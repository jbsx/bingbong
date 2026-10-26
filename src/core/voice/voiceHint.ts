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

export interface VoiceHintInput {
  transcribing: boolean
  listening: boolean
  /** Speech has started in the Utterance being taken (#441): "…" until the first partial. */
  hearing: boolean
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
  kind: 'listening' | 'monitoring' | 'result' | 'starting' | 'transcribing'
  text: string
}

export function voiceHint(voice: VoiceHintInput, options: { promptShown?: boolean; result?: string | null; now?: number } = {}): VoiceHint | null {
  if (options.promptShown === true) return null
  const phase = earPhase(voice)
  const now = options.now ?? Date.now()
  if (phase === 'starting' || phase === 'transcribing') return { kind: phase, text: earWaitLine(phase, voice, now) }
  if (voice.listening) {
    return { kind: 'listening', text: voice.partial !== '' ? `“${voice.partial}…”` : wordlessLine(voice.hearing ? 'hearing' : 'listening') }
  }
  if (options.result != null && options.result !== '') return { kind: 'result', text: options.result }
  if (voice.monitoring) return { kind: 'monitoring', text: REST_HINT }
  return null
}
