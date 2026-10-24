import { join } from 'node:path'
import type { SttModel } from '../../core/settings/settings'

export interface VoiceConfig {
  /** Silero VAD v5 ONNX model. */
  vadModel: string
  /**
   * Model root for the app-managed engines: Parakeet (STT, #358) and the
   * Moonshine tiers (#41/#63) are each ensured under their own subdir on demand.
   */
  modelsDir: string
  /**
   * STT engine (#63, #358): snapshot from settings at construction —
   * Parakeet by default, a Moonshine tier as the lighter choice; switching
   * applies at the next app start.
   */
  sttEngine: SttModel
  /** Scripted transcripts (e2e double), mirroring BINGBONG_LLM_SCRIPT. */
  sttScript?: string
  /** Scripted VAD probabilities (e2e double), one per 512-sample frame. */
  vadScript?: string
  /** Scripted turn-check probabilities (e2e double, #357), one per check. */
  turnScript?: string
}

/** The profile, where the fetched engines land, and the models shipped inside the package (ADR 0090). */
export interface VoiceDirs {
  userDataDir: string
  bundledModelsDir: string
}

export function resolveVoiceConfig(
  env: Record<string, string | undefined>,
  dirs: VoiceDirs,
  sttEngine: SttModel = 'parakeet',
): VoiceConfig {
  const modelsDir = join(dirs.userDataDir, 'models')
  return {
    vadModel: env.BINGBONG_VAD_MODEL?.trim() || join(dirs.bundledModelsDir, 'silero_vad.onnx'),
    modelsDir,
    sttEngine,
    sttScript: env.BINGBONG_STT_SCRIPT?.trim() || undefined,
    vadScript: env.BINGBONG_VAD_SCRIPT?.trim() || undefined,
    turnScript: env.BINGBONG_TURN_SCRIPT?.trim() || undefined,
  }
}
