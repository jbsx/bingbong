// The Status Capsule's voice hint (#331): the pill beside it names the
// state, so the hint carries only instruction, the live words or a wait's
// object and seconds — never the state word a second time. Transcribing
// carries the words being read and its count, and a cold ear its own
// (#442). While the Voice Prompt is on screen (#359) the Prompt carries the
// hint and the live words, and the capsule says only the state. Otherwise
// the last spoken result (#436) takes the instruction's place until the
// next input: speech cannot be scrolled back by ear, and the live words
// still win.

import type { EarLoading } from './ipcChannels'
import { earPhase, earWaitLine, wordlessLine } from './voicePrompt'

/**
 * The rest hint (#437, principle 9): one wording for the same state on every
 * surface — the Idle Screen's voice line, the capsule, the Voice Prompt's
 * field and the empty Feed. Ctrl+Space is named in Settings, not here.
 */
export const REST_HINT_SAY = 'Say'
export const REST_HINT_WAKE = '“Bing Bong”'
export const REST_HINT_MORE = 'or start typing'
export const REST_HINT = `${REST_HINT_SAY} ${REST_HINT_WAKE} ${REST_HINT_MORE}`

/**
 * The cold start's failed outcome (#447, principles 2 and 9): what did not
 * start and what to do, on every surface — speaking is not heard, typing
 * is, and a restart loads the ear again. The Idle Screen sets the two
 * halves apart, as it does "Microphone off".
 */
export const EAR_FAILED = 'Ear did not start'
export const EAR_FAILED_MORE = 'type, or restart'
export const EAR_FAILED_LINE = `${EAR_FAILED} — ${EAR_FAILED_MORE}`
/** The same, said aloud — only to a wake that came in while the words loaded (#442 ruling 3). */
export const EAR_FAILED_SPOKEN = 'The ear did not start. Type, or restart the app.'

export interface VoiceHintInput {
  transcribing: boolean
  listening: boolean
  /** Speech has started in the Utterance being taken (#441): "…" until the first partial. */
  hearing: boolean
  /** The app's own voice is playing (#472): an open ear that has heard nothing is at rest. */
  speaking?: boolean
  /** Only the wake word listens (the mic is not open for a command). */
  monitoring: boolean
  /** The live partial transcript (#324); empty before the first words. */
  partial: string
  /** What a cold ear still waits for (#442). */
  loading?: EarLoading
  /** When the ear's phase began, on main's wall clock (#442). */
  since?: number
}

export interface VoiceHint {
  kind: 'listening' | 'monitoring' | 'result' | 'starting' | 'failed' | 'transcribing'
  text: string
}

export function voiceHint(voice: VoiceHintInput, options: { promptShown?: boolean; result?: string | null; now?: number } = {}): VoiceHint | null {
  if (options.promptShown === true) return null
  const phase = earPhase(voice)
  const now = options.now ?? Date.now()
  if (phase === 'starting' || phase === 'transcribing') return { kind: phase, text: earWaitLine(phase, voice, now) }
  // The wait has ended (#447): no count, the outcome and the next thing to do.
  // The pill says what did not start (#331: never twice); the hint, what to do.
  if (phase === 'failed') return { kind: 'failed', text: EAR_FAILED_MORE }
  if (phase === 'listening' || phase === 'hearing') {
    return { kind: 'listening', text: voice.partial !== '' ? `“${voice.partial}…”` : wordlessLine(phase) }
  }
  if (options.result != null && options.result !== '') return { kind: 'result', text: options.result }
  if (voice.monitoring) return { kind: 'monitoring', text: REST_HINT }
  return null
}
