/** Where the app's voice plays (#490): aplay, or a hidden Chromium window. */
export type SpeechPlayerKind = 'aplay' | 'chromium'

/** BINGBONG_SPEECH_PLAYER: 'chromium' plays the voice through Chromium (#490); anything else, aplay. */
export function speechPlayerOf(env: Record<string, string | undefined>): SpeechPlayerKind {
  return env.BINGBONG_SPEECH_PLAYER?.trim().toLowerCase() === 'chromium' ? 'chromium' : 'aplay'
}
