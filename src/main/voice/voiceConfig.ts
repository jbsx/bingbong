import { join } from 'node:path'

export interface VoiceConfig {
  /** Silero VAD v5 ONNX model. */
  vadModel: string
  /**
   * Model root for the app-managed engines: Moonshine Base (STT, #41) is
   * ensured under <modelsDir>/moonshine-base on demand.
   */
  modelsDir: string
  /** Scripted transcripts (e2e double), mirroring BINGBONG_LLM_SCRIPT. */
  sttScript?: string
  /** Scripted VAD probabilities (e2e double), one per 512-sample frame. */
  vadScript?: string
}

export function resolveVoiceConfig(env: Record<string, string | undefined>, userDataDir: string): VoiceConfig {
  const modelsDir = join(userDataDir, 'models')
  return {
    vadModel: env.BINGBONG_VAD_MODEL?.trim() || join(modelsDir, 'silero_vad.onnx'),
    modelsDir,
    sttScript: env.BINGBONG_STT_SCRIPT?.trim() || undefined,
    vadScript: env.BINGBONG_VAD_SCRIPT?.trim() || undefined,
  }
}
