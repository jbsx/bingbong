import { join } from 'node:path'

/**
 * Default initial_prompt for whisper: biases decoding toward the proper
 * nouns and verbs this assistant actually hears, which base.en otherwise
 * garbles phonetically ("Linus Tech Tips" → "line stack"). Kept to one short
 * line — long prompts pull transcription toward hallucinating prompt text.
 * BINGBONG_STT_PROMPT replaces it wholesale for user vocabulary.
 */
export const DEFAULT_STT_PROMPT =
  'Bing Bong, play the latest Linus Tech Tips video on YouTube. MKBHD, GitHub, Wikipedia, Reddit, Google, Amazon, pause, volume up, next video.'

export interface VoiceConfig {
  /** Silero VAD v5 ONNX model. */
  vadModel: string
  /** ggml whisper model (English-only .en models on this CPU). */
  whisperModel: string
  /** Whisper initial_prompt for vocabulary biasing. */
  sttPrompt: string
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
    sttPrompt: env.BINGBONG_STT_PROMPT?.trim() || DEFAULT_STT_PROMPT,
    sttScript: env.BINGBONG_STT_SCRIPT?.trim() || undefined,
    vadScript: env.BINGBONG_VAD_SCRIPT?.trim() || undefined,
  }
}
