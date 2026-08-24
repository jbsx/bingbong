import type { BrowserPaneState } from '../../core/browser/paneState'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { AcceptedRunAdmission } from '../../core/session/sessionRuntime'
import type { VoiceErrorEvent, VoiceHeardEvent, VoiceState } from '../../core/voice/ipcChannels'

export type AcceptedRunOwnership = Pick<
  AcceptedRunAdmission,
  'submissionId' | 'runId' | 'sessionId' | 'generation'
>

type AuxiliaryPipelineSource = 'detail' | 'lifecycle' | 'download' | 'subagent'

export type WindowEventPublication =
  | { source: AuxiliaryPipelineSource; event: PipelineEvent; ownership?: AcceptedRunOwnership }
  | { source: 'voice-state'; state: VoiceState }
  | { source: 'voice-heard'; heard: VoiceHeardEvent }
  | { source: 'voice-error'; error: VoiceErrorEvent }
  | { source: 'browser'; state: BrowserPaneState }

export interface WindowEventPublisherDeps {
  createHistoryRunObserver(): (event: PipelineEvent) => void
  createSessionRunObserver(): (event: PipelineEvent) => void
  historyEvent(event: PipelineEvent): void
  historyHeard(heard: VoiceHeardEvent): void
  historyVoiceError(error: VoiceErrorEvent): void
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

export interface WindowRunPublisher {
  publish(event: PipelineEvent): void
}

export interface WindowEventPublisher {
  run(ownership?: AcceptedRunOwnership): WindowRunPublisher
  publish(publication: WindowEventPublication): void
}

function withOwnership(event: PipelineEvent, ownership?: AcceptedRunOwnership): PipelineEvent {
  if (!ownership) return event
  return {
    ...event,
    submissionId: ownership.submissionId,
    runId: ownership.runId,
    sessionId: ownership.sessionId,
    sessionGeneration: ownership.generation,
  }
}

export function createWindowEventPublisher(deps: WindowEventPublisherDeps): WindowEventPublisher {
  let activeRunOwnership: AcceptedRunOwnership | undefined

  return {
    run(ownership) {
      const historyRun = deps.createHistoryRunObserver()
      const sessionRun = deps.createSessionRunObserver()
      if (ownership) activeRunOwnership = ownership
      return {
        publish(event) {
          const ownedEvent = withOwnership(event, ownership)
          historyRun(ownedEvent)
          sessionRun(ownedEvent)
          deps.sendPipelineEvent(ownedEvent)
          deps.observeVoicePipelineEvent(ownedEvent)
          deps.overlayPipelineEvent(ownedEvent)
          if (event.type === 'done' && activeRunOwnership === ownership) activeRunOwnership = undefined
        },
      }
    },
    publish(publication) {
      switch (publication.source) {
        case 'detail':
        case 'lifecycle':
        case 'download':
        case 'subagent': {
          const ownership = publication.ownership ?? (publication.source === 'detail' ? activeRunOwnership : undefined)
          const event = withOwnership(publication.event, ownership)
          deps.historyEvent(event)
          deps.sendPipelineEvent(event)
          deps.overlayPipelineEvent(event)
          return
        }
        case 'voice-state':
          deps.sendVoiceState(publication.state)
          return
        case 'voice-heard':
          deps.historyHeard(publication.heard)
          deps.overlayVoiceHeard(publication.heard)
          deps.sendVoiceHeard(publication.heard)
          return
        case 'voice-error':
          deps.historyVoiceError(publication.error)
          deps.overlayVoiceError(publication.error)
          deps.sendVoiceError(publication.error)
          return
        case 'browser':
          deps.sendBrowserState(publication.state)
      }
    },
  }
}
