import type { WebContents } from 'electron'
import type { TtsSpeaker } from '../../core/ports/tts'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
import type { HostTraceWriter } from '../../core/trace/hostTrace'
import type { PiperConfig } from './piperConfig'
import { createPiperSynthesizer } from './createPiperSynthesizer'
import { createAplayPlayer } from './createAplayPlayer'
import { createPaneAudioDucker } from './createPaneAudioDucker'

export interface MainTtsDeps {
  config: PiperConfig
  /** The browser pane whose page audio ducks during speech. */
  pane: WebContents
  /** Resolved per line, so a settings-page voice change applies immediately. */
  getVoiceId(): string
  /** Always-on perf tracer (#31): keys the per-line synthesis/playback spans. */
  tracer?: PerfTracer
  /**
   * The Host Trace writer (#186): the exact text handed to piper per line,
   * and every line barge-in dropped. Absent unless the developer set
   * `BINGBONG_HOST_TRACE`.
   */
  hostTrace?: HostTraceWriter
}

/** Composition root for spoken output (T8): piper → aplay, ducking the pane. */
export function createMainTts(deps: MainTtsDeps): TtsSpeaker {
  return createSpeechCoordinator({
    synth: createPiperSynthesizer({
      bin: deps.config.bin,
      voicesDir: deps.config.voicesDir,
      getVoiceId: deps.getVoiceId,
    }),
    player: createAplayPlayer(),
    ducker: createPaneAudioDucker(deps.pane),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
    ...(deps.hostTrace ? { hostTrace: deps.hostTrace } : {}),
  })
}
