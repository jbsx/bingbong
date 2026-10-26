import { join } from 'node:path'
import { asSttModel, type SttModel } from '../../core/settings/settings'

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
  /** The cloud ear's key and endpoint (#463): present when ElevenLabs is the engine and its key is set. */
  elevenLabs?: { apiKey: string; url?: string }
  /** Why the chosen cloud ear is not the one hearing (#463): ElevenLabs chosen, no key. Settings › Environment says it. */
  earUnarmed?: string
  /** Scripted transcripts (e2e double), mirroring BINGBONG_LLM_SCRIPT. */
  sttScript?: string
  /** Scripted VAD probabilities (e2e double), one per 512-sample frame. */
  vadScript?: string
  /** Scripted turn-check probabilities (e2e double, #357), one per check. */
  turnScript?: string
  /** The scripted VAD's model load, in ms from its creation (e2e double, #442): the ear's cold start held for a shot. */
  vadLoadMs?: number
  /** The scripted VAD's load fails once it is done (e2e double, BINGBONG_VAD_LOAD_FAIL, #447): the ear's cold start ending in a fault. */
  vadLoadFails?: boolean
  /** The scripted transcriber's model load, in ms from its prepare (e2e double, #442): a line held behind it. */
  sttLoadMs?: number
}

/** Which of the ear's models load a model of their own (#442): a scripted double loads one only when given a load to time. */
export function voiceLoads(config: VoiceConfig): { vad: boolean; stt: boolean } {
  return {
    vad: config.vadScript === undefined || config.vadLoadMs !== undefined,
    stt: config.sttScript === undefined || config.sttLoadMs !== undefined,
  }
}

function msOf(value: string | undefined): number | undefined {
  const ms = Number(value?.trim())
  return value !== undefined && value.trim() !== '' && Number.isFinite(ms) && ms >= 0 ? ms : undefined
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
  // The engine by env over the setting (#463): an e2e run or the trial's switch picks it without touching Settings.
  const named = env.BINGBONG_STT_ENGINE?.trim() ?? ''
  const chosen = named !== '' && asSttModel(named) === named ? asSttModel(named) : sttEngine
  const apiKey = env.ELEVENLABS_API_KEY?.trim() ?? ''
  const url = env.BINGBONG_ELEVENLABS_URL?.trim()
  // The cloud ear with no key is never a dead ear: Parakeet hears, and Settings says why (grill ruling 3).
  const unarmed = chosen === 'elevenlabs' && apiKey === ''
  return {
    vadModel: env.BINGBONG_VAD_MODEL?.trim() || join(dirs.bundledModelsDir, 'silero_vad.onnx'),
    modelsDir,
    sttEngine: unarmed ? 'parakeet' : chosen,
    ...(chosen === 'elevenlabs' && !unarmed ? { elevenLabs: { apiKey, ...(url ? { url } : {}) } } : {}),
    ...(unarmed ? { earUnarmed: 'ElevenLabs is chosen as the ear, but ELEVENLABS_API_KEY is not set: Parakeet hears until it is, from the next start.' } : {}),
    sttScript: env.BINGBONG_STT_SCRIPT?.trim() || undefined,
    vadScript: env.BINGBONG_VAD_SCRIPT?.trim() || undefined,
    turnScript: env.BINGBONG_TURN_SCRIPT?.trim() || undefined,
    vadLoadMs: msOf(env.BINGBONG_VAD_LOAD_MS),
    ...(env.BINGBONG_VAD_LOAD_FAIL === '1' ? { vadLoadFails: true } : {}),
    sttLoadMs: msOf(env.BINGBONG_STT_LOAD_MS),
  }
}
