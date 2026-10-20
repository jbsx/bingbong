import type { Transcriber, TurnDetector, VadScorer } from '../../core/ports/stt'
import type { VoiceConfig } from './voiceConfig'
import { createSileroVad } from './createSileroVad'
import { createMainMoonshineTranscriber } from '../moonshine/createMainMoonshineTranscriber'
import { createMainParakeetTranscriber } from '../parakeet/createMainParakeetTranscriber'
import type { BiasInput } from '../moonshine/createMoonshineTranscriber'
import { createScriptedVad } from './createScriptedVad'
import { createScriptedTranscriber } from './createScriptedTranscriber'
import { createScriptedTurn } from './createScriptedTurn'
import { createSmartTurn } from './createSmartTurn'

export interface MainVoice {
  vad: VadScorer
  transcriber: Transcriber
  /** The turn check the Endpoint asks at a short pause (#357). */
  turn: TurnDetector
}

/**
 * Composition root for the ears (T9): Silero VAD + Parakeet (#358), or a
 * lighter Moonshine tier, streamed by rolling passes +
 * Smart Turn (#357), shared by every window so the models load once.
 * Scripted doubles (e2e, keyless demos) drop in via BINGBONG_VAD_SCRIPT /
 * BINGBONG_STT_SCRIPT / BINGBONG_TURN_SCRIPT; a scripted VAD with no turn
 * script reads every pause as finished, so a scripted run never fetches the
 * model and its Utterances end at the short pause.
 * The bias union getter (ADR 0022) rides through to the decoder.
 */
export async function createMainVoice(config: VoiceConfig, getBiasPhrases?: () => BiasInput): Promise<MainVoice> {
  const vad: VadScorer = config.vadScript ? createScriptedVad(config.vadScript) : await createSileroVad({ modelPath: config.vadModel })
  const bias = getBiasPhrases ? { getBiasPhrases } : {}
  const transcriber: Transcriber = config.sttScript
    ? createScriptedTranscriber(config.sttScript)
    : config.sttEngine === 'parakeet'
      ? createMainParakeetTranscriber({ modelsDir: config.modelsDir, ...bias })
      : createMainMoonshineTranscriber({ modelsDir: config.modelsDir, tier: config.sttEngine, ...bias })
  const turn: TurnDetector = config.turnScript
    ? createScriptedTurn(config.turnScript)
    : config.vadScript
      ? createScriptedTurn('[1]')
      : createSmartTurn({ modelsDir: config.modelsDir })
  return { vad, transcriber, turn }
}
