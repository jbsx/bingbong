export const TTS_IPC = {
  listVoices: 'tts:listVoices',
  /** Play a voice's sample line (#412); answers a SpeakOutcome once it ends or is stopped. */
  preview: 'tts:preview',
  stopPreview: 'tts:stopPreview',
} as const
