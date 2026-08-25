import { describe, expect, it } from 'vitest'
import type { BrowserPaneState } from '../../core/browser/paneState'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { RunId, SessionId, SubmissionId } from '../../core/session/sessionIdentity'
import type { SubmissionFeedback } from '../../core/session/submissionFeedback'
import type { VoiceErrorEvent, VoiceHeardEvent, VoiceState } from '../../core/voice/ipcChannels'
import { createWindowEventPublisher, type WindowEventPublisherDeps } from './windowEventPublisher'
import { createPipelineAcceptanceGate } from './pipelineAcceptance'

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
  heardSessions: (string | null)[]
  voiceErrorSessions: (string | null)[]
} {
  const calls: string[] = []
  const pipelineEvents: PipelineEvent[] = []
  const heardSessions: (string | null)[] = []
  const voiceErrorSessions: (string | null)[] = []
  const record = (sink: string) => () => calls.push(sink)
  const recordPipeline = (sink: string) => (event: PipelineEvent) => {
    calls.push(sink)
    pipelineEvents.push(event)
  }
  const deps: WindowEventPublisherDeps = {
    acceptPipelineEvent,
    createHistoryRunObserver: () => recordPipeline('history-run'),
    historyEvent: recordPipeline('history-event'),
    historyHeard: (_heard, sessionId) => {
      calls.push('history-heard')
      heardSessions.push(sessionId)
    },
    historyVoiceError: (_error, sessionId) => {
      calls.push('history-voice-error')
      voiceErrorSessions.push(sessionId)
    },
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
  return { publisher: createWindowEventPublisher(deps), calls, pipelineEvents, heardSessions, voiceErrorSessions }
}

describe('window event publisher', () => {
  it('publishes Run events in observer, renderer, voice, and overlay order with accepted ownership', () => {
    const { publisher, calls, pipelineEvents } = setup()
    const run = publisher.run(ownership)
    run.publish({ type: 'command', turnId: 'turn-1', text: 'hello', at: 10 })

    expect(calls).toEqual(['history-run', 'renderer-pipeline', 'voice-observer', 'overlay-pipeline'])
    expect(pipelineEvents).toHaveLength(4)
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

  it('leaves lifecycle events carrying only their own identity', () => {
    const { publisher, pipelineEvents } = setup()

    publisher.publish({
      source: 'lifecycle',
      event: {
        type: 'session_started',
        sessionId: 'session-9' as SessionId,
        sessionGeneration: 1,
        at: 10,
      },
    })

    expect(pipelineEvents).toHaveLength(4)
    expect(pipelineEvents.every((event) => event === pipelineEvents[0])).toBe(true)
    expect(pipelineEvents[0]).toMatchObject({ sessionId: 'session-9', sessionGeneration: 1 })
    expect(pipelineEvents[0].submissionId).toBeUndefined()
    expect(pipelineEvents[0].runId).toBeUndefined()
  })

  it('publishes voice events through their existing source-specific sinks', () => {
    const { publisher, calls, heardSessions, voiceErrorSessions } = setup()

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
    // No Session exists yet: run-less voice records land honestly Session-less.
    expect(heardSessions).toEqual([null])
    expect(voiceErrorSessions).toEqual([null])
  })

  it('attributes run-less voice records to the active Session, and to none after it ends (#85)', () => {
    const { publisher, heardSessions, voiceErrorSessions } = setup()
    const run = publisher.run(ownership)
    run.publish({ type: 'command', turnId: 'turn-1', text: 'hello', at: 10 })

    publisher.publish({ source: 'voice-heard', heard })
    publisher.publish({ source: 'voice-error', error: voiceError })
    run.publish({ type: 'done', turnId: 'turn-1', at: 11 })
    publisher.publish({ source: 'voice-heard', heard })

    publisher.publish({
      source: 'lifecycle',
      event: { type: 'session_ended', sessionId: ownership.sessionId, sessionGeneration: ownership.generation, reason: 'lapsed', at: 20 },
    })
    publisher.publish({ source: 'voice-heard', heard })

    expect(heardSessions).toEqual(['session-1', 'session-1', null])
    expect(voiceErrorSessions).toEqual(['session-1'])
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
    const { publisher, calls, pipelineEvents } = setup((event) => event.sessionId === ownership.sessionId && event.sessionGeneration === 3)
    const run = publisher.run({ ...ownership, sessionId: 'session-foreign' as SessionId })

    run.publish({ type: 'command', turnId: 'turn-foreign', text: 'foreign', at: 20 })

    expect(calls).toEqual([])
    expect(pipelineEvents).toEqual([])
  })

  // #97: a producer's explicit Session identity must survive active Run
  // ownership — only missing fields are filled. Otherwise a late subagent
  // completion stamped with an ended Session would be re-attributed to the
  // live Run's Session and slip past the acceptance gate.
  it('fills only missing identity fields, never clobbering an explicit stamp', () => {
    const { publisher, pipelineEvents } = setup()
    const run = publisher.run(ownership)

    run.publish({ type: 'agent_update', at: 30, sessionId: 'session-old' as SessionId, sessionGeneration: 1, agent: { id: 'a-1', kind: 'browse', task: 't', status: 'completed', startedAt: 0, finishedAt: 30, steps: 1, lastAction: null, result: 'late', error: null } })

    const stamped = pipelineEvents.find((event) => event.type === 'agent_update')
    expect(stamped).toMatchObject({ sessionId: 'session-old', sessionGeneration: 1 })
    expect(stamped?.runId).toBe('run-1')
  })

  it('rejects a late foreign-Session subagent event even while a new Run is active', () => {
    // The real production rule (#97), not a copy: only the live Session's
    // identity passes, so a completion stamped with the ended Session is
    // dropped before any observer or renderer sees it.
    const accepted = createPipelineAcceptanceGate({
      liveSession: () => ({ sessionId: 'session-live' as SessionId, generation: 4 }),
      lastEndedSession: () => ({ sessionId: 'session-ended' as SessionId, generation: 3 }),
    })
    const { publisher, calls, pipelineEvents } = setup(accepted)
    const run = publisher.run({ ...ownership, sessionId: 'session-live' as SessionId, generation: 4 })

    const lateAgentUpdate: PipelineEvent = {
      type: 'agent_update',
      at: 40,
      sessionId: 'session-ended' as SessionId,
      sessionGeneration: 3,
      agent: { id: 'a-1', kind: 'browse', task: 't', status: 'completed', startedAt: 0, finishedAt: 40, steps: 2, lastAction: null, result: 'late report', error: null },
    }
    publisher.publish({ source: 'subagent', event: lateAgentUpdate })
    run.publish({ type: 'command', turnId: 'turn-2', text: 'new work', at: 41 })

    expect(calls).toEqual(['history-run', 'renderer-pipeline', 'voice-observer', 'overlay-pipeline'])
    expect(pipelineEvents.every((event) => event.sessionId === 'session-live')).toBe(true)
  })
})
