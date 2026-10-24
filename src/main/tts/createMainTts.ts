import type { WebContents } from 'electron'
import type { SpeechSynthesizer, TtsSpeaker } from '../../core/ports/tts'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
import type { PiperConfig } from './piperConfig'
import { createPiperSynthesizer } from './createPiperSynthesizer'
import { createPersistentPiperSynthesizer } from './createPersistentPiperSynthesizer'
import { createAplayPlayer } from './createAplayPlayer'
import { createPaneAudioDucker } from './createPaneAudioDucker'

export interface MainTtsDeps {
  config: PiperConfig
  /** The browser pane whose page audio ducks during speech. */
  pane: WebContents
  /** Resolved per line, so a settings-page voice change applies at the next line. */
  getVoiceId(): string
  /** Always-on perf tracer (#31): keys the per-sentence synthesis, first-sound and playback spans. */
  tracer?: PerfTracer
  /** Start piper at once (#327), as the Moonshine models are prefetched, so the first line pays no model load. */
  prefetch?: boolean
  /** Piper's first-launch install (#419), retriable: each line waits for it, and the prefetch starts once it is done. */
  ready?: () => Promise<unknown>
}

/**
 * Composition root for spoken output (T8, #327): a persistent piper — the
 * per-line spawn behind it when it cannot start — streaming sentence by
 * sentence into one aplay per spoken text, ducking the pane.
 */
export function createMainTts(deps: MainTtsDeps): TtsSpeaker {
  const voice = { bin: deps.config.bin, voicesDir: deps.config.voicesDir, getVoiceId: deps.getVoiceId }
  const persistent = createPersistentPiperSynthesizer({ ...voice, fallback: createPiperSynthesizer(voice) })
  const ready = deps.ready ?? (() => Promise.resolve())
  // A piper started before its install is done would die and send every line to the per-line spawn.
  // A failed install is reported where it is started (tts.piperInstall); the next line retries it.
  if (deps.prefetch) void ready().then(() => persistent.prefetch(), () => {})
  const synth: SpeechSynthesizer = {
    synthesize: async (text) => {
      await ready()
      return persistent.synthesize(text)
    },
    spawnCount: () => persistent.spawnCount?.() ?? 0,
  }
  return createSpeechCoordinator({
    synth,
    player: createAplayPlayer({ bin: deps.config.playerBin, device: deps.config.playerDevice }),
    ducker: createPaneAudioDucker(deps.pane),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
  })
}
