import { join } from 'node:path'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'

export interface PiperConfig {
  /** Piper executable; default resolves via PATH. */
  bin: string
  /** Dir holding `<voice>.onnx` + `<voice>.onnx.json` files. */
  voicesDir: string
  /** Base voice; the settings page's ttsVoice overrides this at speak time. */
  voiceId: string
}

export function resolvePiperConfig(env: Record<string, string | undefined>, userDataDir: string): PiperConfig {
  return {
    bin: env.BINGBONG_PIPER_BIN?.trim() || 'piper',
    voicesDir: env.BINGBONG_PIPER_VOICE_DIR?.trim() || join(userDataDir, 'voices'),
    voiceId: env.BINGBONG_PIPER_VOICE?.trim() || DEFAULT_PIPER_VOICE,
  }
}
