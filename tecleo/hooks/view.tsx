import type { ClientElements } from 'claude-code'

import type { Entry, Speed } from '../types'

const FADE_MS = 260
const HOLD_MS = 450
const BIG_HOLD_MS = 700
const BLINK_MS = 500
// Characters a second at the least, and how long an entry may take at most.
const SPEED: Record<Speed, { cps: number; budgetMs: number }> = {
  lento: { cps: 30, budgetMs: 12_000 },
  normal: { cps: 70, budgetMs: 6000 },
  rapido: { cps: 250, budgetMs: 2500 },
}

/** How many entries waiting speed the one playing up, at most. */
export const MAX_RUSH = 8

// `oldAt` and `newAt`: the row's line numbers before and after the change.
type Row = {
  kind: ' ' | '-' | '+' | '~'
  oldAt: number
  newAt: number
  text: string
}
type Shown = Row & { shown: string }

export type Timing = { fade: number; type: number; hold: number; cps: number }

/** The elements drawing an entry takes, on every surface. */
export type Drawing = Pick<ClientElements, 'Box' | 'Text' | 'Code'>

const rowsOf = (entry: Entry): Row[] => {
  const rows: Row[] = []
  entry.hunks.forEach((hunk, index) => {
    if (index > 0) rows.push({ kind: '~', oldAt: 0, newAt: 0, text: '' })
    let oldAt = Math.max(1, hunk.oldStart)
    let newAt = Math.max(1, hunk.newStart)
    for (const line of hunk.lines) {
      const kind = line[0] === '-' ? '-' : line[0] === '+' ? '+' : ' '
      const text = line.slice(1).replace(/\t/g, '  ')
      rows.push({ kind, oldAt, newAt, text })
      if (kind !== '+') oldAt += 1
      if (kind !== '-') newAt += 1
    }
  })

  return rows
}

// Rows in view as unified-diff hunks, one per run between separators.
const diffSource = (rows: readonly Shown[]): string => {
  const hunks: string[] = []
  let run: Shown[] = []
  const flush = () => {
    const first = run[0]
    if (first === undefined) return
    const before = run.filter(row => row.kind !== '+').length
    const after = run.filter(row => row.kind !== '-').length
    const oldStart = before === 0 ? first.oldAt - 1 : first.oldAt
    const newStart = after === 0 ? first.newAt - 1 : first.newAt
    hunks.push(
      [
        `@@ -${oldStart},${before} +${newStart},${after} @@`,
        ...run.map(row => `${row.kind}${row.shown}`),
      ].join('\n'),
    )
    run = []
  }
  for (const row of rows) {
    if (row.kind === '~') flush()
    else run.push(row)
  }
  flush()

  return hunks.join('\n')
}

/** How long each part of playing an entry takes, in its own milliseconds. */
export const timingOf = (entry: Entry, speed: Speed): Timing => {
  if (entry.isBig) return { fade: 0, type: 0, hold: BIG_HOLD_MS, cps: 1 }
  const { cps: least, budgetMs } = SPEED[speed] ?? SPEED.normal
  const chars = rowsOf(entry)
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

export const durationOf = (entry: Entry, speed: Speed): number => {
  const timing = timingOf(entry, speed)

  return timing.fade + timing.type + timing.hold
}

const splitPath = (path: string) => {
  const cut = path.lastIndexOf('/')

  return cut < 0
    ? { name: path, folder: '' }
    : { name: path.slice(cut + 1), folder: path.slice(0, cut + 1) }
}

export type DrawArgs = {
  entry: Entry
  /** Time into the entry; Infinity draws it whole. */
  elapsed: number
  speed: Speed
  /** Rows there is room for. */
  rows: number
  /** Real milliseconds, for the cursor's blink. */
  now: number
  /** Entries waiting after this one. */
  waiting: number
}

/** One entry as far as it has been typed: its header and its code. */
export const drawEntry = (
  { Box, Text, Code }: Drawing,
  { entry, elapsed, speed, rows: room, now, waiting }: DrawArgs,
) => {
  const rows = rowsOf(entry)
  const timing = timingOf(entry, speed)
  const typed =
    entry.isBig || !Number.isFinite(elapsed)
      ? Number.POSITIVE_INFINITY
      : Math.floor(((elapsed - timing.fade) * timing.cps) / 1000)
  const isTyping = Number.isFinite(typed) && !entry.isBig
  const isBlinkOn = Math.floor(now / BLINK_MS) % 2 === 0

  // Walk the rows, typing the added ones in order.
  const shown: Shown[] = []
  let left = typed
  let cursorAt = -1
  let firstChange = -1
  for (const row of rows) {
    if (row.kind !== '+') {
      if (row.kind === '-' && firstChange < 0) firstChange = shown.length
      shown.push({ ...row, shown: row.text })
      continue
    }
    if (left <= 0) continue
    const take = Math.min(row.text.length, left)
    left -= row.text.length + 1
    shown.push({ ...row, shown: row.text.slice(0, take) })
    cursorAt = shown.length - 1
  }
  const cursorRow = shown[cursorAt]
  if (cursorRow !== undefined && isTyping) {
    cursorRow.shown += isBlinkOn ? '▌' : ' '
  }

  // Keep the cursor in view, a few rows of context under it.
  const space = Math.max(4, room - 2)
  const anchor = cursorAt >= 0 ? cursorAt : Math.max(0, firstChange)
  const start = Math.max(0, Math.min(anchor - (space - 4), shown.length - space))
  const view = shown.slice(start, start + space)
  const { name, folder } = splitPath(entry.path)

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
      {folder !== '' && (
        <Text dimColor wrap="truncate-start">
          {folder}
        </Text>
      )}
      {entry.kind === 'nuevo' ? (
        <Code
          source={view.map(row => row.shown).join('\n') || ' '}
          path={entry.path}
          startLine={view[0]?.newAt ?? 1}
          wrap="truncate-end"
        />
      ) : (
        <Code
          source={diffSource(view) || ' '}
          path={entry.path}
          format="diff"
          wrap="truncate-end"
        />
      )}
    </Box>
  )
}
