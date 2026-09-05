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
import type { RunTraceRecord } from '../../core/trace/runTrace'
import { RUN_TRACE_VERSION } from '../../core/trace/runTrace'
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

async function runSession(dir: string, turns: AssistantTurn[]): Promise<RunTraceRecord[]> {
  const clock = new FakeClock(1_000)
  const runtime = createSessionRuntime({ clock, identities: new DeterministicIdentities() })
  let served = 0
  const llm: LlmClient = {
    complete: () => Promise.resolve(turns[served++] ?? { kind: 'answer', speak: 'Done.', display: 'Done.' }),
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
    const records = await runSession(dir, [
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
    ])

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
    const records = await runSession(dir, [
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
    ])

    expect(records.map((record) => [record.tool, record.outcome])).toEqual([
      ['record_evidence', 'accepted'],
      ['record_candidate', 'accepted'],
      ['record_candidate', 'invalid_support'],
    ])
    expect(records[1]!.entryId).toBe('memory-2')
    expect(records[2]!.args).toEqual({ subject: 'Some other router', supporting_evidence: ['memory-404'] })
    expect(records[2]!.graded).toEqual([])
  })
})
