import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FINALIZATION_REASONING_EFFORT as SOURCE_FINALIZATION_EFFORT, TIER_REASONING_EFFORT as SOURCE_TIER_EFFORT, TIER_TOOL_ROUND_BUDGETS as SOURCE_BUDGETS, budgetWarningMessage, finalizeInstruction, notExecuted } from '../../src/core/pipeline/effortEpoch'
import { SCROLL_END_OF_PAGE } from '../../src/core/browser/scrollDelta'
import { similarQueries as ruleSimilarQueries } from '../../src/core/pipeline/searchLoopRule'
import { createSearchLoopRail, type SearchObservation } from '../../src/core/pipeline/searchLoopRail'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { TraceRecord } from '../../src/core/trace/runTrace'
import {
  AUDIT_COUNTS_NOTE,
  AUDIT_VERDICTS,
  BUDGET_WARNING_RE,
  JUDGEMENT_SCHEMA,
  END_OF_PAGE_MARK,
  FINALIZATION_REASONING_EFFORT,
  FINALIZE_INSTRUCTION_MARK,
  NO_PROGRESS_NOTICE_MARK,
  LIVE_AUDIT_AGGREGATE_KIND,
  LIVE_AUDIT_KIND,
  NOT_EXECUTED_PREFIX,
  TIER_REASONING_EFFORT,
  TIER_TOOL_ROUND_BUDGETS,
  buildAuditAggregate,
  buildAuditSet,
  canonicalUrl,
  checkpointedUrlsOf,
  classifyAttempt,
  countsAfterOverrulesOf,
  formatAuditAggregate,
  formatAuditSet,
  keyLeaks,
  searchQueryOf,
  similarQueries,
  validateJudgement,
  WITHHELD_KEY_TEXT,
  withholdKeyText,
  type AuditAttempt,
  type AuditJudgement,
  type AuditProvenance,
  type AuditReview,
  type AuditTraceInput,
} from './audit.ts'
import * as auditModule from './audit.ts'
import type { LiveGradeEntry, LiveKeyTask } from './grades.ts'
import { attemptCapture, T0, turnIdOf } from './gradingFixtures.ts'
import { liveWebHunts } from './hunts.ts'
import { gradingKeyFor } from './keyManifest.ts'

// The Round Audit (#234): a fixture trace classifies the same way every
// time, the judged half is validated against the digest it was given, and
// nothing a committed output holds is key text.

const SCRIPT = fileURLToPath(new URL('../../scripts/live-audit.ts', import.meta.url))
const REPORTS_DIR = fileURLToPath(new URL('./reports/', import.meta.url))
const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

// ---------------------------------------------------------------------------
// A fixture trace: one attempt, thirteen model rounds, every kind at least once.

const ATTEMPT = 'hunt-x--initial'
const TURN = turnIdOf(ATTEMPT)
const identity = { v: 1, runId: 'run-x', sessionId: 'session-x', generation: 0, turnId: TURN } as const

interface RoundSpec {
  readonly round: number
  readonly attempt?: number
  readonly at: number
  readonly outcome?: string
  readonly effort?: string
  readonly calls?: readonly {
    name: string
    args: Record<string, unknown>
    ok?: boolean
    result?: string
    error?: string
    checkpoint?: string
    /** The store's merge verdict on an accepted checkpoint (#240) — absent, as a trace written before the field existed. */
    merged?: boolean
    /** The Search Observation the rail recorded for this call (#243) — a trace written after observations were kept. */
    observation?: SearchObservation
    /** The Not-found Landing the Run Trace records on the result (#239) — a trace written after the field was kept. */
    notFound?: { basis: string; host: string }
    /** The Composed Address rewrite the Run Trace records on the result (#255, ADR 0055). */
    rewritten?: { site: string; query: string }
  }[]
  readonly reasoning?: string
}

const PAGE = (title: string, url: string, signature: string, text = ''): string => `navigated: url=${url} title="${title}"\n# ${title} — ${url}\nviewport 985x575 scroll 0/4000\nsignature ${signature}\n[1] link "Home" href="${url}"\npage text:\n${text}`
const READ = (title: string, url: string, signature: string): string => `# ${title} — ${url}\nviewport 985x575 scroll 0/4000\nsignature ${signature}\npage text:\nsome text`

function traceOf(rounds: readonly RoundSpec[], extra: readonly Record<string, unknown>[] = []): TraceRecord[] {
  const records: Record<string, unknown>[] = []
  let calls = 0
  for (const spec of rounds) {
    const attempt = spec.attempt ?? 1
    const outcome = spec.outcome ?? 'completed'
    records.push({ ...identity, at: T0 + spec.at, kind: 'reasoning', round: spec.round, attempt, text: spec.reasoning ?? `thinking in round ${spec.round}`, chars: 40 })
    records.push({
      ...identity,
      at: T0 + spec.at,
      kind: 'llm_round',
      round: spec.round,
      attempt,
      role: 'orchestrator',
      outcome,
      reasoningChars: 40,
      model: 'model-o',
      reasoningEffort: spec.effort ?? 'max',
      ...(outcome === 'completed' ? { usage: { promptTokens: 1000 + spec.round, completionTokens: 50 } } : {}),
      request: { toolResults: spec.round - 1, chars: 500 * spec.round },
    })
    for (const call of spec.calls ?? []) {
      calls += 1
      const callId = `call-${calls}`
      records.push({ ...identity, at: T0 + spec.at + 1, kind: 'pipeline_event', event: { type: 'tool_call', turnId: TURN, callId, name: call.name, args: call.args, at: T0 + spec.at + 1 } })
      if (call.checkpoint !== undefined) {
        records.push({ ...identity, at: T0 + spec.at + 2, kind: 'evidence_checkpoint', tool: call.name, args: call.args, outcome: call.checkpoint, matched: call.checkpoint === 'accepted', graded: [], ...(call.merged !== undefined ? { merged: call.merged } : {}) })
      }
      if (call.observation !== undefined) {
        // The round records the rail's observation after the call settles and
        // before it publishes the result; the seam stamps the turn only.
        records.push({ v: 1, at: T0 + spec.at + 2, turnId: TURN, kind: 'search_observation', callId, name: call.name, ...call.observation })
      }
      const ok = call.ok ?? true
      records.push({
        ...identity,
        at: T0 + spec.at + 3,
        kind: 'pipeline_event',
        event: { type: 'tool_result', turnId: TURN, callId, name: call.name, ok, ...(ok ? { result: call.result ?? 'ok' } : { error: call.error ?? 'refused' }), at: T0 + spec.at + 3 },
        ...(call.notFound !== undefined ? { notFound: call.notFound } : {}),
        ...(call.rewritten !== undefined ? { rewritten: call.rewritten } : {}),
      })
    }
  }
  records.push(...extra)
  return records as unknown as TraceRecord[]
}

const SEARCH_A = 'https://duckduckgo.com/?q=harrison+longitude+watch+catalogue'
const SEARCH_B = 'https://duckduckgo.com/?q=harrison+longitude+watch+catalogue+id'
const SPEC_URL = 'https://spec.invalid/watch/'
const OTHER_URL = 'https://spec.invalid/other'

const ROUNDS: RoundSpec[] = [
  { round: 1, at: 1_000, effort: 'high', reasoning: 'first, the plan', calls: [{ name: 'report_run_plan', args: { effort_tier: 'investigation', objective: 'find it' }, result: 'Run Plan noted.' }, { name: 'navigate', args: { url: SPEC_URL }, result: PAGE('Watch spec', SPEC_URL, 'aaaa1111') }] },
  { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'bbbb2222') }] },
  { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SEARCH_B }, result: PAGE('search', SEARCH_B, 'cccc3333') }] },
  { round: 4, at: 4_000, calls: [{ name: 'navigate', args: { url: OTHER_URL }, result: PAGE('Other', OTHER_URL, 'dddd4444') }] },
  { round: 5, at: 5_000, calls: [{ name: 'read_page', args: {}, result: READ('Other', OTHER_URL, 'dddd4444') }] },
  { round: 6, at: 6_000, calls: [{ name: 'read_page', args: {}, result: READ('Other', OTHER_URL, 'dddd4444') }] },
  { round: 7, at: 7_000, calls: [{ name: 'scroll', args: { direction: 'down' }, result: `scrolled down: x=0 y=277\n${SCROLL_END_OF_PAGE}` }] },
  { round: 8, at: 8_000, calls: [{ name: 'navigate', args: { url: 'https://spec.invalid/watch?utm_source=x#top' }, result: PAGE('Watch spec', 'https://spec.invalid/watch/', 'aaaa1111') }] },
  { round: 9, at: 9_000, calls: [{ name: 'record_evidence', args: { kind: 'web', observation: 'a claim', source_url: OTHER_URL }, ok: false, error: 'not grounded', checkpoint: 'not_grounded' }] },
  { round: 10, at: 10_000, calls: [{ name: 'agent_results', args: { wait: true }, result: 'a-1 [browsing] completed — a report' }] },
  { round: 11, at: 11_000, calls: [{ name: 'type', args: { ref: 3, text: 'x' }, ok: false, error: notExecuted('this action repeats an equivalent action against unchanged page state') }] },
  { round: 12, at: 12_000, outcome: 'timeout' },
  { round: 12, attempt: 2, at: 13_000, calls: [{ name: 'navigate', args: { url: 'https://spec.invalid/third' }, result: `${PAGE('Third', 'https://spec.invalid/third', 'eeee5555')}\n\n${budgetWarningMessage('near', 4, 24)}` }] },
  { round: 13, at: 14_000, effort: 'low', calls: [{ name: 'record_evidence', args: { kind: 'web', observation: 'a claim', source_url: 'https://spec.invalid/third' }, result: `Session Evidence recorded: memory-1\n\n${finalizeInstruction('budget_exhausted')}`, checkpoint: 'accepted' }] },
  { round: 14, at: 15_000, effort: 'low' },
]

const EXTRA: Record<string, unknown>[] = [
  { ...identity, at: T0 + 900, kind: 'pipeline_event', event: { type: 'run_plan', turnId: TURN, objective: 'find it', headline: 'h', effortTier: 'investigation', source: 'model', at: T0 + 900 } },
  { ...identity, at: T0 + 2_500, kind: 'llm_round', round: 1, attempt: 1, role: 'subagent', outcome: 'completed', reasoningChars: 0, agentId: 'a-1', request: { toolResults: 0, chars: 10 } },
  { ...identity, at: T0 + 2_600, kind: 'llm_round', round: 2, attempt: 1, role: 'subagent', outcome: 'completed', reasoningChars: 0, agentId: 'a-1', request: { toolResults: 1, chars: 10 } },
  { ...identity, at: T0 + 2_700, kind: 'pipeline_event', event: { type: 'subagent_finalized', turnId: TURN, agentId: 'a-1', kind: 'browse', status: 'completed', cause: 'budget_exhausted', at: T0 + 2_700 } },
  { ...identity, at: T0 + 16_000, kind: 'pipeline_event', event: { type: 'done', turnId: TURN, outcome: 'done', resolution: 'partial', finalizationCause: 'budget_exhausted', at: T0 + 16_000 } },
]

const PERF: PerfSpanRecord[] = ROUNDS.map((spec) => ({ turnId: TURN, stage: 'llm', durMs: 1_000 + spec.round * 10 + (spec.attempt ?? 1), at: T0 + spec.at - 1, t: spec.at }))

const TASK: LiveKeyTask = {
  huntId: 'hunt-x',
  stepId: 'initial',
  promptVersion: 'p1',
  keyRef: 'fixture',
  checks: [
    { checkId: 'fact-01', description: 'names the invented id' },
    { checkId: 'fact-02', description: 'gives the invented date' },
    { checkId: 'pitfall-01', description: 'avoids the invented trap' },
  ],
}

const GRADE: LiveGradeEntry = {
  attemptId: ATTEMPT,
  huntId: 'hunt-x',
  stepId: 'initial',
  captureId: 'capture-hunt-x',
  answer: { at: T0 + 30_000, digest: 'sha256:0' },
  keyVersion: 'k1',
  keyDigest: 'sha256:1',
  status: 'useful_partial',
  checks: [
    { checkId: 'fact-01', satisfied: true },
    { checkId: 'fact-02', satisfied: false },
    { checkId: 'pitfall-01', satisfied: true },
  ],
  support: [],
  rationale: 'half of it',
  reviewer: 'reviewer-x',
  reviewedAt: '2026-09-13T00:00:00.000Z',
}

function inputOf(overrides: Partial<AuditTraceInput> = {}): AuditTraceInput {
  return {
    attempt: attemptCapture({ attemptId: ATTEMPT, huntId: 'hunt-x', terminal: { at: 16_000, resolution: 'partial', finalizationCause: 'budget_exhausted' } }),
    captureId: 'capture-hunt-x',
    traceRecords: traceOf(ROUNDS, EXTRA),
    perfRecords: PERF,
    reasoningEffortOverride: null,
    parentCheckpointedUrls: null,
    task: TASK,
    grade: GRADE,
    ...overrides,
  }
}

/** Digest numbering is by position; the trace's round and attempt ride beside it. */
const kindsOf = (input: AuditTraceInput) => classifyAttempt(input).rounds.map((round) => `${round.round}[${round.llmRound}.${round.attempt}]:${round.kind}`)

describe('the mechanical classification', () => {
  it('assigns every round one kind from the trace alone, numbered by position with the trace’s round beside it', () => {
    expect(kindsOf(inputOf())).toEqual([
      '1[1.1]:acquisition_with_progress',
      '2[2.1]:acquisition_with_progress',
      '3[3.1]:acquisition_without_progress',
      '4[4.1]:acquisition_with_progress',
      '5[5.1]:acquisition_with_progress',
      '6[6.1]:acquisition_without_progress',
      '7[7.1]:acquisition_without_progress',
      '8[8.1]:acquisition_without_progress',
      '9[9.1]:bookkeeping',
      '10[10.1]:collection',
      '11[11.1]:failed_round',
      '12[12.1]:failed_round',
      '13[12.2]:acquisition_with_progress',
      '14[13.1]:finalization',
      '15[14.1]:finalization',
    ])
  })

  it('states the rule each label rests on', () => {
    const { rounds } = classifyAttempt(inputOf())
    const reason = (round: number) => rounds.find((candidate) => candidate.round === round)!.reason
    expect(reason(3)).toContain('rewords the one before it (streak 2)')
    expect(reason(5)).toContain('first read')
    expect(reason(6)).toContain('repeat read')
    expect(reason(7)).toContain('End of Page')
    expect(reason(8)).toContain('URL this Run already acquired')
    expect(reason(9)).toContain('1 rejected Evidence Checkpoint')
    expect(reason(11)).toContain('every call was refused')
    expect(reason(12)).toContain('request timeout')
    expect(reason(14)).toContain('bookkeeping round')
    expect(reason(15)).toBe('the reserved Answer')
  })

  it('joins each Evidence Checkpoint to its own call when a round records several, in trace order', () => {
    // The trace writes tool_call, evidence_checkpoint, tool_result for each
    // call in turn: three checkpoints in one round, the middle one rejected.
    const rounds: RoundSpec[] = [
      {
        round: 1,
        at: 1_000,
        calls: [
          { name: 'record_evidence', args: { kind: 'web', observation: 'one', source_url: SPEC_URL }, result: 'Session Evidence recorded: memory-1', checkpoint: 'accepted' },
          { name: 'record_evidence', args: { kind: 'web', observation: 'two', source_url: SPEC_URL }, ok: false, error: 'record_evidence rejected (excerpt_unsupported): the excerpt does not appear', checkpoint: 'excerpt_unsupported' },
          { name: 'record_evidence', args: { kind: 'web', observation: 'three', source_url: SPEC_URL }, result: 'Session Evidence recorded: memory-2', checkpoint: 'accepted' },
        ],
      },
    ]
    const round = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) })).rounds[0]!
    expect(round.calls.map((call) => call.checkpoint)).toEqual([
      { accepted: true, outcome: 'accepted' },
      { accepted: false, outcome: 'excerpt_unsupported' },
      { accepted: true, outcome: 'accepted' },
    ])
    expect(round.tags).toMatchObject({ acceptedCheckpoints: 2, rejectedCheckpoints: 1 })
    expect(round.reason).toBe('record_evidence, record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s)')
  })

  it('reads Progress for clicks and typing from the controller’s outcome lines', () => {
    const rounds: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SPEC_URL }, result: PAGE('Watch spec', SPEC_URL, 'aaaa1111') }] },
      { round: 2, at: 2_000, calls: [{ name: 'click', args: { ref: 3 }, result: `clicked [3]: urlChanged=false dialogOpen=false; page signature changed\n${READ('Watch spec', SPEC_URL, 'bbbb2222')}` }] },
      { round: 3, at: 3_000, calls: [{ name: 'click', args: { ref: 4 }, result: 'clicked [4]: urlChanged=false dialogOpen=false' }] },
      { round: 4, at: 4_000, calls: [{ name: 'type', args: { ref: 5, text: 'x' }, result: 'typed [5]: value="x"' }] },
      { round: 5, at: 5_000, calls: [{ name: 'type', args: { ref: 6, text: 'b' }, result: 'typed [6]: selected="Option B"' }] },
      { round: 6, at: 6_000, calls: [{ name: 'type', args: { ref: 7, text: 'y' }, result: `typed [7]: not typed — blocked by overlay\n\nThat action ${NO_PROGRESS_NOTICE_MARK} — it will not produce anything new.` }] },
    ]
    const { rounds: classified } = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) }))
    expect(classified.map((round) => round.kind)).toEqual([
      'acquisition_with_progress',
      'acquisition_with_progress',
      'acquisition_without_progress',
      'acquisition_with_progress',
      'acquisition_with_progress',
      'acquisition_without_progress',
    ])
    expect(classified[2]!.reason).toContain('neither the URL nor the page signature')
    expect(classified[5]!.reason).toContain('no-progress Notice')
  })

  it('counts the budget, the shares, the checkpoints and the Subagent rounds', () => {
    const mechanical = classifyAttempt(inputOf())
    expect(mechanical.tier).toBe('investigation')
    expect(mechanical.toolRoundBudget).toBe(24)
    // Rounds outside Finalization that requested a tool: 1–11 and 13.
    expect(mechanical.toolRoundsUsed).toBe(12)
    expect(mechanical.budgetedRounds).toBe(13)
    expect(mechanical.counts).toEqual({ acquisition_with_progress: 5, acquisition_without_progress: 4, collection: 1, bookkeeping: 1, failed_round: 2, finalization: 2 })
    expect(mechanical.shares.acquisition_without_progress).toBe(Math.round((4 / 13) * 1000) / 1000)
    expect(mechanical.shares.finalization).toBe(Math.round((2 / 15) * 1000) / 1000)
    expect(mechanical.acceptedCheckpoints).toBe(1)
    expect(mechanical.rejectedCheckpoints).toBe(1)
    // Round 3 rewords round 2, and round 2 is that loop's head (ADR 0048).
    expect(mechanical.mechanicalSearchRounds).toBe(2)
    expect(mechanical.lastBudgetNotice).toEqual({ remaining: 4, budget: 24 })
    expect(mechanical.subagent).toEqual({ rounds: 2, agents: 1, byStop: { budget_exhausted: 1 } })
    expect(mechanical.checksUnsatisfied).toEqual(['fact-02'])
    expect(mechanical.checksTotal).toBe(3)
    expect(mechanical.terminal).toEqual({ outcome: 'done', resolution: 'partial', finalizationCause: 'budget_exhausted' })
  })

  it('joins each round to its perf llm span by turn and stamp, once', () => {
    const mechanical = classifyAttempt(inputOf())
    expect(mechanical.rounds.map((round) => round.latencyMs)).toEqual(ROUNDS.map((spec) => 1_000 + spec.round * 10 + (spec.attempt ?? 1)))
    expect(mechanical.latency).toEqual({ llmMs: ROUNDS.reduce((total, spec) => total + 1_000 + spec.round * 10 + (spec.attempt ?? 1), 0), joined: 15, unjoined: 0 })
    const unjoined = classifyAttempt(inputOf({ perfRecords: [] }))
    expect(unjoined.latency).toEqual({ llmMs: null, joined: 0, unjoined: 15 })
  })

  it('is deterministic: the same records give byte-identical labels, digests and hash', () => {
    const first = classifyAttempt(inputOf())
    const second = classifyAttempt(inputOf())
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(second.digestHash).toBe(first.digestHash)
    expect(first.digestHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    // The hash covers the digest, not who reviewed it — a different grade
    // moves the grade status and `checksUnsatisfied` and therefore the hash; a
    // different perf log moves the latencies and therefore the hash.
    expect(classifyAttempt(inputOf({ grade: null })).digestHash).not.toBe(first.digestHash)
    expect(classifyAttempt(inputOf({ perfRecords: [] })).digestHash).not.toBe(first.digestHash)
  })

  it('keeps the digest bounded: heads of results and arguments, and no reasoning text at all', () => {
    const long = 'x'.repeat(5_000)
    const rounds: RoundSpec[] = [{ round: 1, at: 1_000, reasoning: `the secret thought ${long}`, calls: [{ name: 'navigate', args: { url: SPEC_URL, note: long }, result: PAGE('Watch spec', SPEC_URL, 'aaaa1111', long) }] }]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) }))
    const round = mechanical.rounds[0]!
    expect(round.reasoningChars).toBe(40)
    expect(JSON.stringify(mechanical)).not.toContain('secret thought')
    expect((round.calls[0]!.args.note as string).length).toBeLessThanOrEqual(201)
    expect(round.calls[0]!.resultHead!.length).toBeLessThanOrEqual(241)
    expect(JSON.stringify(mechanical).length).toBeLessThan(4_000)
  })

  it('tags a follow-up’s re-acquisition of a page the initial checkpointed as inherited and without Progress', () => {
    const initial = classifyAttempt(inputOf())
    expect(initial.inheritedRounds).toBe(0)
    const parentUrls = checkpointedUrlsOf(inputOf().traceRecords)
    expect([...parentUrls]).toEqual(['https://spec.invalid/third'])
    const followUp: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: 'https://spec.invalid/third/' }, result: PAGE('Third', 'https://spec.invalid/third', 'eeee5555') }] },
      { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: OTHER_URL }, result: PAGE('Other', OTHER_URL, 'dddd4444') }] },
    ]
    const mechanical = classifyAttempt(
      inputOf({
        attempt: attemptCapture({ attemptId: 'hunt-x--follow_up', huntId: 'hunt-x', stepId: 'follow_up', relation: 'revised_objective', parentAttemptId: ATTEMPT, terminal: { at: 16_000, finalizationCause: 'objective_met' } }),
        traceRecords: traceOf(followUp, [EXTRA[0]!]),
        parentCheckpointedUrls: parentUrls,
      }),
    )
    expect(mechanical.rounds.map((round) => round.kind)).toEqual(['acquisition_without_progress', 'acquisition_with_progress'])
    expect(mechanical.rounds[0]!.tags.inherited).toBe(true)
    expect(mechanical.rounds[0]!.reason).toContain('inherited')
    expect(mechanical.inheritedRounds).toBe(1)
  })

  it('reads Finalization from the app’s own marks and the Finalization rung, and skips the rung under an override', () => {
    const cut: RoundSpec[] = [
      { round: 1, at: 1_000, effort: 'high', outcome: 'timeout' },
      { round: 2, at: 2_000, effort: 'low', outcome: 'allowance' },
      { round: 3, at: 3_000, effort: 'low' },
    ]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(cut, EXTRA) }))
    expect(mechanical.rounds.map((round) => `${round.kind}: ${round.reason}`)).toEqual([
      'failed_round: the client’s request timeout ended the round',
      'finalization: a Finalization round cut by the Finalization Allowance',
      'finalization: the reserved Answer',
    ])
    expect(mechanical.toolRoundsUsed).toBe(0)
    // Under a reasoning override the rung says nothing; the allowance outcome still does.
    const overridden = classifyAttempt(inputOf({ traceRecords: traceOf(cut, EXTRA), reasoningEffortOverride: 'low' }))
    expect(overridden.rounds.map((round) => round.kind)).toEqual(['failed_round', 'finalization', 'finalization'])
    const answered: RoundSpec[] = [
      { round: 1, at: 1_000, effort: 'high', calls: [{ name: 'navigate', args: { url: SPEC_URL }, result: PAGE('Watch spec', SPEC_URL, 'aaaa1111') }] },
      { round: 2, at: 2_000, effort: 'high' },
    ]
    const met = classifyAttempt(inputOf({ traceRecords: traceOf(answered, [EXTRA[0]!, { ...identity, at: T0 + 3_000, kind: 'pipeline_event', event: { type: 'done', turnId: TURN, outcome: 'done', resolution: 'completed', finalizationCause: 'objective_met', at: T0 + 3_000 } }]) }))
    expect(met.rounds.map((round) => round.kind)).toEqual(['acquisition_with_progress', 'finalization'])
  })

  it('pins its copies of the budgets, rungs and marker sentences to the app’s own constants', () => {
    expect(TIER_TOOL_ROUND_BUDGETS).toEqual(SOURCE_BUDGETS)
    expect(TIER_REASONING_EFFORT).toEqual(SOURCE_TIER_EFFORT)
    expect(FINALIZATION_REASONING_EFFORT).toBe(SOURCE_FINALIZATION_EFFORT)
    expect(finalizeInstruction('budget_exhausted')).toContain(FINALIZE_INSTRUCTION_MARK)
    expect(finalizeInstruction(null)).toContain(FINALIZE_INSTRUCTION_MARK)
    expect(BUDGET_WARNING_RE.exec(budgetWarningMessage('near', 4, 24))?.slice(1)).toEqual(['4', '24'])
    expect(BUDGET_WARNING_RE.exec(budgetWarningMessage('imminent', 1, 12))?.slice(1)).toEqual(['1', '12'])
    expect(notExecuted('x').startsWith(NOT_EXECUTED_PREFIX)).toBe(true)
    expect(END_OF_PAGE_MARK).toBe(SCROLL_END_OF_PAGE)
  })

  it('normalizes URLs and reads searches the way the browser does', () => {
    expect(canonicalUrl('HTTPS://Spec.invalid/watch/?b=2&a=1&utm_source=x#top')).toBe('https://spec.invalid/watch?a=1&b=2')
    expect(canonicalUrl('not a url')).toBeNull()
    expect(searchQueryOf(SEARCH_A)).toBe('harrison longitude watch catalogue')
    expect(searchQueryOf('harrison longitude watch')).toBe('harrison longitude watch')
    expect(searchQueryOf('site:rmg.co.uk harrison watch')).toBe('site:rmg.co.uk harrison watch')
    expect(searchQueryOf('rmg.co.uk/collections')).toBeNull()
    expect(searchQueryOf(SPEC_URL)).toBeNull()
    expect(similarQueries('harrison longitude watch catalogue', 'harrison longitude watch catalogue id')).toBe(true)
    expect(similarQueries('harrison longitude watch', 'voyager interstellar crossing')).toBe(false)
  })

  it('replays the Search Loop rail’s own rule, not a copy of it (#238, ADR 0048)', () => {
    expect(similarQueries).toBe(ruleSimilarQueries)
    expect(auditModule).not.toHaveProperty('queryTokens')
  })

  it('keeps the replayed streak across a scroll or a Look between searches, as the rail does', () => {
    const inspections = [
      { name: 'scroll', args: { direction: 'down' }, result: 'scrolled down: x=0 y=577\nnew in view: [4] link "Result"' },
      { name: 'look', args: { question: 'which result names the watch?' }, result: 'The second result names the watch.' },
    ]
    for (const inspection of inspections) {
      const rounds: RoundSpec[] = [
        { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'bbbb2222') }] },
        { round: 2, at: 2_000, calls: [inspection] },
        { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SEARCH_B }, result: PAGE('search', SEARCH_B, 'cccc3333') }] },
      ]
      const { rounds: classified } = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) }))
      expect(classified[2]!.calls[0]!.search, inspection.name).toEqual({ query: 'harrison longitude watch catalogue id', streak: 2 })
      expect(classified[2]!.reason, inspection.name).toContain('rewords the one before it (streak 2)')
    }
  })

  it('counts a loop’s head by the streak rule without touching its kind, its reason or the digest (Decision 8)', () => {
    const mechanical = classifyAttempt(inputOf())
    // Counting the head re-keys no cached judgement. The pin moved once since,
    // on purpose: #244 renamed `checksUnsatisfied` and hashed the grade status.
    expect(mechanical.digestHash).toBe('sha256:ab85fed806eb15cbf49cb047cd7401081f8033507e32e94ee7e9fbabd7d9a147')
    // Round 2's search starts the streak round 3's continues.
    expect(mechanical.searchLoopHeads).toEqual([2])
    expect(mechanical.mechanicalSearchRounds).toBe(2)
    expect(mechanical.rounds[1]!.kind).toBe('acquisition_with_progress')
    expect(mechanical.rounds[1]!.reason).not.toContain('rewords')
    expect(formatAuditSet(buildAuditSet(provenanceOf(), [attemptOf('initial', judgement)], []))).toMatch(/\n\| 2 \| [^\n]*loop head by the streak rule[^\n]*\|\n/)

    // A streak that never reaches 2 has no head to count.
    const broken: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'bbbb2222') }] },
      { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: OTHER_URL }, result: PAGE('Other', OTHER_URL, 'dddd4444') }] },
      { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SEARCH_B }, result: PAGE('search', SEARCH_B, 'cccc3333') }] },
    ]
    const unbroken = classifyAttempt(inputOf({ traceRecords: traceOf(broken, EXTRA) }))
    expect(unbroken.searchLoopHeads).toEqual([])
    expect(unbroken.mechanicalSearchRounds).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The rail's Search Observations (#243, ADR 0049): where a trace carries them
// the audit reads what the rail saw; where it carries none it replays.

const SEARCH_C = 'https://www.bing.com/search?q=harrison+longitude+watch+catalogue'
const REFUSAL = 'Search loop limit (5 consecutive similar searches — q= navigate or typed search box query) reached for this run'

/** A trace written after observations were kept: typed searches, a refused one, and an escape between. */
const RAIL_ROUNDS: RoundSpec[] = [
  { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'bbbb2222'), observation: { query: 'harrison longitude watch catalogue', signature: 'url', streak: 1 } }] },
  { round: 2, at: 2_000, calls: [{ name: 'type', args: { ref: 3, text: 'harrison longitude watch catalogue\n' }, result: 'typed [3]: value="harrison longitude watch catalogue"', observation: { query: 'harrison longitude watch catalogue', signature: 'input', streak: 2 } }] },
  { round: 3, at: 3_000, calls: [{ name: 'type', args: { ref: 3, text: 'harrison longitude watch catalogue id\n' }, ok: false, error: REFUSAL, observation: { query: 'harrison longitude watch catalogue id', signature: 'input', streak: 3 } }] },
  { round: 4, at: 4_000, calls: [{ name: 'navigate', args: { url: SEARCH_B }, result: PAGE('search', SEARCH_B, 'cccc3333'), observation: { query: 'harrison longitude watch catalogue id', signature: 'url', streak: 4 } }] },
  { round: 5, at: 5_000, calls: [{ name: 'type', args: { ref: 8, text: 'someone@example.com' }, result: 'typed [8]: value="someone@example.com"' }] },
  { round: 6, at: 6_000, calls: [{ name: 'navigate', args: { url: SEARCH_C }, result: PAGE('search', SEARCH_C, 'ffff6666'), observation: { query: 'harrison longitude watch catalogue', signature: 'url', streak: 1 } }] },
]

/** A Browse Subagent's observation on a call id the orchestrator also used: the audit reads the orchestrator's only. */
const SUBAGENT_OBSERVATION: Record<string, unknown> = { v: 1, at: T0 + 2_550, turnId: TURN, kind: 'search_observation', agentId: 'a-1', callId: 'call-2', name: 'type', query: 'something else', signature: 'input', streak: 9 }

describe('merged checkpoints and Held Page rounds without Progress (#240, ADR 0051)', () => {
  const THIRD = 'https://spec.invalid/third'
  const recorded = (id: string, url: string): string => `Session Evidence recorded: ${id}, grounded in obs-1 at ${url}. It survives this run's outcome.`
  const alreadyHeld = (id: string): string => `Session Evidence already held this Observation: ${id} (provenance recorded).`
  const endOfPage = `scrolled down: x=0 y=277\n${SCROLL_END_OF_PAGE}`

  const HELD_ROUNDS: RoundSpec[] = [
    // 1: the inherited navigate — a navigate, so never a Held Page round.
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: THIRD }, result: PAGE('Third', THIRD, 'eeee5555') }] },
    // 2: the first read of the page makes Progress.
    { round: 2, at: 2_000, calls: [{ name: 'read_page', args: {}, result: READ('Third', THIRD, 'eeee5555') }] },
    // 3: reading it again does not, on a page the initial checkpointed.
    { round: 3, at: 3_000, calls: [{ name: 'read_page', args: {}, result: READ('Third', THIRD, 'eeee5555') }] },
    { round: 4, at: 4_000, calls: [{ name: 'navigate', args: { url: OTHER_URL }, result: PAGE('Other', OTHER_URL, 'dddd4444') }] },
    // 5: no Progress, on a page nothing has checkpointed yet.
    { round: 5, at: 5_000, calls: [{ name: 'scroll', args: { direction: 'down' }, result: endOfPage }] },
    // 6: this attempt checkpoints the page, and re-records one the Session held.
    {
      round: 6,
      at: 6_000,
      calls: [
        { name: 'record_evidence', args: { kind: 'web', observation: 'a claim', source_url: OTHER_URL }, result: recorded('memory-7', OTHER_URL), checkpoint: 'accepted', merged: false },
        { name: 'record_evidence', args: { kind: 'web', observation: 'an older claim', source_url: THIRD }, result: alreadyHeld('memory-1'), checkpoint: 'accepted', merged: true },
      ],
    },
    // 7: the same scroll, on a page this attempt's own checkpoint now holds.
    { round: 7, at: 7_000, calls: [{ name: 'scroll', args: { direction: 'down' }, result: endOfPage }] },
    // 8: a navigate without Progress onto a held page is still a navigate.
    { round: 8, at: 8_000, calls: [{ name: 'navigate', args: { url: THIRD }, result: PAGE('Third', THIRD, 'eeee5555') }] },
  ]

  const followUpOf = (rounds: readonly RoundSpec[]) =>
    classifyAttempt(
      inputOf({
        attempt: attemptCapture({ attemptId: 'hunt-x--follow_up', huntId: 'hunt-x', stepId: 'follow_up', relation: 'revised_objective', parentAttemptId: ATTEMPT, terminal: { at: 16_000, finalizationCause: 'objective_met' } }),
        traceRecords: traceOf(rounds, [EXTRA[0]!]),
        parentCheckpointedUrls: new Set([THIRD]),
      }),
    )

  it('counts the checkpoints the store merged from the trace field, and an old trace without it as merging none (AC5)', () => {
    const mechanical = followUpOf(HELD_ROUNDS)
    expect(mechanical.acceptedCheckpoints).toBe(2)
    expect(mechanical.mergedCheckpoints).toBe(1)

    const withoutField = HELD_ROUNDS.map((spec) => ({ ...spec, calls: spec.calls?.map(({ merged: _merged, ...rest }) => rest) }))
    const old = followUpOf(withoutField)
    expect(old.mergedCheckpoints).toBe(0)
    // Counted beside the digest: the hash a cached judgement is keyed on does not move.
    expect(old.digestHash).toBe(mechanical.digestHash)
  })

  it('counts Held Page rounds without Progress over the initial’s checkpointed pages and this attempt’s own before the round, navigate excluded (AC5)', () => {
    const mechanical = followUpOf(HELD_ROUNDS)
    expect(mechanical.rounds.map((round) => round.kind)).toEqual([
      'acquisition_without_progress',
      'acquisition_with_progress',
      'acquisition_without_progress',
      'acquisition_with_progress',
      'acquisition_without_progress',
      'bookkeeping',
      'acquisition_without_progress',
      'acquisition_without_progress',
    ])
    // Rounds 3 and 7; not 1 or 8 (navigates), not 5 (nothing held the page yet).
    expect(mechanical.heldPageRoundsWithoutProgress).toBe(2)
    // The inherited predicate is left exactly as it was.
    expect(mechanical.inheritedRounds).toBe(2)

    // An initial inherits nothing: only its own checkpoints hold a page.
    const initial = classifyAttempt(inputOf({ traceRecords: traceOf(HELD_ROUNDS, [EXTRA[0]!]) }))
    expect(initial.heldPageRoundsWithoutProgress).toBe(1)
    expect(initial.inheritedRounds).toBe(0)
  })

  it('sums both per population and prints them per attempt and per population', () => {
    const followUp = followUpOf(HELD_ROUNDS)
    const initial = classifyAttempt(inputOf({ traceRecords: traceOf(HELD_ROUNDS, [EXTRA[0]!]) }))
    const set = buildAuditSet(
      provenanceOf(),
      [
        { mechanical: initial, review: null, countsAfterOverrules: initial.counts },
        { mechanical: followUp, review: null, countsAfterOverrules: followUp.counts },
      ],
      [],
    )

    expect([set.populations.initial.mergedCheckpoints, set.populations.initial.heldPageRoundsWithoutProgress]).toEqual([1, 1])
    expect([set.populations.followUp.mergedCheckpoints, set.populations.followUp.heldPageRoundsWithoutProgress]).toEqual([1, 2])
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- follow_up: ')
    expect(markdown).toMatch(/- follow_up: .*1 merged Evidence Checkpoint\(s\) \(a floor\), 2 Held Page round\(s\) without Progress/)
    expect(markdown).toContain('2 accepted (1 merged, a floor) and 0 rejected Evidence Checkpoint(s); 2 inherited round(s); 2 Held Page round(s) without Progress;')
  })

  // #254: a checkpoint that rode an action. Not a merge — the two differ on purpose.
  const BUNDLED_ROUNDS: RoundSpec[] = [
    // 1: bundled with a navigate that makes Progress.
    {
      round: 1,
      at: 1_000,
      calls: [
        { name: 'navigate', args: { url: OTHER_URL }, result: PAGE('Other', OTHER_URL, 'dddd4444') },
        { name: 'record_evidence', args: { kind: 'web', observation: 'one', source_url: OTHER_URL }, result: recorded('memory-7', OTHER_URL), checkpoint: 'accepted' },
      ],
    },
    // 2: its only checkpoint was rejected — not bundled.
    {
      round: 2,
      at: 2_000,
      calls: [
        { name: 'scroll', args: { direction: 'down' }, result: endOfPage },
        { name: 'record_evidence', args: { kind: 'web', observation: 'two', source_url: OTHER_URL }, ok: false, error: 'record_evidence rejected (excerpt_unsupported): the excerpt does not appear', checkpoint: 'excerpt_unsupported' },
      ],
    },
    // 3: a checkpoint alone — a bookkeeping round, not bundled.
    { round: 3, at: 3_000, calls: [{ name: 'record_evidence', args: { kind: 'web', observation: 'three', source_url: OTHER_URL }, result: recorded('memory-8', OTHER_URL), checkpoint: 'accepted' }] },
    // 4: bundled with a read that makes no Progress.
    {
      round: 4,
      at: 4_000,
      calls: [
        { name: 'scroll', args: { direction: 'down' }, result: endOfPage },
        { name: 'record_evidence', args: { kind: 'web', observation: 'four', source_url: OTHER_URL }, result: recorded('memory-9', OTHER_URL), checkpoint: 'accepted' },
      ],
    },
  ]

  it('counts acquisition rounds carrying an accepted checkpoint as bundled, per attempt and per population (#254)', () => {
    const initial = classifyAttempt(inputOf({ traceRecords: traceOf(BUNDLED_ROUNDS, [EXTRA[0]!]) }))
    expect(initial.rounds.map((round) => round.kind)).toEqual(['acquisition_with_progress', 'acquisition_without_progress', 'bookkeeping', 'acquisition_without_progress'])
    expect(initial.bundledCheckpoints).toBe(2)
    expect(initial.mergedCheckpoints).toBe(0)

    const followUp = followUpOf(BUNDLED_ROUNDS)
    const set = buildAuditSet(
      provenanceOf(),
      [
        { mechanical: initial, review: null, countsAfterOverrules: initial.counts },
        { mechanical: followUp, review: null, countsAfterOverrules: followUp.counts },
      ],
      [],
    )
    expect([set.populations.initial.bundledCheckpoints, set.populations.followUp.bundledCheckpoints]).toEqual([2, followUp.bundledCheckpoints])
    const markdown = formatAuditSet(set)
    expect(markdown).toMatch(/- initial: .*Held Page round\(s\) without Progress, 2 bundled checkpoint round\(s\), /)
    expect(markdown).toContain('Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 walled round(s)')
  })
})

describe('Identity Slips (#246, ADR 0028)', () => {
  const atVersion = (records: readonly TraceRecord[], v: number): TraceRecord[] => records.map((record) => ({ ...record, v })) as unknown as TraceRecord[]
  const SLIPPED: Record<string, unknown>[] = [
    {
      ...identity,
      at: T0 + 15_500,
      kind: 'identity_slip',
      slips: [
        { surface: 'display', id: 'memory-1', repair: 'substituted' },
        { surface: 'display', id: 'obs-2', repair: 'deleted' },
        { surface: 'speak', id: 'memory-1', repair: 'deleted' },
      ],
    },
  ]
  const slipped = classifyAttempt(inputOf({ traceRecords: atVersion(traceOf(ROUNDS, [...EXTRA, ...SLIPPED]), 2) }))
  const clean = classifyAttempt(inputOf({ traceRecords: atVersion(traceOf(ROUNDS, EXTRA), 2) }))
  const old = classifyAttempt(inputOf())

  it('counts the Answers that slipped and the ids slipped in them from a version-2 trace, and zero when none did', () => {
    expect(slipped.identitySlips).toEqual({ answers: 1, ids: 3 })
    expect(clean.identitySlips).toEqual({ answers: 0, ids: 0 })
  })

  it('reads a version-1 trace as not recorded, and moves no digest, kind or verdict', () => {
    expect(old.identitySlips).toBeNull()
    expect(slipped.digestHash).toBe(old.digestHash)
    expect(slipped.rounds).toEqual(old.rounds)
    expect(slipped.counts).toEqual(old.counts)
    expect(validateJudgement(judgement, slipped)).toEqual(validateJudgement(judgement, old))
  })

  it('sums per population and in the aggregate, and prints both counts per attempt and per population', () => {
    const followUpOf = (mechanical: ReturnType<typeof classifyAttempt>): AuditAttempt => ({ mechanical: { ...mechanical, relation: 'revised_objective' }, review: null, countsAfterOverrules: mechanical.counts })
    const initialOf = (mechanical: ReturnType<typeof classifyAttempt>): AuditAttempt => ({ mechanical, review: null, countsAfterOverrules: mechanical.counts })
    const set = buildAuditSet(provenanceOf(), [initialOf(slipped), initialOf(clean), followUpOf(old)], [])
    expect(set.populations.initial).toMatchObject({ identitySlipAnswers: 1, identitySlipIds: 3, identitySlipsNotRecorded: 0 })
    expect(set.populations.followUp).toMatchObject({ identitySlipAnswers: 0, identitySlipIds: 0, identitySlipsNotRecorded: 1 })

    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Identity Slips: 1 Answer(s) with an Identity Slip, 3 id(s) slipped')
    expect(markdown).toContain('- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped')
    expect(markdown).toContain('- Identity Slips: not recorded (a Run Trace below version 2)')
    expect(markdown).toMatch(/- initial: .*Held Page round\(s\) without Progress, \d+ bundled checkpoint round\(s\), 1 Answer\(s\) with an Identity Slip, 3 id\(s\) slipped, /)
    expect(markdown).toMatch(/- follow_up: .*Held Page round\(s\) without Progress, \d+ bundled checkpoint round\(s\), Identity Slips not recorded, /)

    const other = buildAuditSet(provenanceOf({ setId: 'set-2', createdAt: '2026-09-12T18:00:00.000Z' }), [initialOf(old)], [])
    const aggregate = buildAuditAggregate([set, other], '2026-09-14T11:00:00.000Z')
    if (!aggregate.ok) throw new Error(aggregate.errors.join('; '))
    expect(aggregate.value.populations.initial).toMatchObject({ identitySlipAnswers: 1, identitySlipIds: 3, identitySlipsNotRecorded: 1 })
    expect(formatAuditAggregate(aggregate.value)).toContain('1 Answer(s) with an Identity Slip, 3 id(s) slipped (1 attempt(s) not recorded), ')
  })
})

describe('Asked Items (#250, ADR 0052)', () => {
  const declaredPlan = { ...identity, at: T0 + 900, kind: 'pipeline_event', event: { type: 'run_plan', turnId: TURN, objective: 'find it', headline: 'h', effortTier: 'investigation', source: 'model', askedItems: ['the guitar', 'the piece count', 'the fare'], at: T0 + 900 } }
  const finalDisplay = {
    ...identity,
    at: T0 + 15_500,
    kind: 'pipeline_event',
    event: {
      type: 'display',
      turnId: TURN,
      text: 'Yes.',
      finalAnswer: true,
      askedItems: [
        { item: 'the guitar', standing: 'stated', statement: 'one piece' },
        { item: 'the piece count', standing: 'stated', statement: 'two' },
        { item: 'the fare', standing: 'unverified', statement: 'not stated in the Answer' },
      ],
      at: T0 + 15_500,
    },
  }
  const shape = (at: number, retried: boolean) => ({ ...identity, at: T0 + at, kind: 'asked_items_shape', missing: ['the fare'], undeclared: [], retried })
  const WITH = [declaredPlan, ...EXTRA.slice(1), shape(14_000, true), shape(15_000, false), finalDisplay]

  it('reads the declaration, the standings, and the shape failures from the events and records, never from text', () => {
    const plain = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const counted = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, WITH) }))

    expect(counted.askedItems).toEqual({ declared: 3, stated: 2, unverified: 1, shapeFailures: 2, shapeRetried: 1 })
    // A trace written before the field: nothing is recorded, and nothing is guessed.
    expect(plain.askedItems).toEqual({ declared: null, stated: null, unverified: null, shapeFailures: 0, shapeRetried: 0 })
    expect(counted.rounds).toEqual(plain.rounds)
    expect(counted.digestHash).toBe(plain.digestHash)
  })

  it('sums attempts per population and prints the counts per attempt and per population', () => {
    const counted = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, WITH) }))
    const plain = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const set = buildAuditSet(
      provenanceOf(),
      [
        { mechanical: counted, review: null, countsAfterOverrules: counted.counts },
        { mechanical: { ...plain, attemptId: 'other--initial' }, review: null, countsAfterOverrules: plain.counts },
      ],
      [],
    )

    expect(set.populations.initial).toMatchObject({ askedItemsDeclared: 1, askedItemsUnverified: 1, askedItemsShapeFailures: 2, askedItemsShapeRetried: 1 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Asked Items: 3 declared; Answer standings 2 stated, 1 unverified; 2 shape failure(s) (1 retried)')
    expect(markdown).toContain('- Asked Items: not recorded')
    expect(markdown).toMatch(/- initial: .*1 declared Asked Items \(1 with an unverified standing, 2 shape failure\(s\), 1 retried\)/)
  })
})

describe('Malformed Answers and Answer Retries (#245)', () => {
  const malformed = (at: number, agentId?: string): Record<string, unknown> => ({
    ...identity,
    at: T0 + at,
    kind: 'malformed_answer',
    role: agentId === undefined ? 'orchestrator' : 'subagent',
    text: '{"speak":"Done.","display":42}',
    chars: 30,
    error: '"display" is not a string',
    ...(agentId === undefined ? {} : { agentId }),
  })
  const retry = (at: number, outcome: string, agentId?: string): Record<string, unknown> => ({
    ...identity,
    at: T0 + at,
    kind: 'answer_retry',
    role: agentId === undefined ? 'orchestrator' : 'subagent',
    outcome,
    ...(agentId === undefined ? {} : { agentId }),
  })
  const RECORDS = [malformed(3_500), retry(4_500, 'tool_calls'), malformed(2_550, 'a-1'), retry(2_650, 'on_contract', 'a-1'), malformed(14_500)]

  it('counts both from the records, the Run’s and its Subagents’, beside the rounds', () => {
    const plain = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const counted = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, [...EXTRA, ...RECORDS]) }))

    expect([counted.malformedAnswers, counted.answerRetries]).toEqual([3, 2])
    // A trace written before the records counts none: nothing re-reads Answer text.
    expect([plain.malformedAnswers, plain.answerRetries]).toEqual([0, 0])
    // Round classes, reasons and the digest a cached judgement is keyed on do not move.
    expect(counted.rounds).toEqual(plain.rounds)
    expect(counted.digestHash).toBe(plain.digestHash)
  })

  it('sums both per population and prints them per attempt and per population', () => {
    const counted = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, [...EXTRA, ...RECORDS]) }))
    const set = buildAuditSet(provenanceOf(), [{ mechanical: counted, review: null, countsAfterOverrules: counted.counts }], [])

    expect([set.populations.initial.malformedAnswers, set.populations.initial.answerRetries]).toEqual([3, 2])
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Malformed Answers: 3 (2 retried)')
    expect(markdown).toMatch(/- initial: .*3 Malformed Answer\(s\) \(2 retried\)/)
  })

  it('notes the known pre-record Malformed Answer in the set that holds it, counting it nowhere', () => {
    const plain = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const eurostar = { ...plain, captureId: 'baseline-1--rule-eurostar-luggage', attemptId: 'rule-eurostar-luggage--initial' }
    const holding = buildAuditSet(provenanceOf(), [{ mechanical: eurostar, review: null, countsAfterOverrules: eurostar.counts }], [])
    const other = buildAuditSet(provenanceOf(), [{ mechanical: plain, review: null, countsAfterOverrules: plain.counts }], [])

    expect(holding.caveats).toEqual([expect.stringMatching(/^rule-eurostar-luggage--initial replied with a Malformed Answer in round 7, before the malformed_answer record existed \(#245\)/)])
    expect(holding.populations.initial.malformedAnswers).toBe(0)
    expect(formatAuditSet(holding)).toContain('replied with a Malformed Answer in round 7')
    expect(other.caveats).toEqual([])
  })
})

describe('the rail’s Search Observations (#243, ADR 0049)', () => {
  const searchesOf = (mechanical: ReturnType<typeof classifyAttempt>) => mechanical.rounds.map((round) => round.calls.map((call) => call.search))

  it('takes each search round from its observation — typed and refused searches included — and never consults the replay', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(RAIL_ROUNDS, [...EXTRA, SUBAGENT_OBSERVATION]) }))
    expect(mechanical.searchSource).toBe('rail')
    expect(searchesOf(mechanical)).toEqual([
      [{ query: 'harrison longitude watch catalogue', streak: 1, signature: 'url' }],
      [{ query: 'harrison longitude watch catalogue', streak: 2, signature: 'input' }],
      [{ query: 'harrison longitude watch catalogue id', streak: 3, signature: 'input' }],
      // The replay would have reset at round 2's successful type and skipped
      // round 3's refusal, and read streak 1 here.
      [{ query: 'harrison longitude watch catalogue id', streak: 4, signature: 'url' }],
      [null],
      [{ query: 'harrison longitude watch catalogue', streak: 1, signature: 'url' }],
    ])
    const reasons = mechanical.rounds.map((round) => `${round.kind}: ${round.reason}`)
    expect(reasons[1]).toBe('acquisition_without_progress: type: a search that rewords the one before it (streak 2)')
    // The refused search keeps the kind the refusal makes it.
    expect(reasons[2]).toMatch(/^failed_round: every call was refused/)
    expect(reasons[3]).toBe('acquisition_without_progress: navigate: a search that rewords the one before it (streak 4)')
    // A type the rail did not observe is not a search round.
    expect(reasons[4]).toBe('acquisition_with_progress: type: a requested state change (text entered or an option selected)')
    expect(mechanical.rounds[4]!.tags.search).toBe(false)
    // The head of the rail-sourced streak is counted as ADR 0048 counts it.
    expect(mechanical.searchLoopHeads).toEqual([1])
    expect(mechanical.mechanicalSearchRounds).toBe(3)
  })

  it('replays an observation-free trace as before: a successful type resets, and the source says replay or none', () => {
    expect(classifyAttempt(inputOf()).searchSource).toBe('replay')
    const typedBetween: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'bbbb2222') }] },
      { round: 2, at: 2_000, calls: [{ name: 'type', args: { ref: 3, text: 'harrison longitude watch catalogue\n' }, result: 'typed [3]: value="harrison longitude watch catalogue"' }] },
      { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SEARCH_B }, result: PAGE('search', SEARCH_B, 'cccc3333') }] },
    ]
    const replayed = classifyAttempt(inputOf({ traceRecords: traceOf(typedBetween, EXTRA) }))
    expect(replayed.searchSource).toBe('replay')
    expect(searchesOf(replayed)).toEqual([[{ query: 'harrison longitude watch catalogue', streak: 1 }], [null], [{ query: 'harrison longitude watch catalogue id', streak: 1 }]])
    const noSearch: RoundSpec[] = [{ round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SPEC_URL }, result: PAGE('Watch spec', SPEC_URL, 'aaaa1111') }] }]
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(noSearch, EXTRA) })).searchSource).toBe('none')
    // A Subagent's observations alone do not make the orchestrator's attempt rail-sourced.
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(typedBetween, [...EXTRA, SUBAGENT_OBSERVATION]) })).searchSource).toBe('replay')
  })

  it('agrees with the replay on a navigate-only trace when the observations are the rail’s own (AC5)', async () => {
    // The observations are made by running the rail over the fixture's calls,
    // outcome by outcome, as the Tool Round does — refused calls observed as failed.
    const rail = createSearchLoopRail()
    const observed: RoundSpec[] = []
    for (const spec of ROUNDS) {
      const calls = []
      for (const [index, call] of (spec.calls ?? []).entries()) {
        const ok = call.ok ?? true
        const verdict = await rail.observe({ id: `${spec.round}.${index}`, name: call.name, args: call.args }, ok ? { ok, result: call.result ?? 'ok' } : { ok, error: call.error ?? 'refused' })
        calls.push(verdict.observation === null ? call : { ...call, observation: verdict.observation })
      }
      observed.push({ ...spec, calls })
    }
    const replayed = classifyAttempt(inputOf())
    const railed = classifyAttempt(inputOf({ traceRecords: traceOf(observed, EXTRA) }))
    expect(railed.searchSource).toBe('rail')
    const withoutSignature = (mechanical: ReturnType<typeof classifyAttempt>) => searchesOf(mechanical).map((calls) => calls.map((search) => (search === null ? null : { query: search.query, streak: search.streak })))
    expect(withoutSignature(railed)).toEqual(withoutSignature(replayed))
    expect(railed.rounds.map((round) => `${round.kind}: ${round.reason}`)).toEqual(replayed.rounds.map((round) => `${round.kind}: ${round.reason}`))
    expect(railed.searchLoopHeads).toEqual(replayed.searchLoopHeads)
    expect(railed.mechanicalSearchRounds).toBe(replayed.mechanicalSearchRounds)
  })

  it('names the source per attempt and counts attempts by source, outside the digest', () => {
    const railed = classifyAttempt(inputOf({ traceRecords: traceOf(RAIL_ROUNDS, EXTRA) }))
    const replayed = classifyAttempt(inputOf())
    expect(railed).toHaveProperty('searchSource', 'rail')
    // The source is not the reviewer's business: the replayed digest is the pinned one.
    expect(replayed.digestHash).toBe('sha256:ab85fed806eb15cbf49cb047cd7401081f8033507e32e94ee7e9fbabd7d9a147')
    const set = buildAuditSet(
      provenanceOf(),
      [railed, replayed].map((mechanical) => ({ mechanical, review: null, countsAfterOverrules: countsAfterOverrulesOf(mechanical, null) })),
      [],
    )
    expect(set.populations.initial.searchSources).toEqual({ rail: 1, replay: 1, none: 0 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- search source rail: the rail’s own Search Observations')
    expect(markdown).toContain('- search source replay: the streak rule re-run over navigate searches')
    expect(markdown).toContain('by search source rail 1, replay 1, none 0')
  })
})

describe('Not-found Landings (#239, ADR 0050)', () => {
  const DEAD_A = 'https://www.jpl.nasa.gov/news/voyager-2013-09'
  const DEAD_B = 'https://science.nasa.gov/voyager-2013-09'
  const LANDINGS: RoundSpec[] = [
    // Recorded as a field on the result: the title alone would not say so.
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: DEAD_A }, result: `${PAGE('NASA', DEAD_A, 'dead0001')}\nNOT-FOUND:404 www.jpl.nasa.gov\nadvice`, notFound: { basis: '404', host: 'www.jpl.nasa.gov' } }] },
    // A trace written before the field: the app's own title rule reads it.
    { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: DEAD_B }, result: PAGE('Page not found - NASA Science', DEAD_B, 'dead0002') }] },
    { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SPEC_URL }, result: PAGE('Watch spec', SPEC_URL, 'aaaa1111') }] },
  ]

  it('reads a landing into a notFound call field and Acquisition without Progress, from the field or the title rule', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(LANDINGS, EXTRA) }))
    const [first, second, third] = mechanical.rounds

    expect(first).toMatchObject({ kind: 'acquisition_without_progress', reason: 'navigate: landed on a Not-found Page' })
    expect(first!.calls[0]).toMatchObject({ notFound: '404 www.jpl.nasa.gov', progress: { made: false, reason: 'landed on a Not-found Page' } })
    expect(second).toMatchObject({ kind: 'acquisition_without_progress', reason: 'navigate: landed on a Not-found Page' })
    expect(second!.calls[0]).toHaveProperty('notFound', 'title science.nasa.gov')
    expect(third).toMatchObject({ kind: 'acquisition_with_progress' })
    expect(third!.calls[0]).not.toHaveProperty('notFound')
    expect(mechanical.notFoundNavigates).toEqual([1, 2])
  })

  it('replays a landing between two searches as inspection: the streak goes on', () => {
    const rounds: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('Search', SEARCH_A, 'bbbb0001') }] },
      { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: DEAD_B }, result: PAGE('Page not found - NASA Science', DEAD_B, 'dead0002') }] },
      { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SEARCH_B }, result: PAGE('Search', SEARCH_B, 'bbbb0002') }] },
    ]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) }))
    expect(mechanical.rounds[2]!.calls[0]!.search).toMatchObject({ streak: 2 })
  })

  it('prints the landings per attempt and how many the reviewer judged Off-key, and sums both per population', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(LANDINGS, EXTRA) }))
    const judged: AuditJudgement = {
      searchLoops: [],
      offKey: [{ round: 2, url: DEAD_B, reason: 'a composed slug for a release that is not there' }],
      overrules: [],
      stoppedEarly: { value: false, reason: 'it answered', checks: [] },
      answerOmitted: { value: false, reason: 'fact-02 was on no page it read', checks: [] },
      verdict: { primary: 'rounds_wasted', primaryReason: 'two guessed addresses', secondary: null, secondaryReason: null },
      flags: [],
    }
    expect(validateJudgement(judged, mechanical).ok).toBe(true)
    const review: AuditReview = { judgement: judged, caveats: [], model: 'reviewer', served: null, effort: 'high', promptVersion: '1', digestHash: mechanical.digestHash, costUsd: null, durationMs: null, judgedAt: null }
    const set = buildAuditSet(provenanceOf(), [{ mechanical, review, countsAfterOverrules: countsAfterOverrulesOf(mechanical, judged) }], [])

    expect(set.populations.initial).toMatchObject({ notFoundNavigates: 2, notFoundOffKey: 1 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- navigates that landed on a Not-found Page: 2 (round 1, 2)')
    expect(markdown).toContain('- of those, judged Off-key by the reviewer: 1')
    expect(markdown).toContain('2 navigate(s) landed on a Not-found Page (1 judged Off-key)')

    const unjudged = formatAuditSet(buildAuditSet(provenanceOf(), [{ mechanical, review: null, countsAfterOverrules: mechanical.counts }], []))
    expect(unjudged).toContain('- of those, judged Off-key by the reviewer: not judged')
  })
})

describe('Rewritten Composed Addresses (#255, ADR 0055)', () => {
  const DEAD = 'https://www.nasa.gov/voyager-2013-09'
  const COMPOSED = 'https://www.nasa.gov/voyager-record'
  const SEARCH = 'https://duckduckgo.com/?q=voyager%20record%20site%3Anasa.gov'
  const LINE = `Rewritten — nasa.gov already answered not found for a composed address this run, so ${COMPOSED} was not opened; it ran as a search of the site instead: "voyager record site:nasa.gov". Open a result you were shown rather than composing another address.`
  const ROUNDS: RoundSpec[] = [
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: DEAD }, result: `${PAGE('Page Not Found - NASA', DEAD, 'dead0001')}\nNOT-FOUND:404 www.nasa.gov\nadvice`, notFound: { basis: '404', host: 'www.nasa.gov' } }] },
    { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: COMPOSED }, result: `${LINE}\n${PAGE('DuckDuckGo', SEARCH, 'bbbb0001')}`, rewritten: { site: 'nasa.gov', query: 'voyager record site:nasa.gov' } }] },
    { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SPEC_URL }, result: PAGE('Watch spec', SPEC_URL, 'aaaa1111') }] },
  ]

  it('reads a rewrite into a rewritten call field, replayed as the search that ran, and the rewritten round is an acquisition round, never a Failed one', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const [first, rewritten, third] = mechanical.rounds

    expect(rewritten!.kind).toMatch(/^acquisition_/)
    expect(rewritten!.calls[0]).toMatchObject({ args: { url: COMPOSED }, refused: false, url: SEARCH, rewritten: 'voyager record site:nasa.gov', search: { query: 'voyager record site:nasa.gov', streak: 1 } })
    expect(first!.calls[0]).not.toHaveProperty('rewritten')
    expect(third!.calls[0]).not.toHaveProperty('rewritten')
    expect(mechanical.rewrittenComposedAddresses).toEqual([2])
  })

  it('keeps a rewritten round whose search failed out of the Failed rounds', () => {
    const rounds: RoundSpec[] = [
      ROUNDS[0]!,
      { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: COMPOSED }, ok: false, error: `${LINE}\nSearch loop limit reached`, rewritten: { site: 'nasa.gov', query: 'voyager record site:nasa.gov' } }] },
      ROUNDS[2]!,
    ]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) }))

    expect(mechanical.rounds[1]!.kind).not.toBe('failed_round')
    expect(mechanical.rounds[1]!.calls[0]).toMatchObject({ refused: false, rewritten: 'voyager record site:nasa.gov' })
    expect(mechanical.rewrittenComposedAddresses).toEqual([2])
  })

  it('prints the rewrites per attempt and how many the reviewer judged Off-key, and sums both per population', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const judged: AuditJudgement = {
      searchLoops: [],
      offKey: [{ round: 2, url: SEARCH, reason: 'a site search for a path the site does not have' }],
      overrules: [],
      stoppedEarly: { value: false, reason: 'it answered', checks: [] },
      answerOmitted: { value: false, reason: 'fact-02 was on no page it read', checks: [] },
      verdict: { primary: 'rounds_wasted', primaryReason: 'a guessed address', secondary: null, secondaryReason: null },
      flags: [],
    }
    expect(validateJudgement(judged, mechanical).ok).toBe(true)
    const review: AuditReview = { judgement: judged, caveats: [], model: 'reviewer', served: null, effort: 'high', promptVersion: '1', digestHash: mechanical.digestHash, costUsd: null, durationMs: null, judgedAt: null }
    const set = buildAuditSet(provenanceOf(), [{ mechanical, review, countsAfterOverrules: countsAfterOverrulesOf(mechanical, judged) }], [])

    expect(set.populations.initial).toMatchObject({ rewrittenComposedAddresses: 1, rewrittenComposedAddressesOffKey: 1, notFoundNavigates: 1, notFoundOffKey: 0 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Composed Addresses rewritten into a site search: 1 (round 2)')
    expect(markdown).toContain('- of the rewrites, judged Off-key by the reviewer: 1')
    expect(markdown).toContain('1 Composed Address(es) rewritten into a site search (1 judged Off-key)')
    expect(markdown).toContain('[rewritten, off-key]')

    const unjudged = formatAuditSet(buildAuditSet(provenanceOf(), [{ mechanical, review: null, countsAfterOverrules: mechanical.counts }], []))
    expect(unjudged).toContain('- of the rewrites, judged Off-key by the reviewer: not judged')
  })
})

// ---------------------------------------------------------------------------
// The judged half

const judgement: AuditJudgement = {
  searchLoops: [{ rounds: [2, 3], reason: 'two rewordings of one query' }],
  offKey: [{ round: 4, url: OTHER_URL, reason: 'the page is about something else' }],
  overrules: [{ round: 5, kind: 'acquisition_without_progress', reason: 'the first read repeated what the navigate showed' }],
  stoppedEarly: { value: false, reason: 'it ran to its budget', checks: [] },
  answerOmitted: { value: false, reason: 'fact-02 needed a page the Run never read', checks: [] },
  verdict: { primary: 'rounds_wasted', primaryReason: '4 of 13 budgeted rounds without Progress, plus an Off-key page', secondary: 'failed_rounds', secondaryReason: 'two failed rounds' },
  flags: [{ round: 5, question: 'a first read after a navigate is neutral by the glossary; is it a repeat here?' }],
}

/** The fixture judged an Answer Omission (#244): fact-02 follows from a page the Run had read. */
const omitted: AuditJudgement = {
  ...judgement,
  answerOmitted: { value: true, reason: 'fact-02 follows from https://spec.invalid/third, read in round 13', checks: ['fact-02'] },
  verdict: { primary: 'answer_omitted', primaryReason: 'fact-02 was on a page already read', secondary: 'rounds_wasted', secondaryReason: '4 of 13 budgeted rounds without Progress' },
}

describe('the Early Stop and the Answer Omission (#244)', () => {
  const mechanical = classifyAttempt(inputOf())
  const errorsOf = (raw: unknown): readonly string[] => {
    const validated = validateJudgement(raw, mechanical)
    return validated.ok ? [] : validated.errors
  }

  it('hands on the checks the Grade left unsatisfied under that name, and every check of an ungraded attempt', () => {
    expect(mechanical.checksUnsatisfied).toEqual(['fact-02'])
    expect(mechanical).not.toHaveProperty('checksNotReached')
    expect(classifyAttempt(inputOf({ grade: null })).checksUnsatisfied).toEqual(['fact-01', 'fact-02', 'pitfall-01'])
  })

  it('closes the verdict set over answer_omitted and requires both judgements, each naming its checks', () => {
    expect(AUDIT_VERDICTS).toContain('answer_omitted')
    expect(JUDGEMENT_SCHEMA.required).toEqual(expect.arrayContaining(['stoppedEarly', 'answerOmitted']))
    expect(JUDGEMENT_SCHEMA.properties.stoppedEarly.required).toEqual(['value', 'reason', 'checks'])
    expect(JUDGEMENT_SCHEMA.properties.answerOmitted.required).toEqual(['value', 'reason', 'checks'])
    const without: Record<string, unknown> = { ...judgement }
    delete without.answerOmitted
    expect(errorsOf(without)).toEqual(['answerOmitted must carry a boolean value, a reason and a list of checks'])
    // The audit-p1 shape, with no checks, is refused too.
    expect(errorsOf({ ...judgement, stoppedEarly: { value: false, reason: 'it ran to its budget' } })).toEqual(['stoppedEarly must carry a boolean value, a reason and a list of checks'])
  })

  it('refuses a check the Grade did not leave unsatisfied, a check in both lists, a value its checks contradict, and an empty reason', () => {
    expect(
      errorsOf({
        ...judgement,
        stoppedEarly: { value: true, reason: '', checks: ['fact-01', 'fact-02'] },
        answerOmitted: { value: false, reason: 'x', checks: ['fact-02'] },
      }),
    ).toEqual([
      'stoppedEarly.reason is missing',
      'stoppedEarly.checks names fact-01, which is not a check the Grade left unsatisfied',
      'answerOmitted is false and still names fact-02',
      'fact-02 is named by both stoppedEarly and answerOmitted — a check needed an unread page or follows from a read one, not both',
    ])
    expect(errorsOf({ ...judgement, answerOmitted: { value: true, reason: 'x', checks: [] } })).toEqual(['answerOmitted is true and names no check'])
    expect(errorsOf({ ...judgement, answerOmitted: { value: false, reason: ' ', checks: [] } })).toEqual(['answerOmitted.reason is missing'])
  })

  it('refuses a verdict its judgement contradicts, primary or secondary, and allows a true judgement under another verdict', () => {
    expect(errorsOf({ ...judgement, verdict: { ...judgement.verdict, primary: 'stopped_early' } })).toEqual(['verdict.primary is stopped_early, but stoppedEarly.value is false'])
    expect(errorsOf({ ...omitted, answerOmitted: judgement.answerOmitted })).toEqual(['verdict.primary is answer_omitted, but answerOmitted.value is false'])
    expect(errorsOf({ ...judgement, verdict: { ...judgement.verdict, secondary: 'answer_omitted' } })).toEqual(['verdict.secondary is answer_omitted, but answerOmitted.value is false'])
    // The reverse is legal: the reviewer found the wasted rounds more decisive.
    expect(validateJudgement({ ...judgement, answerOmitted: omitted.answerOmitted }, mechanical).ok).toBe(true)
    expect(validateJudgement(omitted, mechanical)).toEqual({ ok: true, value: omitted })
  })

  it('renders and tallies an Answer Omission beside the Early Stop, per attempt, per population and in the ranked causes', () => {
    const set = buildAuditSet(provenanceOf(), [attemptOf('initial', omitted), attemptOf('revised_objective', judgement)], [])
    expect(set.populations.initial).toMatchObject({ answerOmitted: 1, stoppedEarly: 0 })
    expect(set.populations.initial.verdictsPrimary.answer_omitted).toBe(1)
    expect(set.populations.followUp.answerOmitted).toBe(0)
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- **verdict: answer omitted** — fact-02 was on a page already read')
    expect(markdown).toContain('- stopped early: no — it ran to its budget')
    expect(markdown).toContain('- answer omitted: yes (fact-02) — fact-02 follows from https://spec.invalid/third')
    expect(markdown).toContain('0 stopped early, 1 answer omitted, ')
    expect(markdown).toMatch(/\n\| answer omitted \| 1 \| 0 \| 0 \| 0 \|\n/)

    const other = buildAuditSet(provenanceOf({ setId: 'set-2', createdAt: '2026-09-12T18:00:00.000Z' }), [attemptOf('initial', omitted)], [])
    const aggregate = buildAuditAggregate([set, other], '2026-09-14T11:00:00.000Z')
    if (!aggregate.ok) throw new Error(aggregate.errors.join('; '))
    expect(aggregate.value.rankedCauses[0]).toEqual({ verdict: 'answer_omitted', count: 2, initial: 2, followUp: 0 })
    expect(formatAuditAggregate(aggregate.value)).toContain('| 1 | answer omitted | 2 | 2 | 0 |')
    expect(formatAuditAggregate(aggregate.value)).toContain('0 stopped early, 2 answer omitted, ')
  })

  it('reports the checks unsatisfied, and an ungraded attempt’s as ungraded rather than unsatisfied', () => {
    const graded = formatAuditSet(buildAuditSet(provenanceOf(), [attemptOf('initial', judgement)], []))
    expect(graded).toContain('checks unsatisfied: fact-02 (1 of 3)')
    const ungradedMechanical = classifyAttempt(inputOf({ grade: null }))
    const ungraded = formatAuditSet(buildAuditSet(provenanceOf(), [{ mechanical: ungradedMechanical, review: null, countsAfterOverrules: ungradedMechanical.counts }], []))
    expect(ungraded).toContain('checks unsatisfied: ungraded: every check (3 of 3)')
    expect(`${graded}${ungraded}`).not.toContain('not reached')
  })
})

describe('the reviewer’s output', () => {
  const mechanical = classifyAttempt(inputOf())

  it('is accepted when every round it names exists and every choice is from the closed sets', () => {
    const validated = validateJudgement(judgement, mechanical)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.value).toEqual(judgement)
    expect(countsAfterOverrulesOf(mechanical, validated.value)).toEqual({ ...mechanical.counts, acquisition_with_progress: 4, acquisition_without_progress: 5 })
  })

  it('is refused when it names a round the digest does not have, repeats the primary as secondary, overrules to the same kind, or marks a non-Acquisition round Off-key', () => {
    const refused = validateJudgement(
      {
        ...judgement,
        searchLoops: [{ rounds: [99], reason: 'x' }],
        offKey: [{ round: 9, url: null, reason: 'x' }],
        overrules: [{ round: 6, kind: 'acquisition_without_progress', reason: 'x' }],
        verdict: { ...judgement.verdict, secondary: 'rounds_wasted', secondaryReason: 'x' },
      },
      mechanical,
    )
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.errors).toEqual([
      'overrules: round 6 is already acquisition_without_progress — an overrule must change the label',
      'searchLoops names round 99, which is not a round of this attempt',
      'offKey: round 9 is bookkeeping, and Off-key is a judgement over Acquisition rounds only',
      'verdict.secondary repeats the primary — a secondary verdict must differ',
    ])
    // Finalization is mechanical: neither a Finalization round nor a round
    // overruled into Finalization is a judgement the reviewer can make.
    const finalization = validateJudgement({ ...judgement, overrules: [{ round: 14, kind: 'failed_round', reason: 'x' }, { round: 11, kind: 'finalization', reason: 'x' }] }, mechanical)
    expect(finalization.ok).toBe(false)
    if (finalization.ok) return
    expect(finalization.errors).toEqual([
      'overrules: round 14 — Finalization is mechanical and cannot be overruled into or out of',
      'overrules: round 11 — Finalization is mechanical and cannot be overruled into or out of',
    ])
    expect(validateJudgement('prose', mechanical)).toEqual({ ok: false, errors: ['the output is not a JSON object'] })
  })

  it('finds key text in an output, whole or as a run of eight words, and names only its index', () => {
    const keyTexts = [
      { label: 'required fact', text: 'The invented watch is catalogued as ZZZ0001 in the invented museum collection.' },
      { label: 'pitfall', text: 'short' },
    ]
    expect(keyLeaks('round 4 could carry fact-01', keyTexts)).toEqual([])
    expect(keyLeaks('the page says the invented watch is catalogued as zzz0001 in the invented museum collection, so it is on-key', keyTexts)).toEqual(['required fact #1 reproduced whole'])
    expect(keyLeaks('it repeats that the watch is catalogued as ZZZ0001 in the invented museum, nothing more', keyTexts)).toEqual(['required fact #1: 8 consecutive words reproduced'])
    expect(keyLeaks('short', keyTexts)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Sets and the aggregate

function provenanceOf(overrides: Partial<AuditProvenance> = {}): AuditProvenance {
  return {
    setId: 'set-1',
    study: 'fixture-study',
    protocolVersion: 'v0',
    mode: 'measured',
    state: 'complete',
    createdAt: '2026-09-12T17:00:00.000Z',
    commits: ['0'.repeat(40)],
    dirtyTree: false,
    promptVersions: ['p1'],
    keyVersion: 'k1',
    keyManifestDigest: 'sha256:k',
    gradesReviewers: ['reviewer-x'],
    gradesRevision: 1,
    roles: ['orchestrator=model-o', 'subagent=model-s', 'vision=model-v'],
    reasoningEffortOverride: null,
    effortOverrides: [],
    adblock: 'production_default',
    browserSubspans: false,
    reviewerModel: 'claude-opus-5',
    reviewerEffort: 'high',
    reviewerPromptVersion: 'audit-p1',
    auditCommit: '1'.repeat(40),
    auditDirtyTree: false,
    generatedAt: '2026-09-13T10:00:00.000Z',
    ...overrides,
  }
}

function attemptOf(relation: 'initial' | 'revised_objective', withJudgement: AuditJudgement | null): AuditAttempt {
  const mechanical = classifyAttempt(
    inputOf({
      attempt: attemptCapture({ attemptId: relation === 'initial' ? ATTEMPT : 'hunt-x--follow_up', huntId: 'hunt-x', relation, ...(relation === 'initial' ? {} : { stepId: 'follow_up', parentAttemptId: ATTEMPT }), terminal: { at: 16_000, finalizationCause: 'budget_exhausted' } }),
    }),
  )
  return {
    mechanical,
    review: withJudgement === null ? null : { judgement: withJudgement, caveats: [], model: 'claude-opus-5', served: 'claude-opus-5', effort: 'high', promptVersion: 'audit-p1', digestHash: mechanical.digestHash, costUsd: 0.5, durationMs: 1000, judgedAt: '2026-09-13T10:00:00.000Z' },
    countsAfterOverrules: countsAfterOverrulesOf(mechanical, withJudgement),
  }
}

describe('a set and the aggregate', () => {
  const setOne = buildAuditSet(provenanceOf(), [attemptOf('initial', judgement), attemptOf('revised_objective', { ...judgement, verdict: { ...judgement.verdict, primary: 'budget_too_small_for_the_hunt', secondary: null, secondaryReason: null } })], ['a caveat'])
  const setTwo = buildAuditSet(provenanceOf({ setId: 'set-2', createdAt: '2026-09-12T18:00:00.000Z' }), [attemptOf('initial', { ...judgement, offKey: [], overrules: [] }), attemptOf('revised_objective', null)], [])

  it('reports the two populations apart, with kinds counted and verdicts tallied', () => {
    expect(setOne.kind).toBe(LIVE_AUDIT_KIND)
    expect(setOne.populations.initial.attempts).toBe(1)
    expect(setOne.populations.followUp.attempts).toBe(1)
    expect(setOne.populations.initial.verdictsPrimary.rounds_wasted).toBe(1)
    expect(setOne.populations.followUp.verdictsPrimary.budget_too_small_for_the_hunt).toBe(1)
    expect(setOne.populations.initial.verdictsSecondary.failed_rounds).toBe(1)
    expect(setOne.populations.initial.offKeyRounds).toBe(1)
    expect(setOne.populations.initial.searchLoopRounds).toBe(2)
    expect(setOne.populations.initial.countsAfterOverrules.acquisition_without_progress).toBe(5)
    expect(setOne.populations.initial.attemptsAtBudget).toBe(0)
    expect(setOne.populations.initial.finalizationCauses).toEqual({ budget_exhausted: 1 })
    expect(setOne.note).toBe(AUDIT_COUNTS_NOTE)
  })

  it('counts the rounds that called each tool, outside Finalization, as a share of the tool rounds (#235)', () => {
    const { toolRounds, toolRoundsUsed } = setOne.populations.initial
    const of = (tool: string) => toolRounds.find((entry) => entry.tool === tool)

    // A round that called a tool counts once for it, a refused call included;
    // the Finalization rounds' bookkeeping is outside the budget and the count.
    expect(of('navigate')).toEqual({ tool: 'navigate', rounds: 6, share: 6 / toolRoundsUsed })
    expect(of('read_page')).toEqual({ tool: 'read_page', rounds: 2, share: 2 / toolRoundsUsed })
    expect(of('scroll')).toEqual({ tool: 'scroll', rounds: 1, share: 1 / toolRoundsUsed })
    expect(of('type')?.rounds).toBe(1)
    expect(toolRounds[0]?.tool).toBe('navigate')
    for (const [index, entry] of toolRounds.entries()) {
      expect(entry.rounds).toBeLessThanOrEqual(toolRoundsUsed)
      if (index > 0) expect(entry.rounds).toBeLessThanOrEqual(toolRounds[index - 1]!.rounds)
    }
    // The count is code, outside the reviewer's digest: it moves no cache key.
    expect(setOne.attempts[0]!.mechanical).not.toHaveProperty('toolRounds')

    const aggregate = buildAuditAggregate([setTwo, setOne], '2026-09-13T11:00:00.000Z')
    if (!aggregate.ok) throw new Error(aggregate.errors.join('; '))
    expect(aggregate.value.populations.initial.toolRounds.find((entry) => entry.tool === 'navigate')?.rounds).toBe(12)
    expect(formatAuditSet(setOne)).toContain('## Tool rounds')
    expect(formatAuditSet(setOne)).toMatch(/\| navigate \| 6 \(\d+%\) \| 6 \(\d+%\) \|/)
    expect(formatAuditAggregate(aggregate.value)).toContain('## Tool rounds')
    expect(formatAuditAggregate(aggregate.value)).toMatch(/\| navigate \| 12 \(\d+%\) \| 12 \(\d+%\) \|/)
  })

  it('withholds a call argument that restates Grading Key text, and nothing else, keeping the digest hash (#235)', () => {
    const base = attemptOf('initial', judgement)
    const claim = 'the invented watch carries catalogue number nine hundred and ninety nine'
    const leaking: AuditAttempt = {
      ...base,
      mechanical: {
        ...base.mechanical,
        rounds: base.mechanical.rounds.map((round, index) =>
          index === 0
            ? { ...round, calls: round.calls.map((call, callIndex) => (callIndex === 0 ? { ...call, args: { ...call.args, observation: `Checked: ${claim}.` } } : call)) }
            : round,
        ),
      },
    }

    const { attempts, withheld } = withholdKeyText([leaking, base], () => [{ label: 'required fact', text: claim }])

    expect(withheld).toBe(1)
    const call = attempts[0]!.mechanical.rounds[0]!.calls[0]!
    expect(call.args.observation).toBe(WITHHELD_KEY_TEXT)
    expect(call.args.effort_tier).toBe('investigation')
    expect(attempts[0]!.mechanical.digestHash).toBe(leaking.mechanical.digestHash)
    expect(attempts[1]).toEqual(base)
    expect(withholdKeyText([leaking], () => []).withheld).toBe(0)
  })

  it('aggregates by arithmetic and ranks the primary verdicts', () => {
    const aggregate = buildAuditAggregate([setTwo, setOne], '2026-09-13T11:00:00.000Z')
    expect(aggregate.ok).toBe(true)
    if (!aggregate.ok) return
    expect(aggregate.value.kind).toBe(LIVE_AUDIT_AGGREGATE_KIND)
    expect(aggregate.value.provenance.sets.map((set) => set.setId)).toEqual(['set-1', 'set-2'])
    expect(aggregate.value.populations.initial.attempts).toBe(2)
    expect(aggregate.value.populations.followUp.judged).toBe(1)
    expect(aggregate.value.rankedCauses[0]).toEqual({ verdict: 'rounds_wasted', count: 2, initial: 2, followUp: 0 })
    expect(aggregate.value.rankedCauses[1]).toEqual({ verdict: 'budget_too_small_for_the_hunt', count: 1, initial: 0, followUp: 1 })
    expect(aggregate.value.caveats).toEqual(['set-1: a caveat'])
    expect(aggregate.value.note).toBe(AUDIT_COUNTS_NOTE)
    expect(formatAuditAggregate(aggregate.value)).toContain('counts and does not judge')
  })

  it('refuses sets whose shared provenance differs, one set, or one set named twice', () => {
    const other = buildAuditSet(provenanceOf({ setId: 'set-3', keyVersion: 'k2', reviewerEffort: 'low', browserSubspans: true, createdAt: '2026-09-12T19:00:00.000Z' }), [], [])
    const refused = buildAuditAggregate([setOne, other], '2026-09-13T11:00:00.000Z')
    expect(refused).toEqual({
      ok: false,
      errors: ['key version differs: set-1=k1, set-3=k2', 'browser sub-spans differs: set-1=off, set-3=on', 'audit reviewer effort differs: set-1=high, set-3=low'],
    })
    expect(buildAuditAggregate([setOne], 'x').ok).toBe(false)
    expect(buildAuditAggregate([setOne, setOne], 'x')).toEqual({ ok: false, errors: ['capture set set-1 is named 2 times: one set counts once'] })
  })

  it('formats every attempt with its kinds, verdict, checks unsatisfied, Subagent rounds, overrules and flags', () => {
    const markdown = formatAuditSet(setOne)
    expect(markdown).toContain('# Round Audit — fixture-study (set-1)')
    expect(markdown).toContain('checks unsatisfied: fact-02 (1 of 3)')
    expect(markdown).toContain('2 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1')
    expect(markdown).toContain('**verdict: rounds wasted**')
    expect(markdown).toContain('overrule round 5 → Acquisition without Progress')
    expect(markdown).toContain('Off-key round 4 (https://spec.invalid/other)')
    expect(markdown).toContain('flag (round 5)')
    expect(markdown).toContain('| 13 (trace 12.2) | Acquisition with Progress |')
    expect(markdown).toContain(AUDIT_COUNTS_NOTE)
  })
})

// ---------------------------------------------------------------------------
// The committed outputs and the CLI

describe('the committed audit outputs', () => {
  const files = existsSync(REPORTS_DIR) ? readdirSync(REPORTS_DIR).filter((name) => name.startsWith('audit-')) : []

  it.skipIf(files.length === 0)('carry no key text and nothing under the private root', () => {
    // The key's own words. Its source statements are not in the list: they
    // quote public pages, and an attempt's Evidence Checkpoint excerpts the
    // same pages verbatim into the digest, which is the audit's business.
    const keys = liveWebHunts().map((hunt) => gradingKeyFor(hunt.id)!)
    const keyTexts = keys.flatMap((key) => [
      ...key.requiredFacts.map((text) => ({ label: `${key.huntId} required fact`, text })),
      ...key.constraints.map((text) => ({ label: `${key.huntId} constraint`, text })),
      ...key.pitfalls.map((text) => ({ label: `${key.huntId} pitfall`, text })),
      ...key.uncertainties.map((text) => ({ label: `${key.huntId} uncertainty`, text })),
      ...key.liveFacts.map((text) => ({ label: `${key.huntId} live fact`, text })),
      ...(key.followUpDelta?.requiredFacts ?? []).map((text) => ({ label: `${key.huntId} follow-up fact`, text })),
      ...(key.followUpDelta?.pitfalls ?? []).map((text) => ({ label: `${key.huntId} follow-up pitfall`, text })),
    ])
    for (const name of files) {
      const text = readFileSync(join(REPORTS_DIR, name), 'utf8')
      expect(keyLeaks(text, keyTexts), name).toEqual([])
      expect(text, name).not.toContain('e2e/live/private')
      expect(text, name).not.toMatch(/\/home\/[a-z]/)
    }
  })

  it.skipIf(files.length === 0)('say checks unsatisfied wherever the reviewer prompt is audit-p2, and leave earlier outputs as they were (#244)', () => {
    const promptVersionOf = (name: string): string | null => {
      const json = JSON.parse(readFileSync(join(REPORTS_DIR, name.replace(/\.md$/, '.json')), 'utf8')) as { provenance: { reviewerPromptVersion?: string; shared?: { reviewerPromptVersion?: string } } }
      return json.provenance.reviewerPromptVersion ?? json.provenance.shared?.reviewerPromptVersion ?? null
    }
    const current = files.filter((name) => promptVersionOf(name) === 'audit-p2')
    expect(current.length).toBeGreaterThan(0)
    for (const name of current) {
      const text = readFileSync(join(REPORTS_DIR, name), 'utf8')
      expect(text, name).not.toMatch(/checks not reached|checksNotReached/)
      if (name.endsWith('.json') && !name.startsWith('audit-aggregate')) {
        const audit = JSON.parse(text) as { attempts: { mechanical: Record<string, unknown> }[] }
        for (const attempt of audit.attempts) expect(attempt.mechanical, name).toHaveProperty('checksUnsatisfied')
      }
    }
  })
})

describe('the CLI', () => {
  it.skipIf(!stripsTypes)('loads under plain Node and refuses an unknown option before reading anything', () => {
    let stderr = ''
    let status: number | null = 0
    try {
      execFileSync('node', [SCRIPT, '--nope=1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      const failed = error as { status: number | null; stderr: string }
      status = failed.status
      stderr = failed.stderr
    }
    expect(status).toBe(1)
    expect(stderr).toContain('live:audit: unknown option --nope')
  })

  it('never tells the reviewer a check was not reached (#244)', () => {
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/not reached/)
  })
})
