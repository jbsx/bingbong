import type { WebContents } from 'electron'
import type { TtsSpeaker } from '../../core/ports/tts'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
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
  })
}
