// The ear's state as the screen reads it (#442): the session's own state,
// with what a cold ear still waits for and when its phase began. Main
// keeps one per window, fed the voice process's model loads; the screen
// counts the seconds from `since` on its own clock (UI principle 2).

import { reportFault } from '../trace/fault'
import type { EarLoading, VoiceState } from './ipcChannels'
import { earPhase, type EarPhase } from './voicePrompt'

/** Which of the ear's models load in this run: a scripted double or an engine with no model of its own loads nothing to wait on. */
export interface EarLoads {
  /** The VAD, which every Utterance and the wake gate (#435) hear through. */
  vad: boolean
  /** The wake word's models. */
  wake: boolean
  /** The transcriber, which reads a taken line's words. */
  stt: boolean
}

export interface EarState {
  /** One finished model load; says whether what the ear waits for changed, and whether "I'm ready" — or that the ear did not start (#447) — is now said. */
  modelLoaded(load: { model: string; failed: boolean }): { changed: boolean; sayReady: boolean; sayFailed: boolean }
  /** The session's state with `loading` and `since` (on `now`'s clock). */
  show(state: VoiceState): VoiceState
}

export function createEarState(loads: EarLoads, now: () => number): EarState {
  const waiting = new Set<string>([...(loads.vad ? ['vad'] : []), ...(loads.wake ? ['wake'] : []), ...(loads.stt ? ['stt'] : [])])
  // What did not load (#447): the wait ends there, until a retry of it comes in.
  const failed = new Set<string>()
  let last: VoiceState | null = null
  let phase: EarPhase | null = null
  let since = now()
  // A wake came in while the words loaded (owner ruling 3, #442): the one case the cold start is said aloud.
  let wokeWhileLoading = false

  function loading(): EarLoading | null {
    if (failed.size > 0) return 'failed'
    if (waiting.has('vad') || waiting.has('wake')) return 'ear'
    return waiting.has('stt') ? 'words' : null
  }

  return {
    modelLoaded(load) {
      if (!waiting.has(load.model) && !failed.has(load.model)) return { changed: false, sayReady: false, sayFailed: false }
      const before = loading()
      waiting.delete(load.model)
      if (load.failed) {
        failed.add(load.model)
        reportFault('voice.ear.load', new Error(`the ${load.model} model did not load: the ear cannot start`))
      } else failed.delete(load.model)
      const after = loading()
      // Said only to an open ear no line is being taken in: a held line's own outcome is what it hears next.
      const said = before === 'words' && wokeWhileLoading && last !== null && !last.transcribing && !last.hearing
      const sayReady = said && after === null
      const sayFailed = said && after === 'failed'
      if (after === null || after === 'failed') wokeWhileLoading = false
      return { changed: before !== after, sayReady, sayFailed }
    },
    show(state) {
      last = state
      const waitingFor = loading()
      const shown: VoiceState = { ...state, ...(waitingFor !== null ? { loading: waitingFor } : {}) }
      if (waitingFor === 'words' && state.listening && state.reason === 'wake') wokeWhileLoading = true
      // A line's read counts from its Endpoint, held behind the transcriber's load or not: one clock from Starting into Transcribing.
      const next = state.transcribing ? 'transcribing' : earPhase(shown)
      if (next !== phase) {
        phase = next
        since = now()
      }
      return { ...shown, since }
    },
  }
}
