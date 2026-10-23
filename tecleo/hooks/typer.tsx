import type { ClientModule } from 'claude-code'

import type { Entry, Speed, TyperProps } from '../types'

const FRAME_MS = 33
const FADE_MS = 260
const HOLD_MS = 450
const BIG_HOLD_MS = 700
const BLINK_FRAMES = 15
// Characters a second at the least, and how long an entry may take at most.
const SPEED: Record<Speed, { cps: number; budgetMs: number }> = {
  lento: { cps: 350, budgetMs: 3000 },
  normal: { cps: 1100, budgetMs: 1500 },
  rapido: { cps: 3000, budgetMs: 700 },
}
const MAX_RUSH = 8

type Row = { kind: ' ' | '-' | '+' | '~'; no: number; text: string }

type Typing = {
  /** The entry being played, 0 before any. */
  id: number
  /** Time into it, in the entry's own (sped up) milliseconds. */
  elapsed: number
  /** The entry last posted as played. */
  posted: number
}

type Timing = { fade: number; type: number; hold: number; cps: number }

const rowsOf = (entry: Entry): Row[] => {
  const rows: Row[] = []
  entry.hunks.forEach((hunk, index) => {
    if (index > 0) rows.push({ kind: '~', no: 0, text: '' })
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (const line of hunk.lines) {
      const kind = line[0] === '-' ? '-' : line[0] === '+' ? '+' : ' '
      const text = line.slice(1).replace(/\t/g, '  ')
      if (kind === '-') rows.push({ kind, no: oldNo++, text })
      else if (kind === '+') rows.push({ kind, no: newNo++, text })
      else {
        rows.push({ kind, no: newNo++, text })
        oldNo += 1
      }
    }
  })

  return rows
}

const timingOf = (entry: Entry, rows: Row[], speed: Speed): Timing => {
  if (entry.isBig) return { fade: 0, type: 0, hold: BIG_HOLD_MS, cps: 1 }
  const { cps: least, budgetMs } = SPEED[speed] ?? SPEED.normal
  const chars = rows
    .filter(row => row.kind === '+')
    .reduce((sum, row) => sum + row.text.length + 1, 0)
  const cps = Math.max(least, (chars * 1000) / budgetMs)

  return {
    fade: entry.removed > 0 ? FADE_MS : 0,
    type: (chars * 1000) / cps,
    hold: HOLD_MS,
    cps,
  }
}

const splitPath = (path: string) => {
  const cut = path.lastIndexOf('/')

  return cut < 0
    ? { name: path, folder: '' }
    : { name: path.slice(cut + 1), folder: path.slice(0, cut + 1) }
}

// The props the frame clock reads: the module function sees each new value
// first, and one pane holds one instance.
let latest: TyperProps = { queue: [], last: null, speed: 'normal', pending: 0 }
// Frames since the instance started, for the cursor's blink.
let frames = 0

const Typer: ClientModule<TyperProps, Typing> = (props, surface) => {
  const { Box, Text, Code } = surface.elements
  latest = props

  if (surface.state === undefined) {
    surface.setState({ id: 0, elapsed: 0, posted: 0 })
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined) return
      frames += 1
      const blinks = frames % BLINK_FRAMES === 0
      const head = latest.queue[0]
      if (head === undefined || now.posted === head.id) {
        // Nothing to play: redraw only for the cursor's blink.
        if (blinks) surface.setState({ ...now })

        return
      }
      if (head.id !== now.id) {
        surface.setState({ id: head.id, elapsed: 0, posted: now.posted })

        return
      }
      const rush = Math.min(MAX_RUSH, Math.max(1, latest.pending))
      const elapsed = now.elapsed + FRAME_MS * rush
      const timing = timingOf(head, rowsOf(head), latest.speed)
      if (elapsed >= timing.fade + timing.type + timing.hold) {
        surface.post({ done: head.id })
        surface.setState({ ...now, elapsed, posted: head.id })

        return
      }
      surface.setState({ ...now, elapsed })
    })
  }

  const state = surface.state ?? { id: 0, elapsed: 0, posted: 0 }
  const head = props.queue[0]
  const playing = head !== undefined && head.id === state.id ? head : undefined
  const entry = playing ?? head ?? props.last
  if (entry === undefined || entry === null) {
    return <Text dimColor>Esperando a que Claude escriba código…</Text>
  }

  const rows = rowsOf(entry)
  const timing = timingOf(entry, rows, props.speed)
  // An entry not yet started draws as it starts; one played, whole.
  const elapsed =
    playing === undefined
      ? head === entry
        ? 0
        : Number.POSITIVE_INFINITY
      : state.elapsed
  const isFading = elapsed < timing.fade
  let typed = Number.isFinite(elapsed)
    ? Math.floor(((elapsed - timing.fade) * timing.cps) / 1000)
    : Number.POSITIVE_INFINITY
  if (entry.isBig && Number.isFinite(elapsed)) typed = Number.POSITIVE_INFINITY
  const isBlinkOn = Math.floor(frames / BLINK_FRAMES) % 2 === 0

  // Walk the rows, typing the added ones in order.
  type Shown = Row & { shown: string; hasCursor: boolean }
  const shown: Shown[] = []
  let left = typed
  let cursorAt = -1
  let firstChange = -1
  for (const row of rows) {
    if (row.kind !== '+') {
      if (row.kind === '-' && firstChange < 0) firstChange = shown.length
      shown.push({ ...row, shown: row.text, hasCursor: false })
      continue
    }
    if (left <= 0) continue
    const take = Math.min(row.text.length, left)
    left -= row.text.length + 1
    shown.push({ ...row, shown: row.text.slice(0, take), hasCursor: false })
    cursorAt = shown.length - 1
  }
  if (cursorAt >= 0 && !entry.isBig) shown[cursorAt]!.hasCursor = true

  // Keep the cursor in view, a few rows of context under it.
  const room = Math.max(4, (surface.rows || 30) - 3)
  const anchor = cursorAt >= 0 ? cursorAt : Math.max(0, firstChange)
  const start = Math.max(
    0,
    Math.min(anchor - (room - 4), shown.length - room),
  )
  const view = shown.slice(start, start + room)
  const width = String(rows.reduce((top, row) => Math.max(top, row.no), 0)).length
  const { name, folder } = splitPath(entry.path)
  const waiting = Math.max(0, props.pending - (head === undefined ? 0 : 1))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold color="claude" wrap="truncate-end">
          {`✎ ${name}`}
        </Text>
        <Text dimColor>{entry.kind}</Text>
        {entry.added > 0 && <Text color="success">{`+${entry.added}`}</Text>}
        {entry.removed > 0 && <Text color="error">{`−${entry.removed}`}</Text>}
        {waiting > 0 && <Text dimColor>{`· ${waiting} en cola`}</Text>}
        {entry.isBig && <Text dimColor>· grande, sin animar</Text>}
      </Box>
      <Text dimColor wrap="truncate-start">
        {folder === '' ? ' ' : folder}
      </Text>
      {view.map((row, index) =>
        row.kind === '~' ? (
          <Text key={`r${start + index}`} dimColor>
            {' '.repeat(width)} ⋯
          </Text>
        ) : (
          <Box key={`r${start + index}`} flexDirection="row">
            <Text dimColor>{String(row.no).padStart(width)} </Text>
            <Text
              color={row.kind === '+' ? 'success' : row.kind === '-' ? 'error' : undefined}
              dimColor={row.kind === ' '}
            >
              {row.kind}{' '}
            </Text>
            {row.kind === '-' ? (
              <Text
                color="error"
                strikethrough
                dimColor={!isFading}
                wrap="truncate-end"
              >
                {row.shown === '' ? ' ' : row.shown}
              </Text>
            ) : (
              <Box flexGrow={1} flexShrink={1}>
                <Code
                  source={
                    (row.shown === '' && !row.hasCursor ? ' ' : row.shown) +
                    (row.hasCursor ? (isBlinkOn ? '▌' : ' ') : '')
                  }
                  path={entry.path}
                  wrap="truncate-end"
                />
              </Box>
            )}
          </Box>
        ),
      )}
    </Box>
  )
}

export default Typer
