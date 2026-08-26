import { join } from 'node:path'
import type { SttModel } from '../../core/settings/settings'

export interface VoiceConfig {
  /** Silero VAD v5 ONNX model. */
  vadModel: string
  /**
   * Model root for the app-managed engines: Moonshine (STT, #41/#63) is
   * ensured under <modelsDir>/<tier-dir> on demand.
   */
  modelsDir: string
  /**
   * STT engine tier (#63): snapshot from settings at construction — Small
   * default, Medium opt-in; switching applies at the next app start.
   */
  sttModel: SttModel
  /** Scripted transcripts (e2e double), mirroring BINGBONG_LLM_SCRIPT. */
  sttScript?: string
  /** Scripted VAD probabilities (e2e double), one per 512-sample frame. */
  vadScript?: string
}

export function resolveVoiceConfig(
  env: Record<string, string | undefined>,
  userDataDir: string,
  sttModel: SttModel = 'small',
): VoiceConfig {
  const modelsDir = join(userDataDir, 'models')
  return {
    vadModel: env.BINGBONG_VAD_MODEL?.trim() || join(modelsDir, 'silero_vad.onnx'),
    modelsDir,
    sttModel,
    sttScript: env.BINGBONG_STT_SCRIPT?.trim() || undefined,
    vadScript: env.BINGBONG_VAD_SCRIPT?.trim() || undefined,
  }
}
