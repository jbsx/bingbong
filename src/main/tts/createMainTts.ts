import type { AudioStreamPlayer, SpeechSynthesizer, TtsSpeaker } from '../../core/ports/tts'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
import type { PiperConfig } from './piperConfig'
import { createPiperSynthesizer } from './createPiperSynthesizer'
import { createPersistentPiperSynthesizer } from './createPersistentPiperSynthesizer'
import { createAplayPlayer } from './createAplayPlayer'

export interface MainTtsDeps {
  config: PiperConfig
  /** Resolved per line, so a settings-page voice change applies at the next line. */
  getVoiceId(): string
  /** Always-on perf tracer (#31): keys the per-sentence synthesis, first-sound and playback spans. */
  tracer?: PerfTracer
  /** Start piper at once (#327), as the Moonshine models are prefetched, so the first line pays no model load. */
  prefetch?: boolean
  /** Piper's first-launch install (#419), retriable: each line waits for it, and the prefetch starts once it is done. */
  ready?: () => Promise<unknown>
  /** The Sound Mute: speech goes to no device while it holds. */
  muted?: () => boolean
  /** The player the voice streams into (#490: the Chromium one behind BINGBONG_SPEECH_PLAYER); default aplay, from the config. */
  player?: AudioStreamPlayer
}

/**
 * Composition root for spoken output (T8, #327): a persistent piper — the
 * per-line spawn behind it when it cannot start — streaming sentence by
 * sentence into one player stream per spoken text — aplay, or Chromium's
 * WebAudio when BINGBONG_SPEECH_PLAYER says so (#490). The pane's media ducks under
 * every spoken line through the Ducking gate (#461), not here.
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
    player: deps.player ?? createAplayPlayer({ bin: deps.config.playerBin, device: deps.config.playerDevice, ...(deps.muted ? { muted: deps.muted } : {}) }),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
  })
}
