import { join } from 'node:path'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'
import { shouldMuteAudio } from '../muteOffScreen'

export interface PiperConfig {
  /** Piper executable; default resolves via PATH. */
  bin: string
  /** Dir holding `<voice>.onnx` + `<voice>.onnx.json` files. */
  voicesDir: string
  /** The Piper voice a line falls back to when Kokoro cannot say it (#412); the settings page's ttsVoice, Kokoro af_heart by default, is the voice. */
  voiceId: string
  /** The player spoken text streams into (#327); default aplay on PATH. The TTS e2e scripts it. */
  playerBin: string
  /** The player's ALSA device: 'null' when the run is muted (tests, agents), else aplay's default. */
  playerDevice?: string
  /** Where Kokoro's model is fetched to (#412): <userData>/models. Null with BINGBONG_KOKORO=off (the e2e), every line then Piper's. */
  kokoroModelsDir: string | null
}

export function resolvePiperConfig(env: Record<string, string | undefined>, userDataDir: string): PiperConfig {
  return {
    bin: env.BINGBONG_PIPER_BIN?.trim() || 'piper',
    voicesDir: env.BINGBONG_PIPER_VOICE_DIR?.trim() || join(userDataDir, 'voices'),
    voiceId: env.BINGBONG_PIPER_VOICE?.trim() || DEFAULT_PIPER_VOICE,
    playerBin: env.BINGBONG_APLAY_BIN?.trim() || 'aplay',
    ...(shouldMuteAudio(env) ? { playerDevice: 'null' } : {}),
    kokoroModelsDir: env.BINGBONG_KOKORO?.trim() === 'off' ? null : join(userDataDir, 'models'),
  }
}
