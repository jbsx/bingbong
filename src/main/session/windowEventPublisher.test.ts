import { describe, expect, it } from 'vitest'
import type { BrowserPaneState } from '../../core/browser/paneState'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { RunId, SessionId, SubmissionId } from '../../core/session/sessionIdentity'
import type { SubmissionFeedback } from '../../core/session/submissionFeedback'
import type { VoiceErrorEvent, VoiceHeardEvent, VoiceState } from '../../core/voice/ipcChannels'
import { createWindowEventPublisher, type WindowEventPublisherDeps } from './windowEventPublisher'

const pipelineEvent: PipelineEvent = { type: 'display', text: 'hello', at: 10 }
const voiceState: VoiceState = { listening: true, reason: 'hotkey', monitoring: false, transcribing: false }
const heard: VoiceHeardEvent = { text: 'hello', routed: 'command', at: 11 }
const voiceError: VoiceErrorEvent = { message: 'microphone failed', at: 12 }
const browserState: BrowserPaneState = {
  url: 'https://example.com',
  title: 'Example',
  loading: false,
  canGoBack: false,
  canGoForward: false,
}
const ownership = {
  submissionId: 'submission-1' as SubmissionId,
  runId: 'run-1' as RunId,
  sessionId: 'session-1' as SessionId,
  generation: 3,
}

function setup(acceptPipelineEvent?: (event: PipelineEvent) => boolean): {
  publisher: ReturnType<typeof createWindowEventPublisher>
  calls: string[]
  pipelineEvents: PipelineEvent[]
} {
  const calls: string[] = []
  const pipelineEvents: PipelineEvent[] = []
  const record = (sink: string) => () => calls.push(sink)
  const recordPipeline = (sink: string) => (event: PipelineEvent) => {
    calls.push(sink)
    pipelineEvents.push(event)
  }
  const deps: WindowEventPublisherDeps = {
    acceptPipelineEvent,
    createHistoryRunObserver: () => recordPipeline('history-run'),
    createSessionRunObserver: () => recordPipeline('session-run'),
    historyEvent: recordPipeline('history-event'),
    historyHeard: record('history-heard'),
    historyVoiceError: record('history-voice-error'),
    sendPipelineEvent: recordPipeline('renderer-pipeline'),
    sendVoiceState: record('renderer-voice-state'),
    sendVoiceHeard: record('renderer-voice-heard'),
    sendVoiceError: record('renderer-voice-error'),
    sendBrowserState: record('renderer-browser'),
    sendSubmissionFeedback: record('renderer-submission-feedback'),
    observeVoicePipelineEvent: recordPipeline('voice-observer'),
    overlayPipelineEvent: recordPipeline('overlay-pipeline'),
    overlayVoiceHeard: record('overlay-voice-heard'),
    overlayVoiceError: record('overlay-voice-error'),
    overlaySubmissionFeedback: record('overlay-submission-feedback'),
  }
  return { publisher: createWindowEventPublisher(deps), calls, pipelineEvents }
}

describe('window event publisher', () => {
  it('publishes Run events in observer, renderer, voice, and overlay order with accepted ownership', () => {
    const { publisher, calls, pipelineEvents } = setup()
    const run = publisher.run(ownership)
    run.publish({ type: 'command', turnId: 'turn-1', text: 'hello', at: 10 })

    expect(calls).toEqual(['history-run', 'session-run', 'renderer-pipeline', 'voice-observer', 'overlay-pipeline'])
    expect(pipelineEvents).toHaveLength(5)
    expect(pipelineEvents.every((event) => event === pipelineEvents[0])).toBe(true)
    expect(pipelineEvents[0]).toMatchObject({
      submissionId: 'submission-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sessionGeneration: 3,
    })
  })

  it.each(['detail', 'lifecycle', 'download', 'subagent'] as const)(
    'publishes %s pipeline events through auxiliary history, renderer, and overlay in order',
    (source) => {
      const { publisher, calls, pipelineEvents } = setup()

      publisher.publish({ source, event: pipelineEvent, ownership })

      expect(calls).toEqual(source === 'lifecycle'
        ? ['history-event', 'renderer-pipeline', 'voice-observer', 'overlay-pipeline']
        : ['history-event', 'renderer-pipeline', 'overlay-pipeline'])
      expect(pipelineEvents).toHaveLength(source === 'lifecycle' ? 4 : 3)
      expect(pipelineEvents[0]).toMatchObject({
        submissionId: 'submission-1',
        runId: 'run-1',
        sessionId: 'session-1',
        sessionGeneration: 3,
      })
    },
  )

  it('retains Session ownership for auxiliary events after Run completion', () => {
    const { publisher, pipelineEvents } = setup()
    const run = publisher.run(ownership)

    publisher.publish({ source: 'detail', event: pipelineEvent })
    run.publish({ type: 'done', turnId: 'turn-1', at: 11 })
    publisher.publish({ source: 'detail', event: pipelineEvent })

    expect(pipelineEvents[0]).toMatchObject({ runId: 'run-1', sessionId: 'session-1', sessionGeneration: 3 })
    expect(pipelineEvents.at(-1)).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      sessionGeneration: 3,
    })
  })

  it('leaves legacy pipeline events unstamped when no accepted ownership exists', () => {
    const { publisher, pipelineEvents } = setup()

    publisher.run().publish(pipelineEvent)
    publisher.publish({ source: 'download', event: pipelineEvent })

    expect(pipelineEvents).toHaveLength(8)
    expect(pipelineEvents.every((event) => event === pipelineEvent)).toBe(true)
  })

  it('publishes voice events through their existing source-specific sinks', () => {
    const { publisher, calls } = setup()

    publisher.publish({ source: 'voice-state', state: voiceState })
    publisher.publish({ source: 'voice-heard', heard })
    publisher.publish({ source: 'voice-error', error: voiceError })

    expect(calls).toEqual([
      'renderer-voice-state',
      'history-heard',
      'overlay-voice-heard',
      'renderer-voice-heard',
      'history-voice-error',
      'overlay-voice-error',
      'renderer-voice-error',
    ])
  })

  it('publishes browser state only to the renderer', () => {
    const { publisher, calls } = setup()

    publisher.publish({ source: 'browser', state: browserState })

    expect(calls).toEqual(['renderer-browser'])
  })

  it('publishes Submission feedback without creating or notifying Run observers', () => {
    const { publisher, calls, pipelineEvents } = setup()
    const feedback: SubmissionFeedback = {
      type: 'submission_rejected',
      reason: 'busy',
      submissionId: 'submission-2' as SubmissionId,
      message: 'Another command is already running.',
      at: 20,
    }

    publisher.publish({ source: 'submission-feedback', feedback })

    expect(calls).toEqual(['renderer-submission-feedback', 'overlay-submission-feedback'])
    expect(pipelineEvents).toEqual([])
  })

  it('drops rejected ownership before any observer or renderer sees it', () => {
    const { publisher, calls } = setup((event) => event.sessionId === ownership.sessionId && event.sessionGeneration === 3)
    const run = publisher.run({ ...ownership, sessionId: 'session-foreign' as SessionId })

    run.publish({ type: 'command', turnId: 'turn-foreign', text: 'foreign', at: 20 })

    expect(calls).toEqual([])
  })
})
