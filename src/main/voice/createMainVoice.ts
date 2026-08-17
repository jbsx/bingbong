import type { Transcriber, VadScorer } from '../../core/ports/stt'
import type { VoiceConfig } from './voiceConfig'
import { createSileroVad } from './createSileroVad'
import { createSmartWhisperTranscriber } from './createSmartWhisperTranscriber'
import { createScriptedVad } from './createScriptedVad'
import { createScriptedTranscriber } from './createScriptedTranscriber'

export interface MainVoice {
  vad: VadScorer
  transcriber: Transcriber
}

/**
 * Composition root for the ears (T9): Silero VAD + smart-whisper, shared by
 * every window so the models load once. Scripted doubles (e2e, keyless
 * demos) drop in via BINGBONG_VAD_SCRIPT / BINGBONG_STT_SCRIPT.
 */
export async function createMainVoice(config: VoiceConfig): Promise<MainVoice> {
  const vad: VadScorer = config.vadScript ? createScriptedVad(config.vadScript) : await createSileroVad({ modelPath: config.vadModel })
  const transcriber: Transcriber = config.sttScript
    ? createScriptedTranscriber(config.sttScript)
    : createSmartWhisperTranscriber({ modelPath: config.whisperModel })
  return { vad, transcriber }
}
