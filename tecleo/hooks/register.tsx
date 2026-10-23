import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  Timer,
  ToolCallResult,
} from 'claude-code'

import type { Entry, Speed, TyperPost, TyperProps } from '../types'
import { diffOf, entryOf, splitPath } from './entries'

const PANE = 'tecleo'
const TITLE = 'Tecleo'
const KEEP = 30
// Entries left waiting at most: older ones are skipped, not played late.
const MAX_PENDING = 5
// How many entries the Client is handed at once.
const HANDED = 3
const RECENT_FILES = 6

const entries = atom({ plugin: 'tecleo', key: 'entries' } as const, [], {
  shape: 'entries-1',
})
const playhead = atom({ plugin: 'tecleo', key: 'playhead' } as const, 0)
const replay = atom({ plugin: 'tecleo', key: 'replay' } as const, 0)

const SPEEDS: readonly Speed[] = ['lento', 'normal', 'rapido']

type Settings = { speed: Speed; autoOpen: boolean; closeAfter: number }

let settings: Settings = { speed: 'normal', autoOpen: true, closeAfter: 8 }
let idle: Timer | undefined

function pendingOf(list: readonly Entry[], head: number): Entry[] {
  return list.filter(entry => entry.id > head)
}

// Closes the pane once Claude has stopped writing for a while; each new
// write or played entry pushes the close back.
function scheduleClose($: EngineInterface, waiting: number): void {
  idle?.cancel()
  idle = undefined
  if (settings.closeAfter <= 0) return
  const delay =
    settings.closeAfter * 1000 + Math.min(waiting, MAX_PENDING) * 1600
  idle = $.clock.after(delay, () => {
    idle = undefined
    void $.ui.close({ id: PANE }).catch(() => undefined)
  })
}

async function record(
  $: EngineInterface,
  tool: string,
  input: Record<string, unknown>,
  result: unknown,
): Promise<void> {
  const list = await read($, entries)
  const id = (list[list.length - 1]?.id ?? 0) + 1
  const entry = entryOf(id, tool, input, result)
  if (entry === undefined) return
  const next = [...list, entry].slice(-KEEP)
  await update($, entries, () => next)
  // A backlog plays its newest few, not everything late.
  const head = await read($, playhead)
  const waiting = pendingOf(next, head)
  if (waiting.length > MAX_PENDING) {
    const skipTo = waiting[waiting.length - MAX_PENDING - 1]!.id
    await update($, playhead, now => Math.max(now, skipTo))
  }
  if (settings.autoOpen) {
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
  }
  scheduleClose($, Math.min(waiting.length, MAX_PENDING))
}

async function afterTool<R extends ToolCallResult>(
  $: EngineInterface,
  e: { readonly tool: string },
  ran: R,
): Promise<R> {
  try {
    if (ran.deny === undefined && ran.isError !== true) {
      await record($, e.tool, e as unknown as Record<string, unknown>, ran.result)
    }
  } catch {
    // Nothing to show for this call.
  }

  return ran
}

export const register: Register = (on, options) => {
  settings = {
    speed: SPEEDS.includes(options.velocidad as Speed)
      ? (options.velocidad as Speed)
      : 'normal',
    autoOpen: options.abrirSolo !== false,
    closeAfter:
      typeof options.cerrarTras === 'number' ? options.cerrarTras : 8,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tecleo',
      description: 'Abre o cierra el panel donde se teclea el código que escribe Claude',
    })

    return next(e)
  })

  on('command.run', { command: 'tecleo' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE)) {
      idle?.cancel()
      await $.ui.close({ id: PANE })

      return { text: 'Panel de tecleo cerrado.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Panel de tecleo abierto.' }
  })

  // The panel never stands in a tool's way: a failure here drops the entry
  // and the call's own result goes back untouched.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) =>
    afterTool($, e, await next(e)),
  ).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) =>
    afterTool($, e, await next(e)),
  ).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) =>
    afterTool($, e, await next(e)),
  ).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    const data = e.data as Partial<TyperPost> | null
    if (typeof data?.done !== 'number') return next(e)
    const done = data.done
    if ((await read($, replay)) === done) await update($, replay, () => 0)
    else await update($, playhead, now => Math.max(now, done))
    const list = await read($, entries)
    scheduleClose($, pendingOf(list, await read($, playhead)).length)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Code } = els
    const list = await read($, entries)
    const head = await read($, playhead)
    const again = await read($, replay)
    const replayed = list.find(entry => entry.id === again)
    const waiting = pendingOf(list, head)
    const last = list[list.length - 1] ?? null

    // The files touched this session, newest first, each once.
    const seen = new Set<string>()
    const recent: Entry[] = []
    for (const entry of [...list].reverse()) {
      if (seen.has(entry.path)) continue
      seen.add(entry.path)
      recent.push(entry)
    }
    const files = recent.slice(0, RECENT_FILES)
    const footer = files.length > 1 && (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        <Text dimColor>Tocados:</Text>
        {files.map(entry => (
          <Button
            key={`f${entry.id}`}
            plain
            onPress={() => update($, replay, () => entry.id)}
          >
            {splitPath(entry.path).name}
          </Button>
        ))}
      </Box>
    )

    if (list.length === 0) {
      return <Text dimColor>Esperando a que Claude escriba código…</Text>
    }

    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      const queue =
        replayed === undefined
          ? waiting
          : [replayed, ...waiting.filter(entry => entry.id !== replayed.id)]
      const props: TyperProps = {
        queue: queue.slice(0, HANDED),
        last,
        speed: settings.speed,
        pending: queue.length,
      }

      return (
        <Box flexDirection="column" flexGrow={1}>
          <Client key="typer" module="./typer.tsx" props={props} flexGrow={1} />
          {footer}
        </Box>
      )
    }

    // A surface with no Client shows the change whole, not typed.
    const entry = replayed ?? last!
    const { name, folder } = splitPath(entry.path)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold color="claude">
            {`✎ ${name}`}
          </Text>
          <Text dimColor>{entry.kind}</Text>
          {entry.added > 0 && <Text color="success">{`+${entry.added}`}</Text>}
          {entry.removed > 0 && <Text color="error">{`−${entry.removed}`}</Text>}
        </Box>
        {folder !== '' && <Text dimColor>{folder}</Text>}
        <Code source={diffOf(entry)} path={entry.path} format="diff" />
        {footer}
      </Box>
    )
  })
}
