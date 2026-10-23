import type { ClientModule } from 'claude-code'

import type { TyperProps } from '../types'
import { MAX_RUSH, drawEntry, durationOf } from './view'

const FRAME_MS = 33
const BLINK_FRAMES = 15

type Typing = {
  /** The play under way (`playOf`), '' before any. */
  id: string
  /** Time into it, in the entry's own (sped up) milliseconds. */
  elapsed: number
  /** The play last posted as done. */
  posted: string
}

// One play of an entry: the same entry asked for again is another play.
const playOf = (id: number, props: TyperProps) => `${id}:${props.plays}`

// The props the frame clock reads: the module function sees each new value
// first, and one pane holds one instance.
let latest: TyperProps = {
  queue: [],
  last: null,
  speed: 'normal',
  pending: 0,
  paused: false,
  plays: 0,
}
// Frames since the instance started, for the cursor's blink.
let frames = 0

const Typer: ClientModule<TyperProps, Typing> = (props, surface) => {
  const { Text } = surface.elements
  latest = props

  if (surface.state === undefined) {
    surface.setState({ id: '', elapsed: 0, posted: '' })
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined) return
      frames += 1
      const head = latest.queue[0]
      const play = head === undefined ? '' : playOf(head.id, latest)
      if (head === undefined || now.posted === play || latest.paused) {
        // Nothing to play, or paused: redraw only for the cursor's blink.
        if (frames % BLINK_FRAMES === 0) surface.setState({ ...now })

        return
      }
      if (play !== now.id) {
        surface.setState({ id: play, elapsed: 0, posted: now.posted })

        return
      }
      const rush = Math.min(MAX_RUSH, Math.max(1, latest.pending))
      const elapsed = now.elapsed + FRAME_MS * rush
      if (elapsed >= durationOf(head, latest.speed)) {
        surface.post({ done: head.id })
        surface.setState({ ...now, elapsed, posted: play })

        return
      }
      surface.setState({ ...now, elapsed })
    })
  }

  const state = surface.state ?? { id: '', elapsed: 0, posted: '' }
  const head = props.queue[0]
  const playing =
    head !== undefined && playOf(head.id, props) === state.id ? head : undefined
  const entry = playing ?? head ?? props.last
  if (entry === undefined || entry === null) {
    return <Text dimColor>Esperando a que Claude escriba código…</Text>
  }

  // An entry not yet started draws as it starts; one played, whole.
  const elapsed =
    playing !== undefined
      ? state.elapsed
      : head === entry
        ? 0
        : Number.POSITIVE_INFINITY

  return drawEntry(surface.elements, {
    entry,
    elapsed,
    speed: props.speed,
    rows: surface.rows || 30,
    now: frames * FRAME_MS,
    waiting: Math.max(0, props.pending - (head === undefined ? 0 : 1)),
    paused: props.paused === true && head !== undefined,
  })
}

export default Typer
