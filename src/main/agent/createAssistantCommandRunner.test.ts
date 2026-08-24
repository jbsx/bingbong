import { describe, expect, it } from 'vitest'
import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createFeedProjection } from '../../core/history/feedProjection'
import { createFeedPanelStateFold } from '../../core/panel/feedPanelState'
import { FakeClock } from '../../core/testing/doubles'
import { isSessionActive } from '../../core/session/activeSession'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../../core/session/sessionIdentity'
import { createSessionMemory } from '../../core/session/sessionMemory'
import { createSessionRuntime } from '../../core/session/sessionRuntime'
import { createSessionRuns } from '../../core/session/sessionRuns'
import type { SubmissionFeedback } from '../../core/session/submissionFeedback'
import { createAssistantCommandRunner } from './createAssistantCommandRunner'

class DeterministicIdentities implements SessionIdentitySource {
  readonly minted: string[] = []
  private submissions = 0
  private runs = 0
  private sessions = 0

  mintSubmissionId(): SubmissionId {
    const id = `submission-${++this.submissions}` as SubmissionId
    this.minted.push(id)
    return id
  }

  mintRunId(): RunId {
    const id = `run-${++this.runs}` as RunId
    this.minted.push(id)
    return id
  }

  mintSessionId(): SessionId {
    const id = `session-${++this.sessions}` as SessionId
    this.minted.push(id)
    return id
  }
}

describe('assistant command runner', () => {
  it('publishes Session start before the first accepted command becomes observable', async () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
    const observed: string[] = []
    const pipeline: CommandPipeline = {
      async *execute() {
        yield { type: 'command', text: 'hello', turnId: 'turn-1', at: clock.now() }
        yield { type: 'done', turnId: 'turn-1', at: clock.now() }
      },
      resolveConfirmation: () => {},
      resolveAsk: () => {},
      abort: () => {},
      pause: () => {},
      resume: () => false,
      getState: () => 'idle',
    }
    const runner = createAssistantCommandRunner({
      pipeline,
      runtime,
      clock,
      onSessionStarted: (admission) => observed.push(`started:${admission.sessionId}`),
      createRunPublisher: () => ({ publish: (event) => observed.push(event.type) }),
      publishFeedback: () => {},
    })

    await runner.run('hello')

    expect(observed).toEqual(['started:session-1', 'command', 'done'])
  })

  it('rejects a busy Submission before creating or publishing a Run', async () => {
    const clock = new FakeClock(1_000)
    const identities = new DeterministicIdentities()
    const runtime = createSessionRuntime({ clock, identities })
    const published: PipelineEvent[][] = []
    const feedback: SubmissionFeedback[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let executions = 0
    const pipeline: CommandPipeline = {
      async *execute(command, turnId) {
        executions += 1
        yield { type: 'command', text: command, turnId: turnId ?? `turn-${executions}`, at: clock.now() }
        if (executions === 1) await blocked
        yield { type: 'done', turnId: turnId ?? `turn-${executions}`, at: clock.now() }
      },
      resolveConfirmation: () => {},
      resolveAsk: () => {},
      abort: () => {},
      pause: () => {},
      resume: () => false,
      getState: () => 'idle',
    }
    const runner = createAssistantCommandRunner({
      pipeline,
      runtime,
      clock,
      createRunPublisher: (ownership) => {
        const events: PipelineEvent[] = []
        published.push(events)
        return {
          publish: (event) => events.push({
            ...event,
            submissionId: ownership.submissionId,
            runId: ownership.runId,
            sessionId: ownership.sessionId,
            sessionGeneration: ownership.generation,
          }),
        }
      },
      publishFeedback: (item) => feedback.push(item),
    })

    const accepted = runner.run('first command', 'turn-1')
    await Promise.resolve()
    clock.advance(25)
    await expect(runner.run('second command', 'turn-2')).resolves.toBe(false)

    expect(identities.minted).toEqual(['submission-1', 'session-1', 'run-1', 'submission-2'])
    expect(runtime.state()).toMatchObject({
      sessionId: 'session-1',
      acceptedRunIds: ['run-1'],
      liveRunIds: ['run-1'],
    })
    expect(published).toHaveLength(1)
    expect(published[0].map((event) => event.type)).toEqual(['command'])
    expect(feedback).toEqual([{
      type: 'submission_rejected',
      reason: 'busy',
      submissionId: 'submission-2',
      message: 'Another command is already running. Wait for it to finish or steer it instead.',
      at: 1_025,
    }])

    release()
    await expect(accepted).resolves.toBe(true)
    expect(runtime.state().liveRunIds).toEqual([])
    await expect(runner.run('third command', 'turn-3')).resolves.toBe(true)
    expect(published).toHaveLength(2)
    expect(identities.minted).toEqual([
      'submission-1',
      'session-1',
      'run-1',
      'submission-2',
      'submission-3',
      'run-2',
    ])
  })

  it('passes each accepted Run one Journal snapshot and the next Run sees the prior commit', async () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
    const snapshots: string[][] = []
    const memorySnapshots: string[][] = []
    const pipeline: CommandPipeline = {
      async *execute(command, turnId = 'turn', _truncated, journal) {
        snapshots.push((journal?.snapshot ?? []).map((entry) => entry.text))
        memorySnapshots.push((journal?.memory ?? []).map((entry) => entry.subject))
        yield { type: 'command', text: command, turnId, at: clock.now() }
        journal?.commit('done', `Completed ${command}`, command === 'first' ? [{
          op: 'add',
          entry: { kind: 'objective', subject: 'Compare options', detail: 'Find the best option.' },
        }] : [])
        yield { type: 'done', outcome: 'done', turnId, at: clock.now() }
      },
      resolveConfirmation: () => {},
      resolveAsk: () => {},
      abort: () => {},
      pause: () => {},
      resume: () => false,
      getState: () => 'idle',
    }
    const runner = createAssistantCommandRunner({
      pipeline,
      runtime,
      clock,
      createRunPublisher: () => ({ publish: () => {} }),
      publishFeedback: () => {},
    })

    await runner.run('first')
    await runner.run('second')

    expect(snapshots).toEqual([[], ['Completed first']])
    expect(memorySnapshots).toEqual([[], ['Compare options']])
  })

  it('leaves live projections, continuity, and the Session deadline owned by the accepted Run', async () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
    const feed = createFeedProjection()
    const panel = createFeedPanelStateFold()
    const runs = createSessionRuns()
    let lapses = 0
    const memory = createSessionMemory({ windowMs: 100, clock, onSessionStart: () => lapses++ })
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const pipeline: CommandPipeline = {
      async *execute(command, turnId = 'turn-accepted') {
        yield { type: 'command', text: command, turnId, at: clock.now() }
        await blocked
        yield { type: 'display', text: 'Accepted answer.', turnId, at: clock.now() }
        yield { type: 'done', turnId, at: clock.now() }
      },
      resolveConfirmation: () => {},
      resolveAsk: () => {},
      abort: () => {},
      pause: () => {},
      resume: () => false,
      getState: () => 'idle',
    }
    const runner = createAssistantCommandRunner({
      pipeline,
      runtime,
      clock,
      createRunPublisher: () => {
        const continuityRun = memory.run()
        return {
          publish(event) {
            continuityRun.event(event)
            feed.onEvent(event)
            panel.onEvent(event)
            runs.event(event)
          },
        }
      },
      publishFeedback: () => {},
    })

    const accepted = runner.run('accepted command', 'turn-accepted')
    while (feed.entries().length === 0) await Promise.resolve()
    const feedBeforeRejection = feed.entries()
    const spansBeforeRejection = runs.runs()
    clock.advance(50)

    await expect(runner.run('busy command', 'turn-rejected')).resolves.toBe(false)

    expect(feed.entries()).toEqual(feedBeforeRejection)
    expect(feed.entries().map((entry) => entry.text)).toContain('accepted command')
    expect(feed.liveRunId()).toBe('turn-accepted')
    expect(panel.state().open).toBe(true)
    expect(runs.runs()).toEqual(spansBeforeRejection)
    expect(isSessionActive(runs.runs(), clock.now(), 100)).toBe(true)
    expect(memory.history()).toEqual([])
    expect(lapses).toBe(0)

    clock.advance(50)
    release()
    await accepted
    expect(memory.history()).toEqual([
      { role: 'user', text: 'accepted command' },
      { role: 'assistant', text: 'Accepted answer.' },
    ])
    clock.advance(99)
    expect(lapses).toBe(0)
    clock.advance(1)
    expect(lapses).toBe(1)
  })
})
