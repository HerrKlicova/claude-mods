/** One hunk of a change: its first line numbers and its ` `, `-`, `+` lines. */
export type Hunk = { oldStart: number; newStart: number; lines: string[] }

/** One write or edit Claude made, as the pane plays it. */
export type Entry = {
  id: number
  path: string
  kind: 'nuevo' | 'edición' | 'reescrito' | 'notebook'
  hunks: Hunk[]
  added: number
  removed: number
  /** Too large to animate: shown whole at once. */
  isBig: boolean
}

export type Speed = 'lento' | 'normal' | 'rapido'

/** What the pane hands its `Client`. */
export type TyperProps = {
  /** Entries still to play, in order. */
  queue: Entry[]
  /** What stays on screen once the queue is empty. */
  last: Entry | null
  speed: Speed
  /** How many entries wait in all, the one playing included. */
  pending: number
}

/** What the `Client` posts back when it has played an entry. */
export type TyperPost = { done: number }

declare module 'claude-code' {
  interface PluginState {
    tecleo: {
      entries: Shaped<Entry[]>
      /** Every entry up to this id has been played. */
      playhead: number
      /** An entry the person asked to see again, 0 for none. */
      replay: number
    }
  }
}
