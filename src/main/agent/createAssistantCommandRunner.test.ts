import { describe, expect, it } from 'vitest'
import { createCommandPipeline, type CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createFeedProjection } from '../../core/history/feedProjection'
import { createFeedPanelStateFold } from '../../core/panel/feedPanelState'
import { FakeClock, RecordingTts, ScriptedLlm } from '../../core/testing/doubles'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../../core/session/sessionIdentity'
import { createSessionRuntime } from '../../core/session/sessionRuntime'
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
      onSessionReset: () => {},
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
      onSessionReset: () => {},
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
      onSessionReset: () => {},
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
      onSessionReset: () => {},
      onSessionStarted: (admission) => {
        feed.onEvent({
          type: 'session_started',
          sessionId: admission.sessionId,
          sessionGeneration: admission.generation,
          at: admission.acceptedAt,
        })
      },
      createRunPublisher: () => {
        return {
          publish(event) {
            feed.onEvent({ ...event, sessionId: 'session-1' as SessionId, sessionGeneration: 0 })
            panel.onEvent(event)
          },
        }
      },
      publishFeedback: () => {},
    })

    const accepted = runner.run('accepted command', 'turn-accepted')
    while (feed.entries().length === 0) await Promise.resolve()
    const feedBeforeRejection = feed.entries()
    clock.advance(50)

    await expect(runner.run('busy command', 'turn-rejected')).resolves.toBe(false)

    expect(feed.entries()).toEqual(feedBeforeRejection)
    expect(feed.entries().map((entry) => entry.text)).toContain('accepted command')
    expect(feed.liveRunId()).toBe('turn-accepted')
    expect(panel.state().open).toBe(true)
    // The busy-rejected submission never became a Run and never touched
    // continuity or the live-Run fold.
    expect(runtime.state()).toMatchObject({ acceptedRunIds: ['run-1'], liveRunIds: ['run-1'] })

    clock.advance(50)
    release()
    await accepted
    expect(runtime.state().liveRunIds).toEqual([])
  })

  describe('session reset restart (#99)', () => {
    function resetHarness() {
      const clock = new FakeClock(1_000)
      const identities = new DeterministicIdentities()
      const runtime = createSessionRuntime({ clock, identities })
      const observed: string[] = []
      const resets: string[] = []
      const executed: { command: string; journal: string[]; memory: string[] }[] = []
      let executions = 0
      const pipeline: CommandPipeline = {
        async *execute(command, _turnId, _truncated, continuity) {
          executions += 1
          const run = executions
          executed.push({
            command,
            journal: (continuity?.snapshot ?? []).map((entry) => entry.text),
            memory: (continuity?.memory ?? []).map((entry) => entry.subject),
          })
          yield { type: 'command', text: command, turnId: `turn-${run}`, at: clock.now() }
          if (run === 1 && command.startsWith('forget')) {
            // The discarded attempt: a model-invoked Session Reset.
            yield { type: 'tool_call', callId: 'c1', name: 'new_session', args: {}, turnId: `turn-${run}`, at: clock.now() }
            yield { type: 'done', outcome: 'reset', turnId: `turn-${run}`, at: clock.now() }
            return
          }
          yield { type: 'done', outcome: 'done', turnId: `turn-${run}`, at: clock.now() }
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
        onSessionReset: (admission) => {
          resets.push(`${admission.sessionId}:${admission.runId}`)
          // Production wires this seam to the real lifecycle end.
          runtime.end('reset')
        },
        onSessionStarted: (admission) => observed.push(`started:${admission.sessionId}:gen${admission.generation}`),
        createRunPublisher: (ownership) => ({
          publish: (event) => observed.push(`${event.type}:${ownership.sessionId}:gen${ownership.generation}`),
        }),
        publishFeedback: () => {},
      })
      return { clock, identities, runtime, observed, resets, executed, runner }
    }

    it('restarts the original command as the first Run of a fresh Session', async () => {
      const { identities, runtime, observed, resets, executed, runner } = resetHarness()

      await expect(runner.run('forget all that — find me a pizza place')).resolves.toBe(true)

      // The old Session ended with its own admission, then the replacement
      // began: two distinct identities, one generation step, no shared Run.
      expect(resets).toEqual(['session-1:run-1'])
      expect(observed).toEqual([
        'started:session-1:gen0',
        'command:session-1:gen0',
        'tool_call:session-1:gen0',
        'done:session-1:gen0',
        'started:session-2:gen1',
        'command:session-2:gen1',
        'done:session-2:gen1',
      ])
      expect(identities.minted).toEqual([
        'submission-1', 'session-1', 'run-1',
        'submission-2', 'session-2', 'run-2',
      ])
      expect(runtime.state()).toMatchObject({ sessionId: 'session-2', generation: 1, liveRunIds: [] })
      // Both attempts carry only the original user command; neither sees
      // continuity from before or across the reset.
      expect(executed).toEqual([
        { command: 'forget all that — find me a pizza place', journal: [], memory: [] },
        { command: 'forget all that — find me a pizza place', journal: [], memory: [] },
      ])
    })

    it('ends the old Session only after its discarded run has fully unwound', async () => {
      const { runtime, observed, resets, runner } = resetHarness()

      await runner.run('forget all that')

      const doneIndex = observed.indexOf('done:session-1:gen0')
      const startedIndex = observed.indexOf('started:session-2:gen1')
      expect(doneIndex).toBeGreaterThan(-1)
      expect(startedIndex).toBeGreaterThan(doneIndex)
      // The reset fires in between: after the last old event, before any
      // new one — so no pre-reset work can land in the new Session.
      expect(resets).toEqual(['session-1:run-1'])
      expect(runtime.state().acceptedRunIds).toHaveLength(1)
    })

    it('finishes normally without touching the reset seam', async () => {
      const { observed, resets, runner } = resetHarness()

      await runner.run('a plain command')

      // The harness discards exactly the first scripted execution; a normal
      // command never reaches the reset path.
      const pipelineRuns = observed.filter((entry) => entry.startsWith('done:'))
      expect(pipelineRuns).toEqual(['done:session-1:gen0'])
      expect(resets).toEqual([])
    })
  })

  describe('reset restart through the real pipeline (#99)', () => {
    it('replays the original command with a clean model context under a fresh Session', async () => {
      const clock = new FakeClock(1_000)
      const identities = new DeterministicIdentities()
      const runtime = createSessionRuntime({ clock, identities })

      // Continuity exists before the reset so the test can prove the
      // replacement Run does not inherit it: the first Run commits an
      // objective, the resetting command then arrives in that Session.
      const newSessionTool = { name: 'new_session', sessionReset: true, async execute() { return 'Session reset.' } }
      let siblingExecutions = 0
      const siblingTool = {
        name: 'spin',
        async execute() {
          siblingExecutions += 1
          return 'spun'
        },
      }
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'new_session', args: {} }, { id: 'c2', name: 'spin', args: {} }] },
        { kind: 'answer', speak: 'Fresh answer.', display: 'Fresh answer.' },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [newSessionTool, siblingTool],
      })
      const observed: string[] = []
      const runner = createAssistantCommandRunner({
        pipeline,
        runtime,
        clock,
        onSessionReset: () => runtime.end('reset'),
        onSessionStarted: (admission) => observed.push(`started:${admission.sessionId}:gen${admission.generation}`),
        createRunPublisher: (ownership) => ({
          publish: (event) => observed.push(`${event.type}:${ownership.sessionId}:gen${ownership.generation}`),
        }),
        publishFeedback: () => {},
      })

      await expect(runner.run('forget all that — find me a pizza place')).resolves.toBe(true)

      // The response's sibling call never executed, and the discarded run's
      // scripted answer was never requested: exactly two model rounds total.
      expect(siblingExecutions).toBe(0)
      expect(llm.requests).toHaveLength(2)
      // The replacement round carries only the original user command — no
      // pre-reset tool observations, Journal, or Working Memory cross over.
      expect(llm.requests[1]).toMatchObject({
        command: 'forget all that — find me a pizza place',
        toolResults: [],
        journal: [],
        memory: [],
      })
      // Distinct Session identities across one generation step, and the
      // replacement is the only accepted Run of the new Session.
      expect(observed).toEqual([
        'started:session-1:gen0',
        'command:session-1:gen0',
        'status:session-1:gen0',
        'status:session-1:gen0',
        'tool_call:session-1:gen0',
        'tool_result:session-1:gen0',
        'done:session-1:gen0',
        'started:session-2:gen1',
        'command:session-2:gen1',
        'status:session-2:gen1',
        'display:session-2:gen1',
        'status:session-2:gen1',
        'speak:session-2:gen1',
        'done:session-2:gen1',
      ])
      expect(runtime.state()).toMatchObject({ sessionId: 'session-2', generation: 1, liveRunIds: [] })
    })

    it('keeps continuity flowing into later Runs of the surviving Session', async () => {
      const clock = new FakeClock(1_000)
      const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
      const llm = new ScriptedLlm([
        { kind: 'answer', speak: 'First.', display: 'First.', runNote: 'Researched keyboards.' },
        { kind: 'answer', speak: 'Second.', display: 'Second.' },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [],
      })
      const runner = createAssistantCommandRunner({
        pipeline,
        runtime,
        clock,
        onSessionReset: () => {},
        createRunPublisher: () => ({ publish: () => {} }),
        publishFeedback: () => {},
      })

      await runner.run('research keyboards')
      await runner.run('compare the top two')

      expect(llm.requests[1]?.journal?.map((entry) => entry.text)).toEqual(['Researched keyboards.'])
    })
  })
})
