// The Status Capsule's voice hint (#331): the pill beside it names the
// state, so the hint carries only instruction or the live words — never
// the state word a second time. Transcribing has nothing to add. While
// the Voice Prompt is on screen (#359) the Prompt carries the hint and the
// live words, and the capsule says only the state.

export interface VoiceHintInput {
  transcribing: boolean
  listening: boolean
  /** Only the wake word listens (the mic is not open for a command). */
  monitoring: boolean
  /** The live partial transcript (#324); empty before the first words. */
  partial: string
}

export interface VoiceHint {
  kind: 'listening' | 'monitoring'
  text: string
}

export function voiceHint(voice: VoiceHintInput, options: { promptShown?: boolean } = {}): VoiceHint | null {
  if (voice.transcribing || options.promptShown === true) return null
  if (voice.listening) {
    return { kind: 'listening', text: voice.partial !== '' ? `“${voice.partial}…”` : 'say a command' }
  }
  if (voice.monitoring) return { kind: 'monitoring', text: 'say “Bing Bong” or press Ctrl+Space' }
  return null
}
