import type { Entry, Hunk } from '../types'

// Past these an entry is big: only its first added lines are typed.
const BIG_LINES = 400
const BIG_CHARS = 20_000
const BIG_TYPED = 60
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
  const isBig = added > BIG_LINES || addedChars > BIG_CHARS
  if (!isBig) {
    return { id, path, kind, hunks: trimmed(hunks), added, removed, isBig }
  }

  return {
    id,
    path,
    kind,
    hunks: trimmed(addedOnly(hunks, BIG_TYPED)),
    added,
    removed,
    isBig,
    note: bigNote(Math.max(0, added - BIG_TYPED), removed),
  }
}

// A big change's added lines alone, the first `keep` of them, each hunk
// starting where its first added line stands.
const addedOnly = (hunks: Hunk[], keep: number): Hunk[] => {
  const kept: Hunk[] = []
  let left = keep
  for (const hunk of hunks) {
    if (left <= 0) break
    let oldAt = hunk.oldStart
    let newAt = hunk.newStart
    let run: Hunk | undefined
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        if (left <= 0) break
        if (run === undefined) {
          run = { oldStart: oldAt, newStart: Math.max(1, newAt), lines: [] }
          kept.push(run)
        }
        run.lines.push(line)
        left -= 1
        newAt += 1
      } else {
        // A line not typed ends the run: the next added one starts a hunk.
        run = undefined
        if (line.startsWith('-')) oldAt += 1
        else {
          oldAt += 1
          newAt += 1
        }
      }
    }
  }

  return kept
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

const bigNote = (more: number, removed: number): string => {
  const parts: string[] = []
  if (more > 0) parts.push(plural(more, 'línea añadida más', 'líneas añadidas más'))
  if (removed > 0) parts.push(plural(removed, 'quitada', 'quitadas'))

  return parts.length === 0 ? '' : `… ${parts.join(' y ')}, sin mostrar`
}

// What a shell command seems to change, as far as reading it tells.
const WRITES = [
  /(^|[^<>&|0-9])>>?\s*[^\s&|>]/,
  /\b(sed|perl)\s+(-\w+\s+)*-i/,
  /\btee\b/,
  /(^|[\s;&|(])(mv|cp|rm|touch|mkdir|rmdir|ln|truncate|patch|install|unzip|tar)\s/,
  /\bgit\s+(apply|checkout|restore|mv|rm|reset|stash|merge|rebase|pull|cherry-pick|am)\b/,
  /\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content)\b/i,
]
const NOT_FILES = /^(\/dev\/(null|stdout|stderr)|nul|\$null|&\d*)$/i

const unquote = (word: string) => word.replace(/^["']|["']$/g, '')

/** The files a command names as it writes them: redirects, `tee`, cmdlets. */
const targetsOf = (command: string): string[] => {
  const found: string[] = []
  const take = (word: string | undefined) => {
    if (word === undefined) return
    const path = unquote(word)
    if (path !== '' && !NOT_FILES.test(path) && !found.includes(path)) {
      found.push(path)
    }
  }
  for (const m of command.matchAll(/(?:^|[^<>&|0-9])>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>()]+)/g)) {
    take(m[1])
  }
  for (const m of command.matchAll(/\btee\s+(?:-a\s+)?("[^"]+"|'[^']+'|[^\s;&|<>()-][^\s;&|<>()]*)/g)) {
    take(m[1])
  }
  for (const m of command.matchAll(
    /\b(?:Set-Content|Add-Content|Out-File|New-Item|Clear-Content)\s+(?:-(?:Path|FilePath|LiteralPath)\s+)?("[^"]+"|'[^']+'|[^\s;&|<>()-][^\s;&|<>()]*)/gi,
  )) {
    take(m[1])
  }
  for (const m of command.matchAll(/\b(?:sed|perl)\s+(?:-\w+\s+)*-i\S*\s+(?:(?:-e\s+)?("[^"]*"|'[^']*')\s+)+("[^"]+"|'[^']+'|[^\s;&|<>()]+)/g)) {
    take(m[2])
  }

  return found
}

/**
 * The entry a Bash or PowerShell command makes when it looks like it changes
 * files, or undefined when it reads as one that does not.
 */
export const terminalEntryOf = (
  id: number,
  command: string,
): Entry | undefined => {
  if (!WRITES.some(pattern => pattern.test(command))) return undefined
  const targets = targetsOf(command)

  return {
    id,
    path: targets[0] ?? '',
    kind: 'terminal',
    hunks: [],
    added: 0,
    removed: 0,
    isBig: false,
    command: command.length > 2000 ? `${command.slice(0, 2000)}…` : command,
    targets,
  }
}

/** The line typing ends on: the last added line, else the first changed. */
export const endLineOf = (entry: Entry): number => {
  let end = 0
  for (const hunk of entry.hunks) {
    let at = Math.max(1, hunk.newStart)
    for (const line of hunk.lines) {
      if (line.startsWith('+')) end = at
      if (!line.startsWith('-')) at += 1
    }
  }
  if (end > 0) return end

  return Math.max(1, entry.hunks[0]?.newStart ?? 1)
}

/** What a run of entries came to: files touched and lines added and removed. */
export const summaryOf = (list: readonly Entry[]) => {
  const files = new Set<string>()
  let added = 0
  let removed = 0
  for (const entry of list) {
    for (const path of entry.kind === 'terminal' ? entry.targets ?? [] : [entry.path]) {
      if (path !== '') files.add(path)
    }
    added += entry.added
    removed += entry.removed
  }

  return { entries: list.length, files: files.size, added, removed }
}

/**
 * The pane's last path segment and its folder, for the header: cut at the
 * last `/` or `\`, so Windows paths split too.
 */
export const splitPath = (path: string): { name: string; folder: string } => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

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
