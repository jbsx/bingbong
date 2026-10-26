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
import { createElevenLabsTranscriber } from '../elevenlabs/createElevenLabsTranscriber'
import { cloudKeyterms } from '../../core/voice/cloudKeyterms'
import { BIAS_LEXICON } from '../moonshine/biasLexicon'
import { reportFault } from '../../core/trace/fault'

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
export async function createMainVoice(config: VoiceConfig, getBiasPhrases?: () => BiasInput, sttElsewhere?: Transcriber): Promise<MainVoice> {
  const vad: VadScorer = config.vadScript ? createScriptedVad(config.vadScript, config.vadLoadMs, config.vadLoadFails === true) : await createSileroVad({ modelPath: config.vadModel })
  const transcriber = sttElsewhere ?? createMainVoiceTranscriber(config, getBiasPhrases)
  const turn: TurnDetector = config.turnScript
    ? createScriptedTurn(config.turnScript)
    : config.vadScript
      ? createScriptedTurn('[1]')
      : createSmartTurn({ modelsDir: config.modelsDir })
  return { vad, transcriber, turn }
}

/** The Seed Lexicon as a set, for telling Learned Terms from it in the cloud ear's keyterms (#463). */
const SEED = new Set(BIAS_LEXICON)

/**
 * The STT engine alone, by config: the cloud ear (#463) with the local
 * engine behind it, the scripted double, Parakeet, or a Moonshine tier.
 */
export function createMainVoiceTranscriber(config: VoiceConfig, getBiasPhrases?: () => BiasInput): Transcriber {
  if (config.sttEngine === 'elevenlabs' && config.elevenLabs !== undefined) {
    const { elevenLabs } = config
    return createElevenLabsTranscriber({
      apiKey: elevenLabs.apiKey,
      ...(elevenLabs.url !== undefined ? { url: elevenLabs.url } : {}),
      keyterms: () => cloudKeyterms(getBiasPhrases?.() ?? BIAS_LEXICON, SEED),
      // Parakeet stays loaded behind the cloud (grill ruling 9); the scripted double stands in for it in e2e.
      fallback: createMainVoiceTranscriber({ ...config, sttEngine: 'parakeet' }, getBiasPhrases),
      onFault: (error) => reportFault('voice.ear.cloud', error),
    })
  }
  const bias = getBiasPhrases ? { getBiasPhrases } : {}
  return config.sttScript
    ? createScriptedTranscriber(config.sttScript, config.sttLoadMs)
    : config.sttEngine === 'parakeet' || config.sttEngine === 'elevenlabs'
      ? createMainParakeetTranscriber({ modelsDir: config.modelsDir, ...bias })
      : createMainMoonshineTranscriber({ modelsDir: config.modelsDir, tier: config.sttEngine, ...bias })
}
