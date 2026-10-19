import type { VoiceState } from '../voice/ipcChannels'

// Ducking (#344, CONTEXT.md Voice): while the ear is open, a line is
// spoken or the Timer rings, the music drops to a floor, and it comes back
// when the last of them lets go. The ear holds from the listen opening (a
// wake, a push-to-talk, a Hot Listen) to its Utterance's end — the Command
// fired or the line dropped; speech starting again inside a Hot Listen
// holds it again. The Player does the ducking; this only decides when.

export type DuckReason = 'ear' | 'speech' | 'ring'

export interface Ducking {
  /** A spoken line plays (`speech`) or the Timer rings (`ring`), or stops. */
  hold(reason: Exclude<DuckReason, 'ear'>, on: boolean): void
  /** The voice session's state: a listen opening holds the ear, its closing lets go. */
  voiceState(state: VoiceState): void
  /** Speech started inside a listen. */
  speechStarted(): void
  /** The Utterance ended: submitted, or dropped before its Endpoint. */
  utteranceEnded(): void
}

/** The gate: `duck(true)` when the first reason holds, `duck(false)` when the last lets go. */
export function createDucking(duck: (on: boolean) => void): Ducking {
  const held = new Set<DuckReason>()
  /** The ear is open: listening, or transcribing what it heard. */
  let open = false

  function set(reason: DuckReason, on: boolean): void {
    const was = held.size > 0
    if (on) held.add(reason)
    else held.delete(reason)
    const now = held.size > 0
    if (now !== was) duck(now)
  }

  return {
    hold: set,
    voiceState(state) {
      const opened = state.listening || state.transcribing
      if (opened === open) return
      open = opened
      set('ear', opened)
    },
    speechStarted() {
      if (open) set('ear', true)
    },
    utteranceEnded() {
      set('ear', false)
    },
  }
}
