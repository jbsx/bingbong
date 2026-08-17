import { join } from 'node:path'

export interface VoiceConfig {
  /** Silero VAD v5 ONNX model. */
  vadModel: string
  /** ggml whisper model (English-only .en models on this CPU). */
  whisperModel: string
  /** Scripted transcripts (e2e double), mirroring BINGBONG_LLM_SCRIPT. */
  sttScript?: string
  /** Scripted VAD probabilities (e2e double), one per 512-sample frame. */
  vadScript?: string
}

export function resolveVoiceConfig(env: Record<string, string | undefined>, userDataDir: string): VoiceConfig {
  const modelsDir = join(userDataDir, 'models')
  return {
    vadModel: env.BINGBONG_VAD_MODEL?.trim() || join(modelsDir, 'silero_vad.onnx'),
    whisperModel: env.BINGBONG_WHISPER_MODEL?.trim() || join(modelsDir, 'ggml-base.en.bin'),
    sttScript: env.BINGBONG_STT_SCRIPT?.trim() || undefined,
    vadScript: env.BINGBONG_VAD_SCRIPT?.trim() || undefined,
  }
}
