import type { BrowserPaneState } from '../../core/browser/paneState'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { VoiceErrorEvent, VoiceHeardEvent, VoiceState } from '../../core/voice/ipcChannels'

export type WindowEventPublication =
  | { source: 'run' | 'download'; event: PipelineEvent }
  | { source: 'voice-state'; state: VoiceState }
  | { source: 'voice-heard'; heard: VoiceHeardEvent }
  | { source: 'voice-error'; error: VoiceErrorEvent }
  | { source: 'browser'; state: BrowserPaneState }

export interface WindowEventPublisherDeps {
  sendPipelineEvent(event: PipelineEvent): void
  sendVoiceState(state: VoiceState): void
  sendVoiceHeard(heard: VoiceHeardEvent): void
  sendVoiceError(error: VoiceErrorEvent): void
  sendBrowserState(state: BrowserPaneState): void
  observeVoicePipelineEvent(event: PipelineEvent): void
  overlayPipelineEvent(event: PipelineEvent): void
  overlayVoiceHeard(heard: VoiceHeardEvent): void
  overlayVoiceError(error: VoiceErrorEvent): void
}

export interface WindowEventPublisher {
  publish(publication: WindowEventPublication): void
}

/**
 * One window's fan-out: every event a run or the download router produces
 * reaches the dashboard, the feed panel overlay and the voice session in
 * that order; voice and browser state reach the renderers that show them.
 */
export function createWindowEventPublisher(deps: WindowEventPublisherDeps): WindowEventPublisher {
  return {
    publish(publication) {
      switch (publication.source) {
        case 'run':
        case 'download':
          deps.sendPipelineEvent(publication.event)
          deps.overlayPipelineEvent(publication.event)
          deps.observeVoicePipelineEvent(publication.event)
          return
        case 'voice-state':
          deps.sendVoiceState(publication.state)
          return
        case 'voice-heard':
          deps.overlayVoiceHeard(publication.heard)
          deps.sendVoiceHeard(publication.heard)
          return
        case 'voice-error':
          deps.overlayVoiceError(publication.error)
          deps.sendVoiceError(publication.error)
          return
        case 'browser':
          deps.sendBrowserState(publication.state)
          return
      }
    },
  }
}
