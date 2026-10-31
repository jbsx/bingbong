// When the renderer opens the microphone (#530). The rule is pure so that the
// loop it prevents is tested: a capture's failure publishes a voice state, and
// a state that opened the capture again would fail again.

export interface EarAsk {
  listening: boolean
  transcribing: boolean
  monitoring: boolean
}

/** Before the first state: the ear asks for nothing yet. */
export const EAR_SHUT: EarAsk = { listening: false, transcribing: false, monitoring: false }

/**
 * How often a failed capture is tried again with no event to go on (#530): a
 * sound server that comes back may fire no device change. Guess: seldom enough
 * to cost nothing, soon enough that nobody restarts first; how long the kiosk's
 * sound server takes to come back would settle it.
 */
export const CAPTURE_RETRY_MS = 30_000

/** The ear wants the microphone: for a listen, through a read (#38), or while the wake word is watched. */
export function earAsksCapture(state: EarAsk): boolean {
  return state.listening || state.transcribing || state.monitoring
}

/**
 * Whether this state opens the capture. With none failed, any state that
 * asks for one. With one failed, only a new ask: a listen opening, someone
 * asking to be heard now, or the ear reopening from shut, as the Mic Mute
 * going off. `before` is the state last applied.
 */
export function opensCapture(before: EarAsk, state: EarAsk, failed: boolean): boolean {
  if (!earAsksCapture(state)) return false
  if (!failed) return true
  return !earAsksCapture(before) || (state.listening && !before.listening)
}
