import type { BrowserPaneState } from '../../core/browser/paneState'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { AcceptedRunAdmission } from '../../core/session/sessionRuntime'
import type { SubmissionFeedback } from '../../core/session/submissionFeedback'
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
  | { source: 'submission-feedback'; feedback: SubmissionFeedback }

export interface WindowEventPublisherDeps {
  acceptPipelineEvent?(event: PipelineEvent): boolean
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
  sendSubmissionFeedback(feedback: SubmissionFeedback): void
  observeVoicePipelineEvent(event: PipelineEvent): void
  overlayPipelineEvent(event: PipelineEvent): void
  overlayVoiceHeard(heard: VoiceHeardEvent): void
  overlayVoiceError(error: VoiceErrorEvent): void
  overlaySubmissionFeedback(feedback: SubmissionFeedback): void
}

export interface WindowRunPublisher {
  publish(event: PipelineEvent): void
}

export interface WindowEventPublisher {
  run(ownership?: AcceptedRunOwnership): WindowRunPublisher
  publish(publication: WindowEventPublication): void
}

/**
 * Fills the Run/Session identity an event is missing, without clobbering
 * what a producer already stamped (#97): subagent cards carry the Session
 * that spawned the agent, and that identity must survive even while a later
 * Run's ownership is active — otherwise a late completion from an ended
 * Session would be re-attributed to the live one and slip past the gate.
 */
function withOwnership(event: PipelineEvent, ownership?: AcceptedRunOwnership): PipelineEvent {
  if (!ownership) return event
  return {
    ...event,
    submissionId: event.submissionId ?? ownership.submissionId,
    runId: event.runId ?? ownership.runId,
    sessionId: event.sessionId ?? ownership.sessionId,
    sessionGeneration: event.sessionGeneration ?? ownership.generation,
  }
}

export function createWindowEventPublisher(deps: WindowEventPublisherDeps): WindowEventPublisher {
  let activeRunOwnership: AcceptedRunOwnership | undefined
  let activeSessionOwnership: AcceptedRunOwnership | undefined

  const accepted = (event: PipelineEvent): boolean => deps.acceptPipelineEvent?.(event) ?? true

  return {
    run(ownership) {
      const historyRun = deps.createHistoryRunObserver()
      const sessionRun = deps.createSessionRunObserver()
      if (ownership) {
        activeRunOwnership = ownership
        activeSessionOwnership = ownership
      }
      return {
        publish(event) {
          const ownedEvent = withOwnership(event, ownership)
          if (!accepted(ownedEvent)) return
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
          const ownership = publication.ownership ??
            (publication.source === 'lifecycle' ? undefined : activeRunOwnership ?? activeSessionOwnership)
          const event = withOwnership(publication.event, ownership)
          if (!accepted(event)) return
          deps.historyEvent(event)
          deps.sendPipelineEvent(event)
          if (publication.source === 'lifecycle') deps.observeVoicePipelineEvent(event)
          deps.overlayPipelineEvent(event)
          if (event.type === 'session_ended') {
            activeRunOwnership = undefined
            activeSessionOwnership = undefined
          }
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
          return
        case 'submission-feedback':
          deps.sendSubmissionFeedback(publication.feedback)
          deps.overlaySubmissionFeedback(publication.feedback)
      }
    },
  }
}
