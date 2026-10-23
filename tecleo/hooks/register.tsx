import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  Timer,
  ToolCallResult,
} from 'claude-code'

import type { Entry, Speed, TyperPost, TyperProps } from '../types'
import {
  endLineOf,
  entryOf,
  splitPath,
  summaryOf,
  terminalEntryOf,
} from './entries'
import { MAX_RUSH, drawEntry, durationOf, remainingMs } from './view'

const PANE = 'tecleo'
const TITLE = 'Tecleo'
const KEEP = 30
// Entries left waiting at most: older ones are skipped, not played late.
const MAX_PENDING = 5
// How many entries the Client is handed at once.
const HANDED = 3
const RECENT_FILES = 6
// A tick of the mod's own player.
const TICK_MS = 50
const SOUND = 'sounds/tecleo.wav'
const SOUND_GAIN = 0.5

const entries = atom({ plugin: 'tecleo', key: 'entries' } as const, [], {
  shape: 'entries-1',
})
const playhead = atom({ plugin: 'tecleo', key: 'playhead' } as const, 0)
const again = atom({ plugin: 'tecleo', key: 'again' } as const, [])
// Where the mod's own player stands, on surfaces that draw no Client.
const stage = atom({ plugin: 'tecleo', key: 'stage' } as const, {
  id: 0,
  elapsed: 0,
})
const paused = atom({ plugin: 'tecleo', key: 'paused' } as const, false)
const plays = atom({ plugin: 'tecleo', key: 'plays' } as const, 0)
const lastPlayed = atom({ plugin: 'tecleo', key: 'lastPlayed' } as const, 0)
const picked = atom({ plugin: 'tecleo', key: 'speed' } as const, null)
const skipped = atom({ plugin: 'tecleo', key: 'skipped' } as const, [])
const runFrom = atom({ plugin: 'tecleo', key: 'runFrom' } as const, 0)
const summary = atom({ plugin: 'tecleo', key: 'summary' } as const, null)
const soundPick = atom({ plugin: 'tecleo', key: 'sonido' } as const, null)
const showHistory = atom(
  { plugin: 'tecleo', key: 'showHistory' } as const,
  false,
)

// What `/tecleo demo` plays.
const DEMO = {
  filePath: '/demo/saludo.ts',
  structuredPatch: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        ' export function saludo(nombre: string): string {',
        "-  if (!nombre) return 'hola'",
        '+  if (!nombre) {',
        "+    console.warn('sin nombre')",
        "+    return 'hola'",
        '+  }',
        '   return `hola, ${nombre}`',
        ' }',
      ],
    },
  ],
}

const SPEEDS: readonly Speed[] = ['lento', 'normal', 'rapido']
const SPEED_WORDS: Record<string, Speed> = {
  lento: 'lento',
  normal: 'normal',
  rapido: 'rapido',
  rápido: 'rapido',
}

type Settings = {
  speed: Speed
  autoOpen: boolean
  closeAfter: number
  sound: boolean
  editor: string
}

const DEFAULT_EDITOR = 'code -g {archivo}:{linea}'

let settings: Settings = {
  speed: 'normal',
  autoOpen: true,
  closeAfter: 8,
  sound: false,
  editor: DEFAULT_EDITOR,
}
let idle: Timer | undefined
let player: Timer | undefined
let sound: AbortController | undefined

function pendingOf(list: readonly Entry[], head: number): Entry[] {
  return list.filter(entry => entry.id > head)
}

async function soundOn($: EngineInterface): Promise<boolean> {
  return (await read($, soundPick)) ?? settings.sound
}

async function setSound($: EngineInterface, on: boolean): Promise<void> {
  await update($, soundPick, () => on)
  await syncSound($)
}

async function speedOf($: EngineInterface): Promise<Speed> {
  return (await read($, picked)) ?? settings.speed
}

// What plays next: entries asked for again first, then those waiting.
async function queueOf($: EngineInterface): Promise<Entry[]> {
  const list = await read($, entries)
  const waiting = pendingOf(list, await read($, playhead))
  const asked = (await read($, again))
    .map(id => list.find(entry => entry.id === id))
    .filter((entry): entry is Entry => entry !== undefined)

  return [...asked, ...waiting.filter(entry => !asked.includes(entry))]
}

// Closes the pane once Claude has stopped writing for a while and what waits
// has had time to play; each new write or played entry pushes the close back.
async function scheduleClose($: EngineInterface): Promise<void> {
  idle?.cancel()
  idle = undefined
  if (settings.closeAfter <= 0 || (await read($, paused))) return
  const delay =
    settings.closeAfter * 1000 +
    remainingMs(await queueOf($), await speedOf($))
  idle = $.clock.after(delay, () => {
    idle = undefined
    void $.ui.close({ id: PANE }).catch(() => undefined)
  })
}

// The typing sound loops while an entry is typed, if it is turned on.
async function syncSound($: EngineInterface): Promise<void> {
  const head = (await queueOf($))[0]
  const isTyping =
    (await soundOn($)) &&
    head !== undefined &&
    head.kind !== 'terminal' &&
    !(await read($, paused))
  if (!isTyping) {
    sound?.abort()
    sound = undefined

    return
  }
  if (sound !== undefined) return
  const stop = new AbortController()
  sound = stop
  void $.audio
    .play({ asset: SOUND }, { shouldLoop: true, signal: stop.signal, gain: SOUND_GAIN })
    .catch(() => undefined)
    .finally(() => {
      if (sound === stop) sound = undefined
    })
}

// An entry has been played: move on, and once the queue empties say what
// the run came to.
async function finish($: EngineInterface, done: number): Promise<void> {
  const before = await queueOf($)
  if (before[0]?.id !== done) return
  const asked = await read($, again)
  if (asked.includes(done)) {
    await update($, again, ids => ids.filter(id => id !== done))
  } else {
    await update($, playhead, now => Math.max(now, done))
  }
  await update($, plays, n => n + 1)
  await update($, lastPlayed, () => done)
  if ((await queueOf($)).length === 0) {
    const from = await read($, runFrom)
    if (from > 0) {
      const run = (await read($, entries)).filter(entry => entry.id >= from)
      const total = summaryOf(run)
      await update($, summary, () => (total.entries > 1 ? total : null))
      await update($, runFrom, () => 0)
    }
  }
  await scheduleClose($)
  await syncSound($)
}

async function skip($: EngineInterface): Promise<boolean> {
  const head = (await queueOf($))[0]
  if (head === undefined) return false
  await update($, stage, () => ({ id: 0, elapsed: 0 }))
  await finish($, head.id)

  return true
}

async function setPaused($: EngineInterface, value: boolean): Promise<void> {
  await update($, paused, () => value)
  await scheduleClose($)
  await syncSound($)
}

// Plays entries again, before whatever waits.
async function playAgain($: EngineInterface, ids: number[]): Promise<void> {
  await update($, again, now => [...ids, ...now.filter(id => !ids.includes(id))])
  await update($, summary, () => null)
  await scheduleClose($)
  await syncSound($)
}

async function setSpeed($: EngineInterface, speed: Speed): Promise<void> {
  await update($, picked, () => speed)
  await scheduleClose($)
}

const nextSpeed = (speed: Speed): Speed =>
  SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 'normal'

// The editor's command for a file and line, `{archivo}` and `{linea}` filled
// in; on Windows through `cmd /c`, which finds `code.cmd` and the like.
function editorArgv(path: string, line: number): string[] {
  const words = settings.editor.trim().split(/\s+/).filter(word => word !== '')
  const filled = (words.length > 0 ? words : DEFAULT_EDITOR.split(' ')).map(
    word =>
      word.replaceAll('{archivo}', path).replaceAll('{linea}', String(line)),
  )
  const isWindows = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

  return isWindows ? ['cmd', '/c', ...filled] : filled
}

// Opens the entry's file in the editor, on the line its typing ends on.
async function openInEditor(
  $: EngineInterface,
  entry: Entry | undefined,
): Promise<string> {
  const path = entry?.kind === 'terminal' ? entry.targets?.[0] : entry?.path
  if (entry === undefined || path === undefined || path === '') {
    return 'No hay ningún archivo que abrir.'
  }
  const line = entry.kind === 'terminal' ? 1 : endLineOf(entry)
  const where = `${splitPath(path).name}:${line}`
  try {
    const ran = await $.process.run(editorArgv(path, line), { timeoutMs: 15_000 })
    if (ran.exitCode === 0) return `Abierto ${where} en el editor.`

    return `No se pudo abrir ${where}: ${ran.stderr.trim() || `código ${ran.exitCode}`}`
  } catch (error) {
    return `No se pudo abrir ${where}: ${error instanceof Error ? error.message : String(error)}`
  }
}

// The mod's own player, for surfaces that draw no Client: a few frames a
// second through the pane's state, stopping once nothing waits.
async function tick($: EngineInterface): Promise<void> {
  const queue = await queueOf($)
  const head = queue[0]
  if (head === undefined || (await read($, paused))) {
    player?.cancel()
    player = undefined

    return
  }
  const now = await read($, stage)
  if (now.id !== head.id) {
    await update($, stage, () => ({ id: head.id, elapsed: 0 }))

    return
  }
  const rush = Math.min(MAX_RUSH, Math.max(1, queue.length))
  const elapsed = now.elapsed + TICK_MS * rush
  if (elapsed >= durationOf(head, await speedOf($))) {
    await update($, stage, () => ({ id: 0, elapsed: 0 }))
    await finish($, head.id)

    return
  }
  await update($, stage, () => ({ id: head.id, elapsed }))
}

function startPlayer($: EngineInterface): void {
  if (player !== undefined) return
  player = $.clock.every(TICK_MS, () => {
    void tick($).catch(() => undefined)
  })
}

async function record(
  $: EngineInterface,
  make: (id: number) => Entry | undefined,
): Promise<void> {
  const list = await read($, entries)
  const entry = make((list[list.length - 1]?.id ?? 0) + 1)
  if (entry === undefined) return
  const wasEmpty = (await queueOf($)).length === 0
  const next = [...list, entry].slice(-KEEP)
  const first = next[0]?.id ?? entry.id
  await update($, entries, () => next)
  if (wasEmpty) {
    await update($, runFrom, () => entry.id)
    await update($, summary, () => null)
  }
  // A backlog plays its newest few, not everything late; what it passes over
  // is kept so the pane can say so.
  const head = await read($, playhead)
  const waiting = pendingOf(next, head)
  const passed =
    waiting.length > MAX_PENDING
      ? waiting.slice(0, waiting.length - MAX_PENDING).map(item => item.id)
      : []
  if (passed.length > 0) {
    await update($, playhead, now => Math.max(now, passed[passed.length - 1]!))
  }
  await update($, skipped, ids =>
    [...ids, ...passed].filter(id => id >= first),
  )
  await update($, again, ids => ids.filter(id => id >= first))
  if (settings.autoOpen) {
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
  }
  await scheduleClose($)
  await syncSound($)
}

async function afterTool<R extends ToolCallResult>(
  $: EngineInterface,
  e: { readonly tool: string },
  ran: R,
): Promise<R> {
  try {
    if (ran.deny === undefined && ran.isError !== true) {
      const input = e as unknown as Record<string, unknown>
      await record($, id => entryOf(id, e.tool, input, ran.result))
    }
  } catch {
    // Nothing to show for this call.
  }

  return ran
}

// A command run in the terminal: the pane says when it seems to change files.
async function afterShell<R extends ToolCallResult>(
  $: EngineInterface,
  e: { readonly command?: unknown },
  ran: R,
): Promise<R> {
  try {
    if (ran.deny === undefined && typeof e.command === 'string') {
      const command = e.command
      await record($, id => terminalEntryOf(id, command))
    }
  } catch {
    // Nothing to show for this call.
  }

  return ran
}

const HELP =
  'Uso: /tecleo [demo | pausa | seguir | saltar | lento | normal | rapido | sonido | historial | editor]'

export const register: Register = (on, options) => {
  settings = {
    speed: SPEEDS.includes(options.velocidad as Speed)
      ? (options.velocidad as Speed)
      : 'normal',
    autoOpen: options.abrirSolo !== false,
    closeAfter:
      typeof options.cerrarTras === 'number' ? options.cerrarTras : 8,
    sound: options.sonido === true,
    editor:
      typeof options.editor === 'string' && options.editor.trim() !== ''
        ? options.editor
        : DEFAULT_EDITOR,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tecleo',
      description:
        'Abre o cierra el panel donde se teclea el código que escribe Claude; también pausa, salta, cambia la velocidad o lo prueba ("demo")',
      argumentHint: '[demo|pausa|seguir|saltar|lento|normal|rapido|sonido|historial|editor]',
    })

    return next(e)
  })

  on('command.run', { command: 'tecleo' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const speed = SPEED_WORDS[word]
    if (speed !== undefined) {
      await setSpeed($, speed)

      return { text: `Tecleo en velocidad ${speed}.` }
    }
    switch (word) {
      case 'demo':
        await record($, id => entryOf(id, 'Edit', {}, DEMO))
        await $.ui.open({ id: PANE, title: TITLE })

        return { text: 'Demo de tecleo en marcha.' }
      case 'pausa': {
        const isPaused = !(await read($, paused))
        await setPaused($, isPaused)

        return { text: isPaused ? 'Tecleo en pausa.' : 'Tecleo reanudado.' }
      }
      case 'seguir':
        await setPaused($, false)

        return { text: 'Tecleo reanudado.' }
      case 'saltar':
        return {
          text: (await skip($)) ? 'Entrada saltada.' : 'No hay nada que saltar.',
        }
      case 'sonido': {
        const isOn = !(await soundOn($))
        await setSound($, isOn)

        return { text: isOn ? 'Sonido de tecleo activado.' : 'Sonido de tecleo desactivado.' }
      }
      case 'historial':
        await update($, showHistory, () => true)
        await $.ui.open({ id: PANE, title: TITLE })

        return { text: 'Historial de tecleo abierto.' }
      case 'editor': {
        const queue = await queueOf($)
        const list = await read($, entries)
        const played = await read($, lastPlayed)
        const last =
          list.find(entry => entry.id === played) ?? list[list.length - 1]

        return { text: await openInEditor($, queue[0] ?? last) }
      }
      case '':
        break
      default:
        return { text: HELP }
    }
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
  // PowerShell is the shell tool on Windows; the types know only Bash's.
  on('tool.call', { tool: /^(Bash|PowerShell)$/ }, async ($, e, next) =>
    afterShell($, e as { readonly command?: unknown }, await next(e)),
  ).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    const data = e.data as Partial<TyperPost> | null
    if (typeof data?.done !== 'number') return next(e)
    await finish($, data.done)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const list = await read($, entries)
    const queue = await queueOf($)
    // Once nothing waits, the entry played last stays on screen.
    const played = await read($, lastPlayed)
    const last =
      list.find(entry => entry.id === played) ?? list[list.length - 1]

    if (last === undefined) {
      return <Text dimColor>Esperando a que Claude escriba código…</Text>
    }

    const isPaused = await read($, paused)
    const speed = await speedOf($)
    const head = queue[0]
    const shown = head ?? last
    const passed = (await read($, skipped)).filter(id =>
      list.some(entry => entry.id === id),
    )
    const total = await read($, summary)
    const isHistoryOpen = await read($, showHistory)
    const isSoundOn = await soundOn($)

    const controls = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        <Button
          key="pausa"
          hotkey="p"
          onPress={() => setPaused($, !isPaused)}
        >
          {isPaused ? '▶ Seguir' : '⏸ Pausa'}
        </Button>
        {head !== undefined && (
          <Button key="saltar" hotkey="s" onPress={() => skip($)}>
            ⏭ Saltar
          </Button>
        )}
        <Button
          key="velocidad"
          hotkey="v"
          onPress={() => setSpeed($, nextSpeed(speed))}
        >
          {`Velocidad: ${speed}`}
        </Button>
        <Button
          key="editor"
          hotkey="e"
          onPress={async () => {
            $.ui.toast(await openInEditor($, shown))
          }}
        >
          Abrir en editor
        </Button>
        <Button
          key="sonido"
          hotkey="o"
          onPress={() => setSound($, !isSoundOn)}
        >
          {isSoundOn ? '🔊 Sonido' : '🔇 Sonido'}
        </Button>
        <Button
          key="historial"
          hotkey="h"
          onPress={() => update($, showHistory, open => !open)}
        >
          {`${isHistoryOpen ? 'Ocultar historial' : 'Historial'} (${list.length})`}
        </Button>
      </Box>
    )

    const notices = (
      <Box flexDirection="column">
        {passed.length > 0 && (
          <Box flexDirection="row" columnGap={1}>
            <Text color="warning">
              {passed.length === 1
                ? '1 cambio saltado'
                : `${passed.length} cambios saltados`}
            </Text>
            <Button
              key="ver-saltados"
              onPress={async () => {
                await update($, skipped, () => [])
                await playAgain($, passed)
              }}
            >
              Ver
            </Button>
          </Box>
        )}
        {head === undefined && total !== null && (
          <Text color="success">
            {`✓ ${total.files === 1 ? '1 archivo' : `${total.files} archivos`}, +${total.added} −${total.removed}`}
          </Text>
        )}
      </Box>
    )

    // The files touched this session, newest first, each once.
    const seen = new Set<string>()
    const recent: Entry[] = []
    for (const entry of [...list].reverse()) {
      if (entry.kind === 'terminal' || seen.has(entry.path)) continue
      seen.add(entry.path)
      recent.push(entry)
    }
    const files = recent.slice(0, RECENT_FILES)
    const touched = files.length > 0 && (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text dimColor>Tocados:</Text>
        {files.map(entry => (
          <Button
            key={`f${entry.id}`}
            plain
            onPress={() => playAgain($, [entry.id])}
          >
            {splitPath(entry.path).name}
          </Button>
        ))}
      </Box>
    )

    // Every entry kept, newest first: any of them can be played again.
    const history = isHistoryOpen && (
      <Box flexDirection="column">
        <Text dimColor>Historial:</Text>
        {[...list].reverse().map(entry => {
          const name =
            entry.kind === 'terminal'
              ? `⌨ ${(entry.targets ?? []).map(path => splitPath(path).name).join(', ') || 'terminal'}`
              : splitPath(entry.path).name
          const counts =
            entry.kind === 'terminal' ? '' : ` +${entry.added} −${entry.removed}`

          return (
            <Button
              key={`h${entry.id}`}
              plain
              onPress={() => playAgain($, [entry.id])}
            >
              {`${name} · ${entry.kind}${counts}${passed.includes(entry.id) ? ' · saltado' : ''}`}
            </Button>
          )
        })}
      </Box>
    )

    const footer = (
      <Box flexDirection="column">
        {notices}
        {controls}
        {touched}
        {history}
      </Box>
    )

    // The terminal types in a Client of its own, at its frame rate.
    if (e.surface === 'terminal') {
      const { Client } = $.ui.resolve(e)
      const props: TyperProps = {
        queue: queue.slice(0, HANDED),
        last,
        speed,
        pending: queue.length,
        paused: isPaused,
        plays: await read($, plays),
      }

      return (
        <Box flexDirection="column" flexGrow={1}>
          <Client key="typer" module="./typer.tsx" props={props} flexGrow={1} />
          {footer}
        </Box>
      )
    }

    // Elsewhere the mod's own player types it.
    const now = await read($, stage)
    if (head !== undefined && !isPaused) startPlayer($)
    const elapsed =
      head === undefined
        ? Number.POSITIVE_INFINITY
        : now.id === head.id
          ? now.elapsed
          : 0

    return (
      <Box flexDirection="column">
        {drawEntry(els, {
          entry: shown,
          elapsed,
          speed,
          rows: e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30,
          now: Date.now(),
          waiting: Math.max(0, queue.length - 1),
          paused: isPaused && head !== undefined,
        })}
        {footer}
      </Box>
    )
  })
}
