import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { createRecordCandidateTool } from '../../core/pipeline/candidateTools'
import { createRecordEvidenceTool } from '../../core/pipeline/evidenceTools'
import type { Tool } from '../../core/pipeline/tool'
import type { AssistantTurn, LlmClient } from '../../core/ports/llm'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../../core/session/sessionIdentity'
import { createSessionRuntime } from '../../core/session/sessionRuntime'
import { FakeClock, RecordingTts } from '../../core/testing/doubles'
import type { EvidenceCheckpointEvent, ReasoningEvent, RunTraceRecord } from '../../core/trace/runTrace'
import { RUN_TRACE_VERSION, TRACE_REASONING_MAX_CHARS } from '../../core/trace/runTrace'
import { createAssistantCommandRunner } from '../agent/createAssistantCommandRunner'
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

const readPage: Tool = {
  name: 'read_page',
  acquisition: true,
  async execute() {
    return 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'
  },
}

function traceRecords(dir: string): RunTraceRecord[] {
  return readdirSync(dir)
    .filter((name) => /^trace-.*\.jsonl$/.test(name))
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

async function runSession(
  dir: string,
  turns: AssistantTurn[],
  options: { traceReasoning?: boolean; thinks?: (round: number) => string[]; retriesFirstRound?: boolean } = {},
): Promise<RunTraceRecord[]> {
  const clock = new FakeClock(1_000)
  const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
  let served = 0
  const llm: LlmClient = {
    complete: (request) => {
      const round = served + 1
      // The reasoning stream as a provider emits it: deltas, then the turn.
      // A first attempt that thought, then failed: the client retries it,
      // and the abandoned thinking must not join the attempt that survives.
      if (options.retriesFirstRound && round === 1 && request.onDelta) {
        request.onDelta({ kind: 'reasoning', text: 'the provider hung up' })
        request.onRetryAttempt?.(2, 3)
      }
      if (options.thinks && request.onDelta) {
        for (const chunk of options.thinks(round)) request.onDelta({ kind: 'reasoning', text: chunk })
      }
      return Promise.resolve(turns[served++] ?? { kind: 'answer', speak: 'Done.', display: 'Done.' })
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
    runTrace: createJsonlRunTraceSink(dir),
    ...(options.traceReasoning ? { traceReasoning: true } : {}),
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
    // Every record joins to Recorded History and the eval tape.
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
      { traceReasoning: true, thinks: (round) => [`round ${round}: `, 'what does', ' it cost'] },
    )

    expect(reasoning(all).map((record) => [record.round, record.text])).toEqual([
      [1, 'round 1: what does it cost'],
      [2, 'round 2: what does it cost'],
    ])
    // They join to Recorded History and the eval tape like every other record.
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
      traceReasoning: true,
      thinks: () => [long],
    })

    const [record] = reasoning(all)
    expect(record!.text).toBe(long.slice(0, TRACE_REASONING_MAX_CHARS))
    expect(record!.chars).toBe(long.length)
  })

  it('closes a retried round once per attempt, so the abandoned thinking stands alone', async () => {
    const all = await runSession(dir, [{ kind: 'answer', speak: 'Done.', display: 'Done.' }], {
      traceReasoning: true,
      retriesFirstRound: true,
      thinks: () => ['second time lucky'],
    })

    expect(reasoning(all).map((record) => [record.round, record.attempt, record.text])).toEqual([
      [1, 1, 'the provider hung up'],
      [1, 2, 'second time lucky'],
    ])
  })

  it('writes no reasoning record with the flag unset, however much the model thinks', async () => {
    const all = await runSession(
      dir,
      [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
        { kind: 'answer', speak: 'It is $39.', display: 'It is $39.' },
      ],
      { thinks: () => ['the user asked about their own shopping'] },
    )

    expect(reasoning(all)).toEqual([])
  })
})
