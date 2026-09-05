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
const agentCard = {
  id: 'a-1',
  kind: 'browse' as const,
  task: 'check the price page',
  status: 'running' as const,
  startedAt: 5,
  finishedAt: null,
  steps: 1,
  lastAction: 'read_page',
  result: null,
  error: null,
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
  traced: PipelineEvent[]
  order: string[]
} {
  const calls: string[] = []
  const traced: PipelineEvent[] = []
  const order: string[] = []
  const pipelineEvents: PipelineEvent[] = []
  const record = (sink: string) => () => calls.push(sink)
  const recordPipeline = (sink: string) => (event: PipelineEvent) => {
    calls.push(sink)
    order.push(sink)
    pipelineEvents.push(event)
  }
  const deps: WindowEventPublisherDeps = {
    acceptPipelineEvent,
    // The Run Trace's tap (#185) — deliberately not in `calls`: it must
    // not change the order the other sinks are already pinned to.
    tracePipelineEvent: (event) => {
      order.push('run-trace')
      traced.push(event)
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
  return { publisher: createWindowEventPublisher(deps), calls, pipelineEvents, traced, order }
}

describe('window event publisher', () => {
  it('publishes Run events in renderer, voice, and overlay order with accepted ownership', () => {
    const { publisher, calls, pipelineEvents } = setup()
    const run = publisher.run(ownership)
    run.publish({ type: 'command', turnId: 'turn-1', text: 'hello', at: 10 })

    expect(calls).toEqual(['renderer-pipeline', 'voice-observer', 'overlay-pipeline'])
    expect(pipelineEvents).toHaveLength(3)
    expect(pipelineEvents.every((event) => event === pipelineEvents[0])).toBe(true)
    expect(pipelineEvents[0]).toMatchObject({
      submissionId: 'submission-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sessionGeneration: 3,
    })
  })

  it.each(['detail', 'lifecycle', 'download', 'subagent'] as const)(
    'publishes %s pipeline events through the renderer, voice, and overlay in order',
    (source) => {
      const { publisher, calls, pipelineEvents } = setup()

      publisher.publish({ source, event: pipelineEvent, ownership })

      expect(calls).toEqual(source === 'lifecycle'
        ? ['renderer-pipeline', 'voice-observer', 'overlay-pipeline']
        : ['renderer-pipeline', 'overlay-pipeline'])
      expect(pipelineEvents).toHaveLength(source === 'lifecycle' ? 3 : 2)
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

    expect(pipelineEvents).toHaveLength(3)
    expect(pipelineEvents.every((event) => event === pipelineEvents[0])).toBe(true)
    expect(pipelineEvents[0]).toMatchObject({ sessionId: 'session-9', sessionGeneration: 1 })
    expect(pipelineEvents[0].submissionId).toBeUndefined()
    expect(pipelineEvents[0].runId).toBeUndefined()
  })

  // Voice records were the last thing the retired history recorder was
  // told about (#188); what a heard utterance and a capture error reach
  // now is the overlay and the renderer, and nothing else.
  it('publishes voice events through their existing source-specific sinks', () => {
    const { publisher, calls, pipelineEvents } = setup()

    publisher.publish({ source: 'voice-state', state: voiceState })
    publisher.publish({ source: 'voice-heard', heard })
    publisher.publish({ source: 'voice-error', error: voiceError })

    expect(calls).toEqual([
      'renderer-voice-state',
      'overlay-voice-heard',
      'renderer-voice-heard',
      'overlay-voice-error',
      'renderer-voice-error',
    ])
    // Voice publications are not pipeline events: none of them reaches the
    // pipeline sinks, and none of them earns a Run Trace record.
    expect(pipelineEvents).toEqual([])
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

    expect(calls).toEqual(['renderer-pipeline', 'voice-observer', 'overlay-pipeline'])
    expect(pipelineEvents.every((event) => event.sessionId === 'session-live')).toBe(true)
  })
})

// The pipeline_event tap (#185): one record per *published* event, on
// both roads out of the publisher — a Run's own stream and the auxiliary
// sources (Session boundaries, download announcements, subagent cards).
// It sits behind the acceptance gate on purpose: the file records what
// the views were told, and a rejected event was told to nobody.
describe('the Run Trace tap on the published stream', () => {
  it('records a Run\'s events with the ownership the publisher stamped', () => {
    const { publisher, traced } = setup()

    const run = publisher.run(ownership)
    run.publish({ type: 'status', turnId: 't-1', status: 'thinking', at: 1 })
    run.publish({ type: 'done', turnId: 't-1', outcome: 'done', at: 2 })

    expect(traced.map((event) => event.type)).toEqual(['status', 'done'])
    expect(traced.every((event) => event.runId === 'run-1' && event.sessionId === 'session-1')).toBe(true)
  })

  it('records auxiliary publications too — lifecycle boundaries included', () => {
    const { publisher, traced } = setup()

    publisher.publish({
      source: 'lifecycle',
      event: { type: 'session_started', sessionId: 'session-1' as SessionId, sessionGeneration: 3, at: 1 },
    })
    publisher.publish({ source: 'subagent', event: { type: 'agent_update', agent: agentCard, at: 2 } })

    expect(traced.map((event) => event.type)).toEqual(['session_started', 'agent_update'])
  })

  // The trace writes synchronously, once per event: it must never sit
  // between a Run and the frame it produced, or it perturbs the timing a
  // developer turned it on to see.
  it('writes only after every view has been handed the event', () => {
    const { publisher, order } = setup()

    publisher.run(ownership).publish({ type: 'status', turnId: 't-1', status: 'thinking', at: 1 })

    expect(order[order.length - 1]).toBe('run-trace')
    expect(order).toContain('renderer-pipeline')
  })

  it('records nothing a consumer never saw — a rejected event leaves no line', () => {
    const { publisher, traced } = setup(() => false)

    publisher.run(ownership).publish({ type: 'status', turnId: 't-1', status: 'thinking', at: 1 })
    publisher.publish({ source: 'detail', event: { type: 'steer', turnId: 't-1', text: 'use Paris', at: 2 } })

    expect(traced).toEqual([])
  })
})
