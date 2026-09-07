import { afterEach, describe, expect, it } from 'vitest'
import { createCommandPipeline, type CommandPipeline, type RunContinuityContext } from '../../core/pipeline/createCommandPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { Tool } from '../../core/pipeline/tool'
import { createRecordEvidenceTool } from '../../core/pipeline/evidenceTools'
import { createRecordCandidateTool } from '../../core/pipeline/candidateTools'
import type { SessionEvidenceSnapshot } from '../../core/session/sessionEvidence'
import type { AssistantTurn, LlmClient, LlmRequest } from '../../core/ports/llm'
import { createFeedProjection } from '../../core/feed/feedProjection'
import { createFeedPanelStateFold } from '../../core/panel/feedPanelState'
import { FakeClock, RecordingTts, ScriptedLlm } from '../../core/testing/doubles'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../../core/session/sessionIdentity'
import { parseMemoryPatch, type MemoryEntryId } from '../../core/session/workingMemory'
import { createSessionRuntime } from '../../core/session/sessionRuntime'
import type { SubmissionFeedback } from '../../core/session/submissionFeedback'
import { createAssistantCommandRunner } from './createAssistantCommandRunner'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import { VisionDeadlineError } from '../../core/ports/vision'
import { TIER_TOOL_ROUND_BUDGETS } from '../../core/pipeline/effortEpoch'
import { FORBIDDEN_ENDINGS, RESOURCE_ACCOUNTING } from '../../core/testing/stoppingPolicy'
import type { TraceRecord } from '../../core/trace/runTrace'

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
    // A command never opens the panel (ADR 0021) — and the busy-rejected
    // submission never became a Run and never touched continuity or the
    // live-Run fold.
    expect(panel.state().open).toBe(false)
    expect(runtime.state()).toMatchObject({ acceptedRunIds: ['run-1'], liveRunIds: ['run-1'] })

    clock.advance(50)
    release()
    await accepted
    expect(runtime.state().liveRunIds).toEqual([])
  })

  // The failure screenshot (#191): one capture per Run that finalized
  // failed or on a work rail, recorded through the Run's own writer, and
  // a capture that throws is a fault — never the Run's problem.
  describe('failure screenshot (#191)', () => {
    afterEach(() => setFaultSink(null))

    function harness(done: PipelineEvent, options: { traced?: boolean; capture?: 'ok' | 'throws' | 'absent' } = {}) {
      const clock = new FakeClock(1_000)
      const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
      const records: TraceRecord[] = []
      const captures: { runId: string; turnId: string }[] = []
      const published: PipelineEvent['type'][] = []
      const pipeline: CommandPipeline = {
        async *execute(command) {
          yield { type: 'command', text: command, turnId: 'turn-1', at: clock.now() }
          yield done
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
        createRunPublisher: () => ({ publish: (event) => void published.push(event.type) }),
        publishFeedback: () => {},
        ...(options.traced === false ? {} : { runTrace: { write: (record) => void records.push(record) } }),
        ...(options.capture === 'absent'
          ? {}
          : {
              captureFailureScreenshot: async (identity) => {
                captures.push(identity)
                if (options.capture === 'throws') throw new Error('page is gone')
                return { path: `/logs/run-trace-${identity.runId}-${identity.turnId}.png`, bytes: 512 }
              },
            }),
      })
      return { runner, records, captures, published }
    }

    it('captures once for a failed Run and records where the PNG went, under the Run identity', async () => {
      const { runner, records, captures, published } = harness({ type: 'done', outcome: 'failed', turnId: 'turn-1', at: 5 })

      expect(await runner.run('find the fare')).toBe(true)

      expect(captures).toEqual([{ runId: 'run-1', turnId: 'turn-1' }])
      expect(records).toEqual([
        {
          v: 1,
          at: 1_000,
          runId: 'run-1',
          sessionId: 'session-1',
          generation: 0,
          turnId: 'turn-1',
          kind: 'failure_screenshot',
          cause: 'failed',
          path: '/logs/run-trace-run-1-turn-1.png',
          bytes: 512,
        },
      ])
      // The `done` was already out when the capture ran.
      expect(published).toEqual(['command', 'done'])
    })

    it('captures for a rail-caused finalization and names the rail', async () => {
      const { runner, records } = harness({ type: 'done', outcome: 'done', finalizationCause: 'no_progress', turnId: 'turn-1', at: 5 })

      await runner.run('find the fare')

      expect(records.map((record) => record.kind === 'failure_screenshot' && record.cause)).toEqual(['no_progress'])
    })

    it('captures nothing for a Run that met its objective', async () => {
      const { runner, records, captures } = harness({ type: 'done', outcome: 'done', finalizationCause: 'objective_met', turnId: 'turn-1', at: 5 })

      await runner.run('find the fare')

      expect(captures).toEqual([])
      expect(records).toEqual([])
    })

    it('captures nothing when the Run Trace is off — there is no record for the file to join', async () => {
      const { runner, captures } = harness({ type: 'done', outcome: 'failed', turnId: 'turn-1', at: 5 }, { traced: false })

      await runner.run('find the fare')

      expect(captures).toEqual([])
    })

    it("leaves a fault and the Run's outcome unchanged when the capture throws", async () => {
      const faults: FaultReport[] = []
      setFaultSink((report) => faults.push(report))
      const { runner, records, published } = harness({ type: 'done', outcome: 'failed', turnId: 'turn-1', at: 5 }, { capture: 'throws' })

      expect(await runner.run('find the fare')).toBe(true)

      expect(records).toEqual([])
      expect(published).toEqual(['command', 'done'])
      expect(faults).toEqual([
        expect.objectContaining({ site: 'agent.createAssistantCommandRunner.failureScreenshot', message: 'page is gone', turnId: 'turn-1' }),
      ])
    })
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

  it('flows record_evidence checkpoints into later Runs and drops them at Session Reset (#121)', async () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
    const seenEvidence: (SessionEvidenceSnapshot | undefined)[] = []
    const turns: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: {
          observation: 'The Acme router costs $39.',
          source_url: 'https://shop.example/acme-router',
          excerpt: 'Price: $39',
        },
      }] },
      { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
      { kind: 'answer', speak: 'Still $39.', display: 'Still $39.' },
    ]
    let served = 0
    const llm: LlmClient = {
      complete(request) {
        seenEvidence.push(request.evidence)
        return Promise.resolve(turns[served++] ?? { kind: 'answer', speak: 'Done.', display: 'Done.' })
      },
    }
    const readPage: Tool = {
      name: 'read_page',
      acquisition: true,
      async execute() {
        return 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => 'https://shop.example/acme-router',
    })
    const runner = createAssistantCommandRunner({
      pipeline,
      runtime,
      clock,
      onSessionReset: () => {},
      createRunPublisher: () => ({ publish: () => {} }),
      publishFeedback: () => {},
    })

    await runner.run('what does the acme router cost')
    await runner.run('the price again')

    // Run 1 started beside an empty Session; its checkpoint — made through
    // the real runtime's store — reached the follow-up Run's context with
    // the originating Run's provenance.
    expect(seenEvidence[0]?.observations).toEqual([])
    expect(seenEvidence.at(-1)?.observations).toEqual([expect.objectContaining({
      id: 'memory-1',
      sourceKind: 'web',
      text: 'The Acme router costs $39.',
      references: [{ url: 'https://shop.example/acme-router' }],
      provenance: [{ runId: 'run-1' }],
    })])

    // Session Reset's existing lifecycle cleanup removes the checkpoint:
    // the replacement Session's first Run starts beside nothing.
    runtime.end('reset')
    await runner.run('the price once more')
    expect(seenEvidence.at(-1)?.observations).toEqual([])
    expect(seenEvidence.at(-1)?.candidates).toEqual([])
  })

  it('grounds Candidates, user words, and Answer support through the live store (#122)', async () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
    const turns: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [
        { id: 'c2', name: 'record_evidence', args: { observation: 'The Acme router costs $39.', source_url: 'https://shop.example/acme-router', excerpt: 'Price: $39' } },
        { id: 'c3', name: 'record_evidence', args: { kind: 'user', observation: 'what does the acme router cost' } },
        { id: 'c4', name: 'record_candidate', args: { subject: 'Acme wifi router', supporting_evidence: ['memory-1'] } },
      ] },
      { kind: 'tool_calls', calls: [
        { id: 'c5', name: 'record_candidate', args: { candidate_id: 'memory-3', status: 'accepted', reason: 'the price answers the question', supporting_evidence: ['memory-1', 'memory-2'] } },
      ] },
      {
        kind: 'answer',
        speak: 'It is $39.',
        display: 'The Acme router (memory-2).',
        evidenceIds: ['memory-1' as MemoryEntryId],
        memoryPatch: [
          { op: 'add', entry: { kind: 'assessment', subject: 'Acme is cheapest', detail: 'Verified at the shop.', references: [{ url: 'https://shop.example/acme-router' }] } },
        ],
      },
    ]
    let served = 0
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      complete(request) {
        requests.push(request)
        return Promise.resolve(turns[served++] ?? { kind: 'answer', speak: 'Done.', display: 'Done.' })
      },
    }
    const readPage: Tool = {
      name: 'read_page',
      acquisition: true,
      async execute() {
        return 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [readPage, createRecordEvidenceTool(), createRecordCandidateTool()],
      currentPageUrl: () => 'https://shop.example/acme-router',
    })
    const runner = createAssistantCommandRunner({
      pipeline,
      runtime,
      clock,
      onSessionReset: () => {},
      createRunPublisher: () => ({ publish: () => {} }),
      publishFeedback: () => {},
    })

    await runner.run('what does the acme router cost')
    await runner.run('the price again')

    const store = runtime.evidenceStore()!
    // The web finding, the user's own command, and the accepted Candidate
    // all landed in the live store through the runner's seams.
    expect(store.snapshot().observations.map((observation) => [observation.sourceKind, observation.text])).toEqual([
      ['web', 'The Acme router costs $39.'],
      ['user', 'what does the acme router cost'],
    ])
    expect(store.candidate('memory-3' as never)).toMatchObject({
      status: 'accepted',
      supportingObservationIds: ['memory-1', 'memory-2'],
      provenance: [{ runId: 'run-1' }],
    })
    // The Assessment cleared the support bar — the Answer cited the live
    // Observation — so it entered the terminal Memory Commit and the
    // follow-up Run's Working Memory carries it.
    expect(requests.at(-1)?.memory?.map(({ kind, subject }) => `${kind}: ${subject}`)).toContain(
      'assessment: Acme is cheapest',
    )
  })

  // #206, ADR 0039: the tier-list regression. A continuation Run must be
  // given the objective the user actually set, not the one the model's own
  // Run Notes and Assessments drifted into — "a post I found" stayed "a
  // post I found" across every continuation below, or these fail.
  describe('user objective across continuations (#206)', () => {
    const FOUND = 'find that tier list post i found last week'
    const REVISION = 'it was on a forum, not reddit'
    const REPLACEMENT = 'forget that, book me a table for two tonight'

    /** One record_evidence round citing the user's exact words. */
    function citeUser(callId: string, words: string): AssistantTurn {
      return { kind: 'tool_calls', calls: [{ id: callId, name: 'record_evidence', args: { kind: 'user', observation: words } }] }
    }

    function harness() {
      const clock = new FakeClock(1_000)
      const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
      const requests: LlmRequest[] = []
      const queue: AssistantTurn[] = []
      const degraded: string[] = []
      const llm: LlmClient = {
        complete(request) {
          requests.push(request)
          return Promise.resolve(queue.shift() ?? { kind: 'answer', speak: 'Nothing yet.', display: 'Nothing yet.' })
        },
      }
      const published: PipelineEvent[] = []
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [createRecordEvidenceTool(), createRecordCandidateTool()],
        currentPageUrl: () => 'https://old.reddit.com/r/tierlists',
        onContinuityDegraded: (reason) => degraded.push(reason),
      })
      const runner = createAssistantCommandRunner({
        pipeline,
        runtime,
        clock,
        onSessionReset: () => {},
        createRunPublisher: () => ({ publish: (event: PipelineEvent) => published.push(event) }),
        publishFeedback: () => {},
      })
      return { runtime, runner, requests, queue, degraded, published }
    }

    /**
     * The Run that establishes the objective: the model quotes the user's
     * command as a User Observation, then records the objective and the
     * constraint those words set. Leaves memory-1 (the user's words),
     * memory-2 (the objective), memory-3 (the constraint).
     */
    async function establish(h: ReturnType<typeof harness>): Promise<void> {
      h.queue.push(citeUser('c1', FOUND))
      h.queue.push({
        kind: 'answer',
        speak: 'No match yet.',
        display: 'Searched two subreddits.',
        runNote: 'Searched two subreddits for the post the user found.',
        memoryPatch: parseMemoryPatch([
          {
            op: 'add',
            entry: {
              kind: 'objective',
              subject: 'Find the tier list post',
              detail: 'A post the user found last week.',
              user_evidence: ['memory-1'],
            },
          },
          {
            op: 'add',
            entry: {
              kind: 'constraint',
              subject: 'Authorship',
              detail: 'The user found the post; they did not write it.',
              user_evidence: ['memory-1'],
            },
          },
        ])!,
      })
      await h.runner.run(FOUND)
    }

    it('preserves the objective a model summary drifted away from', async () => {
      const h = harness()
      await establish(h)

      // The drift, exactly as it happened: a Run Note and an Assessment
      // that quietly promote the user from finder to author.
      h.queue.push({
        kind: 'answer',
        speak: 'Still looking.',
        display: 'No luck yet.',
        runNote: 'Still hunting for the tier list post the user wrote last week.',
        evidenceIds: ['memory-1' as MemoryEntryId],
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'assessment',
            subject: 'Authorship',
            detail: 'The user authored the post.',
            references: [{ url: 'https://old.reddit.com/r/tierlists' }],
          },
        }])!,
      })
      await h.runner.run('keep looking')
      await h.runner.run('keep looking')

      const request = h.requests.at(-1)!
      expect(request.command).toBe('keep looking')
      expect(request.objective).toEqual({
        id: 'memory-2',
        userText: [FOUND],
        constraints: [{ id: 'memory-3', userText: [FOUND] }],
      })
      // The drift really is in this Run's context — the objective is
      // preserved beside it, not by its absence.
      expect(request.journal?.map(({ text }) => text)).toContain(
        'Still hunting for the tier list post the user wrote last week.',
      )
      expect(request.memory?.some(({ kind, detail }) => kind === 'assessment' && detail.includes('authored'))).toBe(true)
    })

    it('continues the same objective when the user revises a constraint', async () => {
      const h = harness()
      await establish(h)

      h.queue.push(citeUser('c2', REVISION))
      h.queue.push({
        kind: 'answer',
        speak: 'Understood.',
        display: 'Searching forums instead.',
        runNote: 'Narrowed the search to forums.',
        memoryPatch: parseMemoryPatch([{
          op: 'update',
          id: 'memory-3',
          entry: {
            kind: 'constraint',
            subject: 'Authorship',
            detail: 'The user found it on a forum, not on Reddit.',
            user_evidence: ['memory-4'],
          },
        }])!,
      })
      await h.runner.run(REVISION)
      await h.runner.run('keep looking')

      // Same objective identity, same constraint identity: a revision
      // continues the task rather than starting a parallel one. The
      // constraint now quotes both the words that set it and the words
      // that changed it — a revision adds grounding, it does not swap it.
      expect(h.requests.at(-1)?.objective).toEqual({
        id: 'memory-2',
        userText: [FOUND],
        constraints: [{ id: 'memory-3', userText: [FOUND, REVISION] }],
      })
      // The revision was admitted, not refused and swallowed.
      expect(h.degraded).not.toContain('invalid_memory')
    })

    it('hands a replacement objective none of the old constraints', async () => {
      const h = harness()
      await establish(h)

      h.queue.push(citeUser('c2', REPLACEMENT))
      h.queue.push({
        kind: 'answer',
        speak: 'On it.',
        display: 'Looking for tables.',
        runNote: 'Switched to booking a table.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Book a table',
            detail: 'A table for two tonight.',
            user_evidence: ['memory-4'],
          },
        }])!,
      })
      await h.runner.run(REPLACEMENT)
      await h.runner.run('keep looking')

      expect(h.requests.at(-1)?.objective).toEqual({
        id: 'memory-5',
        userText: [REPLACEMENT],
        constraints: [],
      })
      // The retired objective is still on the record, marked as retired
      // rather than deleted.
      expect(h.requests.at(-1)?.memory?.map(({ id, kind, status }) => [id, kind, status])).toContainEqual([
        'memory-2', 'objective', 'superseded',
      ])
    })

    // #208, ADR 0039: the same Session, one step on. A Candidate is
    // decided *for* the objective in force and *by* someone — and both
    // facts have to survive a continuation, a revised constraint, and a
    // replacement objective.
    const REJECTION = 'not that one, i never wrote it'
    const REOPEN = 'actually show me that one again'

    /** Records one Candidate resting on the user's own words, and rejects it on their authority. */
    async function rejectOnUserAuthority(h: ReturnType<typeof harness>): Promise<void> {
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k1', name: 'record_candidate', args: { subject: 'A reddit tier list post', supporting_evidence: ['memory-1'] } }],
      })
      h.queue.push({ kind: 'answer', speak: 'One option.', display: 'One option.', runNote: 'Recorded one candidate.' })
      await h.runner.run('keep looking')

      h.queue.push(citeUser('c9', REJECTION))
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k2', name: 'record_candidate', args: {
          candidate_id: 'memory-4',
          status: 'rejected',
          reason: REJECTION,
          authority: 'user',
          supporting_evidence: ['memory-5'],
        } }],
      })
      h.queue.push({ kind: 'answer', speak: 'Dropped it.', display: 'Dropped it.', runNote: 'Dropped the reddit post.' })
      await h.runner.run(REJECTION)
    }

    /** Every refused tool result the Runs published, as the model saw them. */
    const refusals = (h: ReturnType<typeof harness>): string[] =>
      h.published
        .filter((event): event is Extract<PipelineEvent, { type: 'tool_result' }> => event.type === 'tool_result' && !event.ok)
        .map((event) => event.error ?? '')

    it('scopes a Candidate decision to the objective in force and to who made it', async () => {
      const h = harness()
      await establish(h)
      await rejectOnUserAuthority(h)
      await h.runner.run('keep looking')

      // The decision reaches the next Run's context carrying the objective
      // it was made under, the authority behind it, and its reason — and
      // beside it, the objective that context is to be read against.
      const evidence = h.requests.at(-1)?.evidence
      expect(evidence?.objectiveId).toBe('memory-2')
      expect(evidence?.candidates).toEqual([expect.objectContaining({
        id: 'memory-4',
        status: 'rejected',
        decisions: [{
          status: 'rejected',
          authority: 'user',
          reason: REJECTION,
          objectiveId: 'memory-2',
          supportingObservationIds: ['memory-5'],
          decidedAt: expect.any(Number),
        }],
      })])
    })

    it('binds a decision made before the objective landed to the objective it was made for', async () => {
      const h = harness()
      // The whole sequence inside the establishing Run: the user's words,
      // a Candidate, and their rejection of it — all recorded while the
      // objective those same words set is still only a pending Memory
      // Commit. Nothing here has an objective to name yet.
      h.queue.push(citeUser('c1', FOUND))
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k0', name: 'record_candidate', args: { subject: 'A reddit tier list post', supporting_evidence: ['memory-1'] } }],
      })
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k1', name: 'record_candidate', args: {
          candidate_id: 'memory-2',
          status: 'rejected',
          reason: REJECTION,
          authority: 'user',
          supporting_evidence: ['memory-1'],
        } }],
      })
      h.queue.push({
        kind: 'answer',
        speak: 'Dropped it.',
        display: 'Dropped it.',
        runNote: 'Rejected the reddit post.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Find the tier list post',
            detail: 'A post the user found last week.',
            user_evidence: ['memory-1'],
          },
        }])!,
      })
      await h.runner.run(FOUND)

      // The Memory Commit that retained the objective claimed the decision
      // made for it: without that, the rejection is scoped to nothing and
      // the next Run — proposing under the objective — finds no decision
      // to respect.
      const objectiveId = h.requests.at(-1)?.objective?.id ?? 'memory-3'
      expect(h.runtime.evidenceStore()!.candidate('memory-2' as never)!.decisions).toEqual([
        expect.objectContaining({ status: 'rejected', authority: 'user', objectiveId }),
      ])

      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k2', name: 'record_candidate', args: {
          candidate_id: 'memory-2',
          status: 'accepted',
          reason: 'on reflection it does match',
          supporting_evidence: ['memory-1'],
        } }],
      })
      h.queue.push({ kind: 'answer', speak: 'Still looking.', display: 'Still looking.', runNote: 'Still looking.' })
      await h.runner.run('keep looking')
      expect(refusals(h).some((error) => /only the user reopens it/.test(error))).toBe(true)
      expect(h.runtime.evidenceStore()?.candidate('memory-2' as never)?.status).toBe('rejected')
    })

    it('refuses a model revival of the user\'s rejection, and admits the user\'s own reopening', async () => {
      const h = harness()
      await establish(h)
      await rejectOnUserAuthority(h)

      // A later round finds the Candidate promising again. It is not the
      // model's to undo — and the refusal says what would move it.
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k3', name: 'record_candidate', args: {
          candidate_id: 'memory-4',
          status: 'accepted',
          reason: 'on reflection it does match',
          supporting_evidence: ['memory-1'],
        } }],
      })
      h.queue.push({ kind: 'answer', speak: 'Still looking.', display: 'Still looking.', runNote: 'Still looking.' })
      await h.runner.run('keep looking')
      expect(refusals(h).some((error) => /only the user reopens it/.test(error))).toBe(true)
      expect(h.runtime.evidenceStore()?.candidate('memory-4' as never)?.status).toBe('rejected')

      // The user themselves reopens it, in their own words.
      h.queue.push(citeUser('c10', REOPEN))
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k4', name: 'record_candidate', args: {
          candidate_id: 'memory-4',
          status: 'active',
          reason: REOPEN,
          authority: 'user',
          supporting_evidence: ['memory-6'],
        } }],
      })
      h.queue.push({ kind: 'answer', speak: 'Back on it.', display: 'Back on it.', runNote: 'Reopened the reddit post.' })
      await h.runner.run(REOPEN)

      const candidate = h.runtime.evidenceStore()!.candidate('memory-4' as never)!
      expect(candidate.status).toBe('active')
      // The rejection it overturned is still on the record, with the
      // reason and the authority it was made under.
      expect(candidate.decisions.map(({ status, authority, reason }) => [status, authority, reason])).toEqual([
        ['rejected', 'user', REJECTION],
        ['active', 'user', REOPEN],
      ])
    })

    it('keeps the rejection through a constraint revision and drops it for a replacement objective', async () => {
      const h = harness()
      await establish(h)
      await rejectOnUserAuthority(h)

      // Revising a constraint continues the same objective, so the user's
      // rejection under it is untouched — and still not the model's to undo.
      h.queue.push(citeUser('c11', REVISION))
      h.queue.push({
        kind: 'answer',
        speak: 'Understood.',
        display: 'Searching forums instead.',
        runNote: 'Narrowed the search to forums.',
        memoryPatch: parseMemoryPatch([{
          op: 'update',
          id: 'memory-3',
          entry: {
            kind: 'constraint',
            subject: 'Authorship',
            detail: 'The user found it on a forum, not on Reddit.',
            user_evidence: ['memory-6'],
          },
        }])!,
      })
      await h.runner.run(REVISION)
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k5', name: 'record_candidate', args: {
          candidate_id: 'memory-4',
          status: 'accepted',
          reason: 'the revision makes it fit',
          supporting_evidence: ['memory-6'],
        } }],
      })
      h.queue.push({ kind: 'answer', speak: 'Still looking.', display: 'Still looking.', runNote: 'Still looking.' })
      await h.runner.run('keep looking')
      expect(h.requests.at(-1)?.objective?.id).toBe('memory-2')
      expect(refusals(h).some((error) => /only the user reopens it/.test(error))).toBe(true)
      expect(h.runtime.evidenceStore()?.candidate('memory-4' as never)?.status).toBe('rejected')

      // Replacing the objective is a different task. The rejection was for
      // the old one: the new objective inherits none of it, so the same
      // Candidate may be decided afresh — and the old decision stays on
      // the record under the objective it belonged to.
      h.queue.push(citeUser('c12', REPLACEMENT))
      h.queue.push({
        kind: 'answer',
        speak: 'On it.',
        display: 'Looking for tables.',
        runNote: 'Switched to booking a table.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Book a table',
            detail: 'A table for two tonight.',
            user_evidence: ['memory-7'],
          },
        }])!,
      })
      await h.runner.run(REPLACEMENT)
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'k6', name: 'record_candidate', args: {
          candidate_id: 'memory-4',
          status: 'accepted',
          reason: 'it is the right one for the booking',
          supporting_evidence: ['memory-1'],
        } }],
      })
      h.queue.push({ kind: 'answer', speak: 'Booked.', display: 'Booked.', runNote: 'Booked a table.' })
      await h.runner.run('keep looking')

      const candidate = h.runtime.evidenceStore()!.candidate('memory-4' as never)!
      expect(candidate.status).toBe('accepted')
      expect(candidate.decisions.map(({ status, authority, objectiveId }) => [status, authority, objectiveId])).toEqual([
        ['rejected', 'user', 'memory-2'],
        ['accepted', 'model', 'memory-8'],
      ])
    })

    it('leaves the objective standing when the model cannot quote the user for a change', async () => {
      const h = harness()
      await establish(h)

      // Two ambiguous readings the model might act on alone: rewrite the
      // user's constraint, or declare a new objective from its own
      // reading. Neither carries the user's words, so neither lands.
      h.queue.push({
        kind: 'answer',
        speak: 'Rewriting the task.',
        display: 'Rewriting the task.',
        runNote: 'Decided the user wrote the post.',
        memoryPatch: parseMemoryPatch([{
          op: 'update',
          id: 'memory-3',
          entry: { kind: 'constraint', subject: 'Authorship', detail: 'The user authored the post.' },
        }])!,
      })
      await h.runner.run('keep looking')
      h.queue.push({
        kind: 'answer',
        speak: 'Trying a new angle.',
        display: 'Trying a new angle.',
        runNote: 'Reframed the task.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: { kind: 'objective', subject: 'Find the post the user wrote', detail: 'Authored by the user.' },
        }])!,
      })
      await h.runner.run('keep looking')
      await h.runner.run('keep looking')

      // The rewrite was refused outright; the model's own objective was
      // admitted as the model's, and neither displaced the user's.
      expect(h.degraded).toContain('invalid_memory')
      expect(h.requests.at(-1)?.objective).toEqual({
        id: 'memory-2',
        userText: [FOUND],
        constraints: [{ id: 'memory-3', userText: [FOUND] }],
      })
      expect(h.requests.at(-1)?.memory?.map(({ id, subject }) => [id, subject])).toContainEqual([
        'memory-4', 'Find the post the user wrote',
      ])
    })

    it('will not retire the objective on a rewording of the same task', async () => {
      const h = harness()
      await establish(h)

      // The ambiguous transition, resolved the wrong way: the model reads
      // "keep looking" as a new task and declares one, grounding it in the
      // only user words it has — the ones the objective already stands on.
      // Admitting that would drop every constraint silently, so it is
      // refused and the model is left to ask the user which they meant.
      h.queue.push({
        kind: 'answer',
        speak: 'Starting over.',
        display: 'Starting over.',
        runNote: 'Treated this as a new task.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Locate the tier list post',
            detail: 'The same task, said differently.',
            user_evidence: ['memory-1'],
          },
        }])!,
      })
      await h.runner.run('keep looking')
      await h.runner.run('keep looking')

      expect(h.degraded).toContain('invalid_memory')
      expect(h.requests.at(-1)?.objective).toEqual({
        id: 'memory-2',
        userText: [FOUND],
        constraints: [{ id: 'memory-3', userText: [FOUND] }],
      })
      expect(h.requests.at(-1)?.memory?.map(({ id, status }) => [id, status])).toEqual([
        ['memory-2', undefined],
        ['memory-3', undefined],
      ])
    })

    it('carries no objective into the Session that replaces this one', async () => {
      const h = harness()
      await establish(h)

      h.runtime.end('reset')
      await h.runner.run('keep looking')

      expect(h.requests.at(-1)?.objective).toBeUndefined()
      expect(h.requests.at(-1)?.memory).toEqual([])
    })
  })

  // #210, ADR 0039: an Answer that presents a Candidate says which one,
  // and the Session retains that relationship. Every test here reads the
  // subject out of the *next* Run's outgoing context — that is the whole
  // observable behaviour: what a later "show me that again" is told it
  // is about. The page the browser is on moves independently throughout,
  // because the page is exactly what must not decide this.
  describe('Inspection Reference across commands (#210)', () => {
    /** Where the browser happens to be — moved between Runs, never consulted. */
    let page = 'https://old.reddit.com/r/tierlists'
    const POST = 'https://old.reddit.com/r/tierlists/comments/abc'
    const THREAD = 'https://forum.example/thread/9'

    /** The acquisition a web Observation has to be grounded in. */
    const readPage: Tool = {
      name: 'read_page',
      acquisition: true,
      async execute() {
        return 'A tier list post.'
      },
    }

    function harness() {
      const clock = new FakeClock(1_000)
      const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
      const requests: LlmRequest[] = []
      const queue: AssistantTurn[] = []
      const degraded: string[] = []
      let failAt: number | null = null
      const llm: LlmClient = {
        complete(request) {
          requests.push(request)
          if (requests.length === failAt) {
            failAt = null
            return Promise.reject(new Error('provider unavailable'))
          }
          return Promise.resolve(queue.shift() ?? { kind: 'answer', speak: 'Nothing yet.', display: 'Nothing yet.' })
        },
      }
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [readPage, createRecordEvidenceTool(), createRecordCandidateTool()],
        currentPageUrl: () => page,
        onContinuityDegraded: (reason) => degraded.push(reason),
      })
      const runner = createAssistantCommandRunner({
        pipeline,
        runtime,
        clock,
        onSessionReset: () => {},
        createRunPublisher: () => ({ publish: () => {} }),
        publishFeedback: () => {},
      })
      /** Fails the nth model request of the Session, once. */
      return { runtime, runner, requests, queue, degraded, failRequest: (nth: number) => { failAt = nth } }
    }

    /**
     * Two rounds that find one Candidate: the page is read, the fact is
     * checkpointed against it, and the Candidate is recorded on that
     * Observation. `supportId` is the Observation the run is about to
     * mint — Session identities are minted in order, so the script names
     * them rather than deriving them twice.
     */
    function findCandidate(
      h: ReturnType<typeof harness>,
      fields: { subject: string; url: string; supportId: string; callId: string },
    ): void {
      page = fields.url
      h.queue.push({ kind: 'tool_calls', calls: [{ id: `${fields.callId}r`, name: 'read_page', args: {} }] })
      h.queue.push({
        kind: 'tool_calls',
        calls: [
          {
            id: `${fields.callId}a`,
            name: 'record_evidence',
            // The excerpt must appear in what the page read returned.
            args: { observation: `${fields.subject} is a tier list post.`, source_url: fields.url, excerpt: 'tier list post' },
          },
          {
            id: `${fields.callId}b`,
            name: 'record_candidate',
            args: { subject: fields.subject, supporting_evidence: [fields.supportId] },
          },
        ],
      })
    }

    /**
     * The Run that presents Candidate A: memory-1 grounds it, memory-2 is
     * the Candidate, and the Answer names memory-2 as what the user is now
     * looking at.
     */
    async function present(h: ReturnType<typeof harness>): Promise<void> {
      findCandidate(h, { subject: 'Ranking every mech', url: POST, supportId: 'memory-1', callId: 'c1' })
      h.queue.push({
        kind: 'answer',
        speak: 'Here it is.',
        display: 'The "Ranking every mech" post.',
        runNote: 'Presented the mech tier list post.',
        inspectionCandidateId: 'memory-2' as MemoryEntryId,
      })
      await h.runner.run('find that tier list post')
    }

    it('addresses the presented Candidate after the browser moved on', async () => {
      const h = harness()
      await present(h)

      // An ordinary continuation that browses elsewhere and presents
      // nothing: incidental navigation neither creates a subject nor
      // replaces one.
      page = 'https://news.example/unrelated'
      await h.runner.run('what else is on that subreddit')
      expect(h.requests.at(-1)?.inspection).toMatchObject({ candidateId: 'memory-2' })

      page = 'https://another.example/elsewhere'
      await h.runner.run('show me that again')

      expect(h.requests.at(-1)?.inspection).toEqual({
        candidateId: 'memory-2',
        subject: 'Ranking every mech',
        status: 'active',
        references: [{ url: POST }],
      })
      // The subject is the Candidate, never the page the Run is standing on.
      expect(JSON.stringify(h.requests.at(-1)?.inspection)).not.toContain('another.example')
    })

    it('replaces the subject only when another Candidate is presented', async () => {
      const h = harness()
      await present(h)

      findCandidate(h, { subject: 'Every mech, ranked again', url: THREAD, supportId: 'memory-3', callId: 'c2' })
      h.queue.push({
        kind: 'answer',
        speak: 'Try this one.',
        display: 'A forum thread instead.',
        runNote: 'Presented the forum thread.',
        inspectionCandidateId: 'memory-4' as MemoryEntryId,
      })
      await h.runner.run('keep looking')
      await h.runner.run('scroll down')

      expect(h.requests.at(-1)?.inspection).toMatchObject({
        candidateId: 'memory-4',
        subject: 'Every mech, ranked again',
      })
    })

    it('refuses an identity that is not a live Candidate, and keeps the standing subject', async () => {
      const h = harness()
      await present(h)

      // memory-1 is the Observation the Candidate stands on. Naming it
      // would make evidence the thing the user is looking at, so it is
      // refused — and refusing does not unset the real subject either.
      h.queue.push({
        kind: 'answer',
        speak: 'Still looking.',
        display: 'Still looking.',
        runNote: 'Nothing new.',
        inspectionCandidateId: 'memory-1' as MemoryEntryId,
      })
      await h.runner.run('keep looking')
      h.queue.push({
        kind: 'answer',
        speak: 'Still looking.',
        display: 'Still looking.',
        runNote: 'Nothing new.',
        inspectionCandidateId: 'memory-404' as MemoryEntryId,
      })
      await h.runner.run('keep looking')
      await h.runner.run('show me that again')

      expect(h.requests.at(-1)?.inspection).toMatchObject({ candidateId: 'memory-2' })
    })

    it('establishes nothing from a Candidate the Run never presented', async () => {
      const h = harness()

      // Two Candidates recorded, an Answer that names neither: the user
      // was shown a shortlist, so "that one" has no subject and the model
      // is left to ask which they mean rather than being handed one.
      findCandidate(h, { subject: 'Ranking every mech', url: POST, supportId: 'memory-1', callId: 'c1' })
      findCandidate(h, { subject: 'Every mech, ranked again', url: THREAD, supportId: 'memory-3', callId: 'c2' })
      h.queue.push({
        kind: 'answer',
        speak: 'Two possibilities.',
        display: 'Two posts match.',
        runNote: 'Shortlisted two posts.',
      })
      await h.runner.run('find that tier list post')
      await h.runner.run('open that one')

      expect(h.requests.at(-1)?.inspection).toBeUndefined()
    })

    it('establishes nothing from a Run that never reached an Answer', async () => {
      const h = harness()

      // The Candidate is recorded and the model is about to present it —
      // then the round fails and the Run ends without an Answer. Nobody
      // was shown anything, so nothing is retained for the next command.
      findCandidate(h, { subject: 'Ranking every mech', url: POST, supportId: 'memory-1', callId: 'c1' })
      // The page is read and the Candidate recorded; the round that would
      // have presented it never returns.
      h.failRequest(3)
      await h.runner.run('find that tier list post')
      await h.runner.run('show me that again')

      expect(h.requests.at(-1)?.evidence?.candidates).toHaveLength(1)
      expect(h.requests.at(-1)?.inspection).toBeUndefined()
    })

    it('survives a constraint the user corrects, and clears on the objective they replace', async () => {
      const h = harness()
      // The objective the Candidate is presented under, in the user's own
      // words (#206): memory-1 the words, memory-2 the objective.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'u1', name: 'record_evidence', args: { kind: 'user', observation: 'find that tier list post i found last week' } }] })
      h.queue.push({
        kind: 'answer',
        speak: 'Looking.',
        display: 'Looking.',
        runNote: 'Started the search.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: { kind: 'objective', subject: 'Find the tier list post', detail: 'A post the user found.', user_evidence: ['memory-1'] },
        }])!,
      })
      await h.runner.run('find that tier list post i found last week')

      findCandidate(h, { subject: 'Ranking every mech', url: POST, supportId: 'memory-3', callId: 'c2' })
      h.queue.push({
        kind: 'answer',
        speak: 'Here it is.',
        display: 'The "Ranking every mech" post.',
        runNote: 'Presented the post.',
        inspectionCandidateId: 'memory-4' as MemoryEntryId,
      })
      await h.runner.run('keep looking')

      // A correction that narrows the same objective: the user is still
      // looking at the same thing.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'u2', name: 'record_evidence', args: { kind: 'user', observation: 'it was on a forum, not reddit' } }] })
      h.queue.push({
        kind: 'answer',
        speak: 'Understood.',
        display: 'Forums it is.',
        runNote: 'Narrowed to forums.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: { kind: 'constraint', subject: 'Source', detail: 'A forum, not Reddit.', user_evidence: ['memory-5'] },
        }])!,
      })
      await h.runner.run('it was on a forum, not reddit')
      await h.runner.run('show me that again')
      expect(h.requests.at(-1)?.inspection).toMatchObject({ candidateId: 'memory-4' })

      // A different task: what they were looking at under the old one is
      // no longer what "that one" means.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'u3', name: 'record_evidence', args: { kind: 'user', observation: 'forget that, book me a table for two tonight' } }] })
      h.queue.push({
        kind: 'answer',
        speak: 'On it.',
        display: 'Looking for tables.',
        runNote: 'Switched to booking.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: { kind: 'objective', subject: 'Book a table', detail: 'For two tonight.', user_evidence: ['memory-7'] },
        }])!,
      })
      await h.runner.run('forget that, book me a table for two tonight')
      await h.runner.run('show me that again')

      expect(h.requests.at(-1)?.objective).toMatchObject({ userText: ['forget that, book me a table for two tonight'] })
      expect(h.requests.at(-1)?.inspection).toBeUndefined()
    })

    it('clears a subject presented in the same Run that recorded the objective', async () => {
      const h = harness()
      // The commonest shape of all, and the one that hid a hole: the Run
      // that presents the Candidate is the Run that first records the
      // user's objective, so its admission memory held no objective to
      // stamp the reference with. The Session adopts the objective at the
      // next admission — without that, the replacement below would leave
      // the old subject standing for the rest of the Session.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'u1', name: 'record_evidence', args: { kind: 'user', observation: 'find that tier list post' } }] })
      findCandidate(h, { subject: 'Ranking every mech', url: POST, supportId: 'memory-2', callId: 'c1' })
      h.queue.push({
        kind: 'answer',
        speak: 'Here it is.',
        display: 'The "Ranking every mech" post.',
        runNote: 'Presented the post.',
        inspectionCandidateId: 'memory-3' as MemoryEntryId,
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: { kind: 'objective', subject: 'Find the tier list post', detail: 'A post the user found.', user_evidence: ['memory-1'] },
        }])!,
      })
      await h.runner.run('find that tier list post')
      await h.runner.run('show me that again')
      expect(h.requests.at(-1)?.inspection).toMatchObject({ candidateId: 'memory-3' })

      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'u2', name: 'record_evidence', args: { kind: 'user', observation: 'forget that, book me a table for two tonight' } }] })
      h.queue.push({
        kind: 'answer',
        speak: 'On it.',
        display: 'Looking for tables.',
        runNote: 'Switched to booking.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: { kind: 'objective', subject: 'Book a table', detail: 'For two tonight.', user_evidence: ['memory-5'] },
        }])!,
      })
      await h.runner.run('forget that, book me a table for two tonight')
      await h.runner.run('show me that again')

      expect(h.requests.at(-1)?.inspection).toBeUndefined()
    })

    it('is not Observation support, however the Answer cites it', async () => {
      const h = harness()
      findCandidate(h, { subject: 'Ranking every mech', url: POST, supportId: 'memory-1', callId: 'c1' })
      // The same identity offered twice: as the subject the user is
      // looking at, and as the evidence an Assessment stands on. Only the
      // first is what a Candidate identity can be — the Assessment is
      // stripped rather than standing on a Candidate the model chose.
      h.queue.push({
        kind: 'answer',
        speak: 'Here it is.',
        display: 'The "Ranking every mech" post.',
        runNote: 'Presented the post.',
        inspectionCandidateId: 'memory-2' as MemoryEntryId,
        evidenceIds: ['memory-2' as MemoryEntryId],
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: { kind: 'assessment', subject: 'It is the post', detail: 'Certainly the one.', references: [{ url: POST }] },
        }])!,
      })
      await h.runner.run('find that tier list post')
      await h.runner.run('show me that again')

      expect(h.degraded).toContain('unsupported_assessment')
      expect(h.requests.at(-1)?.memory?.some(({ kind }) => kind === 'assessment')).toBe(false)
      // The subject still stands: refusing the citation is not refusing
      // the presentation.
      expect(h.requests.at(-1)?.inspection).toMatchObject({ candidateId: 'memory-2' })
    })

    it('carries no inspection subject into the Session that replaces this one', async () => {
      const h = harness()
      await present(h)

      h.runtime.end('reset')
      await h.runner.run('show me that again')

      expect(h.requests.at(-1)?.inspection).toBeUndefined()
    })
  })

  // #211, ADR 0039: an accepted correction is retained before the model
  // runs, survives a first request that never returns, and is resolved by
  // grounding rather than by anyone deciding it looks like a rejection.
  // The whole failure, scripted end to end: present A, say "not that one;
  // keep looking", lose the very first model request, then continue.
  describe('user corrections retained before the model responds (#211)', () => {
    const FIND = 'find that tier list post'
    const REJECT = 'not that one; keep looking'
    const NARROW = 'only posts from 2023'
    const POST = 'https://old.reddit.com/r/tierlists/comments/abc'
    const THREAD = 'https://forum.example/thread/9'

    /** Where the browser happens to be — moved by reads, never consulted for a subject. */
    let page = POST

    /** The acquisition a web Observation has to be grounded in. */
    const readPage: Tool = {
      name: 'read_page',
      acquisition: true,
      async execute(call) {
        if (typeof call.args.url === 'string') page = call.args.url
        return 'A tier list post.'
      },
    }

    function harness() {
      const clock = new FakeClock(1_000)
      const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
      const requests: LlmRequest[] = []
      const queue: AssistantTurn[] = []
      const published: PipelineEvent[] = []
      let failAt: number | null = null
      const llm: LlmClient = {
        complete(request) {
          requests.push(request)
          if (requests.length === failAt) {
            failAt = null
            return Promise.reject(new Error('provider unavailable'))
          }
          return Promise.resolve(queue.shift() ?? { kind: 'answer', speak: 'Nothing yet.', display: 'Nothing yet.' })
        },
      }
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [readPage, createRecordEvidenceTool(), createRecordCandidateTool()],
        currentPageUrl: () => page,
      })
      const runner = createAssistantCommandRunner({
        pipeline,
        runtime,
        clock,
        onSessionReset: () => {},
        createRunPublisher: () => ({ publish: (event: PipelineEvent) => published.push(event) }),
        publishFeedback: () => {},
      })
      return {
        runtime,
        runner,
        requests,
        queue,
        published,
        /** Fails the nth model request of the Session, once. */
        failRequest: (nth: number) => {
          failAt = nth
        },
        /** What the Session retains and no Run has resolved. */
        unresolved: () => runtime.evidenceStore()!.unresolvedCorrections(),
        candidate: (id: string) => runtime.evidenceStore()!.candidate(id as MemoryEntryId)!,
      }
    }

    /**
     * Run 1: reads the post, grounds it, quotes the user's command, records
     * Candidate A, and presents it — recording the user's objective in the
     * same Memory Commit, exactly as the commonest Run of all does.
     *
     * Leaves memory-1 (the post), memory-2 (the user's words), memory-3
     * (Candidate A) and memory-4 (the objective).
     */
    async function present(h: ReturnType<typeof harness>): Promise<void> {
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: { url: POST } }] })
      h.queue.push({
        kind: 'tool_calls',
        calls: [
          {
            id: 'e1',
            name: 'record_evidence',
            args: { observation: 'Ranking every mech is a tier list post.', source_url: POST, excerpt: 'tier list post' },
          },
          { id: 'e2', name: 'record_evidence', args: { kind: 'user', observation: FIND } },
          { id: 'c1', name: 'record_candidate', args: { subject: 'Ranking every mech', supporting_evidence: ['memory-1'] } },
        ],
      })
      h.queue.push({
        kind: 'answer',
        speak: 'Here it is.',
        display: 'The "Ranking every mech" post.',
        runNote: 'Presented the mech tier list post.',
        inspectionCandidateId: 'memory-3' as MemoryEntryId,
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Find the tier list post',
            detail: 'A post the user found last week.',
            user_evidence: ['memory-2'],
          },
        }])!,
      })
      await h.runner.run(FIND)
    }

    it('retains the wording and the subject through a first request that never returned', async () => {
      const h = harness()
      await present(h)

      // The correction arrives and the very first model request of its Run
      // fails — before a tool has run, before anything could interpret it.
      h.failRequest(h.requests.length + 1)
      await h.runner.run(REJECT)

      // The words, the subject, and the task they were spoken under are
      // the Session's, exactly as spoken.
      expect(h.unresolved()).toEqual([
        expect.objectContaining({
          text: REJECT,
          candidateId: 'memory-3',
          objectiveId: 'memory-4',
          runId: 'run-2',
        }),
      ])
      // And nothing was decided on the way: retention is not
      // interpretation, so no deterministic output can claim A was ruled
      // out — because nothing ruled it out.
      expect(h.candidate('memory-3')).toMatchObject({ status: 'active', decisions: [] })
      const spoken = h.published.filter((event) => event.type === 'display' || event.type === 'speak')
      expect(spoken.length).toBeGreaterThan(0)
      for (const event of spoken) {
        expect((event as { text: string }).text).not.toMatch(/ruled out|rejected|not a match/i)
      }
    })

    it('carries the unresolved words into the next Run request, beside the subject', async () => {
      const h = harness()
      await present(h)
      h.failRequest(h.requests.length + 1)
      await h.runner.run(REJECT)

      await h.runner.run('keep looking')

      const request = h.requests.at(-1)!
      expect(request.command).toBe('keep looking')
      // The user's words, quoted, with the Candidate they were about and
      // the Observation a decision on their authority has to cite.
      expect(request.corrections).toEqual([
        { text: REJECT, observationId: 'memory-5', candidateId: 'memory-3', candidateSubject: 'Ranking every mech' },
        { text: 'keep looking', candidateId: 'memory-3', candidateSubject: 'Ranking every mech' },
      ])
      // The inherited words became Session Evidence as this Run was
      // admitted, under the Run that heard them: only that Run could
      // ground them, and it ended without the chance. This Run's own
      // words are not evidence — it is about to answer them itself.
      expect(h.runtime.evidenceStore()!.observation('memory-5' as MemoryEntryId)).toMatchObject({
        sourceKind: 'user',
        text: REJECT,
        provenance: [expect.objectContaining({ runId: 'run-2' })],
      })
      // Beside — never instead of — the objective and the subject.
      expect(request.objective).toMatchObject({ id: 'memory-4', userText: [FIND] })
      expect(request.inspection).toMatchObject({ candidateId: 'memory-3' })
    })

    it('refuses to settle or re-present the Candidate until the words are resolved', async () => {
      const h = harness()
      await present(h)
      h.failRequest(h.requests.length + 1)
      await h.runner.run(REJECT)
      const presentedBy = h.runtime.evidenceStore()!.inspectionReference()

      // The continuation likes Candidate A again and says so, on its own
      // authority, and then shows it to the user.
      h.queue.push({
        kind: 'tool_calls',
        calls: [{
          id: 'c2',
          name: 'record_candidate',
          args: {
            candidate_id: 'memory-3',
            status: 'accepted',
            reason: 'it still looks like the best match to me',
            supporting_evidence: ['memory-1'],
          },
        }],
      })
      h.queue.push({
        kind: 'answer',
        speak: 'Here it is again.',
        display: 'The "Ranking every mech" post.',
        runNote: 'Tried to present the mech post again.',
        inspectionCandidateId: 'memory-3' as MemoryEntryId,
      })
      await h.runner.run('keep looking')

      // The decision was refused, and told why in terms the run can act on.
      const refusal = h.published.find((event) => event.type === 'tool_result' && event.callId === 'c2')
      expect(refusal).toMatchObject({ ok: false })
      expect(JSON.stringify(refusal)).toContain('no run has resolved')
      expect(h.candidate('memory-3')).toMatchObject({ status: 'active', decisions: [] })
      // And the presentation was refused too: the subject is still the one
      // Run 1 presented, not a fresh presentation by this Run.
      //
      // The boundary this scenario shows on purpose: presentation is an
      // explicit act (#210), and refusing it is what the application can
      // enforce. The Answer's own prose is the model's, and this script
      // has it describe the post anyway — nothing here can stop that, and
      // pretending otherwise would be the wrong claim to make. What keeps
      // prose honest is the orchestrator instruction and the fact that no
      // decision exists to call the Candidate ruled out; what keeps the
      // *Session* honest is this refusal, which is why the next Run is
      // still addressing Run 1's subject rather than this Run's.
      expect(h.runtime.evidenceStore()!.inspectionReference()).toEqual(presentedBy)
      expect(presentedBy).toMatchObject({ runId: 'run-1' })
      // Answering its own command resolves its own words — never the debt
      // it inherited from the Run that never answered.
      expect(h.unresolved().map(({ text }) => text)).toEqual([REJECT])
    })

    it('turns the resolved words into an objective-scoped decision the user owns', async () => {
      const h = harness()
      await present(h)
      h.failRequest(h.requests.length + 1)
      await h.runner.run(REJECT)

      // The continuation does what the correction asks: it records the
      // decision the user's own retained words carry, as theirs.
      h.queue.push({
        kind: 'tool_calls',
        calls: [{
          id: 'c3',
          name: 'record_candidate',
          args: {
            candidate_id: 'memory-3',
            status: 'rejected',
            authority: 'user',
            reason: 'the user ruled this post out and asked to keep looking',
            supporting_evidence: ['memory-5'],
          },
        }],
      })
      h.queue.push({ kind: 'answer', speak: 'Still looking.', display: 'Looking elsewhere.', runNote: 'Ruled out the mech post.' })
      await h.runner.run('keep looking')

      // Retained as the user's, for the objective they were working.
      expect(h.candidate('memory-3').decisions).toEqual([
        expect.objectContaining({ status: 'rejected', authority: 'user', objectiveId: 'memory-4' }),
      ])
      expect(h.unresolved()).toEqual([])

      // And with the words resolved, the Session may show it again — the
      // block was on the unresolved correction, never on the Candidate.
      h.queue.push({
        kind: 'answer',
        speak: 'This is the one you ruled out.',
        display: 'The post you ruled out.',
        runNote: 'Showed the ruled-out post back.',
        inspectionCandidateId: 'memory-3' as MemoryEntryId,
      })
      await h.runner.run('what was the one I said no to')
      expect(h.runtime.evidenceStore()!.inspectionReference()).toMatchObject({ runId: 'run-4' })
    })

    /**
     * Run 1 with two Candidates and no subject named: the Answer put both
     * in front of the user, so "not that one" has no unambiguous subject.
     * Leaves memory-1/memory-4 (the sources), memory-2 (the user's words),
     * memory-3 and memory-5 (the Candidates) and memory-6 (the objective).
     */
    async function presentTwo(h: ReturnType<typeof harness>): Promise<void> {
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: { url: POST } }] })
      h.queue.push({
        kind: 'tool_calls',
        calls: [
          {
            id: 'e1',
            name: 'record_evidence',
            args: { observation: 'Ranking every mech is a tier list post.', source_url: POST, excerpt: 'tier list post' },
          },
          { id: 'e2', name: 'record_evidence', args: { kind: 'user', observation: FIND } },
          { id: 'c1', name: 'record_candidate', args: { subject: 'Ranking every mech', supporting_evidence: ['memory-1'] } },
        ],
      })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r2', name: 'read_page', args: { url: THREAD } }] })
      h.queue.push({
        kind: 'tool_calls',
        calls: [
          {
            id: 'e3',
            name: 'record_evidence',
            args: { observation: 'Every mech ranked again is a tier list post.', source_url: THREAD, excerpt: 'tier list post' },
          },
          { id: 'c2', name: 'record_candidate', args: { subject: 'Every mech, ranked again', supporting_evidence: ['memory-4'] } },
        ],
      })
      h.queue.push({
        kind: 'answer',
        speak: 'I found two.',
        display: 'Two possible posts.',
        runNote: 'Presented a shortlist of two.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Find the tier list post',
            detail: 'A post the user found last week.',
            user_evidence: ['memory-2'],
          },
        }])!,
      })
      await h.runner.run(FIND)
    }

    it('retains an ambiguous correction without inventing a subject or rejecting the shortlist', async () => {
      const h = harness()
      await presentTwo(h)
      // No Candidate was named, so the Session holds no subject to take.
      expect(h.runtime.evidenceStore()!.inspectionReference()).toBeNull()

      h.failRequest(h.requests.length + 1)
      await h.runner.run('not that one')

      // The words are kept; the subject is not guessed at.
      expect(h.unresolved()).toEqual([
        expect.objectContaining({ text: 'not that one', objectiveId: 'memory-6', runId: 'run-2' }),
      ])
      expect(h.unresolved()[0]).not.toHaveProperty('candidateId')
      // Neither Candidate was rejected to cover the doubt, and neither is
      // blocked: what is unresolved is a question, not a verdict.
      expect(h.candidate('memory-3')).toMatchObject({ status: 'active', decisions: [] })
      expect(h.candidate('memory-5')).toMatchObject({ status: 'active', decisions: [] })

      // The next Run is handed the words with no subject — which is what
      // it needs in order to ask the user which they meant.
      await h.runner.run('well?')
      expect(h.requests.at(-1)?.corrections).toContainEqual({ text: 'not that one', observationId: 'memory-7' })
    })

    it('retains a constraint correction with no Candidate subject, and resolves it by revising the constraint', async () => {
      const h = harness()
      await presentTwo(h)

      h.failRequest(h.requests.length + 1)
      await h.runner.run(NARROW)
      expect(h.unresolved()).toEqual([
        expect.objectContaining({ text: NARROW, objectiveId: 'memory-6', runId: 'run-2' }),
      ])

      // The continuation revises the constraint the user corrected, citing
      // their own retained words — under the same objective identity.
      h.queue.push({
        kind: 'answer',
        speak: 'Narrowing to 2023.',
        display: 'Only 2023 posts from here.',
        runNote: 'Narrowed the search to 2023.',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'constraint',
            subject: 'Year',
            detail: 'Only posts from 2023.',
            user_evidence: ['memory-7'],
          },
        }])!,
      })
      await h.runner.run('keep looking')

      expect(h.unresolved()).toEqual([])
      // Changing a constraint continues the task; it does not replace it.
      await h.runner.run('and now')
      expect(h.requests.at(-1)?.objective).toEqual({
        id: 'memory-6',
        userText: [FIND],
        constraints: [{ id: 'memory-8', userText: [NARROW] }],
      })
    })

    it('resolves the words only when the model actually wrote an Answer', async () => {
      // AC: "a first-request exception, deadline, or cancellation does not
      // erase it". All three arrive at one seam — the Run reaches an Answer
      // of the model's own writing, or it does not — so this pins the seam
      // rather than one route to it. A Run that recovers from a deadline
      // and answers has answered; a Run that ends any other way leaves the
      // user's words exactly as it found them.
      const clock = new FakeClock(1_000)
      const resolved: string[] = []
      const continuityFor = (label: string): RunContinuityContext => ({
        snapshot: [],
        memory: [],
        generation: 0,
        commit: () => 'committed',
        resolveCorrections: () => resolved.push(label),
      })
      const drive = async (label: string, llm: LlmClient, cancel = false): Promise<void> => {
        const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [] })
        for await (const event of pipeline.execute('keep looking', `turn-${label}`, false, continuityFor(label))) {
          if (cancel && event.type === 'command') pipeline.abort()
        }
      }
      const throwing: LlmClient = { complete: () => Promise.reject(new Error('provider unavailable')) }
      const answering = (): LlmClient =>
        new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Done.', runNote: 'Answered.' }])

      await drive('answered', answering())
      await drive('threw', throwing)
      await drive('cancelled', answering(), true)

      expect(resolved).toEqual(['answered'])
    })

    it('drops the retained words when the Session ends', async () => {
      const h = harness()
      await present(h)
      h.failRequest(h.requests.length + 1)
      await h.runner.run(REJECT)
      expect(h.unresolved()).toHaveLength(1)

      h.runtime.end('reset')

      // A new Session inherits neither the work nor the obligation to
      // resolve what was said about it.
      await h.runner.run(FIND)
      expect(h.runtime.evidenceStore()!.unresolvedCorrections()).toEqual([])
    })

    it('retains nothing from a command the Session rejected as busy', async () => {
      const clock = new FakeClock(1_000)
      const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
      const feedback: SubmissionFeedback[] = []
      let release!: () => void
      const blocked = new Promise<void>((resolve) => {
        release = resolve
      })
      let runs = 0
      const pipeline: CommandPipeline = {
        async *execute(_command, turnId) {
          runs += 1
          if (runs === 2) await blocked
          yield { type: 'done', turnId: turnId ?? `turn-${runs}`, at: clock.now(), outcome: 'done' }
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
        publishFeedback: (item) => feedback.push(item),
      })

      // One Run opens the Session, a second is still running, and a third
      // arrives while it is.
      await runner.run(FIND)
      const busy = runner.run(REJECT)
      const rejected = await runner.run('and this one too')
      release()
      await busy

      expect(rejected).toBe(false)
      expect(feedback.map(({ reason }) => reason)).toEqual(['busy'])
      // A rejected submission is not an accepted Run, so it changed
      // nothing: only the accepted continuation's words are retained.
      expect(runtime.evidenceStore()!.unresolvedCorrections().map(({ text }) => text)).toEqual([REJECT])
    })
  })

  // #212, ADR 0041: a search that cannot check its defining constraint
  // must not keep asking the same route the same question. The whole
  // failure, scripted end to end over a real Session: present a lead,
  // fail the check, refuse the repeat, continue, spend the one fresh
  // attempt, and refuse everything after it.
  //
  // What these tests establish is mechanical — which calls the rails
  // refuse, what the Session retains, what the next Run's request
  // carries, and which Resolution the Run records. They cannot establish
  // that a live model honours the policy it is given, and the scripted
  // Answers below are fixtures, never evidence of live-model compliance
  // (docs/search-continuation-design.md, "Verification Boundary").
  describe('verifying eligible Candidates without repeating a failed check (#212)', () => {
    const FIND = 'find the tier list post with both titles in the 10/10 tier'
    const KEEP = 'keep looking'
    const POST = 'https://old.reddit.com/r/tierlists/comments/abc'
    const LOOK_FAILED = 'Vision request timed out after 8000ms'

    function harness(options: { lookFails?: boolean } = {}) {
      const clock = new FakeClock(1_000)
      const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
      const requests: LlmRequest[] = []
      const queue: AssistantTurn[] = []
      const published: PipelineEvent[] = []
      let lookFails = options.lookFails ?? true
      const looks: boolean[] = []
      const readPage: Tool = {
        name: 'read_page',
        acquisition: true,
        async execute() {
          return `# The mech tier list — ${POST}\n\npage text:\nThe 10/10 tier is an image.`
        },
      }
      const look: Tool = {
        name: 'look',
        usesVision: true,
        acquisition: true,
        async execute() {
          looks.push(lookFails)
          if (lookFails) throw new VisionDeadlineError(8_000)
          return 'The 10/10 tier lists both titles.'
        },
      }
      let failAt: number | null = null
      let exhausted = false
      const llm: LlmClient = {
        complete(request) {
          requests.push(request)
          if (requests.length === failAt) {
            failAt = null
            return Promise.reject(new Error('provider unavailable'))
          }
          const next = queue.shift()
          if (next !== undefined) return Promise.resolve(next)
          if (exhausted) return Promise.reject(new Error('ran out of scripted turns'))
          return Promise.resolve({ kind: 'answer', speak: 'Nothing yet.', display: 'Nothing yet.' })
        },
      }
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [readPage, look, createRecordEvidenceTool(), createRecordCandidateTool()],
        currentPageUrl: () => POST,
      })
      const runner = createAssistantCommandRunner({
        pipeline,
        runtime,
        clock,
        onSessionReset: () => {},
        createRunPublisher: () => ({ publish: (event: PipelineEvent) => published.push(event) }),
        publishFeedback: () => {},
      })
      return {
        runtime,
        runner,
        requests,
        queue,
        published,
        /** Every Look this Session attempted, and whether it was set to fail. */
        looks,
        letLookSucceed: () => {
          lookFails = false
        },
        /** Fails the nth model request of the Session, once. */
        failRequest: (nth: number) => {
          failAt = nth
        },
        /** Every request past the queue fails — including the reserved Answer round. */
        exhaustAfterQueue: () => {
          exhausted = true
        },
        failures: () => runtime.evidenceStore()!.verificationFailures(),
        candidate: (id: string) => runtime.evidenceStore()!.candidate(id as MemoryEntryId)!,
        /** Every failed tool result the Session published, in order. */
        refusals: () =>
          published
            .filter((event): event is Extract<PipelineEvent, { type: 'tool_result' }> => event.type === 'tool_result')
            .filter((event) => !event.ok)
            .map((event) => event.error ?? ''),
        resolutions: () =>
          published
            .filter((event): event is Extract<PipelineEvent, { type: 'done' }> => event.type === 'done')
            .map((event) => event.resolution),
      }
    }

    /**
     * Run 1: reads the post, grounds it, records Candidate A, then tries
     * to read the 10/10 tier image and cannot. Leaves memory-1 (the
     * post), memory-2 (the user's words), memory-3 (Candidate A) and
     * memory-4 (the objective).
     */
    async function failTheCheck(h: ReturnType<typeof harness>, extraLooks = 0): Promise<void> {
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: { url: POST } }] })
      h.queue.push({
        kind: 'tool_calls',
        calls: [
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              observation: 'The mech tier list post shows the 10/10 tier as an image.',
              source_url: POST,
              excerpt: 'The 10/10 tier is an image.',
            },
          },
          { id: 'e2', name: 'record_evidence', args: { kind: 'user', observation: FIND } },
          { id: 'c1', name: 'record_candidate', args: { subject: 'Ranking every mech', supporting_evidence: ['memory-1'] } },
        ],
      })
      for (let at = 0; at <= extraLooks; at += 1) {
        h.queue.push({ kind: 'tool_calls', calls: [{ id: `l${at}`, name: 'look', args: { question: 'which titles are in the 10/10 tier?' } }] })
      }
      h.queue.push({
        kind: 'answer',
        speak: 'I found one possible post but have not checked the tier.',
        display: 'The "Ranking every mech" post — the 10/10 tier is an image I could not read.',
        runNote: 'Presented the mech post; the tier image is unread.',
        inspectionCandidateId: 'memory-3' as MemoryEntryId,
        resolution: 'partial',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Find the tier list post',
            detail: 'Both titles must be in the 10/10 tier.',
            user_evidence: ['memory-2'],
          },
        }])!,
      })
      await h.runner.run(FIND)
    }

    it('retains what the attempt reported, and no explanation of it (#212/AC3)', async () => {
      const h = harness()
      await failTheCheck(h)

      // The route, the words it used, and the Run that spent it. The
      // words are the route's own: the advisory nudge the round appends
      // is ours, and retaining it would hand the next Run our own advice
      // back as though the provider had said it.
      expect(h.failures()).toEqual([
        expect.objectContaining({ route: 'vision', failure: LOOK_FAILED, runId: 'run-1' }),
      ])
      expect(h.failures()[0]!.failure).not.toMatch(/unavailable|broken|offline|read_page/i)
      // No subject and no objective yet, and neither is guessed at: this
      // check was made before anything had been presented, and the task
      // it served only enters Working Memory at the Run's own commit.
      expect(h.failures()[0]!.candidateId).toBeUndefined()
      expect(h.failures()[0]!.objectiveId).toBeUndefined()

      // The next admission joins it to the objective that landed after it
      // — the same commit-time adoption a correction and a decision get.
      h.queue.push({ kind: 'answer', speak: 'Nothing new.', display: 'Nothing new.', resolution: 'partial' })
      await h.runner.run(KEEP)
      expect(h.failures()[0]!.objectiveId).toBe('memory-4')
    })

    it('stamps the Candidate a check was about once one has been presented (#212/AC3)', async () => {
      const h = harness()
      await failTheCheck(h)

      // The continuation looks again at the Candidate the last Answer
      // presented, so this attempt has an unambiguous subject.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l9', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Still unchecked.', display: 'Still unchecked.', resolution: 'partial' })
      await h.runner.run(KEEP)

      expect(h.failures()[1]).toEqual(
        expect.objectContaining({ route: 'vision', candidateId: 'memory-3', objectiveId: 'memory-4', runId: 'run-2' }),
      )
    })

    it('refuses the same check again in the same Run (#212/AC4)', async () => {
      const h = harness()
      await failTheCheck(h, 2)

      // Three Looks were asked for; one was made. The rest never reached
      // the vision model at all.
      expect(h.looks).toHaveLength(1)
      const refused = h.refusals().filter((error) => error.includes('already failed once in this run'))
      expect(refused).toHaveLength(2)
      // And the refusal points somewhere rather than only saying no.
      expect(refused[0]).toContain('read_page')
      expect(refused[0]).toContain('still unverified')
    })

    it('carries the spent route into the next Run’s request, in its own words (#212/AC3)', async () => {
      const h = harness()
      await failTheCheck(h)
      const before = h.requests.length

      await h.runner.run(KEEP)

      const continuation = h.requests[before]!
      expect(continuation.verification).toEqual({
        failures: [{ route: 'vision', failure: LOOK_FAILED }],
        freshAttemptAllowed: true,
        eligible: [{ candidateId: 'memory-3', subject: 'Ranking every mech' }],
      })
    })

    it('permits one fresh attempt on the continuation, then closes it again (#212/AC5)', async () => {
      const h = harness()
      await failTheCheck(h)

      // The continuation asks twice. The first is the fresh attempt the
      // eligible Candidate earns; the second is the repeat the policy
      // answers with a different route or the limitation.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l9', name: 'look', args: {} }] })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l10', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Still unchecked.', display: 'Still unchecked.', resolution: 'partial' })
      await h.runner.run(KEEP)

      expect(h.looks).toHaveLength(2)
      expect(h.refusals().filter((error) => error.includes('already failed once in this run'))).toHaveLength(1)
      // Both attempts are on record, each describing itself.
      expect(h.failures()).toHaveLength(2)
      expect(h.failures().map((held) => held.runId)).toEqual(['run-1', 'run-2'])
    })

    it('refuses a fresh attempt once the user has rejected the Candidate it would settle (#212/AC5)', async () => {
      const h = harness()
      await failTheCheck(h)

      // The user rejects A, and the continuation records that decision on
      // their authority before asking to look again.
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'e9', name: 'record_evidence', args: { kind: 'user', observation: 'not that one; keep looking' } }],
      })
      h.queue.push({
        kind: 'tool_calls',
        calls: [
          {
            id: 'c9',
            name: 'record_candidate',
            args: {
              candidate_id: 'memory-3',
              status: 'rejected',
              authority: 'user',
              reason: 'the user said it is not that one',
              supporting_evidence: ['memory-5'],
            },
          },
        ],
      })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l9', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Looking elsewhere.', display: 'Looking elsewhere.', resolution: 'partial' })
      await h.runner.run('not that one; keep looking')

      expect(h.candidate('memory-3')).toMatchObject({ status: 'rejected' })
      // Nothing is left for a repeat to settle, so it is not spent.
      expect(h.looks).toHaveLength(1)
      expect(h.refusals().some((error) => error.includes('no candidate left'))).toBe(true)
    })

    it('refuses a fresh attempt while inherited words about it are unresolved (#212/AC5)', async () => {
      const h = harness()
      await failTheCheck(h)

      // The user says something about the presented Candidate and that
      // Run's very first model request never returns — so nothing
      // interprets their words, and they outlive the Run (#211).
      h.failRequest(h.requests.length + 1)
      await h.runner.run('not that one; keep looking')
      expect(h.candidate('memory-3')).toMatchObject({ status: 'active', decisions: [] })

      // The Run after it inherits that debt. Checking the Candidate their
      // words name would settle on the model's own authority the very
      // thing they are waiting to be asked about, so the route stays shut.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l9', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Which one did you mean?', display: 'Which one did you mean?', resolution: 'partial' })
      await h.runner.run(KEEP)

      expect(h.looks).toHaveLength(1)
      expect(h.refusals().some((error) => error.includes('no candidate left'))).toBe(true)
    })

    it('reopens every route when the user replaces the objective (#212/AC5)', async () => {
      const h = harness()
      await failTheCheck(h)

      // A replacement objective is a different search. It inherits no
      // rejection and no spent route.
      h.queue.push({
        kind: 'tool_calls',
        calls: [{ id: 'e9', name: 'record_evidence', args: { kind: 'user', observation: 'forget that, find me a mechanical keyboard' } }],
      })
      h.queue.push({
        kind: 'answer',
        speak: 'New search.',
        display: 'New search.',
        runNote: 'The user replaced the objective with a keyboard search.',
        resolution: 'partial',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Find a mechanical keyboard',
            detail: 'The user replaced the tier list search with this one.',
            user_evidence: ['memory-5'],
          },
        }])!,
      })
      await h.runner.run('forget that, find me a mechanical keyboard')

      const before = h.requests.length
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l9', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Looking.', display: 'Looking.', resolution: 'partial' })
      await h.runner.run(KEEP)

      // Nothing is carried into the new task, and the Look is made.
      expect(h.requests[before]!.verification).toBeUndefined()
      expect(h.looks).toHaveLength(2)
    })

    it('does not hand routine image verification to the user (#212/AC2)', async () => {
      const h = harness()
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: { url: POST } }] })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] })
      h.queue.push({
        kind: 'answer',
        speak: 'Can you read the tier image for me?',
        display: 'Can you read the tier image for me?',
        // The Run proposes handing its own check back. It found a page
        // and read it, so what it actually has is useful partial work.
        resolution: 'needs_user',
      })
      await h.runner.run(FIND)

      expect(h.resolutions()).toEqual(['partial'])
    })

    it('records blocked when the failed check left nothing useful to show (#212/AC2)', async () => {
      const h = harness()
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] })
      h.queue.push({
        kind: 'answer',
        speak: 'Can you read the tier image for me?',
        display: 'Can you read the tier image for me?',
        resolution: 'needs_user',
      })
      await h.runner.run(FIND)

      // An unavailable capability prevented further useful work and there
      // is no useful partial result: that is `blocked`, not the user's
      // job.
      expect(h.resolutions()).toEqual(['blocked'])
    })

    it('leaves an honest Resolution the Run proposed alone', async () => {
      const h = harness()
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: { url: POST } }] })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] })
      h.queue.push({
        kind: 'answer',
        speak: 'I found one post but have not checked the tier.',
        display: 'I found one post but have not checked the tier.',
        resolution: 'partial',
      })
      await h.runner.run(FIND)

      expect(h.resolutions()).toEqual(['partial'])
    })

    it('says both what it found and what it could not check, in the deterministic Answer (#212/AC1)', async () => {
      const h = harness()
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: { url: POST } }] })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] })
      // The rest of the Lookup budget goes on reading, so the run stops
      // on its own budget; the reserved Answer round then finds no
      // scripted turn left and fails, which is what puts the
      // deterministic Answer in front of the user.
      for (let at = 2; at < TIER_TOOL_ROUND_BUDGETS.lookup; at += 1) {
        h.queue.push({ kind: 'tool_calls', calls: [{ id: `r${at}`, name: 'read_page', args: { url: `${POST}?page=${at}` } }] })
      }
      h.exhaustAfterQueue()
      await h.runner.run(FIND)

      const display = h.published.find((event) => event.type === 'display') as { text: string } | undefined
      expect(display).toBeDefined()
      // The lead is shown, and neither sentence stands in for the other.
      expect(display!.text).toContain(POST)
      expect(display!.text).toContain('I have not verified that any of these answers the request.')
      expect(display!.text).toContain('I could not read the image I needed to check, so that is still unverified.')
      for (const event of h.published.filter((item) => item.type === 'display' || item.type === 'speak')) {
        const text = (event as { text: string }).text
        expect(text).not.toMatch(RESOURCE_ACCOUNTING)
        expect(text).not.toMatch(FORBIDDEN_ENDINGS)
      }
    })


    it('does not retain a check that was refused before it ran (#212/AC3)', async () => {
      const h = harness()
      // The whole Lookup budget goes on reading, so the run finalizes on
      // its own budget. The bookkeeping round then asks for a look, and
      // Finalization refuses it: acquisition is closed.
      for (let at = 0; at < TIER_TOOL_ROUND_BUDGETS.lookup; at += 1) {
        h.queue.push({ kind: 'tool_calls', calls: [{ id: `r${at}`, name: 'read_page', args: { url: `${POST}?page=${at}` } }] })
      }
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'bk', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Not confirmed.', display: 'Not confirmed.', runNote: 'Read the pages.', resolution: 'partial' })
      await h.runner.run(FIND)

      // The vision model was never contacted.
      expect(h.looks).toHaveLength(0)
      // So nothing was spent, and nothing is retained. Retaining here
      // would put our own Finalize Instruction into the Session as "what
      // the route reported", and hand it to the next Run as the
      // provider's words.
      expect(h.failures()).toEqual([])
    })

    it('keeps looking available to a Session that is weighing no Candidates (#212/AC5)', async () => {
      const h = harness()
      // Reading a chart is not Candidate verification: this Session has no
      // shortlist, so there is nothing for a repeat to grow.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: { url: POST } }] })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: { question: 'what does the chart say?' } }] })
      h.queue.push({
        kind: 'answer',
        speak: 'I could not read it.',
        display: 'I could not read it.',
        runNote: 'The chart is unread.',
        resolution: 'partial',
        memoryPatch: parseMemoryPatch([{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Read the chart on the page',
            detail: 'The user asked what the chart shows.',
            user_evidence: ['memory-1'],
          },
        }])!,
      })
      // The user's own words, so the objective carries their authority.
      h.queue.splice(1, 0, {
        kind: 'tool_calls',
        calls: [{ id: 'e1', name: 'record_evidence', args: { kind: 'user', observation: FIND } }],
      })
      await h.runner.run(FIND)
      expect(h.looks).toHaveLength(1)

      // A later Run asks again. One transient deadline breach must not
      // have disabled looking for the rest of the objective.
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l2', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Still not readable.', display: 'Still not readable.', resolution: 'partial' })
      await h.runner.run('please try again')

      expect(h.looks).toHaveLength(2)
      expect(h.refusals().some((error) => error.includes('no candidate left'))).toBe(false)
    })

    it('stops telling a Run an attempt is open once it has spent one (#212)', async () => {
      const h = harness()
      await failTheCheck(h)

      // The continuation is told a fresh attempt is open, spends it, and
      // watches it fail. The next round must not still be told one is
      // open — the rail will refuse it, and a block that disagrees with
      // the gate costs a round and contradicts itself.
      const before = h.requests.length
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l9', name: 'look', args: {} }] })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'r9', name: 'read_page', args: { url: POST } }] })
      h.queue.push({ kind: 'answer', speak: 'Read it instead.', display: 'Read it instead.', resolution: 'partial' })
      await h.runner.run(KEEP)

      expect(h.requests[before]!.verification!.freshAttemptAllowed).toBe(true)
      expect(h.requests[before + 1]!.verification!.freshAttemptAllowed).toBe(false)
    })

    it('spends the route only on a failure — a Look that answered closes nothing', async () => {
      const h = harness({ lookFails: false })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] })
      h.queue.push({ kind: 'tool_calls', calls: [{ id: 'l2', name: 'look', args: {} }] })
      h.queue.push({ kind: 'answer', speak: 'Both titles are there.', display: 'Both titles are there.', resolution: 'completed' })
      await h.runner.run(FIND)

      expect(h.looks).toHaveLength(2)
      expect(h.failures()).toEqual([])
    })
  })
})
