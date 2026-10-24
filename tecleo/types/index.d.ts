/** One hunk of a change: its first line numbers and its ` `, `-`, `+` lines. */
export type Hunk = { oldStart: number; newStart: number; lines: string[] }

/** One write or edit Claude made, as the pane plays it. */
export type Entry = {
  id: number
  path: string
  kind: 'nuevo' | 'edición' | 'reescrito' | 'notebook' | 'terminal'
  hunks: Hunk[]
  added: number
  removed: number
  /** Too large to type whole: only its first added lines are typed. */
  isBig: boolean
  /** What a big entry leaves out, said under its code. */
  note?: string
  /** A terminal entry's command. */
  command?: string
  /** The files a terminal entry's command seems to change. */
  targets?: string[]
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
  /** Typing stands still while true. */
  paused: boolean
  /** Entries played so far: a new count is a new play, a replay included. */
  plays: number
}

/**
 * What the `Client` posts back: an entry played, or, every few frames, the
 * entry it is typing, which keeps the typing sound going.
 */
export type TyperPost = { done: number; typing?: undefined } | { typing: number; done?: undefined }

/** What the pane says once the queue has emptied. */
export type Summary = {
  entries: number
  files: number
  added: number
  removed: number
}

declare module 'claude-code' {
  interface PluginState {
    tecleo: {
      entries: Shaped<Entry[]>
      /** Every entry up to this id has been played. */
      playhead: number
      /** Entries the person asked to see again, in the order they play. */
      again: number[]
      /** The entry the mod's own player is typing, and how far in. */
      stage: { id: number; elapsed: number }
      paused: boolean
      /** The entry played last, which stays on screen; 0 for the newest. */
      lastPlayed: number
      /** Entries played or skipped so far, as `TyperProps.plays`. */
      plays: number
      /** The speed chosen in the pane or by command; null keeps the setting. */
      speed: Speed | null
      /** Entries a backlog skipped without playing. */
      skipped: number[]
      /** The first entry of the run now playing, 0 when the queue is empty. */
      runFrom: number
      /** What the last run came to, shown once the queue empties. */
      summary: Summary | null
      /** Sound turned on or off in the pane or by command; null keeps the setting. */
      sonido: boolean | null
      /** The full history is open in the pane. */
      showHistory: boolean
    }
  }
}
