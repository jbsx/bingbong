import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FINALIZATION_REASONING_EFFORT as SOURCE_FINALIZATION_EFFORT, TIER_REASONING_EFFORT as SOURCE_TIER_EFFORT, TIER_TOOL_ROUND_BUDGETS as SOURCE_BUDGETS, TIER_ESCALATION_DECLINE_REASONS as SOURCE_DECLINE_REASONS, TIER_ESCALATION_ARMS as SOURCE_ARMS, budgetWarningMessage, finalizeInstruction, notExecuted } from '../../src/core/pipeline/effortEpoch'
import { SCROLL_END_OF_PAGE } from '../../src/core/browser/scrollDelta'
import { CONSENT_LABEL_RE, consentDismissalLine, consentRetryNote } from '../../src/core/browser/dialogPolicy'
import { blockedActionHead } from '../../src/core/browser/actionOutcome'
import { similarQueries as ruleSimilarQueries } from '../../src/core/pipeline/searchLoopRule'
import { createSearchLoopRail, SEARCH_LOOP_NUDGE, searchQueryFromUrl as railSearchQueryFromUrl, type SearchObservation } from '../../src/core/pipeline/searchLoopRail'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { TraceRecord } from '../../src/core/trace/runTrace'
import type { SnapshotRef } from '../../src/core/browser/snapshot'
import {
  AUDIT_COUNTS_NOTE,
  AUDIT_VERDICTS,
  BUDGET_WARNING_RE,
  CONSENT_DISMISSAL_MARK,
  CONSENT_LABEL_PATTERN,
  JUDGEMENT_SCHEMA,
  END_OF_PAGE_MARK,
  TIER_ESCALATION_ARMS,
  TIER_ESCALATION_DECLINE_REASONS,
  FINALIZATION_REASONING_EFFORT,
  FINALIZE_INSTRUCTION_MARK,
  NO_PROGRESS_NOTICE_MARK,
  SEARCH_LOOP_NUDGE_MARKS,
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
  sameSourceUnsupportedRoundsOf,
  searchQueryOf,
  replaySearchStreaks,
  blockedOrInertOf,
  recountUnavailableByTitle,
  unavailableLandingsOf,
  searchLoopCountsOf,
  similarQueries,
  validateJudgement,
  WITHHELD_KEY_TEXT,
  withholdKeyText,
  type AuditAttempt,
  type AuditJudgement,
  type AuditMechanical,
  type AuditProvenance,
  type AuditReview,
  type AuditRound,
  type AuditTraceInput,
  rewritesByHuntOf,
  engineRewriteOffKeyOf,
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
/** The fixture attempt's digest hash: a pin on what the reviewer is shown, moved only on purpose. */
const DIGEST_HASH_PIN = 'sha256:23b447f2e0fc361a1d28d6dee08cb1e7c49f83e925efa68a423ad7058fff0151'
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
    /** The Subagent a kind "subagent" checkpoint cited, and the Notice its acceptance carried (#272). */
    checkpointAgentId?: string
    correction?: string
    /** The Search Observation the rail recorded for this call (#243) — a trace written after observations were kept. */
    observation?: SearchObservation
    /** The Not-found Landing the Run Trace records on the result (#239) — a trace written after the field was kept. */
    notFound?: { basis: string; host: string }
    /** The Unavailable Landing the Run Trace records on the result (#262) — a trace written after the field was kept. */
    unavailable?: { basis: string; host: string }
    /** The Composed Address rewrite the Run Trace records on the result (#255, ADR 0055). */
    rewritten?: { site: string; query: string }
    /** The Unseen Phrase rewrite the Run Trace records on the result (#267, ADR 0064). */
    unquoted?: { phrases: string[]; query: string }
    /** The Engine Rewrite the Run Trace records on the result (#270, ADR 0067). */
    engineRewrite?: { from: string; to: string; query: string }
  }[]
  readonly reasoning?: string
  /** How long the attempt waited for its first fragment (#256, ADR 0057) — a trace written after the field was kept. */
  readonly firstTokenMs?: number
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
      ...(spec.firstTokenMs !== undefined ? { firstTokenMs: spec.firstTokenMs } : {}),
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
        records.push({ ...identity, at: T0 + spec.at + 2, kind: 'evidence_checkpoint', tool: call.name, args: call.args, outcome: call.checkpoint, matched: call.checkpoint === 'accepted', graded: [], ...(call.merged !== undefined ? { merged: call.merged } : {}), ...(call.checkpointAgentId !== undefined ? { agentId: call.checkpointAgentId } : {}), ...(call.correction !== undefined ? { correction: call.correction } : {}) })
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
        ...(call.unavailable !== undefined ? { unavailable: call.unavailable } : {}),
        ...(call.rewritten !== undefined ? { rewritten: call.rewritten } : {}),
        ...(call.unquoted !== undefined ? { unquoted: call.unquoted } : {}),
        ...(call.engineRewrite !== undefined ? { engineRewrite: call.engineRewrite } : {}),
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
    expect(reason(3)).toContain('a search after a search with nothing opened between them (streak 2, rewording the one before it)')
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

  it('reads a Search URL as the rail reads it: one function, every form (#260, ADR 0059, AC4)', () => {
    const table = [
      'https://www.rmg.co.uk/collections/objects/search/Harrison',
      'https://www.rmg.co.uk/collections/objects/search/Harrison%20timekeeper',
      'https://www.rmg.co.uk/search?query=harrison%20marine%20timekeeper%20H4',
      'https://www.rmg.co.uk/search?Query=harrison',
      'https://duckduckgo.com/?q=x',
      'http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov&filter=statuscode:200',
      'https://www.bing.com/ck/a?!&&p=789a',
      'https://www.rmg.co.uk/collections/objects/search/Harrison?page=2',
      'https://example.org/search',
      'https://example.org/search/',
      'https://www.raspberrypi.com/news/?s=x',
      'harrison longitude watch',
      'site:rmg.co.uk harrison watch',
      'rmg.co.uk/collections',
      SEARCH_A,
      SPEC_URL,
    ]
    for (const url of table) expect(searchQueryOf(url), url).toBe(railSearchQueryFromUrl(url))
    expect(searchQueryOf('https://www.rmg.co.uk/collections/objects/search/Harrison%20timekeeper')).toBe('Harrison timekeeper')
  })

  it('marks the Search Loop nudge in the rail’s current wording and in the wording captures before #260 carry', () => {
    expect(SEARCH_LOOP_NUDGE).toContain(SEARCH_LOOP_NUDGE_MARKS[0])
    expect(SEARCH_LOOP_NUDGE_MARKS).toContain('The last searches reword one intent')
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
      expect(classified[2]!.calls[0]!.search, inspection.name).toEqual({ query: 'harrison longitude watch catalogue id', streak: 2, rewords: true })
      expect(classified[2]!.reason, inspection.name).toContain('with nothing opened between them (streak 2, rewording the one before it)')
    }
  })

  it('counts a loop’s head by the streak rule without touching its kind, its reason or the digest (Decision 8)', () => {
    const mechanical = classifyAttempt(inputOf())
    // Counting the head re-keys no cached judgement. The pin moved three times
    // since, on purpose: #244 renamed `checksUnsatisfied` and hashed the grade
    // status, #256 reworded the Finalize Instruction the fixture's round 13
    // carries (a captured trace keeps the words it recorded, so no cache
    // re-keys), and #259 changed what a search line in the digest says — the
    // streak by the consecutive rule and `rewords` beside it.
    expect(mechanical.digestHash).toBe(DIGEST_HASH_PIN)
    // Round 2's search starts the streak round 3's continues.
    expect(mechanical.searchLoopHeads).toEqual([2])
    expect(mechanical.mechanicalSearchRounds).toBe(2)
    expect(mechanical.rounds[1]!.kind).toBe('acquisition_with_progress')
    expect(mechanical.rounds[1]!.reason).not.toContain('nothing opened between them')
    expect(formatAuditSet(buildAuditSet(provenanceOf(), [attemptOf('initial', judgement)], []))).toMatch(/\n\| 2 \| [^\n]*loop head by the streak rule[^\n]*\|\n/)
    // The two counters beside it (#259): round 3 is at streak 2; nothing reached 3.
    expect(mechanical.searchRoundsAtStreak2).toBe(1)
    expect(mechanical.searchRoundsAtStreak3).toBe(0)

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

  it('continues the streak across a search that shares no words, and says so beside it (#259, ADR 0058)', () => {
    const rounds: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'bbbb2222') }] },
      { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: 'https://www.bing.com/search?q=voyager+interstellar+crossing' }, result: PAGE('search', 'https://www.bing.com/search?q=voyager+interstellar+crossing', 'cccc3333') }] },
      { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SEARCH_B }, result: PAGE('search', SEARCH_B, 'dddd4444') }] },
    ]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) }))
    expect(mechanical.rounds.map((round) => round.calls[0]!.search)).toEqual([
      { query: 'harrison longitude watch catalogue', streak: 1 },
      { query: 'voyager interstellar crossing', streak: 2, rewords: false },
      { query: 'harrison longitude watch catalogue id', streak: 3, rewords: false },
    ])
    expect(mechanical.rounds[1]!.reason).toBe('navigate: a search after a search with nothing opened between them (streak 2)')
    expect(mechanical.searchLoopHeads).toEqual([1])
    expect(mechanical.mechanicalSearchRounds).toBe(3)
    expect(mechanical.searchRoundsAtStreak2).toBe(2)
    expect(mechanical.searchRoundsAtStreak3).toBe(1)
    expect(similarQueries('voyager interstellar crossing', 'harrison longitude watch catalogue')).toBe(false)
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

describe('subagent citations: excerpt_unsupported and dropped excerpts (#272)', () => {
  const DOCS = 'https://www.raspberrypi.com/documentation/accessories/camera.html'
  const NOTICE = 'Notice: record_evidence stored the finding without its excerpt.'
  const cited = (id: string): string => `Session Evidence recorded: ${id}, grounded in what subagent a-1 observed at ${DOCS} (wobs-2). It survives this run's outcome.`
  const subagentArgs = (excerpt?: string): Record<string, unknown> => ({ kind: 'subagent', agent_id: 'a-1', observation: 'a finding', source_url: DOCS, ...(excerpt !== undefined ? { excerpt } : {}) })

  const ROUNDS: RoundSpec[] = [
    // 1: a pre-#272 refusal of a report passage, beside a web citation's refusal that is no worker's.
    {
      round: 1,
      at: 1_000,
      calls: [
        { name: 'record_evidence', args: subagentArgs('from the report'), ok: false, error: 'record_evidence rejected (excerpt_unsupported): not in what subagent a-1 retained', checkpoint: 'excerpt_unsupported', checkpointAgentId: 'a-1' },
        { name: 'record_evidence', args: { kind: 'web', observation: 'x', source_url: OTHER_URL, excerpt: 'y' }, ok: false, error: 'record_evidence rejected (excerpt_unsupported): no', checkpoint: 'excerpt_unsupported' },
      ],
    },
    // 2: applied with its excerpt dropped, and one that offered none.
    {
      round: 2,
      at: 2_000,
      calls: [
        { name: 'record_evidence', args: subagentArgs('from the report'), result: cited('memory-3'), checkpoint: 'accepted', checkpointAgentId: 'a-1', correction: NOTICE },
        { name: 'record_evidence', args: subagentArgs(), result: cited('memory-4'), checkpoint: 'accepted', checkpointAgentId: 'a-1' },
      ],
    },
  ]

  it('counts both from the trace\'s checkpoint records, beside the digest', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, [EXTRA[0]!]) }))
    expect(mechanical.subagentCitations).toEqual({ excerptUnsupported: 1, droppedExcerpts: 1 })

    // Counted beside the digest: the hash a cached judgement is keyed on does not move.
    const without = ROUNDS.map((spec) => ({ ...spec, calls: spec.calls?.map(({ correction: _correction, ...rest }) => rest) }))
    const old = classifyAttempt(inputOf({ traceRecords: traceOf(without, [EXTRA[0]!]) }))
    expect(old.subagentCitations).toEqual({ excerptUnsupported: 1, droppedExcerpts: 0 })
    expect(old.digestHash).toBe(mechanical.digestHash)

    // Another Notice on a subagent acceptance is not a dropped excerpt.
    const other = ROUNDS.map((spec) => ({ ...spec, calls: spec.calls?.map((call) => (call.correction === undefined ? call : { ...call, correction: 'Notice: something else.' })) }))
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(other, [EXTRA[0]!]) })).subagentCitations).toEqual({ excerptUnsupported: 1, droppedExcerpts: 0 })
  })

  it('sums them per population and prints both numbers per attempt and per population', () => {
    const initial = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, [EXTRA[0]!]) }))
    const set = buildAuditSet(provenanceOf(), [{ mechanical: initial, review: null, countsAfterOverrules: initial.counts }], [])

    expect(set.populations.initial.subagentCitations).toEqual({ excerptUnsupported: 1, droppedExcerpts: 1 })
    const markdown = formatAuditSet(set)
    expect(markdown).toMatch(/- initial: .*subagent citations: 1 excerpt_unsupported, 1 applied with a dropped excerpt/)
    expect(markdown).toContain('; subagent citations: 1 excerpt_unsupported, 1 applied with a dropped excerpt;')

    // An audit written before the counter says so, never zero.
    const { subagentCitations: _dropped, ...before } = initial
    const legacy = buildAuditSet(provenanceOf(), [{ mechanical: before, review: null, countsAfterOverrules: initial.counts }], [])
    expect(legacy.populations.initial.subagentCitations).toBeUndefined()
    expect(formatAuditSet(legacy)).toMatch(/- initial: .*subagent citations not counted/)
  })
})

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
    expect(markdown).toContain('Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)')
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
    expect(markdown).toMatch(/- initial: .*Held Page round\(s\) without Progress, \d+ bundled checkpoint round\(s\), \d+ same-source unsupported round\(s\), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 1 Answer\(s\) with an Identity Slip, 3 id\(s\) slipped, /)
    expect(markdown).toMatch(/- follow_up: .*Held Page round\(s\) without Progress, \d+ bundled checkpoint round\(s\), \d+ same-source unsupported round\(s\), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, Identity Slips not recorded, /)

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

describe('skipped bookkeeping rounds and Finalization rounds cut by the Allowance (#256, ADR 0056)', () => {
  const entry = (at: number, bookkeeping: 'kept' | 'skipped', agentId?: string): Record<string, unknown> => ({
    ...identity,
    v: 3,
    at: T0 + at,
    kind: 'finalization_entry',
    cause: 'budget_exhausted',
    bookkeeping,
    reason: bookkeeping === 'skipped' ? 'nothing new' : 'something new',
    ...(agentId === undefined ? {} : { agentId }),
  })
  // The fixture's bookkeeping round, cut by its share instead of recording anything.
  const CUT = ROUNDS.map((spec) => (spec.round === 13 ? { round: 13, at: 14_000, effort: 'low', outcome: 'allowance' } : spec))

  it('counts both beside the rounds, and a trace below version 3 recorded no skips at all', () => {
    const plain = classifyAttempt(inputOf())
    const cut = classifyAttempt(inputOf({ traceRecords: traceOf(CUT, EXTRA) }))
    const skipped = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, [...EXTRA, entry(13_500, 'skipped'), entry(2_550, 'skipped', 'a-1')]) }))
    const kept = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, [...EXTRA, entry(13_500, 'kept')]) }))

    expect([plain.skippedBookkeepingRounds, plain.allowanceFinalizationRounds]).toEqual([null, 0])
    expect(cut.allowanceFinalizationRounds).toBe(1)
    // A Subagent's record is not the Run's, and a version-3 trace with no skip counts zero, not nothing.
    expect(skipped.skippedBookkeepingRounds).toBe(1)
    expect(kept.skippedBookkeepingRounds).toBe(0)
    // Beside the rounds, never in them: no class, reason or cached judgement moves.
    expect(skipped.rounds).toEqual(plain.rounds)
    expect(skipped.digestHash).toBe(plain.digestHash)
  })

  it('sums both per population, reads a population of old traces as not recorded, and prints them', () => {
    const skipped = classifyAttempt(inputOf({ traceRecords: traceOf(CUT, [...EXTRA, entry(13_500, 'skipped')]) }))
    const old = classifyAttempt(inputOf({ traceRecords: traceOf(CUT, EXTRA) }))
    const set = buildAuditSet(provenanceOf(), [{ mechanical: skipped, review: null, countsAfterOverrules: skipped.counts }], [])
    const oldSet = buildAuditSet(provenanceOf(), [{ mechanical: old, review: null, countsAfterOverrules: old.counts }], [])

    expect(set.populations.initial).toMatchObject({ skippedBookkeepingRounds: 1, skippedBookkeepingNotRecorded: 0, allowanceFinalizationRounds: 1 })
    expect(oldSet.populations.initial).toMatchObject({ skippedBookkeepingRounds: 0, skippedBookkeepingNotRecorded: 1, allowanceFinalizationRounds: 1 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Finalization: 1 bookkeeping round(s) skipped, 1 round(s) cut by the Finalization Allowance')
    expect(markdown).toMatch(/- initial: .*1 skipped bookkeeping round\(s\), 1 Finalization round\(s\) cut by the Allowance/)
    const oldMarkdown = formatAuditSet(oldSet)
    expect(oldMarkdown).toContain('- Finalization: skipped bookkeeping rounds not recorded (a Run Trace below version 3), 1 round(s) cut by the Finalization Allowance')
    expect(oldMarkdown).toMatch(/- initial: .*skipped bookkeeping rounds not recorded, 1 Finalization round\(s\) cut by the Allowance/)
  })
})

describe('the rail’s Search Observations (#243, ADR 0049)', () => {
  const searchesOf = (mechanical: ReturnType<typeof classifyAttempt>) => mechanical.rounds.map((round) => round.calls.map((call) => call.search))

  it('takes which calls were searches from the observations — typed and refused searches included — and replays the streak by the rule', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(RAIL_ROUNDS, [...EXTRA, SUBAGENT_OBSERVATION]) }))
    expect(mechanical.searchSource).toBe('rail')
    expect(searchesOf(mechanical)).toEqual([
      [{ query: 'harrison longitude watch catalogue', streak: 1, signature: 'url' }],
      [{ query: 'harrison longitude watch catalogue', streak: 2, signature: 'input', rewords: true }],
      [{ query: 'harrison longitude watch catalogue id', streak: 3, signature: 'input', rewords: true }],
      // The navigate-only replay would have reset at round 2's successful type
      // and skipped round 3's refusal, and read streak 1 here.
      [{ query: 'harrison longitude watch catalogue id', streak: 4, signature: 'url', rewords: true }],
      [null],
      [{ query: 'harrison longitude watch catalogue', streak: 1, signature: 'url' }],
    ])
    const reasons = mechanical.rounds.map((round) => `${round.kind}: ${round.reason}`)
    expect(reasons[1]).toBe('acquisition_without_progress: type: a search after a search with nothing opened between them (streak 2, rewording the one before it)')
    // The refused search keeps the kind the refusal makes it.
    expect(reasons[2]).toMatch(/^failed_round: every call was refused/)
    expect(reasons[3]).toBe('acquisition_without_progress: navigate: a search after a search with nothing opened between them (streak 4, rewording the one before it)')
    // A type the rail did not observe is not a search round.
    expect(reasons[4]).toBe('acquisition_with_progress: type: a requested state change (text entered or an option selected)')
    expect(mechanical.rounds[4]!.tags.search).toBe(false)
    // The head of the rail-sourced streak is counted as ADR 0048 counts it,
    // and the refused search at streak 3 is a loop round by the rule (#259):
    // the rail refused it for the loop, whatever kind the refusal makes its round.
    expect(mechanical.searchLoopHeads).toEqual([1])
    expect(mechanical.mechanicalSearchRounds).toBe(4)
    expect(mechanical.searchRoundsAtStreak2).toBe(3)
    expect(mechanical.searchRoundsAtStreak3).toBe(2)
  })

  it('never reads the streak off the observation: a trace recorded under the same-intent rule counts under the consecutive one (ADR 0058)', () => {
    // The rail under ADR 0048 recorded streak 1 for a second search that
    // shared no words; the audit replays its current rule over the same calls.
    const SEARCH_V = 'https://duckduckgo.com/?q=voyager+interstellar+crossing'
    const olderRule: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'bbbb2222'), observation: { query: 'harrison longitude watch catalogue', signature: 'url', streak: 1 } }] },
      { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: SEARCH_V }, result: PAGE('search', SEARCH_V, 'cccc3333'), observation: { query: 'voyager interstellar crossing', signature: 'url', streak: 1 } }] },
    ]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(olderRule, EXTRA) }))
    expect(searchesOf(mechanical)[1]).toEqual([{ query: 'voyager interstellar crossing', streak: 2, signature: 'url', rewords: false }])
    expect(mechanical.searchLoopHeads).toEqual([1])
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

  it('counts the navigate searches by Search URL form, outside the digest (#260, ADR 0059, AC5)', () => {
    const PATH_A = 'https://www.rmg.co.uk/collections/objects/search/Harrison'
    const PATH_B = 'https://www.rmg.co.uk/collections/objects/search/Harrison%20timekeeper'
    const PARAM = 'https://www.rmg.co.uk/search?query=harrison%20H4'
    const forms: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'type', args: { ref: 3, text: 'Harrison sea watch\n' }, result: 'typed [3]: value="Harrison sea watch"', observation: { query: 'Harrison sea watch', signature: 'input', streak: 1 } }] },
      { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: PATH_A }, result: PAGE('search', PATH_A, 'bbbb2222'), observation: { query: 'Harrison', signature: 'url', streak: 2 } }] },
      { round: 3, at: 3_000, calls: [{ name: 'read_page', args: {}, result: READ('search', PATH_A, 'bbbb2222') }] },
      { round: 4, at: 4_000, calls: [{ name: 'navigate', args: { url: PATH_B }, result: PAGE('search', PATH_B, 'cccc3333'), observation: { query: 'Harrison timekeeper', signature: 'url', streak: 3 } }] },
      { round: 5, at: 5_000, calls: [{ name: 'navigate', args: { url: PARAM }, result: PAGE('search', PARAM, 'dddd4444'), observation: { query: 'harrison H4', signature: 'url', streak: 4 } }] },
      { round: 6, at: 6_000, calls: [{ name: 'navigate', args: { url: SEARCH_A }, result: PAGE('search', SEARCH_A, 'eeee5555'), observation: { query: 'harrison longitude watch catalogue', signature: 'url', streak: 5 } }] },
    ]
    const railed = classifyAttempt(inputOf({ traceRecords: traceOf(forms, EXTRA) }))
    expect(railed.searchForms).toEqual({ q: 1, param: 1, path: 2 })
    expect(railed.searchRoundsAtStreak3).toBe(3)
    // An observation-free trace replays the path and parameter forms as searches too.
    const withoutObservations = forms.map((spec) => ({ ...spec, calls: spec.calls?.map(({ observation: _observation, ...rest }) => rest) }))
    const replayed = classifyAttempt(inputOf({ traceRecords: traceOf(withoutObservations, EXTRA) }))
    expect(replayed.searchForms).toEqual({ q: 1, param: 1, path: 2 })
    expect(replayed.rounds.map((round) => round.calls[0]!.search?.streak ?? null)).toEqual([null, 1, null, 2, 3, 4])

    const set = buildAuditSet(
      provenanceOf(),
      [railed, classifyAttempt(inputOf())].map((mechanical) => ({ mechanical, review: null, countsAfterOverrules: countsAfterOverrulesOf(mechanical, null) })),
      [],
    )
    expect(set.populations.initial.searchForms).toEqual({ q: 3, param: 1, path: 2 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- navigate searches by Search URL form: q 1, param 1, path 2')
    expect(markdown).toContain('navigate searches by Search URL form q 3, param 1, path 2')
  })

  describe('a Blocked Action or an inert click holds the streak (#261, note on ADR 0058)', () => {
    const COLLECTIONS = 'https://www.rmg.co.uk/collections/objects'
    // Round 3's click changed the page signature, and the page title is long
    // enough that its settled state's `signature` line falls past the digest's
    // result head: only the full result text says the click consumed something.
    const LONG_TITLE = `Collections | Royal Museums Greenwich — ${'objects, '.repeat(24)}`
    const searchBox: SnapshotRef = {
      ref: 7, kind: 'input', label: 'Search e.g. cutty sark', inputType: 'search', rect: { x: 0, y: 0, width: 200, height: 32 }, src: null, href: null,
      downloadsFile: false, submitsForm: false, credentialField: false, paymentField: false, inForm: false, formHasCredential: false, formHasPayment: false, searchField: true, formHasSearch: true,
    }
    // fix-258-259 pass 2 rounds 2–6 as the port reports them since #264 (ADR
    // 0062) — the consent underlay Covered the search box, the closed drawer's
    // input and Close button were Not Shown — then an inert click and one more search.
    const UNDERLAY = blockedActionHead('type', 7, { fact: 'covered', cover: { kind: 'unlabelled', tag: 'div', contains: [] } })
    const PASS_2: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: COLLECTIONS }, result: PAGE('Collections', COLLECTIONS, 'aaaa1111') }] },
      { round: 2, at: 2_000, calls: [{ name: 'type', args: { ref: 7, text: 'Harrison longitude watch' }, result: UNDERLAY }] },
      { round: 3, at: 3_000, calls: [{ name: 'click', args: { ref: 8 }, result: `clicked [8]: urlChanged=false dialogOpen=false; page signature changed\n${READ(LONG_TITLE, COLLECTIONS, 'bbbb2222')}` }] },
      { round: 4, at: 4_000, calls: [{ name: 'type', args: { ref: 7, text: 'Harrison longitude watch' }, result: blockedActionHead('type', 7, { fact: 'notShown' }) }] },
      { round: 5, at: 5_000, calls: [{ name: 'click', args: { ref: 9 }, result: blockedActionHead('click', 9, { fact: 'notShown' }) }] },
      { round: 6, at: 6_000, calls: [{ name: 'type', args: { ref: 7, text: 'Harrison longitude watch\n' }, result: 'typed [7]: value="Harrison longitude watch"' }] },
      { round: 7, at: 7_000, calls: [{ name: 'click', args: { ref: 10 }, result: 'clicked [10]: urlChanged=false dialogOpen=false; no observable change\nAuto-vision (no observable change): The header search drawer is closed.' }] },
      { round: 8, at: 8_000, calls: [{ name: 'type', args: { ref: 7, text: 'Harrison H4\n' }, result: 'typed [7]: value="Harrison H4"' }] },
    ]

    async function railed(): Promise<RoundSpec[]> {
      const rail = createSearchLoopRail({ describeRef: async (ref) => (ref === 7 ? searchBox : undefined) })
      const observed: RoundSpec[] = []
      for (const spec of PASS_2) {
        const calls = []
        for (const [index, call] of (spec.calls ?? []).entries()) {
          const verdict = await rail.observe({ id: `${spec.round}.${index}`, name: call.name, args: call.args }, { ok: true, result: call.result })
          calls.push(verdict.observation === null ? call : { ...call, observation: verdict.observation })
        }
        observed.push({ ...spec, calls })
      }
      return observed
    }

    it('the audit’s consumed and the rail agree, read from the full result text (AC3)', async () => {
      const observed = await railed()
      const railStreaks = observed.map((spec) => spec.calls?.[0]?.observation?.streak ?? null)
      expect(railStreaks).toEqual([null, 1, null, 1, null, 2, null, 3])
      const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(observed, EXTRA) }))
      expect(mechanical.searchSource).toBe('rail')
      expect(mechanical.rounds.map((round) => round.calls[0]!.search?.streak ?? null)).toEqual(railStreaks)
      // Round 3's head cuts before its settled state; the audit read the whole text.
      expect(mechanical.rounds[2]!.calls[0]!.resultHead).not.toContain('signature bbbb2222')
      // A written report recounts to the same streaks.
      expect(replaySearchStreaks(mechanical.rounds).map((round) => round.calls[0]!.search?.streak ?? null)).toEqual(railStreaks)
    })

    it('counts Blocked Actions by kind, inert clicks and those met inside a streak, outside the digest (#261 AC4, #264 AC8)', async () => {
      const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(await railed(), EXTRA) }))
      expect(mechanical.blockedOrInert).toEqual({
        covered: [2],
        notShown: [4, 5],
        blocked: [],
        inert: [7],
        inStreak: [5, 7],
        postBlockVision: [],
        // Round 3's click landed; round 5 was a block, round 6's search landed.
        recoveries: [
          { at: 2, rounds: 1 },
          { at: 4, rounds: 2 },
          { at: 5, rounds: 1 },
        ],
      })
      expect(blockedOrInertOf(mechanical.rounds)).toEqual(mechanical.blockedOrInert)

      const set = buildAuditSet(
        provenanceOf(),
        [mechanical, classifyAttempt(inputOf())].map((attempt) => ({ mechanical: attempt, review: null, countsAfterOverrules: countsAfterOverrulesOf(attempt, null) })),
        [],
      )
      expect(set.populations.initial.blockedOrInert).toEqual({
        covered: 1,
        notShown: 2,
        blocked: 0,
        inert: 1,
        inStreak: 2,
        postBlockVision: 0,
        recoveryRounds: 4,
        recovered: 3,
        unrecovered: 0,
      })
      const markdown = formatAuditSet(set)
      expect(markdown).toContain(
        '- Blocked Actions covered 1 (round 2), not shown 2 (round 4, 5), inert clicks 1 (round 7); inside a Search Loop streak, holding it: 2 (round 5, 7); post-block vision rounds 0; recovery rounds by block 2 +1, 4 +2, 5 +1',
      )
      expect(markdown).toContain(
        '1 covered, 2 not shown and 0 pre-#264 Blocked Action(s), 1 inert click(s), 2 inside a Search Loop streak, 0 post-block vision round(s), 4 recovery round(s) over 3 recovered block(s) and 0 never recovered',
      )
      expect(markdown).toContain('## Blocked Actions by hunt')
      expect(markdown).toContain(`| ${mechanical.huntId} | 1 | 2 | 0 | 0 | 4 | 3 | 0 |`)
    })

    it('tags a Look or visual grounding round within two rounds of a block, by tool name, and a block nothing recovered from (#264 AC8)', () => {
      const HUNTING: RoundSpec[] = [
        { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: COLLECTIONS }, result: PAGE('Collections', COLLECTIONS, 'aaaa1111') }] },
        { round: 2, at: 2_000, calls: [{ name: 'click', args: { ref: 9 }, result: blockedActionHead('click', 9, { fact: 'notShown' }) }] },
        { round: 3, at: 3_000, calls: [{ name: 'ground_visual', args: { description: 'the close button' }, result: 'no match' }] },
        { round: 4, at: 4_000, calls: [{ name: 'look', args: { question: 'Is a dialog visible?' }, result: 'No.' }] },
        { round: 5, at: 5_000, calls: [{ name: 'look', args: { question: 'What is on the page?' }, result: 'A collection page.' }] },
      ]
      const counted = classifyAttempt(inputOf({ traceRecords: traceOf(HUNTING, EXTRA) })).blockedOrInert!
      // Round 5's look is three rounds past the block: not a post-block vision round.
      expect(counted.postBlockVision).toEqual([3, 4])
      expect(counted.recoveries).toEqual([{ at: 2, rounds: null }])
    })

    it('reads fix-258-259\'s pre-#264 heads as the grill did: five Blocked Actions, no inert click, one inside a streak — pass 2 round 6 (AC4)', () => {
      type Report = { attempts: { mechanical: { huntId: string; stepId: string; rounds: AuditRound[] } }[] }
      const found: { pass: number; huntId: string; stepId: string; counted: ReturnType<typeof blockedOrInertOf> }[] = []
      for (const pass of [1, 2, 3]) {
        const report = JSON.parse(readFileSync(join(REPORTS_DIR, `audit-fix-258-259-${pass}.json`), 'utf8')) as Report
        for (const { mechanical } of report.attempts) {
          const counted = blockedOrInertOf(replaySearchStreaks(mechanical.rounds))
          if (counted.blocked.length + counted.inert.length > 0) found.push({ pass, huntId: mechanical.huntId, stepId: mechanical.stepId, counted })
        }
      }
      const total = (key: 'blocked' | 'inert' | 'inStreak') => found.reduce((sum, entry) => sum + entry.counted[key].length, 0)
      expect({ blocked: total('blocked'), inert: total('inert'), inStreak: total('inStreak') }).toEqual({ blocked: 5, inert: 0, inStreak: 1 })
      expect(found.filter((entry) => entry.counted.inStreak.length > 0).map((entry) => ({ pass: entry.pass, stepId: entry.stepId, inStreak: entry.counted.inStreak }))).toEqual([
        { pass: 2, stepId: 'initial', inStreak: [6] },
      ])
      // #264: the visual-grounding round and the Look that hunted a dialog after the drawer's blocks.
      expect(found.filter((entry) => (entry.counted.postBlockVision ?? []).length > 0).map((entry) => ({ pass: entry.pass, stepId: entry.stepId, rounds: entry.counted.postBlockVision }))).toEqual([
        { pass: 2, stepId: 'initial', rounds: [7, 8] },
      ])
    })
  })

  it('names the source per attempt and counts attempts by source, outside the digest', () => {
    const railed = classifyAttempt(inputOf({ traceRecords: traceOf(RAIL_ROUNDS, EXTRA) }))
    const replayed = classifyAttempt(inputOf())
    expect(railed).toHaveProperty('searchSource', 'rail')
    // The source is not the reviewer's business: the replayed digest is the pinned one.
    expect(replayed.digestHash).toBe(DIGEST_HASH_PIN)
    const set = buildAuditSet(
      provenanceOf(),
      [railed, replayed].map((mechanical) => ({ mechanical, review: null, countsAfterOverrules: countsAfterOverrulesOf(mechanical, null) })),
      [],
    )
    expect(set.populations.initial.searchSources).toEqual({ rail: 1, replay: 1, none: 0 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- search source rail: the rail’s own Search Observations, the streak replayed by its rule')
    expect(markdown).toContain('- search source replay: the streak rule re-run over navigate searches')
    expect(markdown).toContain('by search source rail 1, replay 1, none 0')
  })
})

describe('Unavailable Landings (#262, ADR 0060)', () => {
  // fix-258-259 pass 2, the Voyager initial, rounds 20–23.
  const SEARCH_20 = 'https://duckduckgo.com/?q=%22June+27%2C+2013%22+Voyager+1+site%3Ajpl.nasa.gov'
  const ARCHIVE = 'https://web.archive.org/web/20130801000000/http://www.jpl.nasa.gov/news/news.php?release=2013-107'
  const OFFLINE_URL = 'https://web.archive.org/web/20130516021947/http://www.jpl.nasa.gov/news/news.php?release=2013-107'
  const OFFLINE_TITLE = 'Internet Archive: Temporarily Offline'
  const SEARCH_22 = 'https://duckduckgo.com/?q=missionpages+voyager+voyager20130627+site%3Anasa.gov'
  const SEARCH_23 = 'https://duckduckgo.com/?q=Voyager+1+explores+final+frontier+of+our+solar+bubble+jpl+news+2013'
  const MARKED = `${PAGE(OFFLINE_TITLE, OFFLINE_URL, 'off00021')}\nUNAVAILABLE:title web.archive.org\narchive.org could not serve this page right now.`
  const VOYAGER: RoundSpec[] = [
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: SEARCH_20 }, result: PAGE('June 27, 2013 at DuckDuckGo', SEARCH_20, 'ddg00020') }] },
    { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: ARCHIVE }, result: MARKED, unavailable: { basis: 'title', host: 'web.archive.org' } }] },
    { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: SEARCH_22 }, result: PAGE('missionpages at DuckDuckGo', SEARCH_22, 'ddg00022') }] },
    { round: 4, at: 4_000, calls: [{ name: 'navigate', args: { url: SEARCH_23 }, result: PAGE('Voyager 1 explores at DuckDuckGo', SEARCH_23, 'ddg00023') }] },
  ]

  async function railed(rounds: readonly RoundSpec[]): Promise<RoundSpec[]> {
    const rail = createSearchLoopRail()
    const observed: RoundSpec[] = []
    for (const spec of rounds) {
      const calls = []
      for (const [index, call] of (spec.calls ?? []).entries()) {
        const verdict = await rail.observe({ id: `${spec.round}.${index}`, name: call.name, args: call.args }, { ok: true, result: call.result })
        calls.push(verdict.observation === null ? call : { ...call, observation: verdict.observation })
      }
      observed.push({ ...spec, calls })
    }
    return observed
  }

  it('the audit’s consumed and the rail agree on rounds 20–23, and the landing is Acquisition without Progress (AC5)', async () => {
    const observed = await railed(VOYAGER)
    const railStreaks = observed.map((spec) => spec.calls?.[0]?.observation?.streak ?? null)
    expect(railStreaks).toEqual([1, null, 2, 3])

    for (const traced of [observed, VOYAGER]) {
      const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(traced, EXTRA) }))
      expect(mechanical.rounds.map((round) => round.calls[0]!.search?.streak ?? null)).toEqual(railStreaks)
      expect(mechanical.rounds[1]).toMatchObject({ kind: 'acquisition_without_progress', reason: 'navigate: landed on an Unavailable Page' })
      expect(mechanical.rounds[1]!.calls[0]).toMatchObject({ unavailable: 'title web.archive.org', progress: { made: false, reason: 'landed on an Unavailable Page' } })
      expect(mechanical.rounds[1]!.calls[0]).not.toHaveProperty('notFound')
      // A written report recounts to the same streaks.
      expect(replaySearchStreaks(mechanical.rounds).map((round) => round.calls[0]!.search?.streak ?? null)).toEqual(railStreaks)
    }
  })

  it('reads the landing from the trace’s field, never from the result text (AC5)', () => {
    // The field alone, on a page whose title the rule would not mark: a 503 the trace recorded.
    const byField: RoundSpec[] = VOYAGER.map((spec) =>
      spec.round === 2 ? { ...spec, calls: [{ name: 'navigate', args: { url: ARCHIVE }, result: PAGE('Wayback Machine', OFFLINE_URL, 'off00021'), unavailable: { basis: '503', host: 'web.archive.org' } }] } : spec,
    )
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(byField, EXTRA) })).rounds[1]!.calls[0]).toHaveProperty('unavailable', '503 web.archive.org')
    // A marker line in the text with no field and no outage title is nothing.
    const byText: RoundSpec[] = VOYAGER.map((spec) =>
      spec.round === 2 ? { ...spec, calls: [{ name: 'navigate', args: { url: ARCHIVE }, result: `${PAGE('Wayback Machine', OFFLINE_URL, 'off00021')}\nUNAVAILABLE:503 web.archive.org` }] } : spec,
    )
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(byText, EXTRA) }))
    expect(mechanical.rounds[1]!.calls[0]).not.toHaveProperty('unavailable')
    expect(mechanical.rounds.map((round) => round.calls[0]!.search?.streak ?? null)).toEqual([1, null, 1, 2])
  })

  it('reads a trace written before the field by the app’s title rule, and a Not-found Landing wins over it', () => {
    const unmarked: RoundSpec[] = VOYAGER.map((spec) => (spec.round === 2 ? { ...spec, calls: [{ name: 'navigate', args: { url: ARCHIVE }, result: PAGE(OFFLINE_TITLE, OFFLINE_URL, 'off00021') }] } : spec))
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(unmarked, EXTRA) })).rounds[1]!.calls[0]).toHaveProperty('unavailable', 'title web.archive.org')

    const notFound: RoundSpec[] = VOYAGER.map((spec) =>
      spec.round === 2 ? { ...spec, calls: [{ name: 'navigate', args: { url: ARCHIVE }, result: PAGE(OFFLINE_TITLE, OFFLINE_URL, 'off00021'), notFound: { basis: '404', host: 'web.archive.org' } }] } : spec,
    )
    const call = classifyAttempt(inputOf({ traceRecords: traceOf(notFound, EXTRA) })).rounds[1]!.calls[0]!
    expect(call).toHaveProperty('notFound', '404 web.archive.org')
    expect(call).not.toHaveProperty('unavailable')
  })

  it('counts the landings by basis and those followed by a search, outside the digest, and prints them (AC6)', () => {
    const rounds: RoundSpec[] = [
      ...VOYAGER,
      { round: 5, at: 5_000, calls: [{ name: 'navigate', args: { url: SPEC_URL }, result: `${PAGE('Service Unavailable', SPEC_URL, 'err00005')}\nUNAVAILABLE:503 spec.invalid\nadvice`, unavailable: { basis: '503', host: 'spec.invalid' } }] },
      { round: 6, at: 6_000, calls: [{ name: 'read_page', args: {}, result: READ('Service Unavailable', SPEC_URL, 'err00005') }] },
      { round: 7, at: 7_000, calls: [{ name: 'navigate', args: { url: OTHER_URL }, result: PAGE('Other', OTHER_URL, 'aaaa0007') }] },
    ]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) }))
    // Round 5's next call after its read is an opening, not a search.
    expect(mechanical.unavailableLandings).toEqual({ status: [5], title: [2], followedBySearch: [2] })
    expect(unavailableLandingsOf(mechanical.rounds)).toEqual(mechanical.unavailableLandings)
    // The digest never held a counter: the rounds with and without it hash alike.
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(rounds, EXTRA) })).digestHash).toBe(mechanical.digestHash)

    const set = buildAuditSet(
      provenanceOf(),
      [mechanical, classifyAttempt(inputOf())].map((attempt) => ({ mechanical: attempt, review: null, countsAfterOverrules: countsAfterOverrulesOf(attempt, null) })),
      [],
    )
    expect(set.populations.initial.unavailableLandings).toEqual({ status: 1, title: 1, followedBySearch: 1 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Unavailable Landings by status 1 (round 5), by title 1 (round 2); followed by a search: 1 (round 2)')
    expect(markdown).toContain('2 Unavailable Landing(s) (1 by status, 1 by title), 1 followed by a search')
  })

  it('recounts the committed fix-258-259 audits by the title rule: one landing, pass 2 Voyager round 21, and the streak replays 1, 1, 2, 3 (AC6)', () => {
    type Report = { attempts: { mechanical: { huntId: string; stepId: string; rounds: AuditRound[]; unavailableLandings?: unknown } }[] }
    const found: { pass: number; huntId: string; stepId: string; landings: ReturnType<typeof unavailableLandingsOf> }[] = []
    let voyager: AuditRound[] | null = null
    for (const pass of [1, 2, 3]) {
      const report = JSON.parse(readFileSync(join(REPORTS_DIR, `audit-fix-258-259-${pass}.json`), 'utf8')) as Report
      for (const { mechanical } of report.attempts) {
        expect(mechanical.unavailableLandings).toBeUndefined()
        const recounted = replaySearchStreaks(recountUnavailableByTitle(mechanical.rounds))
        const landings = unavailableLandingsOf(recounted)
        if (landings.status.length + landings.title.length > 0) found.push({ pass, huntId: mechanical.huntId, stepId: mechanical.stepId, landings })
        if (pass === 2 && mechanical.huntId === 'superseded-voyager-interstellar' && mechanical.stepId === 'initial') voyager = recounted
      }
    }
    // The grill's sweep: the Internet Archive's offline page twice, and only pass 2's was followed by a search.
    expect(found).toEqual([
      { pass: 2, huntId: 'superseded-voyager-interstellar', stepId: 'initial', landings: { status: [], title: [21], followedBySearch: [21] } },
      { pass: 3, huntId: 'superseded-voyager-interstellar', stepId: 'initial', landings: { status: [], title: [22], followedBySearch: [] } },
    ])
    const streaks = voyager!.filter((round) => round.round >= 20 && round.round <= 23).map((round) => round.calls.map((call) => call.search?.streak ?? null))
    // The held landing sits at the streak before it: 1, (1), 2, 3.
    expect(streaks).toEqual([[1], [null], [2], [3]])
  })
})

describe('consent walls (#263, ADR 0061)', () => {
  const COLLECTIONS = 'https://www.rmg.co.uk/collections/objects'
  // The page as a navigate lists it: the search box, and the wall's own
  // controls on the page layer, as the role-less Cookiebot wall was before #263.
  const WALLED = `navigated: url=${COLLECTIONS} title="Collections"\n# Collections — ${COLLECTIONS}\nviewport 985x575 scroll 0/5007\nsignature a11c0001\n[7] input[search] "Search our collection"\n[8] button "Reject all cookies"\n[9] button "Manage settings"\n[10] button "Allow all cookies"\npage text:\nsome text`
  const CLEARED = `# Collections — ${COLLECTIONS}\nviewport 985x575 scroll 0/4435\nsignature a11c0002\n[7] input[search] "Search our collection"\n[8] link "Visit"\npage text:\nsome text`

  // fix-258-259 pass 2's shape: blocked, a read between, then the hand click.
  const BEFORE: RoundSpec[] = [
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: COLLECTIONS }, result: WALLED }] },
    { round: 2, at: 2_000, calls: [{ name: 'type', args: { ref: 7, text: 'Harrison longitude watch' }, result: 'typed [7]: not typed — blocked by overlay' }] },
    { round: 3, at: 3_000, calls: [{ name: 'read_page', args: {}, result: WALLED.split('\n').slice(1).join('\n') }] },
    { round: 4, at: 4_000, calls: [{ name: 'click', args: { ref: 8 }, result: `clicked [8]: urlChanged=false dialogOpen=false; page signature changed\n${CLEARED}` }] },
    // A click on a ref that is no consent control is no hand consent click,
    // though its number once named one.
    { round: 5, at: 5_000, calls: [{ name: 'click', args: { ref: 8 }, result: `clicked [8]: urlChanged=true dialogOpen=false; page signature changed\n${CLEARED}` }] },
  ]

  // The same Run after #263: dismissed on navigate, and inside a blocked type.
  const AFTER: RoundSpec[] = [
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: COLLECTIONS }, result: `navigated: url=${COLLECTIONS} title="Collections"\n${consentDismissalLine(1, 'Reject all cookies')}\n${CLEARED}` }] },
    { round: 2, at: 2_000, calls: [{ name: 'type', args: { ref: 7, text: 'Harrison' }, result: `typed [7]: value="Harrison"; ${consentDismissalLine(1, 'Reject all cookies')} ${consentRetryNote(7, 'landed')}\n${CLEARED}` }] },
  ]

  it('pins its dismissal mark and its consent vocabulary to the source they read (AC5)', () => {
    expect(consentDismissalLine(8, 'Reject all cookies').startsWith(CONSENT_DISMISSAL_MARK)).toBe(true)
    expect(CONSENT_LABEL_PATTERN.source).toBe(CONSENT_LABEL_RE.source)
    expect(CONSENT_LABEL_PATTERN.flags).toBe(CONSENT_LABEL_RE.flags)
  })

  it('counts a hand consent click, and a block it followed within two rounds (AC5)', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(BEFORE, EXTRA) }))
    expect(mechanical.consentWalls).toEqual({ dismissals: [], handConsentClicks: [4], blockedThenHandConsent: [2] })
  })

  it('reads a label from the last whole listing that numbered the ref, never from one before it', () => {
    // Round 4's listing numbers nothing 10; the click on 10 is on no consent control it showed.
    const relisted = [...BEFORE.slice(0, 3), { round: 4, at: 4_000, calls: [{ name: 'click', args: { ref: 10 }, result: `clicked [10]: urlChanged=false dialogOpen=false; page signature changed\n${CLEARED}` }] }]
    const shorter = [...relisted.slice(0, 3), { round: 4, at: 4_000, calls: [{ name: 'read_page', args: {}, result: CLEARED }] }, { ...relisted[3]!, round: 5, at: 5_000 }]
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(shorter, EXTRA) })).consentWalls).toEqual({ dismissals: [], handConsentClicks: [], blockedThenHandConsent: [] })
  })

  it('never pairs a block with a hand consent click three rounds on', () => {
    const late = [...BEFORE.slice(0, 3), { round: 4, at: 4_000, calls: [{ name: 'read_page', args: {}, result: WALLED.split('\n').slice(1).join('\n') }] }, { ...BEFORE[3]!, round: 5, at: 5_000 }]
    expect(classifyAttempt(inputOf({ traceRecords: traceOf(late, EXTRA) })).consentWalls).toEqual({ dismissals: [], handConsentClicks: [5], blockedThenHandConsent: [] })
  })

  it('counts a dismissal on navigate and one inside a blocked type, and no hand click (AC5)', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(AFTER, EXTRA) }))
    expect(mechanical.consentWalls).toEqual({ dismissals: [1, 2], handConsentClicks: [], blockedThenHandConsent: [] })
  })

  it('reports the tags per attempt, per population and per hunt, beside the rounds (AC5)', () => {
    const before = classifyAttempt(inputOf({ traceRecords: traceOf(BEFORE, EXTRA) }))
    const after = classifyAttempt(inputOf({ traceRecords: traceOf(AFTER, EXTRA) }))
    // Beside the rounds: the payload a cached judgement is keyed by is blind to the counter.
    expect(auditModule.digestPayloadOf({ ...before, consentWalls: undefined })).toEqual(auditModule.digestPayloadOf(before))
    expect(auditModule.digestPayloadOf({ ...before, consentWalls: { dismissals: [9], handConsentClicks: [9], blockedThenHandConsent: [9] } })).toEqual(auditModule.digestPayloadOf(before))
    const set = buildAuditSet(
      provenanceOf(),
      [before, after].map((attempt) => ({ mechanical: attempt, review: null, countsAfterOverrules: countsAfterOverrulesOf(attempt, null) })),
      [],
    )
    expect(set.populations.initial.consentWalls).toEqual({ dismissals: 2, handConsentClicks: 1, blockedThenHandConsent: 1 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- consent walls: dismissals 0, hand consent clicks 1 (round 4), blocked then hand consent 1 (round 2)')
    expect(markdown).toContain('- consent walls: dismissals 2 (round 1, 2), hand consent clicks 0, blocked then hand consent 0')
    expect(markdown).toContain('2 consent dismissal(s), 1 hand consent click(s), 1 blocked then hand consent')
    expect(markdown).toContain('| hunt-x | 2 | 1 | 1 |')
    const other = buildAuditSet(provenanceOf({ setId: 'set-2', createdAt: '2026-09-12T18:00:00.000Z' }), [{ mechanical: before, review: null, countsAfterOverrules: countsAfterOverrulesOf(before, null) }], [])
    const aggregate = buildAuditAggregate([set, other], '2026-09-14T11:00:00.000Z')
    if (!aggregate.ok) throw new Error(aggregate.errors.join('; '))
    expect(formatAuditAggregate(aggregate.value)).toContain('| hunt-x | 2 | 2 | 2 |')
  })

  it('leaves an audit written before the counter uncounted, never zero', () => {
    const older = { ...classifyAttempt(inputOf()), consentWalls: undefined }
    const set = buildAuditSet(provenanceOf(), [{ mechanical: older, review: null, countsAfterOverrules: countsAfterOverrulesOf(older, null) }], [])
    expect(set.populations.initial.consentWalls).toBeUndefined()
    expect(formatAuditSet(set)).toContain('- consent walls not counted')
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

// #258: a rewritten navigate whose address an earlier successful result of
// the Run had printed, whole or cut at the snapshot's href cap. The count keys
// on the cut href's prefix — the trace holds only the printed text — which is
// exactly the defect the fix removes; an address that merely extends the
// prefix counts too, because the audit cannot tell it from the link's own.
describe('Rewritten navigates to a shown address (#258)', () => {
  const LONG = `https://science.nasa.gov/missions/voyager-program/${'nasa-voyager-status-update-on-voyager-1-location-'.repeat(4)}`
  /** The link as the pre-#258 snapshot printed it: cut at 80 with an ellipsis. */
  const CUT = `${LONG.slice(0, 79)}…`
  const SHORT = 'https://www.nasa.gov/news-release/voyager-2013/'
  const LATER = 'https://www.nasa.gov/news-release/voyager-later/'
  const DEAD = 'https://www.jpl.nasa.gov/news/voyager-2013-09'
  const RESULTS = 'https://duckduckgo.com/?q=voyager+status'
  const results = (hrefs: readonly string[], signature: string): string =>
    `navigated: url=${RESULTS} title="DuckDuckGo"\n# DuckDuckGo — ${RESULTS}\nsignature ${signature}\n${hrefs.map((href, index) => `[${index + 1}] link "r${index}" href=${JSON.stringify(href)}`).join('\n')}\npage text:\nresults`
  const rewrite = (url: string, round: number): RoundSpec['calls'] extends readonly (infer C)[] | undefined ? C : never => ({
    name: 'navigate',
    args: { url },
    result: `Rewritten — nasa.gov already answered not found for a composed address this run, so ${url} was not opened; it ran as a search of the site instead: "x site:nasa.gov". Open a result you were shown rather than composing another address.\n${PAGE('DuckDuckGo', `https://duckduckgo.com/?q=x${round}`, `bbbb000${round}`)}`,
    rewritten: { site: 'nasa.gov', query: 'x site:nasa.gov' },
  })
  const ROUNDS: RoundSpec[] = [
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: RESULTS }, result: results([CUT, SHORT], 'cccc0001') }] },
    { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: DEAD }, result: `${PAGE('Page Not Found - NASA', DEAD, 'dead0001')}\nNOT-FOUND:404 www.jpl.nasa.gov\nadvice`, notFound: { basis: '404', host: 'www.jpl.nasa.gov' } }] },
    // Shown cut: the whole address extends the printed prefix.
    { round: 3, at: 3_000, calls: [rewrite(LONG, 3)] },
    // Shown whole, matched by fingerprint: a dropped trailing slash is the same address.
    { round: 4, at: 4_000, calls: [rewrite(SHORT.slice(0, -1), 4)] },
    // Composed: shown nowhere.
    { round: 5, at: 5_000, calls: [rewrite('https://www.nasa.gov/voyager-guess', 5)] },
    // A wrong reconstruction of the cut link counts too: the audit only sees the prefix.
    { round: 6, at: 6_000, calls: [rewrite(`${LONG}2013/`, 6)] },
    // Shown only later, and in a failed result before that: not shown when navigated.
    { round: 7, at: 7_000, calls: [{ name: 'navigate', args: { url: RESULTS }, ok: false, error: `net::ERR_FAILED ${results([LATER], 'cccc0002')}` }, rewrite(LATER, 7)] },
    { round: 8, at: 8_000, calls: [{ name: 'navigate', args: { url: RESULTS }, result: results([LATER], 'cccc0003') }, rewrite(LATER, 8)] },
  ]

  it('counts the rewritten navigates whose address an earlier successful result printed, whole or cut, beside the rewrites', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))

    expect(mechanical.rewrittenComposedAddresses).toEqual([3, 4, 5, 6, 7, 8])
    expect(mechanical.rewrittenShownAddresses).toEqual([3, 4, 6, 8])
  })

  it('re-keys no cached judgement: the counter lives beside the rounds', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    for (const round of mechanical.rounds) expect(JSON.stringify(round)).not.toContain('rewrittenShown')
  })

  it('prints the count per attempt and per population, in JSON and Markdown', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const set = buildAuditSet(provenanceOf(), [{ mechanical, review: null, countsAfterOverrules: mechanical.counts }], [])

    expect(set.populations.initial).toMatchObject({ rewrittenComposedAddresses: 6, rewrittenShownAddresses: 4 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- of the rewrites, to an address the Run was shown, whole or cut: 4 (round 3, 4, 6, 8)')
    expect(markdown).toContain('6 Composed Address(es) rewritten into a site search (0 judged Off-key, 4 to an address the Run was shown)')
  })

  it('reads 4 recomputed on the committed fix-257 audits (#258, AC3)', () => {
    const perPass = [1, 2, 3].map((pass) => {
      const audit = JSON.parse(readFileSync(join(REPORTS_DIR, `audit-fix-257-${pass}.json`), 'utf8')) as { attempts: { mechanical: { rewrittenShownAddresses?: number[] } }[] }
      return audit.attempts.reduce((total, attempt) => total + (attempt.mechanical.rewrittenShownAddresses?.length ?? 0), 0)
    })
    expect(perPass.reduce((total, count) => total + count, 0)).toBe(4)
  })
})

describe('Unseen Phrase rewrites (#267, ADR 0064)', () => {
  const COMPOSED = 'https://www.nasa.gov/voyager-record'
  const DEAD = 'https://www.nasa.gov/voyager-2013-09'
  const SITE_SEARCH = 'https://duckduckgo.com/?q=voyager%20record%20site%3Anasa.gov'
  const QUOTED = 'https://duckduckgo.com/?q=%22Voyager+1+Has+Not+Yet+Left+the+Solar+System%22+NASA'
  const UNQUOTED = 'https://duckduckgo.com/?q=Voyager+1+Has+Not+Yet+Left+the+Solar+System+NASA'
  const HEAD = 'Rewritten — "Voyager 1 Has Not Yet Left the Solar System" appears in nothing this run was shown, so it ran unquoted: Voyager 1 Has Not Yet Left the Solar System NASA. Quote only a phrase you were shown — on a page, in the user’s words or in a report.'
  const STAMP = { phrases: ['Voyager 1 Has Not Yet Left the Solar System'], query: 'Voyager 1 Has Not Yet Left the Solar System NASA' }
  const ADDRESS_LINE = `Rewritten — nasa.gov already answered not found for a composed address this run, so ${COMPOSED} was not opened; it ran as a search of the site instead: "voyager record site:nasa.gov". Open a result you were shown rather than composing another address.`
  const ROUNDS: RoundSpec[] = [
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: DEAD }, result: `${PAGE('Page Not Found - NASA', DEAD, 'dead0001')}\nNOT-FOUND:404 www.nasa.gov\nadvice`, notFound: { basis: '404', host: 'www.nasa.gov' } }] },
    { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: QUOTED }, result: `${HEAD}\n${PAGE('DuckDuckGo', UNQUOTED, 'bbbb0001')}`, unquoted: STAMP }] },
    { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: COMPOSED }, result: `${ADDRESS_LINE}\n${PAGE('DuckDuckGo', SITE_SEARCH, 'bbbb0002')}`, rewritten: { site: 'nasa.gov', query: 'voyager record site:nasa.gov' } }] },
    // The head alone, with no stamp: a trace the counter never reads.
    { round: 4, at: 4_000, calls: [{ name: 'navigate', args: { url: QUOTED }, result: `${HEAD}\n${PAGE('DuckDuckGo', UNQUOTED, 'bbbb0003')}` }] },
    { round: 5, at: 5_000, calls: [{ name: 'navigate', args: { url: QUOTED }, ok: false, error: `${HEAD}\nSearch loop limit reached`, unquoted: STAMP }] },
  ]

  it('reads the stamp into an unquoted call field, never the head, and counts the rounds beside the Composed Address rewrites', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const [, unquoted, composed, headOnly, failed] = mechanical.rounds

    expect(unquoted!.calls[0]).toMatchObject({ args: { url: QUOTED }, refused: false, unquoted: STAMP.phrases })
    // The streak replay on a trace without Search Observations reads the terms that ran.
    expect(unquoted!.calls[0]!.search).toMatchObject({ query: STAMP.query })
    expect(unquoted!.calls[0]).not.toHaveProperty('rewritten')
    expect(composed!.calls[0]).toMatchObject({ rewritten: 'voyager record site:nasa.gov' })
    expect(composed!.calls[0]).not.toHaveProperty('unquoted')
    expect(headOnly!.calls[0]).not.toHaveProperty('unquoted')
    expect(failed!.calls[0]).toMatchObject({ unquoted: STAMP.phrases })
    expect(mechanical.unseenPhraseRewrites).toEqual([2, 5])
    expect(mechanical.rewrittenComposedAddresses).toEqual([3])
  })

  it('crosses the rewrites with Off-key, sums them in the population, and reports both kinds by hunt', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const judged: AuditJudgement = {
      searchLoops: [],
      offKey: [{ round: 2, url: UNQUOTED, reason: 'the unseen title, unquoted, still found the March update' }],
      overrules: [],
      stoppedEarly: { value: false, reason: 'it answered', checks: [] },
      answerOmitted: { value: false, reason: 'fact-02 was on no page it read', checks: [] },
      verdict: { primary: 'rounds_wasted', primaryReason: 'a title the Run was never shown', secondary: null, secondaryReason: null },
      flags: [],
    }
    expect(validateJudgement(judged, mechanical).ok).toBe(true)
    const review: AuditReview = { judgement: judged, caveats: [], model: 'reviewer', served: null, effort: 'high', promptVersion: '1', digestHash: mechanical.digestHash, costUsd: null, durationMs: null, judgedAt: null }
    const set = buildAuditSet(provenanceOf(), [{ mechanical, review, countsAfterOverrules: countsAfterOverrulesOf(mechanical, judged) }], [])

    expect(set.populations.initial).toMatchObject({ unseenPhraseRewrites: 2, unseenPhraseRewritesOffKey: 1, rewrittenComposedAddresses: 1, rewrittenComposedAddressesOffKey: 0 })
    expect(rewritesByHuntOf(set.attempts)).toEqual({ [mechanical.huntId]: { composedAddresses: 1, unseenPhrases: 2, engines: 0 } })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- searches that ran with an Unseen Phrase unquoted: 2 (round 2, 5)')
    expect(markdown).toContain('- of those, judged Off-key by the reviewer: 1')
    expect(markdown).toContain('2 search(es) ran with an Unseen Phrase unquoted (1 judged Off-key)')
    expect(markdown).toContain('[unquoted, off-key, loop head by the streak rule]')
    expect(markdown).toContain('every call was refused (navigate) [unquoted]')
    expect(markdown).toContain('## Rewrites by hunt')
    expect(markdown).toContain(`| ${mechanical.huntId} | 1 | 2 | 0 |`)

    const unjudged = formatAuditSet(buildAuditSet(provenanceOf(), [{ mechanical, review: null, countsAfterOverrules: mechanical.counts }], []))
    expect(unjudged).toContain('- of those, judged Off-key by the reviewer: not judged')
  })

  it('leaves the by-hunt table out for an audit that counted neither kind', () => {
    const before = { ...classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) })) } as AuditMechanical & { unseenPhraseRewrites?: number[] }
    delete before.unseenPhraseRewrites
    expect(rewritesByHuntOf([{ mechanical: before, review: null, countsAfterOverrules: before.counts }])).toBeUndefined()
  })
})

describe('Engine Rewrites (#270, ADR 0067)', () => {
  const GOOGLE = 'https://www.google.com/search?q=longitude+watch+1938'
  const YAHOO = 'https://search.yahoo.com/search?p=longitude+watch+maker'
  const ON_DDG = 'https://duckduckgo.com/?q=longitude%20watch%201938'
  const LINE = 'Rewritten — this run searches on DuckDuckGo, so the Google search ran there with the same terms: "longitude watch 1938". Search with plain terms or a DuckDuckGo address.'
  const STAMP = { from: 'google', to: 'duckduckgo', query: 'longitude watch 1938' }
  const ROUNDS: RoundSpec[] = [
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: GOOGLE }, result: `${LINE}\n${PAGE('DuckDuckGo', ON_DDG, 'eeee0001')}`, engineRewrite: STAMP }] },
    // The line alone, with no stamp: a trace the counter never reads.
    { round: 2, at: 2_000, calls: [{ name: 'navigate', args: { url: GOOGLE }, result: `${LINE}\n${PAGE('DuckDuckGo', ON_DDG, 'eeee0002')}` }] },
    { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: YAHOO }, ok: false, error: 'Rewritten — …\nnet::ERR_TIMED_OUT', engineRewrite: { from: 'yahoo', to: 'duckduckgo', query: 'longitude watch maker' } }] },
  ]

  it('reads the stamp into a call field, never the line, replays the terms that ran, and counts the rounds', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const [rewritten, lineOnly, failed] = mechanical.rounds

    expect(rewritten!.calls[0]).toMatchObject({ args: { url: GOOGLE }, engineRewrite: 'google → duckduckgo' })
    expect(rewritten!.calls[0]!.search).toMatchObject({ query: 'longitude watch 1938' })
    expect(lineOnly!.calls[0]).not.toHaveProperty('engineRewrite')
    expect(failed!.calls[0]).toMatchObject({ engineRewrite: 'yahoo → duckduckgo' })
    expect(mechanical.engineRewrites).toEqual([1, 3])
  })

  it('crosses the rewrites with Off-key, sums them in the population, and reports them by hunt', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) }))
    const judged: AuditJudgement = {
      searchLoops: [],
      offKey: [{ round: 1, url: ON_DDG, reason: 'the maker, not the date, was the open fact' }],
      overrules: [],
      stoppedEarly: { value: false, reason: 'it answered', checks: [] },
      answerOmitted: { value: false, reason: 'nothing omitted', checks: [] },
      verdict: { primary: 'rounds_wasted', primaryReason: 'a search for a settled fact', secondary: null, secondaryReason: null },
      flags: [],
    }
    expect(validateJudgement(judged, mechanical).ok).toBe(true)
    const review: AuditReview = { judgement: judged, caveats: [], model: 'reviewer', served: null, effort: 'high', promptVersion: '1', digestHash: mechanical.digestHash, costUsd: null, durationMs: null, judgedAt: null }
    const set = buildAuditSet(provenanceOf(), [{ mechanical, review, countsAfterOverrules: countsAfterOverrulesOf(mechanical, judged) }], [])

    expect(engineRewriteOffKeyOf(mechanical, judged)).toBe(1)
    expect(set.populations.initial).toMatchObject({ engineRewrites: 2, engineRewritesOffKey: 1 })
    expect(rewritesByHuntOf(set.attempts)).toEqual({ [mechanical.huntId]: { composedAddresses: 0, unseenPhrases: 0, engines: 2 } })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- searches that ran on the Run Engine in place of another Web Engine: 2 (round 1, 3)')
    expect(markdown).toContain('2 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key)')
    expect(markdown).toContain('engine rewritten')
    expect(markdown).toContain(`| ${mechanical.huntId} | 0 | 0 | 2 |`)
  })

  it('reads "not counted" for an audit written before the counter', () => {
    const before = { ...classifyAttempt(inputOf({ traceRecords: traceOf(ROUNDS, EXTRA) })) } as AuditMechanical & { engineRewrites?: number[] }
    delete before.engineRewrites
    const byHunt = rewritesByHuntOf([{ mechanical: before, review: null, countsAfterOverrules: before.counts }])!
    expect(byHunt[before.huntId]).not.toHaveProperty('engines')
    expect(formatAuditSet(buildAuditSet(provenanceOf(), [{ mechanical: before, review: null, countsAfterOverrules: before.counts }], []))).toContain('- searches that ran on the Run Engine in place of another Web Engine: not counted')
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

    expect(set.populations.initial).toMatchObject({ rewrittenComposedAddresses: 1, rewrittenComposedAddressesOffKey: 1, rewrittenShownAddresses: 0, notFoundNavigates: 1, notFoundOffKey: 0 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Composed Addresses rewritten into a site search: 1 (round 2)')
    expect(markdown).toContain('- of the rewrites, judged Off-key by the reviewer: 1')
    expect(markdown).toContain('- of the rewrites, to an address the Run was shown, whole or cut: 0')
    expect(markdown).toContain('1 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown)')
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

  // Every committed report against every key string: it grows with each audit
  // set and fits in a second alone, but not in the default five under the
  // parallel suite's load once the post-#252 levers added their tests.
  it.skipIf(files.length === 0)('carry no key text and nothing under the private root', { timeout: 30_000 }, () => {
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
      // A local home directory leaks as a path, never inside a URL's own
      // path (www.nasa.gov/home/hqnews is a public page, fix-256r2).
      expect(text, name).not.toMatch(/(?<![\w.:-])\/home\/[a-z]/)
    }
  })

  it.skipIf(files.length === 0)('say checks unsatisfied wherever the reviewer prompt is audit-p2 or later, and leave earlier outputs as they were (#244)', () => {
    const promptVersionOf = (name: string): string | null => {
      const json = JSON.parse(readFileSync(join(REPORTS_DIR, name.replace(/\.md$/, '.json')), 'utf8')) as { provenance: { reviewerPromptVersion?: string; shared?: { reviewerPromptVersion?: string } } }
      return json.provenance.reviewerPromptVersion ?? json.provenance.shared?.reviewerPromptVersion ?? null
    }
    // audit-p1 predates the split; every prompt since carries it (audit-p3, #259, changed only the Search Loop definition).
    const current = files.filter((name) => promptVersionOf(name) !== null && promptVersionOf(name) !== 'audit-p1')
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

describe('the first token (#256, ADR 0057)', () => {
  // A record new enough to say its rounds carry `firstTokenMs`.
  const v4 = { ...identity, v: 4, at: T0 + 13_500, kind: 'finalization_entry', cause: 'budget_exhausted', bookkeeping: 'kept', reason: 'something new' }
  const CUT_SILENT = ROUNDS.map((spec) => (spec.round === 13 ? { round: 13, at: 14_000, effort: 'low', outcome: 'allowance' } : spec))
  const CUT_STREAMING = ROUNDS.map((spec) =>
    spec.round === 13 ? { round: 13, at: 14_000, effort: 'low', outcome: 'allowance', firstTokenMs: 8_120 } : spec.round === 2 ? { ...spec, firstTokenMs: 3_900 } : spec,
  )
  const setOf = (mechanical: ReturnType<typeof classifyAttempt>) => buildAuditSet(provenanceOf(), [{ mechanical, review: null, countsAfterOverrules: mechanical.counts }], [])

  it('splits the cut rounds into streaming and silent beside the rounds, and reads an older trace as not recorded', () => {
    const streaming = classifyAttempt(inputOf({ traceRecords: traceOf(CUT_STREAMING, [...EXTRA, v4]) }))
    const silent = classifyAttempt(inputOf({ traceRecords: traceOf(CUT_SILENT, [...EXTRA, v4]) }))
    const old = classifyAttempt(inputOf({ traceRecords: traceOf(CUT_STREAMING, EXTRA) }))

    expect([streaming.allowanceFinalizationRounds, streaming.allowanceFinalizationRoundsStreaming]).toEqual([1, 1])
    expect([silent.allowanceFinalizationRounds, silent.allowanceFinalizationRoundsStreaming]).toEqual([1, 0])
    // A version-3 trace's round carries no first token even when the record does: the version says so.
    expect([old.allowanceFinalizationRounds, old.allowanceFinalizationRoundsStreaming, old.firstTokens]).toEqual([1, null, null])
    expect(streaming.firstTokens).toEqual([
      { round: 2, ms: 3_900 },
      // The digest numbers attempts, and the fixture retries one round before this one.
      { round: 14, ms: 8_120 },
    ])
    expect(silent.firstTokens).toEqual([])
    // Beside the rounds: the digest a reviewer judged does not move.
    expect(streaming.rounds).toEqual(old.rounds)
    expect(streaming.digestHash).toBe(old.digestHash)
  })

  it('sums the split and the first-token latency per population, and prints them', () => {
    const set = setOf(classifyAttempt(inputOf({ traceRecords: traceOf(CUT_STREAMING, [...EXTRA, v4]) })))
    const oldSet = setOf(classifyAttempt(inputOf({ traceRecords: traceOf(CUT_STREAMING, EXTRA) })))

    expect(set.populations.initial).toMatchObject({
      allowanceFinalizationRounds: 1,
      allowanceFinalizationRoundsStreaming: 1,
      allowanceFinalizationRoundsSilent: 0,
      allowanceFinalizationRoundsNotRecorded: 0,
      firstToken: { rounds: 2, p50: 3_900, p90: 8_120 },
    })
    expect(oldSet.populations.initial).toMatchObject({
      allowanceFinalizationRounds: 1,
      allowanceFinalizationRoundsStreaming: 0,
      allowanceFinalizationRoundsSilent: 0,
      allowanceFinalizationRoundsNotRecorded: 1,
      firstToken: { rounds: 0, p50: null, p90: null },
    })
    expect(formatAuditSet(set)).toContain('1 Finalization round(s) cut by the Allowance (1 after a first token, 0 silent); first-token latency p50 3900 ms, p90 8120 ms over 2 round(s)')
    expect(formatAuditSet(set)).toContain('- Finalization: 0 bookkeeping round(s) skipped, 1 round(s) cut by the Finalization Allowance (1 after a first token, 0 silent)')
    expect(formatAuditSet(oldSet)).toContain('(0 after a first token, 0 silent, 1 not recorded); first-token latency not recorded')
  })
})

describe('same-source unsupported rounds (#257, ADR 0054)', () => {
  const WIKI = 'https://en.wikipedia.org/wiki/Voyager_1'
  const DRAWING = 'https://pip-assets.example/RP-008149.pdf'
  const unsupported = (url: string, observation: string) => ({
    name: 'record_evidence',
    args: { kind: 'web', observation, source_url: url, excerpt: 'not there' },
    ok: false,
    error: 'record_evidence rejected (excerpt_unsupported): the excerpt does not appear',
    checkpoint: 'excerpt_unsupported',
  })
  const RETRY_ROUNDS: RoundSpec[] = [
    // 1–2: one source refused in consecutive rounds — both count.
    { round: 1, at: 1_000, calls: [{ name: 'navigate', args: { url: DRAWING }, result: PAGE('Drawing', DRAWING, 'aaaa1111') }, unsupported(DRAWING, 'one')] },
    { round: 2, at: 2_000, calls: [unsupported(DRAWING, 'two')] },
    // 3: another source, alone — its neighbours refuse nothing of it.
    { round: 3, at: 3_000, calls: [{ name: 'navigate', args: { url: WIKI }, result: PAGE('Voyager', WIKI, 'bbbb2222') }, unsupported(WIKI, 'three')] },
    // 4: a malformed rejection of the same source is not an unsupported one, and breaks the run.
    { round: 4, at: 4_000, calls: [{ name: 'record_evidence', args: { kind: 'web', observation: 'four', source_url: WIKI }, ok: false, error: 'record_evidence rejected (malformed): x', checkpoint: 'malformed' }] },
    // 5–6: the same source under a tracker and a fragment — canonical, so both count.
    { round: 5, at: 5_000, calls: [unsupported(WIKI, 'five')] },
    { round: 6, at: 6_000, calls: [{ name: 'scroll', args: { direction: 'down' }, result: 'scrolled down: x=0 y=277' }, unsupported(`${WIKI}?utm_source=x#Heliopause`, 'six')] },
    // 7: an accepted checkpoint of that source counts nothing.
    { round: 7, at: 7_000, calls: [{ name: 'record_evidence', args: { kind: 'web', observation: 'seven', source_url: WIKI }, result: 'Session Evidence recorded: memory-1', checkpoint: 'accepted' }] },
  ]

  it('counts a round whose refused source the previous or next round also refused, per attempt and per population', () => {
    const initial = classifyAttempt(inputOf({ traceRecords: traceOf(RETRY_ROUNDS, [EXTRA[0]!]) }))
    expect(initial.rejectedCheckpoints).toBe(6)
    expect(initial.sameSourceUnsupportedRounds).toBe(4)
    expect(sameSourceUnsupportedRoundsOf(initial.rounds)).toBe(4)

    const followUp = classifyAttempt(
      inputOf({
        attempt: attemptCapture({ attemptId: 'hunt-x--follow_up', huntId: 'hunt-x', stepId: 'follow_up', relation: 'revised_objective', parentAttemptId: ATTEMPT, terminal: { at: 16_000, finalizationCause: 'objective_met' } }),
        traceRecords: traceOf(RETRY_ROUNDS.slice(0, 2), [EXTRA[0]!]),
        parentCheckpointedUrls: new Set([WIKI]),
      }),
    )
    const set = buildAuditSet(
      provenanceOf(),
      [
        { mechanical: initial, review: null, countsAfterOverrules: initial.counts },
        { mechanical: followUp, review: null, countsAfterOverrules: followUp.counts },
      ],
      [],
    )
    expect([set.populations.initial.sameSourceUnsupportedRounds, set.populations.followUp.sameSourceUnsupportedRounds]).toEqual([4, 2])
    const markdown = formatAuditSet(set)
    expect(markdown).toMatch(/- initial: .*bundled checkpoint round\(s\), 4 same-source unsupported round\(s\), /)
    expect(markdown).toContain('bundled checkpoint round(s); 4 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)')
  })

  it('reads a trace whose verdict was the error head, not the reason word, as nothing', () => {
    const rounds: RoundSpec[] = [
      { round: 1, at: 1_000, calls: [{ ...unsupported(WIKI, 'one'), checkpoint: undefined }] },
      { round: 2, at: 2_000, calls: [{ ...unsupported(WIKI, 'two'), checkpoint: undefined }] },
    ]
    const mechanical = classifyAttempt(inputOf({ traceRecords: traceOf(rounds, [EXTRA[0]!]) }))
    expect(mechanical.rejectedCheckpoints).toBe(2)
    expect(mechanical.sameSourceUnsupportedRounds).toBe(0)
  })

  it('reads 5 recomputed on the committed fix-253-256 audits: pi-camera rounds 22–24 and Voyager rounds 23–24, all in pass 2', () => {
    const perPass = [1, 2, 3].map((pass) => {
      const audit = JSON.parse(readFileSync(join(REPORTS_DIR, `audit-fix-253-256-${pass}.json`), 'utf8')) as { attempts: { mechanical: { rounds: AuditRound[] } }[] }
      return audit.attempts.reduce((total, attempt) => total + sameSourceUnsupportedRoundsOf(attempt.mechanical.rounds), 0)
    })
    expect(perPass).toEqual([0, 5, 0])
  })
})

describe('the consecutive-search rule recounted on the committed fix-257 audits (#259, AC3)', () => {
  type Report = { attempts: { mechanical: { huntId: string; stepId: string; rounds: AuditRound[]; mechanicalSearchRounds: number; searchLoopHeads: number[] } }[] }
  const passes = [1, 2, 3].map((pass) => JSON.parse(readFileSync(join(REPORTS_DIR, `audit-fix-257-${pass}.json`), 'utf8')) as Report)

  it('marks 37 orchestrator rounds at streak 2 or beyond and 22 at 3 or beyond, against 22 Search Loop rounds as written under the same-intent rule', () => {
    // The issue's 50 and 26 counted the Browse Subagents' own rails with
    // the orchestrator's (13 calls at streak 2 or beyond and 4 rounds at 3
    // or beyond in Subagent rounds); the audit reads the orchestrator's
    // rounds only (ADR 0049), and these are its numbers on that population.
    const asWritten = { mechanicalSearchRounds: 0, searchRoundsAtStreak2: 0, searchRoundsAtStreak3: 0 }
    const recounted = { mechanicalSearchRounds: 0, searchRoundsAtStreak2: 0, searchRoundsAtStreak3: 0, heads: 0 }
    for (const report of passes) {
      for (const { mechanical } of report.attempts) {
        const written = searchLoopCountsOf(mechanical.rounds)
        expect(written.mechanicalSearchRounds).toBe(mechanical.mechanicalSearchRounds)
        expect(written.searchLoopHeads).toEqual(mechanical.searchLoopHeads)
        asWritten.mechanicalSearchRounds += written.mechanicalSearchRounds
        asWritten.searchRoundsAtStreak2 += written.searchRoundsAtStreak2
        asWritten.searchRoundsAtStreak3 += written.searchRoundsAtStreak3
        const replayed = searchLoopCountsOf(replaySearchStreaks(mechanical.rounds))
        recounted.mechanicalSearchRounds += replayed.mechanicalSearchRounds
        recounted.searchRoundsAtStreak2 += replayed.searchRoundsAtStreak2
        recounted.searchRoundsAtStreak3 += replayed.searchRoundsAtStreak3
        recounted.heads += replayed.searchLoopHeads.length
      }
    }
    expect(asWritten).toEqual({ mechanicalSearchRounds: 22, searchRoundsAtStreak2: 11, searchRoundsAtStreak3: 0 })
    expect(recounted).toEqual({ mechanicalSearchRounds: 52, searchRoundsAtStreak2: 37, searchRoundsAtStreak3: 22, heads: 15 })
  })

  it('reads Voyager pass 2 rounds 16–19 as one streak to 4 where the same-intent rule recorded 1, 1, 2, 1', () => {
    const voyager = passes[1]!.attempts.find(({ mechanical }) => mechanical.huntId === 'superseded-voyager-interstellar' && mechanical.stepId === 'initial')!.mechanical
    const streaksOf = (rounds: readonly AuditRound[]) => rounds.filter((round) => round.round >= 16 && round.round <= 19).map((round) => round.calls.map((call) => call.search?.streak ?? null))
    expect(streaksOf(voyager.rounds)).toEqual([[null, 1], [null, 1], [2], [1]])
    const replayed = replaySearchStreaks(voyager.rounds)
    expect(streaksOf(replayed)).toEqual([[null, 1], [null, 2], [3], [4]])
    // Only round 18 rewords the one before it — the one pair the same-intent
    // rule caught; the streak no longer needs it.
    expect(replayed.filter((round) => round.round >= 17 && round.round <= 19).map((round) => round.calls.at(-1)!.search!.rewords)).toEqual([false, true, false])
    // What was judged stays as judged: the digest's kinds and reasons are untouched.
    expect(replayed.map((round) => `${round.kind}: ${round.reason}`)).toEqual(voyager.rounds.map((round) => `${round.kind}: ${round.reason}`))
  })
})

describe('Tier Escalations by arm and the recorded decline (#266, ADR 0063)', () => {
  const LOOKUP_PLAN = { ...identity, at: T0 + 900, kind: 'pipeline_event', event: { type: 'run_plan', turnId: TURN, objective: 'find it', headline: 'h', effortTier: 'lookup', source: 'model', at: T0 + 900 } }
  const ESCALATION = {
    ...identity,
    at: T0 + 13_400,
    kind: 'pipeline_event',
    event: { type: 'run_plan', turnId: TURN, objective: 'find it', headline: 'h', effortTier: 'investigation', source: 'budget', escalationReason: 'fixed', roundBudget: 19, at: T0 + 13_400 },
  }
  const declinedEntry = (arm: string, reason: string, v = 5): Record<string, unknown> => ({
    ...identity,
    v,
    at: T0 + 15_500,
    kind: 'finalization_entry',
    cause: arm === 'budget' ? 'budget_exhausted' : 'deadline_reached',
    bookkeeping: 'kept',
    reason: 'something new',
    declined: { arm, reason },
  })
  /**
   * The fixture in a real trace's order: the model's Lookup plan first, then
   * the escalation spliced in after the retried round 12 — the thirteenth
   * digest round — as the loop top yields it before round 13's request.
   */
  const escalated = (escalation: Record<string, unknown>, extra: readonly Record<string, unknown>[] = []): TraceRecord[] => {
    const records: Record<string, unknown>[] = [LOOKUP_PLAN, ...(traceOf(ROUNDS, [...EXTRA.slice(1), ...extra]) as unknown as Record<string, unknown>[])]
    const round13 = records.findIndex((record) => record.kind === 'reasoning' && record.round === 13)
    records.splice(round13, 0, escalation)
    return records as unknown as TraceRecord[]
  }
  const attemptOf = (mechanical: AuditMechanical): AuditAttempt => ({ mechanical, review: null, countsAfterOverrules: mechanical.counts })
  const atVersion = (records: readonly TraceRecord[], v: number): TraceRecord[] => records.map((record) => ({ ...record, v })) as unknown as TraceRecord[]

  it('pins the decline reasons and the arms to the source', () => {
    expect(TIER_ESCALATION_DECLINE_REASONS).toEqual(SOURCE_DECLINE_REASONS)
    expect(TIER_ESCALATION_ARMS).toEqual(SOURCE_ARMS)
  })

  it('reads each escalation with the digest round before it, the replay’s verdict on that round, and the re-armed budget', () => {
    const mechanical = classifyAttempt(inputOf({ traceRecords: escalated(ESCALATION, [declinedEntry('budget', 'no_progress')]) }))

    expect(mechanical.plans.at(-1)).toEqual({ tier: 'investigation', source: 'budget', roundBudget: 19 })
    // The audit reads the re-armed budget, not the Investigation's 24.
    expect(mechanical.toolRoundBudget).toBe(19)
    expect(mechanical.deadlineEscalations).toBe(0)
    expect(mechanical.tierEscalations).toEqual({
      fired: [{ arm: 'budget', before: 13, progressBefore: true }],
      // The stop's entry is written after the last round, so the replay's
      // verdict is on the digest's last round — here one with no call to judge.
      declined: { arm: 'budget', reason: 'no_progress', before: 15, progressBefore: null },
      declineRecorded: true,
    })
    // The round before is the retried round 12's navigate to a fresh page.
    expect(mechanical.rounds[12]!.calls.some((call) => call.progress?.made === true)).toBe(true)
  })

  it('reads a version-5 trace with no decline as none, and an older trace as not recorded', () => {
    const none = classifyAttempt(inputOf({ traceRecords: atVersion(traceOf(ROUNDS, EXTRA), 5) }))
    const old = classifyAttempt(inputOf())

    expect(none.tierEscalations).toEqual({ fired: [], declined: null, declineRecorded: true })
    expect(old.tierEscalations).toEqual({ fired: [], declined: null, declineRecorded: false })
    // A Subagent's entry is never the Run's decline.
    const worker = classifyAttempt(inputOf({ traceRecords: atVersion(traceOf(ROUNDS, [...EXTRA, { ...declinedEntry('budget', 'no_rail'), agentId: 'a-1' }]), 5) }))
    expect(worker.tierEscalations?.declined).toBeNull()
    // Beside the rounds: no class, reason or cached judgement moves.
    expect(none.rounds).toEqual(old.rounds)
    expect(none.digestHash).toBe(old.digestHash)
  })

  it('counts both arms per population and per hunt, prints the attempt line, the per-Run block and the table', () => {
    const fired = classifyAttempt(inputOf({ traceRecords: escalated(ESCALATION, [declinedEntry('budget', 'no_progress')]) }))
    const old = classifyAttempt(inputOf())
    const set = buildAuditSet(provenanceOf(), [attemptOf(fired), attemptOf(old)], [])

    expect(set.populations.initial.tierEscalations).toEqual({
      budget: 1,
      deadline: 0,
      progressBefore: 1,
      noProgressBefore: 0,
      declined: { no_rail: 0, no_tier_above: 0, once_spent: 0, hard_ceiling: 0, no_progress: 1, other: 0 },
      declinedAgainstReplay: 0,
      declinesNotRecorded: 1,
    })
    const markdown = formatAuditSet(set)
    expect(markdown).toMatch(/tier investigation \(1 Tier Escalation\(s\): 1 at the budget\); \d+ Tool Rounds used over 2 tier epochs, the last budgeted 19/)
    expect(markdown).toMatch(/tier investigation; \d+ of 24 Tool Rounds used/)
    expect(markdown).toContain('- Tier Escalations: budget arm after round 13, replay: Progress; declined at the budget: no_progress (after round 15, replay: no judged call)')
    expect(markdown).toContain('- Tier Escalations: none fired; decline not recorded (a Run Trace below version 5)')
    expect(markdown).toContain('1 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 1, none before 0), declined no_progress 1, 0 declined no_progress against the replay (1 attempt(s) not recorded)')
    expect(markdown).toContain('## Tier Escalations by hunt')
    expect(markdown).toContain('| hunt-x | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |')

    const other = buildAuditSet(provenanceOf({ setId: 'set-2', createdAt: '2026-09-12T18:00:00.000Z' }), [attemptOf(fired)], [])
    const aggregate = buildAuditAggregate([set, other], '2026-09-14T11:00:00.000Z')
    if (!aggregate.ok) throw new Error(aggregate.errors.join('; '))
    expect(aggregate.value.tierEscalationsByHunt).toEqual({ 'hunt-x': expect.objectContaining({ budget: 2, declinesNotRecorded: 1 }) })
    expect(formatAuditAggregate(aggregate.value)).toContain('| hunt-x | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 1 |')
  })

  it('still counts a deadline-armed escalation on a trace that carried no budget', () => {
    const { roundBudget, ...withoutBudget } = ESCALATION.event
    expect(roundBudget).toBeDefined()
    const mechanical = classifyAttempt(inputOf({ traceRecords: escalated({ ...ESCALATION, event: { ...withoutBudget, source: 'deadline' } }) }))

    expect(mechanical.deadlineEscalations).toBe(1)
    expect(mechanical.plans.at(-1)).toEqual({ tier: 'investigation', source: 'deadline' })
    expect(mechanical.toolRoundBudget).toBe(24)
    expect(mechanical.tierEscalations?.fired).toEqual([{ arm: 'deadline', before: 13, progressBefore: true }])
    expect(formatAuditSet(buildAuditSet(provenanceOf(), [attemptOf(mechanical)], []))).toContain('tier investigation (1 Tier Escalation(s): 1 at the deadline)')
  })
})

describe('Transport Failures (#271)', () => {
  // Round 5 failed at the transport and its Transport Retry completed; the
  // Subagent's round 2 did the same.
  const RECOVERED: RoundSpec[] = ROUNDS.flatMap((spec) =>
    spec.round === 5 && (spec.attempt ?? 1) === 1 ? [{ round: 5, at: 4_900, outcome: 'transport' }, { ...spec, attempt: 2 }] : [spec],
  )
  const subagentTransport: Record<string, unknown> = {
    ...identity,
    at: T0 + 2_550,
    kind: 'llm_round',
    round: 2,
    attempt: 1,
    role: 'subagent',
    outcome: 'transport',
    reasoningChars: 0,
    failure: { message: 'fetch failed', code: 'ECONNRESET' },
    agentId: 'a-1',
    request: { toolResults: 1, chars: 10 },
  }
  const recoveredExtra = [...EXTRA.slice(0, 2), subagentTransport, ...EXTRA.slice(2)]
  // A Run whose round 3 failed twice and finalized for it: the retry hook
  // closes attempt 1, the round's end closes attempt 2, both `transport`.
  const UNREACHABLE: RoundSpec[] = [
    ...ROUNDS.slice(0, 2),
    { round: 3, at: 3_000, outcome: 'transport' },
    { round: 3, attempt: 2, at: 3_001, outcome: 'transport' },
    { round: 4, at: 4_000, effort: 'low' },
  ]
  const unreachableInput = inputOf({
    attempt: attemptCapture({ attemptId: ATTEMPT, huntId: 'hunt-x', terminal: { at: 16_000, resolution: 'unsuccessful', finalizationCause: 'model_unreachable' } }),
    traceRecords: traceOf(UNREACHABLE, [
      EXTRA[0]!,
      { ...identity, at: T0 + 16_000, kind: 'pipeline_event', event: { type: 'done', turnId: TURN, outcome: 'done', resolution: 'unsuccessful', finalizationCause: 'model_unreachable', at: T0 + 16_000 } },
    ]),
  })

  it('counts attempts, recovered rounds and unreachable Runs from the llm_round records', () => {
    const recovered = classifyAttempt(inputOf({ traceRecords: traceOf(RECOVERED, recoveredExtra) }))
    const unreachable = classifyAttempt(unreachableInput)
    const plain = classifyAttempt(inputOf())

    expect([recovered.transportAttempts, recovered.transportRetriesRecovered, recovered.modelUnreachableRuns]).toEqual([2, 2, 0])
    expect([unreachable.transportAttempts, unreachable.transportRetriesRecovered, unreachable.modelUnreachableRuns]).toEqual([2, 0, 1])
    expect([plain.transportAttempts, plain.transportRetriesRecovered, plain.modelUnreachableRuns]).toEqual([0, 0, 0])
  })

  it('classes a recovered round by its final attempt, never as a failed round', () => {
    const recovered = classifyAttempt(inputOf({ traceRecords: traceOf(RECOVERED, recoveredExtra) }))
    const plain = classifyAttempt(inputOf())

    expect(recovered.rounds.map((round) => round.kind)).toEqual(plain.rounds.map((round) => round.kind))
    expect(recovered.rounds[4]).toMatchObject({ llmRound: 5, attempt: 2, kind: plain.rounds[4]!.kind })
  })

  it('gives a round that ended transport the reason the model could not be reached', () => {
    const unreachable = classifyAttempt(unreachableInput)

    expect(unreachable.rounds[2]).toMatchObject({ llmRound: 3, attempt: 2, kind: 'failed_round', reason: 'the model could not be reached' })
    expect(unreachable.rounds).toHaveLength(4)
  })

  it('sums the counters per population and prints them per attempt and per population', () => {
    const recovered = classifyAttempt(inputOf({ traceRecords: traceOf(RECOVERED, recoveredExtra) }))
    const unreachable = { ...classifyAttempt(unreachableInput), attemptId: 'hunt-x--other' }
    const set = buildAuditSet(
      provenanceOf(),
      [recovered, unreachable].map((mechanical) => ({ mechanical, review: null, countsAfterOverrules: mechanical.counts })),
      [],
    )

    expect(set.populations.initial).toMatchObject({ transportAttempts: 4, transportRetriesRecovered: 2, modelUnreachableRuns: 1 })
    const markdown = formatAuditSet(set)
    expect(markdown).toContain('- Transport Failures: 2 Transport Failure attempt(s) (2 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)')
    expect(markdown).toMatch(/- initial: .*4 Transport Failure attempt\(s\) \(2 round\(s\) recovered by a Transport Retry, 1 Run\(s\) model_unreachable\)/)
  })
})
