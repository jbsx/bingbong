import { describe, expect, it } from 'vitest'

import type { AssistantTurn, ToolCall } from '../ports/llm'
import type { RunId, SessionId } from '../session/sessionIdentity'
import { createSessionEvidence, type SessionEvidenceStore } from '../session/sessionEvidence'
import type { MemoryEntryId, MemoryPatch } from '../session/workingMemory'
import { FakeClock, RecordingTts, ScriptedLlm, withoutTurnId } from '../testing/doubles'
import type { RunTraceEvent } from '../trace/runTrace'
import { createCommandPipeline, type RunContinuityContext } from './createCommandPipeline'
import { webEvidenceCommit } from './evidenceCheckpoint'
import { createRecordEvidenceTool } from './evidenceTools'
import { createRecordCandidateTool } from './candidateTools'
import type { PipelineEvent } from './events'
import { createReportRunPlanTool } from './runPlanTools'
import type { Tool } from './tool'

const PAGE_URL = 'https://shop.example/acme-router'
const PAGE_TEXT = 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.\nShips in two days.'

const PRICE = { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' }
const SHIPPING = { observation: 'It ships in two days.', source_url: PAGE_URL, excerpt: 'Ships in two days' }
const UNGROUNDED = { observation: 'It has a two-year warranty.', source_url: PAGE_URL, excerpt: 'two-year warranty' }

const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return PAGE_TEXT } }
const READ: AssistantTurn = { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] }

interface Harness {
  readonly store: SessionEvidenceStore
  readonly events: PipelineEvent[]
  readonly traced: RunTraceEvent[]
  readonly degradations: string[]
  readonly committed: MemoryPatch[]
  readonly llm: ScriptedLlm
  /** What the Session held when each event was published. */
  readonly observationsAt: number[]
}

async function run(script: AssistantTurn[], tools: Tool[] = [readPage, createRecordEvidenceTool(), createRecordCandidateTool()]): Promise<Harness> {
  let next = 0
  const store = createSessionEvidence({
    sessionId: 'session-1' as SessionId,
    now: () => 0,
    mintId: () => `memory-${++next}` as MemoryEntryId,
    objectiveId: () => 'memory-objective-a' as MemoryEntryId,
  })
  const traced: RunTraceEvent[] = []
  const degradations: string[] = []
  const committed: MemoryPatch[] = []
  const continuity: RunContinuityContext = {
    snapshot: [],
    memory: [],
    evidence: store.snapshot(),
    generation: 0,
    commit: (_outcome, _note, patch) => {
      committed.push(patch)
      return 'committed'
    },
    checkpointEvidence: webEvidenceCommit(() => store, 'run-1' as RunId),
    evidenceSession: () => ({ store, runId: 'run-1' as RunId }),
    traceRun: (build) => traced.push(build()),
  }
  const llm = new ScriptedLlm(script)
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools,
    currentPageUrl: () => PAGE_URL,
    onContinuityDegraded: (reason) => degradations.push(reason),
  })
  const events: PipelineEvent[] = []
  const observationsAt: number[] = []
  for await (const raw of pipeline.execute('what does the acme router cost', undefined, false, continuity)) {
    events.push(withoutTurnId(raw))
    observationsAt.push(store.snapshot().observations.length)
  }
  return { store, events, traced, degradations, committed, llm, observationsAt }
}

const indexOfType = (events: readonly PipelineEvent[], type: PipelineEvent['type']): number => events.findIndex((event) => event.type === type)

describe('Answer Checkpoints in a Run (#288, ADR 0072)', () => {
  it('records the Answer’s entries once the Card is available, and makes them that Answer’s evidence', async () => {
    const { store, events, observationsAt, llm } = await run([
      READ,
      { kind: 'answer', speak: 'It costs $39.', display: 'The Acme router costs $39.', answerCheckpoints: [PRICE, SHIPPING] },
    ])

    const card = events.findIndex((event) => event.type === 'display' && event.finalAnswer === true)
    const evidence = indexOfType(events, 'answer_evidence')
    // The Card was published with nothing recorded: it never waited.
    expect(observationsAt[card]).toBe(0)
    expect(evidence).toBeGreaterThan(card)
    expect(events[card]).toEqual({ type: 'display', text: 'The Acme router costs $39.', at: 0, finalAnswer: true })
    expect(events[evidence]).toEqual({
      type: 'answer_evidence',
      evidenceIds: ['memory-1', 'memory-2'],
      sources: [{ url: PAGE_URL }],
      at: 0,
    })
    expect(store.snapshot().observations.map((observation) => observation.text)).toEqual([PRICE.observation, SHIPPING.observation])
    // No round was spent recording: the read, and the Answer.
    expect(llm.requests).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('adds the entries to the evidence the Answer named by identity', async () => {
    const { events } = await run([
      READ,
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'record_evidence', args: PRICE }] },
      { kind: 'answer', speak: 'It costs $39.', display: 'Detail.', evidenceIds: ['memory-1' as MemoryEntryId], answerCheckpoints: [SHIPPING] },
    ])

    expect(events.find((event) => event.type === 'display' && event.finalAnswer === true)).toMatchObject({ evidenceIds: ['memory-1'] })
    expect(events.find((event) => event.type === 'answer_evidence')).toMatchObject({ evidenceIds: ['memory-2'] })
  })

  it('drops an entry that fails its grounding check, logs it, and leaves the Answer as displayed', async () => {
    const { store, events, traced, degradations, llm } = await run([
      READ,
      { kind: 'answer', speak: 'It costs $39.', display: 'The Acme router costs $39.', runNote: 'Checked the price.', answerCheckpoints: [UNGROUNDED, PRICE] },
    ])

    expect(events.find((event) => event.type === 'display' && event.finalAnswer === true)).toEqual({
      type: 'display',
      text: 'The Acme router costs $39.',
      at: 0,
      finalAnswer: true,
    })
    expect(events.find((event) => event.type === 'answer_evidence')).toMatchObject({ evidenceIds: ['memory-1'] })
    expect(store.snapshot().observations.map((observation) => observation.text)).toEqual([PRICE.observation])
    expect(degradations).toEqual(['answer_checkpoint_dropped'])
    expect(traced.find((event) => event.kind === 'answer_checkpoints')).toMatchObject({
      offered: 2,
      accepted: 1,
      dropped: [{ index: 0, tool: 'record_evidence', reason: 'excerpt_unsupported' }],
    })
    // What was cited and what it was graded against, as for a call.
    expect(traced.filter((event) => event.kind === 'evidence_checkpoint')).toEqual([
      expect.objectContaining({ tool: 'record_evidence', origin: 'answer', outcome: 'excerpt_unsupported', args: UNGROUNDED }),
      expect.objectContaining({ tool: 'record_evidence', origin: 'answer', outcome: 'accepted', entryId: 'memory-1' }),
    ])
    // Never retried: no Answer Retry, no further round.
    expect(llm.requests).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('publishes no evidence when every entry is dropped', async () => {
    const { events, traced } = await run([
      READ,
      { kind: 'answer', speak: 'Unsure.', display: 'Unsure.', answerCheckpoints: [UNGROUNDED] },
    ])

    expect(events.some((event) => event.type === 'answer_evidence')).toBe(false)
    expect(traced.find((event) => event.kind === 'answer_checkpoints')).toMatchObject({ offered: 1, accepted: 0 })
  })

  it('creates a Candidate, creates and decides one, and decides an existing one by its id', async () => {
    const { store, traced } = await run([
      READ,
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c2', name: 'record_evidence', args: PRICE },
          { id: 'c3', name: 'record_evidence', args: SHIPPING },
        ],
      },
      { kind: 'tool_calls', calls: [{ id: 'c4', name: 'record_candidate', args: { subject: 'The Bolt router', supporting_evidence: ['memory-1'] } }] },
      {
        kind: 'answer',
        speak: 'The Acme.',
        display: 'The Acme router.',
        answerCheckpoints: [
          { subject: 'The Crest router', supporting_evidence: ['memory-1'] },
          { subject: 'The Acme router', supporting_evidence: ['memory-1'], status: 'accepted', reason: 'Cheapest, and ships in two days.' },
          { candidate_id: 'memory-3', status: 'rejected', reason: 'Dearer than the Acme.', supporting_evidence: ['memory-2'] },
        ],
      },
    ])

    expect(store.snapshot().candidates.map(({ id, subject, status }) => ({ id, subject, status }))).toEqual([
      { id: 'memory-3', subject: 'The Bolt router', status: 'rejected' },
      { id: 'memory-4', subject: 'The Crest router', status: 'active' },
      { id: 'memory-5', subject: 'The Acme router', status: 'accepted' },
    ])
    expect(traced.find((event) => event.kind === 'answer_checkpoints')).toMatchObject({ offered: 3, accepted: 3, dropped: [] })
  })

  it('drops the seventh entry and logs it', async () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({ ...PRICE, observation: `The Acme router costs $39 (${i + 1}).` }))
    const { store, traced, degradations } = await run([
      READ,
      { kind: 'answer', speak: 'It costs $39.', display: 'Detail.', runNote: 'Checked the price.', answerCheckpoints: entries },
    ])

    expect(store.snapshot().observations).toHaveLength(6)
    expect(traced.find((event) => event.kind === 'answer_checkpoints')).toMatchObject({
      offered: 7,
      accepted: 6,
      dropped: [{ index: 6, tool: 'record_evidence', reason: 'over_cap' }],
    })
    expect(degradations).toEqual(['answer_checkpoint_dropped'])
  })

  it('lets an Assessment stand on an Observation the Answer carried', async () => {
    const assessment: MemoryPatch[number] = {
      op: 'add',
      entry: { kind: 'assessment', subject: 'Acme is cheapest', detail: 'Verified.', references: [{ url: PAGE_URL }] },
    }
    const { committed, degradations } = await run([
      READ,
      { kind: 'answer', speak: 'Done.', display: 'Done.', runNote: 'Checked the price.', memoryPatch: [assessment], answerCheckpoints: [PRICE] },
    ])

    expect(committed).toEqual([[assessment]])
    expect(degradations).toEqual([])
  })

  it('logs a checkpoints field that is not a list, and records nothing', async () => {
    const { store, events, degradations, traced } = await run([
      READ,
      { kind: 'answer', speak: 'Done.', display: 'Done.', runNote: 'Checked the price.', answerCheckpointsIssue: 'malformed' },
    ])

    expect(store.snapshot().observations).toEqual([])
    expect(events.some((event) => event.type === 'answer_evidence')).toBe(false)
    expect(degradations).toEqual(['answer_checkpoint_dropped'])
    expect(traced.find((event) => event.kind === 'answer_checkpoints')).toMatchObject({ offered: 0, accepted: 0, dropped: [], malformed: true })
  })

  it('leaves an Answer without the field exactly as it was', async () => {
    const { events, traced, degradations } = await run([
      READ,
      { kind: 'answer', speak: 'It costs $39.', display: 'The Acme router costs $39.', runNote: 'Checked the price.' },
    ])

    expect(events.some((event) => event.type === 'answer_evidence')).toBe(false)
    expect(traced.some((event) => event.kind === 'answer_checkpoints')).toBe(false)
    expect(degradations).toEqual([])
    expect(events.filter((event) => event.type === 'display')).toEqual([
      { type: 'display', text: 'The Acme router costs $39.', at: 0, finalAnswer: true },
    ])
  })

  it('accepts the field on the reserved Finalization Answer, which is still sent with no tools to call', async () => {
    const plan: ToolCall = { id: 'p0', name: 'report_run_plan', args: { objective: 'Find the price', headline: 'Find the price', effort_tier: 'direct_action' } }
    const { store, events, llm } = await run(
      [
        { kind: 'tool_calls', calls: [plan, { id: 'r0', name: 'read_page', args: {} }] },
        ...Array.from({ length: 5 }, (_, i): AssistantTurn => ({ kind: 'tool_calls', calls: [{ id: `r${i + 1}`, name: 'read_page', args: {} }] })),
        // The Finalization bookkeeping round, unchanged: it records nothing here.
        { kind: 'tool_calls', calls: [{ ...plan, id: 'p7' }] },
        { kind: 'answer', speak: 'It costs $39.', display: 'The Acme router costs $39.', resolution: 'partial', answerCheckpoints: [PRICE] },
      ],
      [createReportRunPlanTool(), readPage, createRecordEvidenceTool(), createRecordCandidateTool()],
    )

    expect(llm.requests.at(-1)).toMatchObject({ answerOnly: true })
    expect(events.find((event) => event.type === 'answer_evidence')).toMatchObject({ evidenceIds: ['memory-1'] })
    expect(store.snapshot().observations.map((observation) => observation.text)).toEqual([PRICE.observation])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'budget_exhausted' })
  })
})
