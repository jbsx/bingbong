import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { createRecordCandidateTool } from '../../core/pipeline/candidateTools'
import { createRecordEvidenceTool } from '../../core/pipeline/evidenceTools'
import { createReportRunPlanTool } from '../../core/pipeline/runPlanTools'
import type { Tool } from '../../core/pipeline/tool'
import { holdBrowserCustody } from '../../core/browser/unsettledAction'
import type { AssistantTurn, LlmClient } from '../../core/ports/llm'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../../core/session/sessionIdentity'
import { createSessionRuntime } from '../../core/session/sessionRuntime'
import { FakeBrowser, FakeClock, RecordingTts } from '../../core/testing/doubles'
import type {
  EvidenceCheckpointEvent,
  LlmRoundEvent,
  PipelineEventTraceEvent,
  ReasoningEvent,
  RunTraceRecord,
} from '../../core/trace/runTrace'
import { RUN_TRACE_VERSION, TRACE_REASONING_MAX_CHARS, TRACE_TOOL_RESULT_MAX_CHARS } from '../../core/trace/runTrace'
import { createAssistantCommandRunner } from '../agent/createAssistantCommandRunner'
import { createSubagentManager } from '../../core/agent/subagentManager'
import { createSubagentTools } from '../../core/pipeline/subagentTools'
import { createSubagentTaskApi } from '../agent/createSubagentWorkhorse'
import { createJsonlRunTraceSink } from './jsonlRunTraceSink'

// The Run Trace end to end (#180, ADR 0030): a real Session, the real
// checkpoint grading, and the real rotating sink — the file is the
// contract, so this test reads it back off disk rather than a fake.

const SOURCE = 'https://shop.example/acme-router'

class DeterministicIdentities implements SessionIdentitySource {
  private submissions = 0
  private runs = 0
  private sessions = 0
  mintSubmissionId = (): SubmissionId => `submission-${++this.submissions}` as SubmissionId
  mintRunId = (): RunId => `run-${++this.runs}` as RunId
  mintSessionId = (): SessionId => `session-${++this.sessions}` as SessionId
}

/** A worker's tab, serving one page — the round is real, the pane is not. */
function workerBrowser(page: string): FakeBrowser {
  const browser = new FakeBrowser()
  browser.readPage = async () => page
  return browser
}

const readPage: Tool = {
  name: 'read_page',
  acquisition: true,
  async execute() {
    return 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'
  },
}

function traceRecords(dir: string): RunTraceRecord[] {
  return readdirSync(dir)
    .filter((name) => /^run-trace-.*\.jsonl$/.test(name))
    .sort()
    .flatMap((name) =>
      readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as RunTraceRecord),
    )
}

/** The checkpoint records, narrowed away from the reasoning ones beside them. */
function checkpoints(records: readonly RunTraceRecord[]): (RunTraceRecord & EvidenceCheckpointEvent)[] {
  return records.filter((record): record is RunTraceRecord & EvidenceCheckpointEvent => record.kind === 'evidence_checkpoint')
}

/** The reasoning records (#182), in the order the rounds happened. */
function reasoning(records: readonly RunTraceRecord[]): (RunTraceRecord & ReasoningEvent)[] {
  return records.filter((record): record is RunTraceRecord & ReasoningEvent => record.kind === 'reasoning')
}

/** The llm_round records (#191), in the order the attempts were sent. */
function llmRounds(records: readonly RunTraceRecord[]): (RunTraceRecord & LlmRoundEvent)[] {
  return records.filter((record): record is RunTraceRecord & LlmRoundEvent => record.kind === 'llm_round')
}

/** The pipeline_event records (#185), in publication order. */
function pipelineEvents(records: readonly RunTraceRecord[]): (RunTraceRecord & PipelineEventTraceEvent)[] {
  return records.filter((record): record is RunTraceRecord & PipelineEventTraceEvent => record.kind === 'pipeline_event')
}

async function runSession(
  dir: string,
  turns: AssistantTurn[],
  options: { traced?: boolean; thinks?: (round: number) => string[]; retriesFirstRound?: boolean } = {},
): Promise<RunTraceRecord[]> {
  const clock = new FakeClock(1_000)
  const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
  let served = 0
  const llm: LlmClient = {
    complete: (request) => {
      const round = served + 1
      // The attempt identity a client reports (#191): before each attempt
      // starts, the retried one included, like the production client.
      const sent = { model: 'stub-model', promptHash: 'hash-1' }
      request.onAttempt?.(sent)
      // The reasoning stream as a provider emits it: deltas, then the turn.
      // A first attempt that thought, then failed: the client retries it,
      // and the abandoned thinking must not join the attempt that survives.
      if (options.retriesFirstRound && round === 1 && request.onDelta) {
        request.onDelta({ kind: 'reasoning', text: 'the provider hung up' })
        request.onRetryAttempt?.(2, 3)
        request.onAttempt?.(sent)
      }
      if (options.thinks && request.onDelta) {
        for (const chunk of options.thinks(round)) request.onDelta({ kind: 'reasoning', text: chunk })
      }
      const turn = turns[served++] ?? { kind: 'answer', speak: 'Done.', display: 'Done.' }
      return Promise.resolve({ ...turn, usage: { promptTokens: 100 * round, completionTokens: 10 } })
    },
  }
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock,
    tools: [readPage, createRecordEvidenceTool(), createRecordCandidateTool()],
    currentPageUrl: () => SOURCE,
  })
  const runner = createAssistantCommandRunner({
    pipeline,
    runtime,
    clock,
    onSessionReset: () => {},
    createRunPublisher: () => ({ publish: () => {} }),
    publishFeedback: () => {},
    // The Run Trace's one opt-in (#184): the sink main builds only behind
    // `BINGBONG_RUN_TRACE`. Absent, the Run traces nothing whatsoever.
    ...(options.traced === false ? {} : { runTrace: createJsonlRunTraceSink(dir) }),
  })

  await runner.run('what does the acme router cost')
  return traceRecords(dir)
}

/**
 * The same file, written by a Run that delegates (#183): the real spawn
 * tool, the real manager, and the real workhorse loop — so what the file
 * holds about a worker's thinking is proved through the path production
 * takes, not a stand-in for it.
 */
async function runDelegatingSession(
  dir: string,
  options: { traced?: boolean; workerThinks: string[]; workerReads?: string },
): Promise<RunTraceRecord[]> {
  const clock = new FakeClock(1_000)
  const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
  // A worker that reads a page first (#185): its Tool Round reaches no
  // view at all, so the only place its call and result can be read back
  // is the parent Run's file.
  const workerPage = options.workerReads
  const taskApi = createSubagentTaskApi({
    getEnv: () => ({
      BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify([
        ...(workerPage !== undefined
          ? [{ kind: 'tool_calls', calls: [{ id: 'w1', name: 'read_page', args: {} }] }]
          : []),
        {
          kind: 'answer',
          speak: 'Checked.',
          display: 'Checked.',
          streamChunks: options.workerThinks.map((text) => ({ kind: 'reasoning', text })),
        },
      ]),
    }),
    fetchFn: (async () => new Response('{}')) as typeof fetch,
    clock,
    // The worker's own tab, when the case is about its Tool Round: a
    // browse worker's tools exist only behind a controller.
    ...(workerPage !== undefined ? { browserFor: () => holdBrowserCustody(workerBrowser(workerPage)) } : {}),
  })
  const manager = createSubagentManager({
    taskApi,
    tabs: { openFor: () => ({ ok: true }), finish: () => undefined },
    clock,
    onEvent: () => undefined,
  })
  // A browse worker, because that is the kind that thinks about pages
  // (#183's motivating case), and browse delegation exists only for an
  // Investigation branch (#120) — so the Run plans one first.
  const orchestratorTurns: AssistantTurn[] = [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'p1',
          name: 'report_run_plan',
          args: { objective: 'Find the router price', headline: 'Checking the router', effort_tier: 'investigation' },
        },
        { id: 'c1', name: 'spawn_agent', args: { kind: 'browse', task: 'check the price page' } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'c2', name: 'agent_results', args: { wait: true } }] },
    { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
  ]
  let served = 0
  const llm: LlmClient = {
    complete: () => Promise.resolve(orchestratorTurns[served++] ?? { kind: 'answer', speak: 'Done.', display: 'Done.' }),
  }
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock,
    tools: [createReportRunPlanTool(), ...createSubagentTools(manager)],
    currentPageUrl: () => SOURCE,
  })
  const runner = createAssistantCommandRunner({
    pipeline,
    runtime,
    clock,
    onSessionReset: () => {},
    createRunPublisher: () => ({ publish: () => {} }),
    publishFeedback: () => {},
    // The Run Trace's one opt-in (#184): the sink main builds only behind
    // `BINGBONG_RUN_TRACE`. Absent, the Run traces nothing whatsoever.
    ...(options.traced === false ? {} : { runTrace: createJsonlRunTraceSink(dir) }),
  })

  await runner.run('what does the acme router cost')
  return traceRecords(dir)
}

describe('the Run Trace file', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-run-trace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes one evidence_checkpoint line per record_evidence call, accepted and rejected alike', async () => {
    const records = checkpoints(await runSession(dir, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'c2',
            name: 'record_evidence',
            args: { observation: 'The Acme router costs $39.', source_url: SOURCE, excerpt: 'Price: $39' },
          },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'c3',
            name: 'record_evidence',
            args: { observation: 'It ships free.', source_url: SOURCE, excerpt: 'free shipping over $50' },
          },
        ],
      },
      { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
    ]))

    expect(records.map((record) => [record.tool, record.outcome, record.matched])).toEqual([
      ['record_evidence', 'accepted', true],
      ['record_evidence', 'excerpt_unsupported', false],
    ])
    // Every record joins the Run's own identity and the eval tape.
    for (const record of records) {
      expect(record.v).toBe(RUN_TRACE_VERSION)
      expect(record.runId).toBe('run-1')
      expect(record.sessionId).toBe('session-1')
      // The first Session's generation: a Reset would advance it.
      expect(record.generation).toBe(0)
      expect(record.turnId).toMatch(/^turn-/)
      expect(record.kind).toBe('evidence_checkpoint')
    }
    expect(records[0]!.entryId).toBe('memory-1')
    // The rejection shows the retention it was graded against, so a wrong
    // excerpt is diagnosable without re-running the Run.
    expect(records[1]!.excerpt).toBe('free shipping over $50')
    expect(records[1]!.graded).toEqual([
      expect.objectContaining({
        producer: 'page_read',
        payloadChars: 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'.length,
        payloadHead: 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.',
        sourceUrl: SOURCE,
        matched: false,
      }),
    ])
  })

  it('traces record_candidate calls the same way, invalid_support included', async () => {
    const records = checkpoints(await runSession(dir, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'c2',
            name: 'record_evidence',
            args: { observation: 'The Acme router costs $39.', source_url: SOURCE, excerpt: 'Price: $39' },
          },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'c3',
            name: 'record_candidate',
            args: { subject: 'Acme Wi-Fi Router', supporting_evidence: ['memory-1'] },
          },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'c4',
            name: 'record_candidate',
            args: { subject: 'Some other router', supporting_evidence: ['memory-404'] },
          },
        ],
      },
      { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
    ]))

    expect(records.map((record) => [record.tool, record.outcome])).toEqual([
      ['record_evidence', 'accepted'],
      ['record_candidate', 'accepted'],
      ['record_candidate', 'invalid_support'],
    ])
    expect(records[1]!.entryId).toBe('memory-2')
    expect(records[2]!.args).toEqual({ subject: 'Some other router', supporting_evidence: ['memory-404'] })
    expect(records[2]!.graded).toEqual([])
  })

  // The reasoning records (#182): opt-in, one per round, and never
  // written — nor retained — with the flag off.
  it('writes one reasoning line per LLM round when the developer opted in', async () => {
    const all = await runSession(
      dir,
      [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
        { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
      ],
      // Several deltas per round, so the record proves the assembly.
      { thinks: (round) => [`round ${round}: `, 'what does', ' it cost'] },
    )

    expect(reasoning(all).map((record) => [record.round, record.text])).toEqual([
      [1, 'round 1: what does it cost'],
      [2, 'round 2: what does it cost'],
    ])
    // They join the Session identity and the eval tape like every other record.
    for (const record of reasoning(all)) {
      expect(record.v).toBe(RUN_TRACE_VERSION)
      expect(record.runId).toBe('run-1')
      expect(record.sessionId).toBe('session-1')
      expect(record.generation).toBe(0)
      expect(record.turnId).toMatch(/^turn-/)
      expect(record.chars).toBe(record.text.length)
      // One attempt each: nothing here retried.
      expect(record.attempt).toBe(1)
    }
    // This Run checkpointed nothing, so reasoning is all the file holds.
    expect(checkpoints(all)).toEqual([])
  })

  it('truncates a round that thought past the cap, and keeps the true length', async () => {
    const long = 'z'.repeat(TRACE_REASONING_MAX_CHARS + 1_000)
    const all = await runSession(dir, [{ kind: 'answer', speak: 'Done.', display: 'Done.' }], {
      thinks: () => [long],
    })

    const [record] = reasoning(all)
    expect(record!.text).toBe(long.slice(0, TRACE_REASONING_MAX_CHARS))
    expect(record!.chars).toBe(long.length)
  })

  it('closes a retried round once per attempt, so the abandoned thinking stands alone', async () => {
    const all = await runSession(dir, [{ kind: 'answer', speak: 'Done.', display: 'Done.' }], {
      retriesFirstRound: true,
      thinks: () => ['second time lucky'],
    })

    expect(reasoning(all).map((record) => [record.round, record.attempt, record.text])).toEqual([
      [1, 1, 'the provider hung up'],
      [1, 2, 'second time lucky'],
    ])
  })

  // A delegated worker's reasoning (#183): the half of the same opt-in
  // that runs through the workhorse loop rather than the pipeline's.
  it("writes one reasoning line per delegated worker round, stamped with the worker's agentId", async () => {
    const all = await runDelegatingSession(dir, {
      workerThinks: ['the task names ', 'one page'],
    })

    const worker = reasoning(all).filter((record) => record.agentId !== undefined)
    expect(worker.map((record) => [record.agentId, record.round, record.attempt, record.text])).toEqual([
      ['a-1', 1, 1, 'the task names one page'],
    ])
    // The worker's thinking joins the Run that delegated it: the parent
    // Run's correlation keys, and the turn the spawn happened in.
    for (const record of worker) {
      expect(record.v).toBe(RUN_TRACE_VERSION)
      expect(record.runId).toBe('run-1')
      expect(record.sessionId).toBe('session-1')
      expect(record.generation).toBe(0)
      expect(record.turnId).toMatch(/^turn-/)
      expect(record.chars).toBe(record.text.length)
    }
  })

  it("cuts a worker's overlong thinking at the same cap, and keeps the true length", async () => {
    const long = 'w'.repeat(TRACE_REASONING_MAX_CHARS + 750)
    const all = await runDelegatingSession(dir, { workerThinks: [long] })

    const [record] = reasoning(all).filter((entry) => entry.agentId !== undefined)
    expect(record!.text).toBe(long.slice(0, TRACE_REASONING_MAX_CHARS))
    expect(record!.chars).toBe(long.length)
  })

  // The worker's Tool Rounds (#185): a delegated worker publishes only
  // its cards and its `subagent_finalized` to the main stream, so what it
  // called and what came back is kept here or nowhere. The records stamp
  // the worker's `agentId` under the parent Run's identity — the same
  // pattern the reasoning and checkpoint records use (#123, #183).
  it("keeps a worker's Tool Round under the parent Run, stamped with its agentId", async () => {
    const all = await runDelegatingSession(dir, {
      workerThinks: ['reading the page'],
      workerReads: 'Acme Wi-Fi Router\nPrice: $39.',
    })

    const worker = pipelineEvents(all).filter((record) => record.agentId !== undefined)
    expect(worker.map((record) => [record.agentId, record.event.type])).toEqual([
      ['a-1', 'tool_call'],
      ['a-1', 'tool_result'],
    ])
    const [call, result] = worker
    expect(call!.event).toMatchObject({ type: 'tool_call', name: 'read_page', turnId: call!.turnId })
    expect(result!.event).toMatchObject({ type: 'tool_result', name: 'read_page', ok: true })
    // The parent Run's identity, so a worker's calls join the delegation
    // that made them — and the turn is the parent's, never the worker's.
    for (const record of worker) {
      expect(record.v).toBe(RUN_TRACE_VERSION)
      expect(record.runId).toBe('run-1')
      expect(record.sessionId).toBe('session-1')
      expect(record.generation).toBe(0)
      expect(record.turnId).toMatch(/^turn-/)
    }
  })

  it("keeps a worker's overlong page read whole, with its length beside it (#191)", async () => {
    const page = 'p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS + 2_500)
    const all = await runDelegatingSession(dir, { workerThinks: [], workerReads: page })

    const [result] = pipelineEvents(all).filter(
      (record) => record.agentId !== undefined && record.event.type === 'tool_result',
    )
    const event = result!.event
    if (event.type !== 'tool_result') throw new Error('not a tool_result')
    expect(event.result).toBe(page)
    expect(result!.chars).toBe(page.length)
  })

  // The llm_round records (#191): what each attempt was sent under and
  // what it cost, numbered exactly as the reasoning record beside it.
  it('writes one llm_round line per attempt, numbered as the reasoning record for the same attempt', async () => {
    const all = await runSession(dir, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
    ], { retriesFirstRound: true, thinks: (round) => [`round ${round}`] })

    const rounds = llmRounds(all)
    // Three attempts: round 1 retried once, then round 2 — the reasoning
    // records number them the same way, attempt for attempt.
    expect(rounds.map((record) => [record.round, record.attempt])).toEqual([[1, 1], [1, 2], [2, 1]])
    expect(reasoning(all).map((record) => [record.round, record.attempt])).toEqual([[1, 1], [1, 2], [2, 1]])
    // Every attempt says what it was sent under; only the ones that
    // returned carry usage — the abandoned attempt never did.
    expect(rounds.map((record) => [record.role, record.model, record.promptHash, record.reasoningEffort])).toEqual([
      ['orchestrator', 'stub-model', 'hash-1', 'high'],
      ['orchestrator', 'stub-model', 'hash-1', 'high'],
      ['orchestrator', 'stub-model', 'hash-1', 'high'],
    ])
    expect(rounds.map((record) => record.usage)).toEqual([
      undefined,
      { promptTokens: 100, completionTokens: 10 },
      { promptTokens: 200, completionTokens: 10 },
    ])
    // The request's shape grows with the context: round 2 carries the
    // page read, so it is one pair deeper and longer than round 1.
    expect(rounds.map((record) => record.request.toolResults)).toEqual([0, 0, 1])
    expect(rounds[2]!.request.chars).toBeGreaterThan(rounds[0]!.request.chars)
    for (const record of rounds) {
      expect(record.v).toBe(RUN_TRACE_VERSION)
      expect(record.runId).toBe('run-1')
      expect(record.sessionId).toBe('session-1')
      expect(record.turnId).toMatch(/^turn-/)
      expect(record.agentId).toBeUndefined()
    }
  })

  it("writes a delegated worker's llm_round lines under the parent Run, stamped with its agentId (#191)", async () => {
    const all = await runDelegatingSession(dir, {
      workerThinks: ['reading the page'],
      workerReads: 'Acme Wi-Fi Router\nPrice: $39.',
    })

    const worker = llmRounds(all).filter((record) => record.agentId !== undefined)
    // Two worker rounds — the read and the answer — served by the
    // scripted double, which names itself the way the usage ledger does.
    expect(worker.map((record) => [record.agentId, record.role, record.round, record.attempt, record.model, record.request.toolResults])).toEqual([
      ['a-1', 'subagent', 1, 1, 'scripted', 0],
      ['a-1', 'subagent', 2, 1, 'scripted', 1],
    ])
    // A worker runs at the Subagent rung (#166), and the record says so.
    expect(worker.map((record) => record.reasoningEffort)).toEqual(['low', 'low'])
    for (const record of worker) {
      expect(record.runId).toBe('run-1')
      expect(record.sessionId).toBe('session-1')
      expect(record.turnId).toMatch(/^turn-/)
    }
    // The orchestrator's own rounds are there too, unstamped.
    expect(llmRounds(all).filter((record) => record.agentId === undefined).map((record) => record.round)).toEqual([1, 2, 3])
  })

  it("writes no worker events at all when the Run Trace is off", async () => {
    const all = await runDelegatingSession(dir, {
      traced: false,
      workerThinks: ['reading the page'],
      workerReads: 'Acme Wi-Fi Router\nPrice: $39.',
    })

    expect(all).toEqual([])
  })

  it('writes nothing at all when the Run Trace is off, however much the worker thinks', async () => {
    const all = await runDelegatingSession(dir, {
      traced: false,
      workerThinks: ['the user asked about their own shopping'],
    })

    expect(all).toEqual([])
  })

  // The whole opt-in, end to end (#184): with `BINGBONG_RUN_TRACE` unset
  // main builds no sink, so a Run that reads a page, thinks out loud and
  // records evidence leaves no file behind — not a reasoning record, not
  // an evidence one.
  it('writes nothing at all when the Run Trace is off, however much the model thinks', async () => {
    const all = await runSession(
      dir,
      [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
        {
          kind: 'tool_calls',
          calls: [
            {
              id: 'c2',
              name: 'record_evidence',
              args: { observation: 'The Acme router costs $39.', source_url: SOURCE, excerpt: 'Price: $39' },
            },
          ],
        },
        { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
      ],
      { traced: false, thinks: () => ['the user asked about their own shopping'] },
    )

    expect(all).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })
})
