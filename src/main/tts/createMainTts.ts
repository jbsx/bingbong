import type { WebContents } from 'electron'
import type { TtsSpeaker } from '../../core/ports/tts'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
import { kokoroVoiceOf, PREVIEW_LINE } from '../../core/tts/ttsVoices'
import { createVoiceRoutedSynthesizer, piperVoiceFor } from '../../core/tts/voiceRoutedSynthesizer'
import type { PiperConfig } from './piperConfig'
import { createPiperSynthesizer } from './createPiperSynthesizer'
import { createPersistentPiperSynthesizer } from './createPersistentPiperSynthesizer'
import { createAplayPlayer } from './createAplayPlayer'
import { createPaneAudioDucker } from './createPaneAudioDucker'
import type { MainKokoroSynthesizer } from './createKokoroSynthesizer'

export interface MainTtsDeps {
  config: PiperConfig
  /** The app's one Kokoro (#412), shared with the voice previews; null when Kokoro is off. */
  kokoro?: MainKokoroSynthesizer | null
  /** The browser pane whose page audio ducks during speech. */
  pane: WebContents
  /** Resolved per line, so a settings-page voice change applies at the next line. */
  getVoiceId(): string
  /** Always-on perf tracer (#31): keys the per-sentence synthesis, first-sound and playback spans. */
  tracer?: PerfTracer
  /** Start the voice's engine at once (#327, #412), as the Moonshine models are prefetched, so the first line pays no model load. */
  prefetch?: boolean
}

/**
 * Composition root for spoken output (T8, #327, #412): each line goes to
 * the engine its voice names, Kokoro or a persistent piper (the per-line
 * spawn behind it when it cannot start), with Piper's fallback voice
 * speaking a Kokoro line Kokoro cannot say; sentence by sentence into one
 * aplay per spoken text, ducking the pane.
 */
export function createMainTts(deps: MainTtsDeps): TtsSpeaker {
  const voice = { bin: deps.config.bin, voicesDir: deps.config.voicesDir, getVoiceId: () => piperVoiceFor(deps.getVoiceId(), deps.config.voiceId) }
  const piper = createPersistentPiperSynthesizer({ ...voice, fallback: createPiperSynthesizer(voice) })
  const kokoro = deps.kokoro ?? null
  if (deps.prefetch) {
    // Piper too when Kokoro speaks: it says the lines while Kokoro's model is fetched.
    piper.prefetch()
    const kokoroVoice = kokoroVoiceOf(deps.getVoiceId())
    if (kokoro !== null && kokoroVoice !== null) kokoro.prefetch(kokoroVoice)
  }
  return createSpeechCoordinator({
    synth: createVoiceRoutedSynthesizer({ getVoiceId: deps.getVoiceId, kokoro, piper }),
    player: createAplayPlayer({ bin: deps.config.playerBin, device: deps.config.playerDevice }),
    ducker: createPaneAudioDucker(deps.pane),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
  })
}

/** The sample line in a given voice through the real synthesizer (#412): a voice with no shipped preview clip gets one. */
export function createPreviewRenderer(config: PiperConfig, kokoro: MainKokoroSynthesizer | null): (voiceId: string) => Promise<Uint8Array> {
  return async (voiceId) => {
    const kokoroVoice = kokoroVoiceOf(voiceId)
    if (kokoroVoice !== null) {
      if (kokoro === null) throw new Error('Kokoro is off')
      // A voice no line has used yet has no style file: the preview fetches it.
      return kokoro.synthesize(PREVIEW_LINE, kokoroVoice, { waitForVoice: true })
    }
    return createPiperSynthesizer({ bin: config.bin, voicesDir: config.voicesDir, getVoiceId: () => voiceId }).synthesize(PREVIEW_LINE)
  }
}
