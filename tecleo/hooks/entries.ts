import type { Entry, Hunk } from '../types'

// Past these an entry is shown whole, not typed.
const BIG_LINES = 400
const BIG_CHARS = 20_000
// What one entry keeps, so a queue of them fits a Client's props.
const KEEP_CHARS = 24_000

type Patch = { oldStart: number; newStart: number; lines: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const splitLines = (source: string): string[] => {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  return lines
}

const patchOf = (value: unknown): Hunk[] => {
  if (!Array.isArray(value)) return []

  return value
    .filter(
      (hunk): hunk is Patch =>
        isRecord(hunk) &&
        typeof hunk.oldStart === 'number' &&
        typeof hunk.newStart === 'number' &&
        Array.isArray(hunk.lines),
    )
    .map(hunk => ({
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      lines: hunk.lines.filter(
        (line): line is string =>
          typeof line === 'string' && /^[ +-]/.test(line),
      ),
    }))
}

const replaced = (before: string, after: string, start = 1): Hunk[] => [
  {
    oldStart: before === '' ? 0 : start,
    newStart: after === '' ? 0 : start,
    lines: [
      ...(before === '' ? [] : splitLines(before).map(line => `-${line}`)),
      ...(after === '' ? [] : splitLines(after).map(line => `+${line}`)),
    ],
  },
]

// Cuts an entry's hunks to KEEP_CHARS, closing with a line that says so.
const trimmed = (hunks: Hunk[]): Hunk[] => {
  let room = KEEP_CHARS
  const kept: Hunk[] = []
  for (const hunk of hunks) {
    const lines: string[] = []
    for (const line of hunk.lines) {
      if (room <= 0) break
      lines.push(line.length > room ? line.slice(0, room) : line)
      room -= line.length + 1
    }
    kept.push({ ...hunk, lines })
    if (room <= 0) {
      lines.push(' …')
      break
    }
  }

  return kept
}

/**
 * The entry a finished Edit, Write or NotebookEdit call makes, or undefined
 * when there is nothing to show.
 */
export const entryOf = (
  id: number,
  tool: string,
  input: Record<string, unknown>,
  result: unknown,
): Entry | undefined => {
  const out = isRecord(result) ? result : {}
  let path = text(out.filePath) ?? text(input.file_path) ?? ''
  let kind: Entry['kind'] = 'edición'
  let hunks = patchOf(out.structuredPatch)

  if (tool === 'Write') {
    const content = text(out.content) ?? text(input.content) ?? ''
    const isNew = out.type === 'create' || out.originalFile === null
    kind = isNew ? 'nuevo' : 'reescrito'
    if (isNew || hunks.length === 0) hunks = replaced('', content)
  } else if (tool === 'NotebookEdit') {
    path = text(out.notebook_path) ?? text(input.notebook_path) ?? ''
    kind = 'notebook'
    hunks = replaced(
      text(out.old_source) ?? '',
      text(out.new_source) ?? text(input.new_source) ?? '',
    )
  } else if (hunks.length === 0) {
    hunks = replaced(
      text(out.oldString) ?? text(input.old_string) ?? '',
      text(out.newString) ?? text(input.new_string) ?? '',
    )
  }

  if (path === '') return undefined
  let added = 0
  let removed = 0
  let addedChars = 0
  for (const line of hunks.flatMap(hunk => hunk.lines)) {
    if (line.startsWith('+')) {
      added += 1
      addedChars += line.length
    } else if (line.startsWith('-')) removed += 1
  }
  if (added === 0 && removed === 0) return undefined

  return {
    id,
    path,
    kind,
    hunks: trimmed(hunks),
    added,
    removed,
    isBig: added > BIG_LINES || addedChars > BIG_CHARS,
  }
}

/** The pane's last path segment and its folder, for the header. */
export const splitPath = (path: string): { name: string; folder: string } => {
  const cut = path.lastIndexOf('/')

  return cut < 0
    ? { name: path, folder: '' }
    : { name: path.slice(cut + 1), folder: path.slice(0, cut + 1) }
}

/** An entry's hunks as one unified diff, for a `Code` under `format: 'diff'`. */
export const diffOf = (entry: Entry): string =>
  entry.hunks
    .map(hunk => {
      const before = hunk.lines.filter(line => !line.startsWith('+')).length
      const after = hunk.lines.filter(line => !line.startsWith('-')).length
      const head = `@@ -${hunk.oldStart},${before} +${hunk.newStart},${after} @@`

      return [head, ...hunk.lines].join('\n')
    })
    .join('\n')
