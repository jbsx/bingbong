// The Round Audit (#234, ADR 0045): why a captured attempt's Tool Rounds
// went where they went, counted by code and judged by a model that is not
// the one measured.
//
// Two halves, kept apart on purpose:
//
//   * The MECHANICAL half reads an attempt's Run Trace (`llm_round`,
//     `pipeline_event` tool calls and results, `evidence_checkpoint`) and
//     its perf `llm` spans, and assigns every orchestrator round one of the
//     glossary's kinds — Acquisition with Progress, Acquisition without
//     Progress, Collection, Bookkeeping, a failed round, Finalization. It
//     is a pure function of the records: the same trace classifies
//     identically on every run, and `digestHash` says so. It also builds
//     the per-round digest the reviewer is shown — bounded heads of
//     arguments and results, never a whole page — so a 24-round attempt
//     stays tens of kilobytes, not megabytes. The measured model's
//     reasoning is counted (`reasoningChars`) and never quoted: a reviewer
//     cannot be shown it (Opus 5's safeguards refuse a message carrying it,
//     measured 2026-09-13), and a head of it kept only in the committed file
//     collides with the key's wording wherever both restate the hunt's
//     question — so the digest holds exactly what the reviewer judged.
//   * The JUDGED half is a reviewer's output — Search Loop membership,
//     Off-key Acquisitions, an early stop, the verdict, overrules of
//     mechanical labels and flags for a human — validated here against the
//     digest it was given (a round it names must exist, an overrule must
//     change something, a secondary verdict must differ from the primary)
//     and checked for key text, which must never reach a committed output.
//
// The aggregate is arithmetic over verdicts and kinds; it refuses sets whose
// shared provenance differs, as the cross-pass summary does (ADR 0044), and
// says in one line that it counts and does not judge.
//
// NOTHING HERE LOADS A KEY. The CLI hands the reviewer the key bundle the way
// `live:grade` does; this module sees the key only as a list of strings to
// check an output against. Relative imports carry `.ts` (the Node
// type-stripping pattern the scripts run under).

import { createHash } from 'node:crypto'
import { parseBlockerMarker } from '../../src/core/browser/blockerNudge.ts'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { EffortTier } from '../../src/core/pipeline/runPlan'
import type { TraceRecord } from '../../src/core/trace/runTrace'
import type { Validation } from './artifacts.ts'
import type { LiveGradeEntry, LiveKeyTask } from './grades.ts'
import type { AttemptRelation, LiveAttemptCapture, Observed } from './types.ts'

export const LIVE_AUDIT_KIND = 'bingbong.live.round-audit'
export const LIVE_AUDIT_AGGREGATE_KIND = 'bingbong.live.round-audit-aggregate'
export const LIVE_AUDIT_VERSION = 1

// ---------------------------------------------------------------------------
// The taxonomy — glossary terms only (CONTEXT.md: Tool Round, Acquisition,
// Collection, Bookkeeping, Progress, Finalization, Round Audit, Off-key).

export const ROUND_KINDS = [
  'acquisition_with_progress',
  'acquisition_without_progress',
  'collection',
  'bookkeeping',
  'failed_round',
  'finalization',
] as const
export type RoundKind = (typeof ROUND_KINDS)[number]

export const AUDIT_VERDICTS = ['rounds_wasted', 'tier_too_small_or_never_escalated', 'budget_too_small_for_the_hunt', 'stopped_early', 'failed_rounds'] as const
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number]

/**
 * The per-tier Tool Round budgets, copied from `TIER_TOOL_ROUND_BUDGETS`
 * (src/core/pipeline/effortEpoch.ts) because that module's runtime graph is
 * not loadable under Node's type stripping. `audit.test.ts` pins the copy to
 * the source, so a retuned budget fails a test here rather than misreading
 * every audit.
 */
export const TIER_TOOL_ROUND_BUDGETS: Readonly<Record<EffortTier, number>> = { direct_action: 6, lookup: 12, investigation: 24 }

/** The rung each tier's model rounds run at (`TIER_REASONING_EFFORT`), pinned by the same test. */
export const TIER_REASONING_EFFORT: Readonly<Record<EffortTier, string>> = { direct_action: 'high', lookup: 'high', investigation: 'max' }

/** The rung Finalization rounds run at whatever the tier (#215, `FINALIZATION_REASONING_EFFORT`), pinned by the same test. */
export const FINALIZATION_REASONING_EFFORT = 'low'

// The app's own model-facing sentences, matched as markers. Each is a
// deterministic constant in src/core/pipeline; the test pins the fragments
// used here to the source so a reworded Notice cannot silently unmark a
// round.
/** The Finalize Instruction's demand (`FINALIZE_INSTRUCTION_DEMAND`, effortEpoch.ts). */
export const FINALIZE_INSTRUCTION_MARK = 'Acquisition tools (browser, vision, media, and delegation) and ask_user are closed'
/** The round-budget warning (`budgetWarningMessage`, effortEpoch.ts). */
export const BUDGET_WARNING_RE = /Work budget: (\d+) of (\d+) tool rounds? remains?\./
/** The time milestone (`budgetWarningMessage('time')`). */
export const TIME_MILESTONE_MARK = 'Time: 60% of this run'
/** The no-progress rail's advisory and refusal (noProgressRail.ts). */
export const NO_PROGRESS_NOTICE_MARK = 'repeats an equivalent action against unchanged page state'
/** The Search Loop rail's advisory (searchLoopRail.ts). */
export const SEARCH_LOOP_NUDGE_MARK = 'The last searches reword one intent'
/** The refusal prefix every "the run will not do this" answer carries (`notExecuted`, effortEpoch.ts). */
export const NOT_EXECUTED_PREFIX = 'Not executed — '
/** What a scroll that brought nothing into view says (`SCROLL_END_OF_PAGE`, scrollDelta.ts). */
export const END_OF_PAGE_MARK = 'end of page'

/** Which tools acquire, collect and record — the catalog's own `acquisition` flags and the glossary's Collection and Bookkeeping. */
export const ACQUISITION_TOOLS: ReadonlySet<string> = new Set([
  'navigate',
  'read_page',
  'click',
  'type',
  'scroll',
  'back',
  'go_forward',
  'look',
  'ground_visual',
  'media_control',
  'spawn_agent',
  'cancel_agent',
  'download_url',
])
export const COLLECTION_TOOLS: ReadonlySet<string> = new Set(['agent_results'])
export const BOOKKEEPING_TOOLS: ReadonlySet<string> = new Set(['record_evidence', 'record_candidate', 'report_run_plan'])

/** How much of a tool result the digest keeps. */
export const DIGEST_RESULT_HEAD_CHARS = 240
/** How much of one string argument the digest keeps. */
export const DIGEST_ARG_CHARS = 200
/** How far apart a perf `llm` span's end and an `llm_round` record may be and still be the same round. */
const LATENCY_JOIN_TOLERANCE_MS = 2_000
/** A search that continues a streak of this length rewords the one before it. */
const SEARCH_STREAK_WITHOUT_PROGRESS = 2

// ---------------------------------------------------------------------------
// Shapes

export interface AuditCall {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
  /** Null when the tape holds no result for the call. */
  readonly ok: boolean | null
  /** Refused: the tool returned an error, or a `Not executed —` answer. */
  readonly refused: boolean
  readonly resultHead: string | null
  /** The page the call put in front of the Run, where the result says. */
  readonly url: string | null
  readonly title: string | null
  readonly signature: string | null
  /** A Blocker marker on the result: `<signal> <host>`. */
  readonly wall: string | null
  /** An Evidence Checkpoint's verdict: accepted, or the rejection's head. */
  readonly checkpoint: { readonly accepted: boolean; readonly outcome: string } | null
  /** The app's own Notices riding the result, as marker names. */
  readonly notices: readonly string[]
  /** The search query a `navigate` carried, when it was one. */
  readonly search: { readonly query: string; readonly streak: number } | null
  /** Why this call did or did not make Progress, in the words of the rule that decided. */
  readonly progress: { readonly made: boolean; readonly reason: string } | null
}

export interface AuditRound {
  /**
   * The digest's own numbering: the round's position among the attempt's
   * orchestrator rounds, from 1, Finalization included. Unique, so a
   * judgement can name a round — the trace's `llm_round` numbering repeats
   * across a retried round's attempts.
   */
  readonly round: number
  /** The trace's `llm_round` number and attempt, for joining back to the Run Trace. */
  readonly llmRound: number
  readonly attempt: number
  readonly at: number
  readonly outcome: string
  readonly effort: string | null
  readonly model: string | null
  readonly latencyMs: number | null
  readonly promptTokens: number | null
  readonly completionTokens: number | null
  readonly requestChars: number | null
  readonly toolResultsInRequest: number | null
  /** How much the model thought before deciding, as a length; the text itself is never in the digest. */
  readonly reasoningChars: number
  readonly calls: readonly AuditCall[]
  readonly kind: RoundKind
  readonly reason: string
  readonly tags: {
    readonly inherited: boolean
    readonly rejectedCheckpoints: number
    readonly acceptedCheckpoints: number
    readonly refusedCalls: number
    readonly wall: boolean
    readonly search: boolean
  }
}

export interface AuditTraceInput {
  readonly attempt: LiveAttemptCapture
  readonly captureId: string
  /** Every Run Trace record of the attempt's turn, in file order — Subagent rounds included. */
  readonly traceRecords: readonly TraceRecord[]
  /** Perf spans of the same turn. */
  readonly perfRecords: readonly PerfSpanRecord[]
  /** The `BINGBONG_REASONING_EFFORT` override the launch ran under; the rung rule is skipped when one was. */
  readonly reasoningEffortOverride: string | null
  /** Canonical URLs the initial attempt already checkpointed, for a follow-up; null for an initial. */
  readonly parentCheckpointedUrls: ReadonlySet<string> | null
  /** The key's checks for this task, ids only. */
  readonly task: LiveKeyTask | null
  /** This attempt's grade entry, when the set has been graded. */
  readonly grade: LiveGradeEntry | null
}

export type AuditDisposition = 'answered' | 'no_answer' | 'acceptance_unconfirmed'

export interface AuditPlan {
  readonly tier: EffortTier
  readonly source: string
}

export interface AuditMechanical {
  readonly attemptId: string
  readonly huntId: string
  readonly stepId: string
  readonly relation: AttemptRelation
  readonly parentAttemptId: string | null
  readonly captureId: string
  readonly turnId: string | null
  readonly disposition: AuditDisposition
  readonly terminal: { readonly outcome: string | null; readonly resolution: string | null; readonly finalizationCause: string | null } | null
  readonly stopReason: string
  readonly runDurationMs: Observed<number>
  readonly plans: readonly AuditPlan[]
  readonly tier: EffortTier | null
  readonly deadlineEscalations: number
  readonly toolRoundBudget: number | null
  /** Rounds outside Finalization that requested at least one tool — the rounds the budget counts. */
  readonly toolRoundsUsed: number
  readonly lastBudgetNotice: { readonly remaining: number; readonly budget: number } | null
  readonly rounds: readonly AuditRound[]
  readonly orchestratorRounds: number
  /** Rounds outside Finalization: the denominator of every share. */
  readonly budgetedRounds: number
  readonly counts: Readonly<Record<RoundKind, number>>
  /** Each kind over the budgeted rounds; Finalization's share is over all rounds. Null when there is nothing to divide by. */
  readonly shares: Readonly<Record<RoundKind, number | null>>
  readonly acceptedCheckpoints: number
  readonly rejectedCheckpoints: number
  readonly inheritedRounds: number
  readonly mechanicalSearchRounds: number
  readonly walledRounds: number
  readonly latency: { readonly llmMs: number | null; readonly joined: number; readonly unjoined: number }
  readonly usage: { readonly promptTokens: number; readonly completionTokens: number; readonly roundsWithUsage: number }
  readonly subagent: { readonly rounds: number; readonly agents: number; readonly byStop: Readonly<Record<string, number>> }
  readonly grade: { readonly status: string; readonly reviewer: string } | null
  /** Check ids the Answer never reached: judged unsatisfied, or every check when ungraded. Null when the key has no task for the slot. */
  readonly checksNotReached: readonly string[] | null
  readonly checksTotal: number | null
  readonly digestHash: string
}

export interface AuditJudgement {
  readonly searchLoops: readonly { readonly rounds: readonly number[]; readonly reason: string }[]
  readonly offKey: readonly { readonly round: number; readonly url: string | null; readonly reason: string }[]
  readonly overrules: readonly { readonly round: number; readonly kind: RoundKind; readonly reason: string }[]
  readonly stoppedEarly: { readonly value: boolean; readonly reason: string }
  readonly verdict: {
    readonly primary: AuditVerdict
    readonly primaryReason: string
    readonly secondary: AuditVerdict | null
    readonly secondaryReason: string | null
  }
  readonly flags: readonly { readonly round: number | null; readonly question: string }[]
}

export interface AuditReview {
  readonly judgement: AuditJudgement | null
  /** Why the judgement is absent or qualified; every flag ships here too. */
  readonly caveats: readonly string[]
  readonly model: string
  readonly served: string | null
  readonly effort: string
  readonly promptVersion: string
  readonly digestHash: string
  readonly costUsd: number | null
  readonly durationMs: number | null
  readonly judgedAt: string | null
}

export interface AuditAttempt {
  readonly mechanical: AuditMechanical
  readonly review: AuditReview | null
  /** Kind counts after the reviewer's overrules; equal to the mechanical counts when there are none. */
  readonly countsAfterOverrules: Readonly<Record<RoundKind, number>>
}

export interface AuditProvenance {
  readonly setId: string
  readonly study: string
  readonly protocolVersion: string
  readonly mode: string
  readonly state: string
  readonly createdAt: string
  readonly commits: readonly string[]
  readonly dirtyTree: boolean
  readonly promptVersions: readonly string[]
  readonly keyVersion: string
  readonly keyManifestDigest: string
  readonly gradesReviewers: readonly string[]
  readonly gradesRevision: number | null
  readonly roles: readonly string[]
  readonly reasoningEffortOverride: string | null
  readonly effortOverrides: readonly string[]
  readonly adblock: string
  readonly reviewerModel: string
  readonly reviewerEffort: string
  readonly reviewerPromptVersion: string
  readonly auditCommit: string
  readonly auditDirtyTree: boolean
  readonly generatedAt: string
}

export interface AuditPopulation {
  readonly label: string
  readonly attempts: number
  readonly judged: number
  readonly rounds: number
  readonly budgetedRounds: number
  readonly toolRoundsUsed: number
  readonly counts: Readonly<Record<RoundKind, number>>
  readonly countsAfterOverrules: Readonly<Record<RoundKind, number>>
  readonly shares: Readonly<Record<RoundKind, number | null>>
  readonly verdictsPrimary: Readonly<Record<AuditVerdict, number>>
  readonly verdictsSecondary: Readonly<Record<AuditVerdict, number>>
  readonly offKeyRounds: number
  readonly searchLoopRounds: number
  readonly mechanicalSearchRounds: number
  readonly inheritedRounds: number
  readonly rejectedCheckpoints: number
  readonly walledRounds: number
  readonly subagentRounds: number
  readonly stoppedEarly: number
  readonly overrules: number
  readonly flags: number
  readonly finalizationCauses: Readonly<Record<string, number>>
  readonly attemptsAtBudget: number
}

export interface AuditSetOutput {
  readonly kind: typeof LIVE_AUDIT_KIND
  readonly auditVersion: typeof LIVE_AUDIT_VERSION
  readonly provenance: AuditProvenance
  readonly attempts: readonly AuditAttempt[]
  readonly populations: { readonly initial: AuditPopulation; readonly followUp: AuditPopulation }
  readonly caveats: readonly string[]
  readonly note: string
}

export interface AuditAggregatePopulation extends AuditPopulation {
  readonly perSet: readonly { readonly setId: string; readonly population: AuditPopulation }[]
}

export interface AuditAggregate {
  readonly kind: typeof LIVE_AUDIT_AGGREGATE_KIND
  readonly auditVersion: typeof LIVE_AUDIT_VERSION
  readonly provenance: {
    readonly shared: Omit<AuditProvenance, 'setId' | 'state' | 'createdAt' | 'commits' | 'dirtyTree' | 'gradesRevision' | 'auditCommit' | 'auditDirtyTree' | 'generatedAt'>
    readonly sets: readonly Pick<AuditProvenance, 'setId' | 'state' | 'createdAt' | 'commits' | 'dirtyTree' | 'gradesRevision' | 'auditCommit' | 'auditDirtyTree' | 'generatedAt'>[]
    readonly generatedAt: string
  }
  readonly populations: { readonly initial: AuditAggregatePopulation; readonly followUp: AuditAggregatePopulation }
  /** Primary verdicts over every attempt of both populations, most counted first. Arithmetic, never an opinion. */
  readonly rankedCauses: readonly { readonly verdict: AuditVerdict; readonly count: number; readonly initial: number; readonly followUp: number }[]
  readonly caveats: readonly string[]
  readonly note: string
}

export const AUDIT_COUNTS_NOTE = 'This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.'

// ---------------------------------------------------------------------------
// Small pure helpers

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Whitespace collapsed, cut with a visible ellipsis. */
export function head(text: string | null | undefined, limit: number): string | null {
  if (text === null || text === undefined) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

/** Query parameters that carry no page identity. */
const TRACKER_PARAMS = new Set(['fbclid', 'gclid', 'msclkid'])

/**
 * One URL's canonical identity: host lowercased, hash dropped, default port
 * dropped, attribution trackers removed, parameters sorted, trailing slash
 * folded. The same rules `progressFingerprints.urlFingerprint` applies
 * (that module's runtime graph is not loadable here). Null for anything the
 * URL parser refuses.
 */
export function canonicalUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  url.hash = ''
  for (const name of [...url.searchParams.keys()]) {
    if (name.startsWith('utm_') || TRACKER_PARAMS.has(name)) url.searchParams.delete(name)
  }
  url.searchParams.sort()
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString()
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i
/** The schemes the browser opens as URLs (`WEB_SCHEMES`, urlInput.ts); anything else typed with a colon is search terms. */
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'file', 'about'])
const DOMAIN_RE = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/

/**
 * The search a `navigate` argument is: the `q=` of a search URL, or the
 * plain terms the browser normalizes into one (`normalizeUrlInput`: no
 * scheme and not a domain means a search). Null for a plain page.
 */
export function searchQueryOf(raw: string): string | null {
  const input = raw.trim()
  if (input === '') return null
  const scheme = SCHEME_RE.exec(input)
  if (scheme !== null) {
    // A web scheme is a URL; any other "scheme" (`site:rmg.co.uk …`) is
    // search terms, as the browser reads it.
    if (!WEB_SCHEMES.has(scheme[1]!.toLowerCase())) return input
    try {
      const q = new URL(input).searchParams.get('q')
      return q !== null && q.trim() !== '' ? q.trim() : null
    } catch {
      return null
    }
  }
  if (/^(localhost|\d+\.\d+\.\d+\.\d+)/.test(input) || DOMAIN_RE.test(input)) return null
  return input
}

/** Lowercase, punctuation-free tokens with a light plural fold — the Search Loop rail's own tokenizer. */
export function queryTokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token !== '')
      .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)),
  )
}

/** Token-Jaccard at or above the rail's 0.45: two queries reword one intent. */
export function similarQueries(a: string, b: string): boolean {
  const left = queryTokens(a)
  const right = queryTokens(b)
  if (left.size === 0 || right.size === 0) return false
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared) >= 0.45
}

const NAVIGATED_LINE = /^navigated: url=(\S+)(?: title="(.*)")?$/m
const PAGE_HEADER_LINE = /^# (.*) — (\S+)$/m
const SIGNATURE_LINE = /^signature ([0-9a-f]+)$/m

function resultText(result: unknown): string | null {
  if (result === undefined || result === null) return null
  return isString(result) ? result : JSON.stringify(result)
}

function pageOf(text: string | null): { url: string; title: string | null } | null {
  if (text === null) return null
  const navigated = NAVIGATED_LINE.exec(text)
  if (navigated !== null) return { url: navigated[1]!, title: navigated[2] ?? null }
  const header = PAGE_HEADER_LINE.exec(text)
  return header === null ? null : { url: header[2]!, title: header[1]! }
}

function signatureOf(text: string | null): string | null {
  if (text === null) return null
  const match = SIGNATURE_LINE.exec(text)
  return match === null ? null : match[1]!
}

function noticesOf(text: string | null): string[] {
  if (text === null) return []
  const notices: string[] = []
  const budget = BUDGET_WARNING_RE.exec(text)
  if (budget !== null) notices.push(`budget_warning:${budget[1]}/${budget[2]}`)
  if (text.includes(TIME_MILESTONE_MARK)) notices.push('time_milestone')
  if (text.includes(FINALIZE_INSTRUCTION_MARK)) notices.push('finalize_instruction')
  if (text.includes(NO_PROGRESS_NOTICE_MARK)) notices.push('no_progress_notice')
  if (text.includes(SEARCH_LOOP_NUDGE_MARK)) notices.push('search_loop_nudge')
  return notices
}

/** The arguments as the digest keeps them: strings cut, structures flattened, order preserved. */
function boundedArgs(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) return {}
  const bounded: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(args)) {
    if (isString(value)) bounded[name] = head(value, DIGEST_ARG_CHARS)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) bounded[name] = value
    else bounded[name] = head(JSON.stringify(value), DIGEST_ARG_CHARS)
  }
  return bounded
}

// ---------------------------------------------------------------------------
// Reading the trace

type TraceLine = Record<string, unknown> & { kind?: unknown; at?: unknown; agentId?: unknown }
type ToolCallEvent = Extract<PipelineEvent, { type: 'tool_call' }>
type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

interface RawRound {
  readonly record: TraceLine
  readonly round: number
  readonly attempt: number
  readonly calls: { call: ToolCallEvent; result: ToolResultEvent | undefined; checkpoint: TraceLine | undefined }[]
}

function eventOf(record: TraceLine): Record<string, unknown> | null {
  return record.kind === 'pipeline_event' && isRecord(record.event) ? record.event : null
}

/** Group the turn's orchestrator records into rounds: each `llm_round` owns the tool calls that follow it until the next. */
function rawRounds(records: readonly TraceLine[]): RawRound[] {
  const rounds: RawRound[] = []
  const results = new Map<string, ToolResultEvent>()
  for (const record of records) {
    const event = eventOf(record)
    if (event !== null && event.type === 'tool_result' && isString(event.callId) && !results.has(event.callId) && record.agentId === undefined) {
      results.set(event.callId, event as unknown as ToolResultEvent)
    }
  }
  let current: RawRound | null = null
  for (const record of records) {
    if (record.agentId !== undefined) continue
    if (record.kind === 'llm_round') {
      current = { record, round: isFiniteNumber(record.round) ? record.round : rounds.length + 1, attempt: isFiniteNumber(record.attempt) ? record.attempt : 1, calls: [] }
      rounds.push(current)
      continue
    }
    if (record.kind === 'evidence_checkpoint') {
      // The trace writes tool_call, then evidence_checkpoint, then
      // tool_result: the checkpoint belongs to the latest call of its tool
      // in this round that has none yet.
      if (current === null) continue
      const owner = [...current.calls].reverse().find((entry) => entry.call.name === record.tool && entry.checkpoint === undefined)
      if (owner !== undefined) owner.checkpoint = record
      continue
    }
    const event = eventOf(record)
    if (event === null || event.type !== 'tool_call' || current === null) continue
    const call = event as unknown as ToolCallEvent
    current.calls.push({ call, result: results.get(call.callId), checkpoint: undefined })
  }
  return rounds
}

interface ProgressState {
  /** Canonical URLs the Run has put in front of itself. */
  readonly acquiredUrls: Set<string>
  /** Page states each Observation Producer has already observed. */
  readonly observed: Set<string>
  /** The page the Run is on, as the last successful result said. */
  currentUrl: string | null
  /** The Search Loop rail's streak, mirrored. */
  lastQuery: string | null
  anchor: string | null
  streak: number
}

function classifyCall(
  entry: RawRound['calls'][number],
  state: ProgressState,
  parentUrls: ReadonlySet<string> | null,
): { call: AuditCall; inherited: boolean } {
  const { call, result, checkpoint } = entry
  const text = result === undefined ? null : result.ok ? resultText(result.result) : (result.error ?? null)
  // A Bookkeeping tool's error is a rejected Evidence Checkpoint — counted
  // beside the round, not a refusal of the round; a `Not executed —` answer
  // is a refusal whatever the tool.
  const refused = result !== undefined && ((!result.ok && !BOOKKEEPING_TOOLS.has(call.name)) || (text !== null && text.startsWith(NOT_EXECUTED_PREFIX)))
  const page = result !== undefined && result.ok ? pageOf(text) : null
  const signature = result !== undefined && result.ok ? signatureOf(text) : null
  const wall = text === null ? null : parseBlockerMarker(text)
  const notices = noticesOf(text)
  const checkpointVerdict =
    checkpoint !== undefined && isString(checkpoint.outcome)
      ? { accepted: checkpoint.outcome === 'accepted', outcome: head(checkpoint.outcome, 160)! }
      : BOOKKEEPING_TOOLS.has(call.name) && call.name !== 'report_run_plan' && result !== undefined
        ? { accepted: result.ok, outcome: result.ok ? 'accepted' : (head(result.error ?? 'rejected', 160) ?? 'rejected') }
        : null

  const base = {
    name: call.name,
    args: boundedArgs(call.args),
    ok: result === undefined ? null : result.ok,
    refused,
    resultHead: head(text, DIGEST_RESULT_HEAD_CHARS),
    url: page?.url ?? (call.name === 'navigate' ? null : state.currentUrl),
    title: page?.title ?? null,
    signature,
    wall: wall === null ? null : `${wall.signal} ${wall.host}`,
    checkpoint: checkpointVerdict,
    notices,
  }

  // The search streak, as the rail keeps it: reads observe without
  // resetting, a successful escape resets, a refused call changes nothing.
  let search: AuditCall['search'] = null
  if (call.name === 'navigate' && !refused) {
    const query = searchQueryOf(isString(call.args.url) ? call.args.url : '')
    if (query !== null) {
      const continues = (state.lastQuery !== null && similarQueries(query, state.lastQuery)) || (state.anchor !== null && similarQueries(query, state.anchor))
      state.streak = continues ? state.streak + 1 : 1
      state.anchor = continues ? state.anchor : query
      state.lastQuery = query
      search = { query: head(query, 120)!, streak: state.streak }
    } else {
      state.lastQuery = null
      state.anchor = null
      state.streak = 0
    }
  } else if (call.name !== 'read_page' && call.name !== 'navigate' && !refused && result !== undefined) {
    state.lastQuery = null
    state.anchor = null
    state.streak = 0
  }

  // Collection and Bookkeeping make no Progress claim; everything else is
  // Acquisition, the catalog's own tools by flag and any other tool as a
  // requested state change.
  if (refused || result === undefined || COLLECTION_TOOLS.has(call.name) || BOOKKEEPING_TOOLS.has(call.name)) {
    return { call: { ...base, search, progress: null }, inherited: false }
  }

  const landedCanonical = page === null ? null : canonicalUrl(page.url)
  const stateKey = `${landedCanonical ?? state.currentUrl ?? ''}|${signature ?? ''}`
  let inherited = false
  let progress: { made: boolean; reason: string }
  const noProgressNotice = notices.includes('no_progress_notice')
  switch (call.name) {
    case 'navigate': {
      if (landedCanonical !== null && parentUrls !== null && parentUrls.has(landedCanonical)) {
        inherited = true
        progress = { made: false, reason: 'a re-acquisition of a page the initial attempt already checkpointed (inherited)' }
      } else if (landedCanonical !== null && state.acquiredUrls.has(landedCanonical)) {
        progress = { made: false, reason: 'a navigate to a URL this Run already acquired' }
      } else if (search !== null && search.streak >= SEARCH_STREAK_WITHOUT_PROGRESS) {
        progress = { made: false, reason: `a search that rewords the one before it (streak ${search.streak})` }
      } else if (noProgressNotice) {
        progress = { made: false, reason: 'the app’s own no-progress Notice rode the result' }
      } else {
        progress = { made: true, reason: 'the settled page state moved to a page this Run had not acquired' }
      }
      break
    }
    case 'read_page': {
      const key = `page_read|${stateKey}`
      if (state.observed.has(key)) progress = { made: false, reason: 'a repeat read of a page state already read' }
      else progress = { made: true, reason: 'the first read of this page state' }
      state.observed.add(key)
      break
    }
    case 'look':
    case 'ground_visual': {
      const question = isString(call.args.question) ? call.args.question.trim().toLowerCase() : ''
      const region = isString(call.args.region) ? call.args.region : ''
      const key = `look|${stateKey}|${question}|${region}`
      if (state.observed.has(key)) progress = { made: false, reason: 'a repeat Look at a page state already looked at with the same question' }
      else if (text !== null && text.trim().toLowerCase() === 'not legible') progress = { made: false, reason: 'the Look returned nothing legible' }
      else progress = { made: true, reason: 'the first Look at this page state with this question' }
      state.observed.add(key)
      break
    }
    case 'scroll': {
      const brought = text !== null && text.includes('new in view:')
      if (!brought && text !== null && text.includes(END_OF_PAGE_MARK)) progress = { made: false, reason: 'a scroll that answered End of Page' }
      else if (noProgressNotice) progress = { made: false, reason: 'the app’s own no-progress Notice rode the result' }
      else progress = { made: true, reason: 'the scroll brought new material into view' }
      break
    }
    case 'click':
    case 'type':
    case 'back':
    case 'go_forward': {
      if (landedCanonical !== null && parentUrls !== null && parentUrls.has(landedCanonical) && !state.acquiredUrls.has(landedCanonical)) {
        inherited = true
        progress = { made: false, reason: 'a re-acquisition of a page the initial attempt already checkpointed (inherited)' }
      } else if (noProgressNotice) {
        progress = { made: false, reason: 'the app’s own no-progress Notice rode the result' }
      } else if (text !== null && (text.includes('page signature changed') || text.includes('urlChanged=true') || text.includes('after page change'))) {
        progress = { made: true, reason: 'the settled page state moved' }
      } else if (call.name === 'type' && text !== null && /^typed \[\d+\]: (?:value|selected)=/.test(text)) {
        // The controller's two typed outcomes (createCdpBrowserController.ts):
        // text entered into a field, or an option selected in a <select>.
        progress = { made: true, reason: 'a requested state change (text entered or an option selected)' }
      } else if (text !== null && text.includes('urlChanged=false') && !text.includes('page signature changed')) {
        progress = { made: false, reason: 'the action changed neither the URL nor the page signature' }
      } else if (page !== null) {
        progress = { made: true, reason: 'the settled page state moved' }
      } else {
        progress = { made: false, reason: 'the result reports no page movement' }
      }
      break
    }
    case 'spawn_agent':
      progress = { made: true, reason: 'delegated a Subagent' }
      break
    default:
      progress = noProgressNotice ? { made: false, reason: 'the app’s own no-progress Notice rode the result' } : { made: true, reason: 'a requested state change' }
  }

  if (landedCanonical !== null) {
    state.acquiredUrls.add(landedCanonical)
    state.currentUrl = landedCanonical
  }
  if (signature !== null) state.observed.add(`action_outcome|${landedCanonical ?? state.currentUrl ?? ''}|${signature}`)
  return { call: { ...base, search, progress }, inherited }
}

/** The perf `llm` span nearest each round's stamp, each span used once. */
function joinLatencies(rounds: readonly RawRound[], perfRecords: readonly PerfSpanRecord[]): Map<RawRound, number> {
  const spans = perfRecords.filter((record) => record.stage === 'llm' && isFiniteNumber(record.at) && isFiniteNumber(record.durMs))
  const used = new Set<PerfSpanRecord>()
  const joined = new Map<RawRound, number>()
  for (const round of rounds) {
    const at = round.record.at
    if (!isFiniteNumber(at)) continue
    let best: PerfSpanRecord | null = null
    for (const span of spans) {
      if (used.has(span)) continue
      const distance = Math.abs(span.at - at)
      if (distance <= LATENCY_JOIN_TOLERANCE_MS && (best === null || distance < Math.abs(best.at - at))) best = span
    }
    if (best !== null) {
      used.add(best)
      joined.set(round, Math.round(best.durMs))
    }
  }
  return joined
}

function emptyCounts(): Record<RoundKind, number> {
  return { acquisition_with_progress: 0, acquisition_without_progress: 0, collection: 0, bookkeeping: 0, failed_round: 0, finalization: 0 }
}

function emptyVerdictCounts(): Record<AuditVerdict, number> {
  return { rounds_wasted: 0, tier_too_small_or_never_escalated: 0, budget_too_small_for_the_hunt: 0, stopped_early: 0, failed_rounds: 0 }
}

function sharesOf(counts: Readonly<Record<RoundKind, number>>, budgeted: number, all: number): Record<RoundKind, number | null> {
  const share = (count: number, over: number): number | null => (over === 0 ? null : Math.round((count / over) * 1000) / 1000)
  return {
    acquisition_with_progress: share(counts.acquisition_with_progress, budgeted),
    acquisition_without_progress: share(counts.acquisition_without_progress, budgeted),
    collection: share(counts.collection, budgeted),
    bookkeeping: share(counts.bookkeeping, budgeted),
    failed_round: share(counts.failed_round, budgeted),
    finalization: share(counts.finalization, all),
  }
}

/** The canonical URLs an attempt's accepted Evidence Checkpoints cite — what a follow-up would inherit. */
export function checkpointedUrlsOf(traceRecords: readonly TraceRecord[]): Set<string> {
  const urls = new Set<string>()
  for (const raw of traceRecords as unknown as readonly TraceLine[]) {
    if (raw.kind !== 'evidence_checkpoint' || raw.outcome !== 'accepted' || !isRecord(raw.args)) continue
    const source = raw.args.source_url
    const canonical = isString(source) ? canonicalUrl(source) : null
    if (canonical !== null) urls.add(canonical)
  }
  return urls
}

/**
 * Classify one attempt's rounds. Pure: the same records give the same
 * labels, digest and hash every time.
 */
export function classifyAttempt(input: AuditTraceInput): AuditMechanical {
  const { attempt } = input
  const records = input.traceRecords as unknown as readonly TraceLine[]
  const raw = rawRounds(records)
  const latencies = joinLatencies(raw, input.perfRecords)

  const plans: AuditPlan[] = []
  let terminal: AuditMechanical['terminal'] = null
  for (const record of records) {
    if (record.agentId !== undefined) continue
    const event = eventOf(record)
    if (event === null) continue
    if (event.type === 'run_plan' && isString(event.effortTier)) plans.push({ tier: event.effortTier as EffortTier, source: isString(event.source) ? event.source : 'unknown' })
    if (event.type === 'done') {
      terminal = {
        outcome: isString(event.outcome) ? event.outcome : null,
        resolution: isString(event.resolution) ? event.resolution : null,
        finalizationCause: isString(event.finalizationCause) ? event.finalizationCause : null,
      }
    }
  }
  const tier = plans.at(-1)?.tier ?? null
  const tierRung = tier === null ? null : TIER_REASONING_EFFORT[tier]
  const rungRuleApplies = input.reasoningEffortOverride === null && tierRung !== null && tierRung !== FINALIZATION_REASONING_EFFORT

  // Pass one: calls and Progress, in trace order.
  const state: ProgressState = { acquiredUrls: new Set(), observed: new Set(), currentUrl: null, lastQuery: null, anchor: null, streak: 0 }
  const classified = raw.map((round) => {
    const calls = round.calls.map((entry) => classifyCall(entry, state, input.parentCheckpointedUrls))
    return { round, calls: calls.map((item) => item.call), inherited: calls.some((item) => item.inherited) }
  })

  // Pass two: where Finalization was entered. Everything from that round on
  // is Finalization; the marks are the app's own.
  let finalizationFrom = classified.length
  classified.forEach(({ round, calls }, index) => {
    if (index >= finalizationFrom) return
    const outcome = isString(round.record.outcome) ? round.record.outcome : 'completed'
    const carriesInstruction = calls.some((call) => call.notices.includes('finalize_instruction'))
    const atFinalizationRung = rungRuleApplies && round.record.reasoningEffort === FINALIZATION_REASONING_EFFORT
    const isReservedAnswer = index === classified.length - 1 && calls.length === 0 && terminal !== null && terminal.finalizationCause !== null
    if (outcome === 'allowance' || carriesInstruction || atFinalizationRung || isReservedAnswer) finalizationFrom = index
  })

  const rounds: AuditRound[] = classified.map(({ round, calls, inherited }, index) => {
    const record = round.record
    const outcome = isString(record.outcome) ? record.outcome : 'completed'
    const successful = calls.filter((call) => !call.refused && call.ok !== null)
    const acquisitions = successful.filter((call) => ACQUISITION_TOOLS.has(call.name) || (!COLLECTION_TOOLS.has(call.name) && !BOOKKEEPING_TOOLS.has(call.name)))
    const rejected = calls.filter((call) => call.checkpoint !== null && !call.checkpoint.accepted).length
    const accepted = calls.filter((call) => call.checkpoint !== null && call.checkpoint.accepted).length
    const isLast = index === classified.length - 1

    let kind: RoundKind
    let reason: string
    if (index >= finalizationFrom) {
      kind = 'finalization'
      reason =
        outcome === 'allowance'
          ? 'a Finalization round cut by the Finalization Allowance'
          : outcome !== 'completed'
            ? `a Finalization round that ended ${outcome}`
            : calls.length > 0 && successful.length === 0
              ? `a Finalization round whose calls were refused — the tools are closed (${calls.map((call) => call.name).join(', ')})`
              : calls.length > 0
                ? `the bookkeeping round (${calls.map((call) => call.name).join(', ')})`
                : isLast
                  ? 'the reserved Answer'
                  : 'a Finalization round'
    } else if (outcome !== 'completed') {
      kind = 'failed_round'
      reason = outcome === 'deadline' ? 'cut by the active-work deadline' : outcome === 'timeout' ? 'the client’s request timeout ended the round' : `the round ended ${outcome}`
    } else if (calls.length === 0) {
      kind = 'failed_round'
      reason = isLast ? 'the last round replied with no tool call and no Answer reached the tape' : 'the round completed with no tool call and no Answer'
    } else if (successful.length === 0) {
      kind = 'failed_round'
      reason = `every call was refused (${calls.map((call) => call.name).join(', ')})`
    } else if (acquisitions.length > 0) {
      const made = acquisitions.find((call) => call.progress?.made === true)
      if (made !== undefined) {
        kind = 'acquisition_with_progress'
        reason = `${made.name}: ${made.progress!.reason}`
      } else {
        const first = acquisitions[0]!
        kind = 'acquisition_without_progress'
        reason = `${first.name}: ${first.progress?.reason ?? 'no Progress'}`
      }
    } else if (successful.some((call) => COLLECTION_TOOLS.has(call.name))) {
      kind = 'collection'
      reason = 'read a finished Subagent Report'
    } else {
      kind = 'bookkeeping'
      reason = rejected > 0 ? `${calls.map((call) => call.name).join(', ')} — ${rejected} rejected Evidence Checkpoint(s)` : calls.map((call) => call.name).join(', ')
    }

    const usage = isRecord(record.usage) ? record.usage : null
    const request = isRecord(record.request) ? record.request : null
    return {
      round: index + 1,
      llmRound: round.round,
      attempt: round.attempt,
      at: isFiniteNumber(record.at) ? record.at : 0,
      outcome,
      effort: isString(record.reasoningEffort) ? record.reasoningEffort : null,
      model: isString(record.model) ? record.model : null,
      latencyMs: latencies.get(round) ?? null,
      promptTokens: usage !== null && isFiniteNumber(usage.promptTokens) ? usage.promptTokens : null,
      completionTokens: usage !== null && isFiniteNumber(usage.completionTokens) ? usage.completionTokens : null,
      requestChars: request !== null && isFiniteNumber(request.chars) ? request.chars : null,
      toolResultsInRequest: request !== null && isFiniteNumber(request.toolResults) ? request.toolResults : null,
      reasoningChars: isFiniteNumber(record.reasoningChars) ? record.reasoningChars : 0,
      calls,
      kind,
      reason,
      tags: {
        inherited,
        rejectedCheckpoints: rejected,
        acceptedCheckpoints: accepted,
        refusedCalls: calls.filter((call) => call.refused).length,
        wall: calls.some((call) => call.wall !== null),
        search: calls.some((call) => call.search !== null),
      },
    }
  })

  const counts = emptyCounts()
  for (const round of rounds) counts[round.kind] += 1
  const budgetedRounds = rounds.filter((round) => round.kind !== 'finalization')
  const toolRoundsUsed = budgetedRounds.filter((round) => round.calls.length > 0).length
  let lastBudgetNotice: AuditMechanical['lastBudgetNotice'] = null
  for (const round of rounds) {
    for (const call of round.calls) {
      for (const notice of call.notices) {
        const match = /^budget_warning:(\d+)\/(\d+)$/.exec(notice)
        if (match !== null) lastBudgetNotice = { remaining: Number(match[1]), budget: Number(match[2]) }
      }
    }
  }

  const joined = rounds.filter((round) => round.latencyMs !== null)
  const subagentRounds = records.filter((record) => record.kind === 'llm_round' && record.agentId !== undefined)
  const byStop: Record<string, number> = {}
  const stops = new Map<string, Record<string, unknown>>()
  for (const record of records) {
    const event = eventOf(record)
    if (event !== null && event.type === 'subagent_finalized' && isString(event.agentId)) stops.set(event.agentId, event)
  }
  for (const event of stops.values()) {
    const stop = isString(event.cause) ? event.cause : event.status === 'failed' ? 'failed' : event.status === 'cancelled' ? 'cancelled' : 'uncaused'
    byStop[stop] = (byStop[stop] ?? 0) + 1
  }
  const agents = new Set([...subagentRounds.map((record) => String(record.agentId)), ...stops.keys()])

  const checksTotal = input.task === null ? null : input.task.checks.length
  const checksNotReached =
    input.task === null
      ? null
      : input.grade === null || input.grade.status === 'pending'
        ? input.task.checks.map((check) => check.checkId)
        : input.grade.checks.filter((check) => !check.satisfied).map((check) => check.checkId)

  const disposition: AuditDisposition =
    attempt.accepted.status !== 'observed' ? 'acceptance_unconfirmed' : attempt.finalAnswer.status === 'observed' ? 'answered' : 'no_answer'

  const withoutHash: Omit<AuditMechanical, 'digestHash'> = {
    attemptId: attempt.attemptId,
    huntId: attempt.huntId,
    stepId: attempt.stepId,
    relation: attempt.relation,
    parentAttemptId: attempt.parentAttemptId ?? null,
    captureId: input.captureId,
    turnId: attempt.accepted.status === 'observed' ? attempt.accepted.value.turnId : null,
    disposition,
    terminal,
    stopReason: attempt.stop.reason,
    runDurationMs: attempt.metrics.runDurationMs,
    plans,
    tier,
    deadlineEscalations: plans.filter((plan) => plan.source === 'deadline').length,
    toolRoundBudget: tier === null ? null : TIER_TOOL_ROUND_BUDGETS[tier],
    toolRoundsUsed,
    lastBudgetNotice,
    rounds,
    orchestratorRounds: rounds.length,
    budgetedRounds: budgetedRounds.length,
    counts,
    shares: sharesOf(counts, budgetedRounds.length, rounds.length),
    acceptedCheckpoints: rounds.reduce((total, round) => total + round.tags.acceptedCheckpoints, 0),
    rejectedCheckpoints: rounds.reduce((total, round) => total + round.tags.rejectedCheckpoints, 0),
    inheritedRounds: rounds.filter((round) => round.tags.inherited).length,
    mechanicalSearchRounds: rounds.filter((round) => round.kind === 'acquisition_without_progress' && round.reason.includes('rewords the one before it')).length,
    walledRounds: rounds.filter((round) => round.tags.wall).length,
    latency: {
      llmMs: joined.length === 0 ? null : joined.reduce((total, round) => total + round.latencyMs!, 0),
      joined: joined.length,
      unjoined: rounds.length - joined.length,
    },
    usage: {
      promptTokens: rounds.reduce((total, round) => total + (round.promptTokens ?? 0), 0),
      completionTokens: rounds.reduce((total, round) => total + (round.completionTokens ?? 0), 0),
      roundsWithUsage: rounds.filter((round) => round.promptTokens !== null).length,
    },
    subagent: { rounds: subagentRounds.length, agents: agents.size, byStop },
    grade: input.grade === null ? null : { status: input.grade.status, reviewer: input.grade.reviewer },
    checksNotReached,
    checksTotal,
  }
  return { ...withoutHash, digestHash: sha256(JSON.stringify(digestPayloadOf(withoutHash))) }
}

/** What the hash covers: the digest the reviewer is shown, and nothing about who reviewed it. */
function digestPayloadOf(mechanical: Omit<AuditMechanical, 'digestHash'>): unknown {
  return {
    attemptId: mechanical.attemptId,
    tier: mechanical.tier,
    plans: mechanical.plans,
    toolRoundBudget: mechanical.toolRoundBudget,
    terminal: mechanical.terminal,
    rounds: mechanical.rounds,
    counts: mechanical.counts,
    shares: mechanical.shares,
    checksNotReached: mechanical.checksNotReached,
    subagent: mechanical.subagent,
  }
}

// ---------------------------------------------------------------------------
// The reviewer's output

/** The JSON schema the reviewer's structured output must satisfy (`claude -p --json-schema`). */
export const JUDGEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['searchLoops', 'offKey', 'overrules', 'stoppedEarly', 'verdict', 'flags'],
  properties: {
    searchLoops: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['rounds', 'reason'], properties: { rounds: { type: 'array', items: { type: 'integer' } }, reason: { type: 'string' } } },
    },
    offKey: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['round', 'url', 'reason'],
        properties: { round: { type: 'integer' }, url: { type: ['string', 'null'] }, reason: { type: 'string' } },
      },
    },
    overrules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['round', 'kind', 'reason'],
        properties: { round: { type: 'integer' }, kind: { type: 'string', enum: [...ROUND_KINDS] }, reason: { type: 'string' } },
      },
    },
    stoppedEarly: { type: 'object', additionalProperties: false, required: ['value', 'reason'], properties: { value: { type: 'boolean' }, reason: { type: 'string' } } },
    verdict: {
      type: 'object',
      additionalProperties: false,
      required: ['primary', 'primaryReason', 'secondary', 'secondaryReason'],
      properties: {
        primary: { type: 'string', enum: [...AUDIT_VERDICTS] },
        primaryReason: { type: 'string' },
        secondary: { type: ['string', 'null'], enum: [...AUDIT_VERDICTS, null] },
        secondaryReason: { type: ['string', 'null'] },
      },
    },
    flags: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['round', 'question'], properties: { round: { type: ['integer', 'null'] }, question: { type: 'string' } } },
    },
  },
} as const

/** Validate a reviewer's output against the digest it was given. Names rounds and fields, never key text. */
export function validateJudgement(raw: unknown, mechanical: AuditMechanical): Validation<AuditJudgement> {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['the output is not a JSON object'] }
  const roundNumbers = new Set(mechanical.rounds.map((round) => round.round))
  const kindOf = new Map(mechanical.rounds.map((round) => [round.round, round.kind]))
  const roundExists = (round: unknown, where: string): round is number => {
    if (!Number.isInteger(round) || !roundNumbers.has(round as number)) {
      errors.push(`${where} names round ${String(round)}, which is not a round of this attempt`)
      return false
    }
    return true
  }
  const list = (value: unknown, where: string): Record<string, unknown>[] => {
    if (!Array.isArray(value)) {
      errors.push(`${where} is not a list`)
      return []
    }
    return value.filter((item): item is Record<string, unknown> => {
      if (isRecord(item)) return true
      errors.push(`${where} holds a non-object entry`)
      return false
    })
  }

  const overrules: { round: number; kind: RoundKind; reason: string }[] = []
  for (const item of list(raw.overrules, 'overrules')) {
    if (!roundExists(item.round, 'overrules')) continue
    if (!isString(item.kind) || !(ROUND_KINDS as readonly string[]).includes(item.kind)) {
      errors.push(`overrules: round ${item.round} is given a kind outside the taxonomy`)
      continue
    }
    if (kindOf.get(item.round) === item.kind) {
      errors.push(`overrules: round ${item.round} is already ${item.kind} — an overrule must change the label`)
      continue
    }
    // Finalization is read from the app's own marks, not judged: a round is
    // in Finalization or it is not, whatever its calls did.
    if (kindOf.get(item.round) === 'finalization' || item.kind === 'finalization') {
      errors.push(`overrules: round ${item.round} — Finalization is mechanical and cannot be overruled into or out of`)
      continue
    }
    if (!isString(item.reason) || item.reason.trim() === '') errors.push(`overrules: round ${item.round} has no stated reason`)
    overrules.push({ round: item.round, kind: item.kind as RoundKind, reason: isString(item.reason) ? item.reason : '' })
  }
  const effectiveKind = (round: number): RoundKind => overrules.find((item) => item.round === round)?.kind ?? kindOf.get(round)!

  const searchLoops: { rounds: number[]; reason: string }[] = []
  for (const item of list(raw.searchLoops, 'searchLoops')) {
    if (!Array.isArray(item.rounds) || item.rounds.length === 0) {
      errors.push('searchLoops: an entry names no rounds')
      continue
    }
    const rounds = item.rounds.filter((round: unknown) => roundExists(round, 'searchLoops')) as number[]
    if (!isString(item.reason) || item.reason.trim() === '') errors.push('searchLoops: an entry has no stated reason')
    searchLoops.push({ rounds, reason: isString(item.reason) ? item.reason : '' })
  }

  const offKey: { round: number; url: string | null; reason: string }[] = []
  for (const item of list(raw.offKey, 'offKey')) {
    if (!roundExists(item.round, 'offKey')) continue
    const kind = effectiveKind(item.round)
    if (kind !== 'acquisition_with_progress' && kind !== 'acquisition_without_progress') {
      errors.push(`offKey: round ${item.round} is ${kind}, and Off-key is a judgement over Acquisition rounds only`)
      continue
    }
    if (!isString(item.reason) || item.reason.trim() === '') errors.push(`offKey: round ${item.round} has no stated reason`)
    offKey.push({ round: item.round, url: isString(item.url) ? item.url : null, reason: isString(item.reason) ? item.reason : '' })
  }

  const stopped = isRecord(raw.stoppedEarly) ? raw.stoppedEarly : null
  if (stopped === null || typeof stopped.value !== 'boolean' || !isString(stopped.reason)) errors.push('stoppedEarly must carry a boolean value and a reason')

  const verdict = isRecord(raw.verdict) ? raw.verdict : null
  if (verdict === null) errors.push('verdict is missing')
  else {
    if (!isString(verdict.primary) || !(AUDIT_VERDICTS as readonly string[]).includes(verdict.primary)) errors.push('verdict.primary is outside the closed set')
    if (!isString(verdict.primaryReason) || verdict.primaryReason.trim() === '') errors.push('verdict.primaryReason is missing')
    if (verdict.secondary !== null && (!isString(verdict.secondary) || !(AUDIT_VERDICTS as readonly string[]).includes(verdict.secondary))) errors.push('verdict.secondary is outside the closed set')
    if (verdict.secondary !== null && verdict.secondary === verdict.primary) errors.push('verdict.secondary repeats the primary — a secondary verdict must differ')
    if (verdict.secondary !== null && (!isString(verdict.secondaryReason) || verdict.secondaryReason.trim() === '')) errors.push('verdict.secondaryReason is missing for the secondary verdict')
  }

  const flags: { round: number | null; question: string }[] = []
  for (const item of list(raw.flags, 'flags')) {
    if (item.round !== null && !roundExists(item.round, 'flags')) continue
    if (!isString(item.question) || item.question.trim() === '') {
      errors.push('flags: an entry has no question')
      continue
    }
    flags.push({ round: item.round === null ? null : (item.round as number), question: item.question })
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      searchLoops,
      offKey,
      overrules,
      stoppedEarly: { value: stopped!.value as boolean, reason: stopped!.reason as string },
      verdict: {
        primary: verdict!.primary as AuditVerdict,
        primaryReason: verdict!.primaryReason as string,
        secondary: (verdict!.secondary as AuditVerdict | null) ?? null,
        secondaryReason: verdict!.secondary === null ? null : (verdict!.secondaryReason as string),
      },
      flags,
    },
  }
}

const normalizeForLeak = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** Key strings shorter than this are too generic to test for. */
const LEAK_MIN_CHARS = 24
const LEAK_SHINGLE_WORDS = 8

/**
 * Where an output carries the key: any key string, or any run of eight
 * consecutive words of one, reproduced. Returns descriptions that name the
 * key string by index and kind — never the string — so the finding itself
 * can be committed.
 */
export function keyLeaks(output: string, keyTexts: readonly { readonly label: string; readonly text: string }[]): string[] {
  const haystack = ` ${normalizeForLeak(output)} `
  const found: string[] = []
  keyTexts.forEach((entry, index) => {
    const needle = normalizeForLeak(entry.text)
    if (needle.length < LEAK_MIN_CHARS) return
    if (haystack.includes(` ${needle} `)) {
      found.push(`${entry.label} #${index + 1} reproduced whole`)
      return
    }
    const words = needle.split(' ')
    for (let start = 0; start + LEAK_SHINGLE_WORDS <= words.length; start += 1) {
      const shingle = words.slice(start, start + LEAK_SHINGLE_WORDS).join(' ')
      if (haystack.includes(` ${shingle} `)) {
        found.push(`${entry.label} #${index + 1}: ${LEAK_SHINGLE_WORDS} consecutive words reproduced`)
        return
      }
    }
  })
  return found
}

// ---------------------------------------------------------------------------
// Counting

export function countsAfterOverrulesOf(mechanical: AuditMechanical, judgement: AuditJudgement | null): Record<RoundKind, number> {
  const counts = emptyCounts()
  for (const round of mechanical.rounds) {
    const overrule = judgement?.overrules.find((item) => item.round === round.round)
    counts[overrule?.kind ?? round.kind] += 1
  }
  return counts
}

function addCounts<K extends string>(into: Record<K, number>, from: Readonly<Record<K, number>>): void {
  for (const key of Object.keys(from) as K[]) into[key] += from[key]
}

export function populationOf(label: string, attempts: readonly AuditAttempt[]): AuditPopulation {
  const counts = emptyCounts()
  const after = emptyCounts()
  const primary = emptyVerdictCounts()
  const secondary = emptyVerdictCounts()
  const causes: Record<string, number> = {}
  let rounds = 0
  let budgeted = 0
  let toolRoundsUsed = 0
  let judged = 0
  let offKey = 0
  let searchLoop = 0
  let mechanicalSearch = 0
  let inherited = 0
  let rejected = 0
  let walled = 0
  let subagentRounds = 0
  let stoppedEarly = 0
  let overrules = 0
  let flags = 0
  let atBudget = 0
  for (const attempt of attempts) {
    const { mechanical } = attempt
    addCounts(counts, mechanical.counts)
    addCounts(after, attempt.countsAfterOverrules)
    rounds += mechanical.orchestratorRounds
    budgeted += mechanical.budgetedRounds
    toolRoundsUsed += mechanical.toolRoundsUsed
    mechanicalSearch += mechanical.mechanicalSearchRounds
    inherited += mechanical.inheritedRounds
    rejected += mechanical.rejectedCheckpoints
    walled += mechanical.walledRounds
    subagentRounds += mechanical.subagent.rounds
    if (mechanical.toolRoundBudget !== null && mechanical.toolRoundsUsed >= mechanical.toolRoundBudget) atBudget += 1
    const cause = mechanical.terminal?.finalizationCause ?? 'none'
    causes[cause] = (causes[cause] ?? 0) + 1
    const judgement = attempt.review?.judgement ?? null
    if (judgement === null) continue
    judged += 1
    primary[judgement.verdict.primary] += 1
    if (judgement.verdict.secondary !== null) secondary[judgement.verdict.secondary] += 1
    offKey += judgement.offKey.length
    searchLoop += new Set(judgement.searchLoops.flatMap((loop) => loop.rounds)).size
    if (judgement.stoppedEarly.value) stoppedEarly += 1
    overrules += judgement.overrules.length
    flags += judgement.flags.length
  }
  return {
    label,
    attempts: attempts.length,
    judged,
    rounds,
    budgetedRounds: budgeted,
    toolRoundsUsed,
    counts,
    countsAfterOverrules: after,
    shares: sharesOf(counts, budgeted, rounds),
    verdictsPrimary: primary,
    verdictsSecondary: secondary,
    offKeyRounds: offKey,
    searchLoopRounds: searchLoop,
    mechanicalSearchRounds: mechanicalSearch,
    inheritedRounds: inherited,
    rejectedCheckpoints: rejected,
    walledRounds: walled,
    subagentRounds,
    stoppedEarly,
    overrules,
    flags,
    finalizationCauses: Object.fromEntries(Object.entries(causes).sort(([left], [right]) => left.localeCompare(right))),
    attemptsAtBudget: atBudget,
  }
}

export function buildAuditSet(provenance: AuditProvenance, attempts: readonly AuditAttempt[], caveats: readonly string[]): AuditSetOutput {
  return {
    kind: LIVE_AUDIT_KIND,
    auditVersion: LIVE_AUDIT_VERSION,
    provenance,
    attempts,
    populations: {
      initial: populationOf('initial', attempts.filter((attempt) => attempt.mechanical.relation === 'initial')),
      followUp: populationOf('follow_up', attempts.filter((attempt) => attempt.mechanical.relation === 'revised_objective')),
    },
    caveats,
    note: AUDIT_COUNTS_NOTE,
  }
}

/** Which provenance fields every set of one audit must share, and how each reads. */
const SHARED_FIELDS: readonly { readonly name: string; readonly of: (provenance: AuditProvenance) => string }[] = [
  { name: 'key version', of: (provenance) => provenance.keyVersion },
  { name: 'key manifest digest', of: (provenance) => provenance.keyManifestDigest },
  { name: 'routing', of: (provenance) => provenance.roles.join('; ') },
  { name: 'grades reviewer', of: (provenance) => provenance.gradesReviewers.join('; ') },
  { name: 'study', of: (provenance) => provenance.study },
  { name: 'protocol version', of: (provenance) => provenance.protocolVersion },
  { name: 'mode', of: (provenance) => provenance.mode },
  { name: 'adblock', of: (provenance) => provenance.adblock },
  { name: 'reasoning-effort override', of: (provenance) => provenance.reasoningEffortOverride ?? 'none' },
  { name: 'effort overrides', of: (provenance) => provenance.effortOverrides.join(', ') || 'none' },
  { name: 'prompt versions', of: (provenance) => provenance.promptVersions.join(', ') },
  { name: 'audit reviewer model', of: (provenance) => provenance.reviewerModel },
  { name: 'audit reviewer effort', of: (provenance) => provenance.reviewerEffort },
  { name: 'audit prompt version', of: (provenance) => provenance.reviewerPromptVersion },
]

function aggregatePopulation(label: string, relation: AttemptRelation, sets: readonly AuditSetOutput[], pick: (set: AuditSetOutput) => AuditPopulation): AuditAggregatePopulation {
  const attempts = sets.flatMap((set) => set.attempts.filter((attempt) => attempt.mechanical.relation === relation))
  return { ...populationOf(label, attempts), perSet: sets.map((set) => ({ setId: set.provenance.setId, population: pick(set) })) }
}

/** Read N per-set audits together. Refuses sets whose shared provenance differs; counts the rest. */
export function buildAuditAggregate(sets: readonly AuditSetOutput[], generatedAt: string): Validation<AuditAggregate> {
  if (sets.length < 2) return { ok: false, errors: [`${sets.length} set(s) named; an aggregate needs at least two — for one set, read its audit`] }
  const errors: string[] = []
  const ids = new Map<string, number>()
  for (const set of sets) ids.set(set.provenance.setId, (ids.get(set.provenance.setId) ?? 0) + 1)
  for (const [setId, count] of ids) if (count > 1) errors.push(`capture set ${setId} is named ${count} times: one set counts once`)
  if (errors.length > 0) return { ok: false, errors }
  const ordered = [...sets].sort((left, right) => Date.parse(left.provenance.createdAt) - Date.parse(right.provenance.createdAt))
  for (const field of SHARED_FIELDS) {
    const values = ordered.map((set) => field.of(set.provenance))
    if (new Set(values).size > 1) errors.push(`${field.name} differs: ${ordered.map((set, index) => `${set.provenance.setId}=${values[index]}`).join(', ')}`)
  }
  if (errors.length > 0) return { ok: false, errors }

  const shared = ordered[0]!.provenance
  const initial = aggregatePopulation('initial', 'initial', ordered, (set) => set.populations.initial)
  const followUp = aggregatePopulation('follow_up', 'revised_objective', ordered, (set) => set.populations.followUp)
  const rankedCauses = AUDIT_VERDICTS.map((verdict) => ({
    verdict,
    count: initial.verdictsPrimary[verdict] + followUp.verdictsPrimary[verdict],
    initial: initial.verdictsPrimary[verdict],
    followUp: followUp.verdictsPrimary[verdict],
  })).sort((left, right) => right.count - left.count || left.verdict.localeCompare(right.verdict))
  return {
    ok: true,
    value: {
      kind: LIVE_AUDIT_AGGREGATE_KIND,
      auditVersion: LIVE_AUDIT_VERSION,
      provenance: {
        shared: {
          study: shared.study,
          protocolVersion: shared.protocolVersion,
          mode: shared.mode,
          promptVersions: shared.promptVersions,
          keyVersion: shared.keyVersion,
          keyManifestDigest: shared.keyManifestDigest,
          gradesReviewers: shared.gradesReviewers,
          roles: shared.roles,
          reasoningEffortOverride: shared.reasoningEffortOverride,
          effortOverrides: shared.effortOverrides,
          adblock: shared.adblock,
          reviewerModel: shared.reviewerModel,
          reviewerEffort: shared.reviewerEffort,
          reviewerPromptVersion: shared.reviewerPromptVersion,
        },
        sets: ordered.map((set) => ({
          setId: set.provenance.setId,
          state: set.provenance.state,
          createdAt: set.provenance.createdAt,
          commits: set.provenance.commits,
          dirtyTree: set.provenance.dirtyTree,
          gradesRevision: set.provenance.gradesRevision,
          auditCommit: set.provenance.auditCommit,
          auditDirtyTree: set.provenance.auditDirtyTree,
          generatedAt: set.provenance.generatedAt,
        })),
        generatedAt,
      },
      populations: { initial, followUp },
      rankedCauses,
      caveats: ordered.flatMap((set) => set.caveats.map((caveat) => `${set.provenance.setId}: ${caveat}`)),
      note: AUDIT_COUNTS_NOTE,
    },
  }
}

// ---------------------------------------------------------------------------
// Markdown. The same facts as the JSON; no key text can appear because none
// reaches this module, and the reviewer's prose was checked before it did.

const KIND_LABELS: Readonly<Record<RoundKind, string>> = {
  acquisition_with_progress: 'Acquisition with Progress',
  acquisition_without_progress: 'Acquisition without Progress',
  collection: 'Collection',
  bookkeeping: 'Bookkeeping',
  failed_round: 'Failed round',
  finalization: 'Finalization',
}

const VERDICT_LABELS: Readonly<Record<AuditVerdict, string>> = {
  rounds_wasted: 'rounds wasted',
  tier_too_small_or_never_escalated: 'tier too small or never escalated',
  budget_too_small_for_the_hunt: 'budget too small for the Hunt',
  stopped_early: 'stopped early',
  failed_rounds: 'failed rounds',
}

const pct = (share: number | null): string => (share === null ? 'n/a' : `${Math.round(share * 100)}%`)
const msOf = (observation: Observed<number>): string => (observation.status === 'observed' ? `${observation.value} ms` : observation.status)

function populationTable(populations: readonly AuditPopulation[]): string[] {
  const lines = [
    '| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | ' + ROUND_KINDS.map((kind) => KIND_LABELS[kind]).join(' | ') + ' |',
    `| --- | --- | --- | --- | --- | --- | --- | ${ROUND_KINDS.map(() => '---').join(' | ')} |`,
  ]
  for (const population of populations) {
    lines.push(
      `| ${population.label} | ${population.attempts} | ${population.judged} | ${population.rounds} | ${population.budgetedRounds} | ${population.toolRoundsUsed} | ${population.attemptsAtBudget} | ` +
        ROUND_KINDS.map((kind) => `${population.counts[kind]} (${pct(population.shares[kind])})${population.countsAfterOverrules[kind] !== population.counts[kind] ? ` → ${population.countsAfterOverrules[kind]}` : ''}`).join(' | ') +
        ' |',
    )
  }
  return lines
}

function verdictTable(populations: readonly AuditPopulation[]): string[] {
  const lines = ['| verdict | ' + populations.map((population) => `${population.label} primary | ${population.label} secondary`).join(' | ') + ' |', `| --- | ${populations.map(() => '--- | ---').join(' | ')} |`]
  for (const verdict of AUDIT_VERDICTS) {
    lines.push(`| ${VERDICT_LABELS[verdict]} | ${populations.map((population) => `${population.verdictsPrimary[verdict]} | ${population.verdictsSecondary[verdict]}`).join(' | ')} |`)
  }
  return lines
}

function judgementLines(populations: readonly AuditPopulation[]): string[] {
  return populations.map(
    (population) =>
      `- ${population.label}: ${population.offKeyRounds} Off-key round(s), ${population.searchLoopRounds} Search Loop round(s) by the reviewer (${population.mechanicalSearchRounds} by the streak rule), ` +
      `${population.inheritedRounds} inherited, ${population.rejectedCheckpoints} rejected Evidence Checkpoint(s), ${population.walledRounds} walled round(s), ${population.subagentRounds} Subagent round(s), ` +
      `${population.stoppedEarly} stopped early, ${population.overrules} overrule(s), ${population.flags} flag(s); Finalization Causes: ${Object.entries(population.finalizationCauses)
        .map(([cause, count]) => `${cause} ${count}`)
        .join(', ')}`,
  )
}

function attemptSection(attempt: AuditAttempt): string[] {
  const { mechanical, review } = attempt
  const judgement = review?.judgement ?? null
  const lines: string[] = []
  lines.push(`### ${mechanical.attemptId} (${mechanical.relation})`)
  lines.push('')
  const terminal = mechanical.terminal
  lines.push(
    `- ${mechanical.disposition}; ended ${terminal === null ? 'without a terminal' : `${terminal.outcome ?? '?'}${terminal.resolution ? ` / ${terminal.resolution}` : ''}${terminal.finalizationCause ? ` (${terminal.finalizationCause})` : ''}`}; ` +
      `tier ${mechanical.tier ?? 'none'}${mechanical.deadlineEscalations > 0 ? ` (${mechanical.deadlineEscalations} Tier Escalation(s) at the deadline)` : ''}; ` +
      `${mechanical.toolRoundsUsed} of ${mechanical.toolRoundBudget ?? '?'} Tool Rounds used; ${mechanical.orchestratorRounds} orchestrator rounds, ${mechanical.counts.finalization} in Finalization; ` +
      `Run duration ${msOf(mechanical.runDurationMs)}; LLM stage ${mechanical.latency.llmMs === null ? 'unjoined' : `${mechanical.latency.llmMs} ms over ${mechanical.latency.joined} joined round(s)`}${mechanical.latency.unjoined > 0 ? ` (${mechanical.latency.unjoined} unjoined)` : ''}`,
  )
  lines.push(
    `- grade ${mechanical.grade?.status ?? 'none'}; checks not reached: ${mechanical.checksNotReached === null ? 'no task in the key' : mechanical.checksNotReached.length === 0 ? 'none' : `${mechanical.checksNotReached.join(', ')} (${mechanical.checksNotReached.length} of ${mechanical.checksTotal})`}`,
  )
  lines.push(
    `- ${mechanical.subagent.rounds} Subagent round(s) over ${mechanical.subagent.agents} Subagent(s)${Object.keys(mechanical.subagent.byStop).length > 0 ? `, stopped by ${Object.entries(mechanical.subagent.byStop).map(([stop, count]) => `${stop} ${count}`).join(', ')}` : ''}; ` +
      `${mechanical.acceptedCheckpoints} accepted and ${mechanical.rejectedCheckpoints} rejected Evidence Checkpoint(s); ${mechanical.inheritedRounds} inherited round(s); ${mechanical.walledRounds} walled round(s)`,
  )
  lines.push(`- kinds: ${ROUND_KINDS.map((kind) => `${KIND_LABELS[kind]} ${mechanical.counts[kind]} (${pct(mechanical.shares[kind])})`).join(' · ')}`)
  if (review === null) lines.push('- reviewer: not consulted')
  else if (judgement === null) lines.push(`- reviewer: no judgement — ${review.caveats.join('; ')}`)
  else {
    const { verdict } = judgement
    lines.push(`- **verdict: ${VERDICT_LABELS[verdict.primary]}** — ${verdict.primaryReason}`)
    if (verdict.secondary !== null) lines.push(`- secondary: ${VERDICT_LABELS[verdict.secondary]} — ${verdict.secondaryReason}`)
    lines.push(`- stopped early: ${judgement.stoppedEarly.value ? 'yes' : 'no'} — ${judgement.stoppedEarly.reason}`)
    for (const loop of judgement.searchLoops) lines.push(`- Search Loop over rounds ${loop.rounds.join(', ')}: ${loop.reason}`)
    for (const item of judgement.offKey) lines.push(`- Off-key round ${item.round}${item.url ? ` (${item.url})` : ''}: ${item.reason}`)
    for (const item of judgement.overrules) lines.push(`- overrule round ${item.round} → ${KIND_LABELS[item.kind]}: ${item.reason}`)
    for (const flag of judgement.flags) lines.push(`- flag${flag.round === null ? '' : ` (round ${flag.round})`}: ${flag.question}`)
    // The flags are already caveats in the JSON; here they are printed once.
    for (const caveat of review.caveats.filter((caveat) => !caveat.startsWith('flag'))) lines.push(`- caveat: ${caveat}`)
    lines.push(`- reviewer ${review.served ?? review.model} at ${review.effort}, prompt ${review.promptVersion}, digest ${review.digestHash.slice(0, 15)}…${review.costUsd === null ? '' : `, $${review.costUsd.toFixed(2)}`}`)
  }
  lines.push('')
  lines.push('| round | kind | tools | page | ms | note |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const round of mechanical.rounds) {
    const overrule = judgement?.overrules.find((item) => item.round === round.round)
    const offKey = judgement?.offKey.some((item) => item.round === round.round) ?? false
    const inLoop = judgement?.searchLoops.some((loop) => loop.rounds.includes(round.round)) ?? false
    const tools = round.calls.map((call) => `${call.name}${call.refused ? ' ✗' : ''}`).join(', ') || '—'
    const page = round.calls.map((call) => call.url).find((url) => url !== null) ?? '—'
    const markers = [round.tags.inherited ? 'inherited' : '', round.tags.wall ? 'walled' : '', offKey ? 'off-key' : '', inLoop ? 'search loop' : '', round.tags.rejectedCheckpoints > 0 ? `${round.tags.rejectedCheckpoints} rejected checkpoint` : ''].filter((marker) => marker !== '')
    const trace = round.llmRound !== round.round || round.attempt > 1 ? ` (trace ${round.llmRound}.${round.attempt})` : ''
    lines.push(
      `| ${round.round}${trace} | ${KIND_LABELS[round.kind]}${overrule ? ` → ${KIND_LABELS[overrule.kind]}` : ''} | ${tools} | ${head(page, 80)} | ${round.latencyMs ?? '—'} | ${round.reason}${markers.length > 0 ? ` [${markers.join(', ')}]` : ''} |`,
    )
  }
  lines.push('')
  return lines
}

export function formatAuditSet(audit: AuditSetOutput): string {
  const { provenance } = audit
  const lines: string[] = []
  lines.push(`# Round Audit — ${provenance.study} (${provenance.setId})`)
  lines.push('')
  lines.push(`Generated ${provenance.generatedAt} from a capture set created ${provenance.createdAt} (state ${provenance.state}). ${AUDIT_COUNTS_NOTE}`)
  lines.push('')
  lines.push('## Provenance')
  lines.push('')
  lines.push(`- capture: commit(s) ${provenance.commits.map((commit) => commit.slice(0, 8)).join(', ')}${provenance.dirtyTree ? ' (dirty tree)' : ''}; mode ${provenance.mode}; protocol ${provenance.protocolVersion}; prompt version(s) ${provenance.promptVersions.join(', ')}`)
  lines.push(`- routing: ${provenance.roles.join('; ')} | reasoning override: ${provenance.reasoningEffortOverride ?? 'none'} | effort overrides: ${provenance.effortOverrides.length === 0 ? 'none' : provenance.effortOverrides.join(', ')} | adblock: ${provenance.adblock}`)
  lines.push(`- key ${provenance.keyVersion}, manifest ${provenance.keyManifestDigest.slice(0, 15)}…; grades by ${provenance.gradesReviewers.length === 0 ? 'nobody yet' : provenance.gradesReviewers.join('; ')}${provenance.gradesRevision === null ? '' : ` (revision ${provenance.gradesRevision})`}`)
  lines.push(`- reviewer: ${provenance.reviewerModel} at ${provenance.reviewerEffort}, prompt ${provenance.reviewerPromptVersion}; audit run at commit ${provenance.auditCommit.slice(0, 8)}${provenance.auditDirtyTree ? ' (dirty tree)' : ''}`)
  lines.push('')
  lines.push('## Populations')
  lines.push('')
  lines.push('Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.')
  lines.push('')
  lines.push(...populationTable([audit.populations.initial, audit.populations.followUp]))
  lines.push('')
  lines.push(...verdictTable([audit.populations.initial, audit.populations.followUp]))
  lines.push('')
  lines.push(...judgementLines([audit.populations.initial, audit.populations.followUp]))
  if (audit.caveats.length > 0) {
    lines.push('')
    lines.push('## Caveats')
    lines.push('')
    for (const caveat of audit.caveats) lines.push(`- ${caveat}`)
  }
  lines.push('')
  lines.push('## Attempts')
  lines.push('')
  for (const attempt of audit.attempts) lines.push(...attemptSection(attempt))
  return lines.join('\n')
}

export function formatAuditAggregate(aggregate: AuditAggregate): string {
  const { provenance } = aggregate
  const lines: string[] = []
  lines.push(`# Round Audit — aggregate over ${provenance.sets.length} sets (${provenance.shared.study})`)
  lines.push('')
  lines.push(`Generated ${provenance.generatedAt} over ${provenance.sets.map((set) => set.setId).join(', ')}, ordered by capture-set creation. ${AUDIT_COUNTS_NOTE}`)
  lines.push('')
  lines.push('## Ranked causes')
  lines.push('')
  lines.push('Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.')
  lines.push('')
  lines.push('| rank | cause | attempts | initial | follow-up |')
  lines.push('| --- | --- | --- | --- | --- |')
  aggregate.rankedCauses.forEach((cause, index) => lines.push(`| ${index + 1} | ${VERDICT_LABELS[cause.verdict]} | ${cause.count} | ${cause.initial} | ${cause.followUp} |`))
  lines.push('')
  lines.push('## Provenance')
  lines.push('')
  lines.push('Shared by every set, and checked before anything was counted:')
  lines.push('')
  lines.push(`- key ${provenance.shared.keyVersion}, manifest ${provenance.shared.keyManifestDigest.slice(0, 15)}…; grades by ${provenance.shared.gradesReviewers.join('; ')}`)
  lines.push(`- routing: ${provenance.shared.roles.join('; ')} | mode ${provenance.shared.mode} | protocol ${provenance.shared.protocolVersion} | prompt version(s) ${provenance.shared.promptVersions.join(', ')}`)
  lines.push(`- reasoning override: ${provenance.shared.reasoningEffortOverride ?? 'none'} | effort overrides: ${provenance.shared.effortOverrides.length === 0 ? 'none' : provenance.shared.effortOverrides.join(', ')} | adblock: ${provenance.shared.adblock}`)
  lines.push(`- reviewer: ${provenance.shared.reviewerModel} at ${provenance.shared.reviewerEffort}, prompt ${provenance.shared.reviewerPromptVersion}`)
  lines.push('')
  lines.push('| set | created | state | commit(s) | dirty tree | grades revision | audited at |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const set of provenance.sets) {
    lines.push(`| ${set.setId} | ${set.createdAt} | ${set.state} | ${set.commits.map((commit) => commit.slice(0, 8)).join(', ')} | ${set.dirtyTree ? 'yes' : 'no'} | ${set.gradesRevision ?? '—'} | ${set.auditCommit.slice(0, 8)}${set.auditDirtyTree ? ' (dirty)' : ''} |`)
  }
  lines.push('')
  lines.push('## Populations')
  lines.push('')
  lines.push(...populationTable([aggregate.populations.initial, aggregate.populations.followUp]))
  lines.push('')
  lines.push(...verdictTable([aggregate.populations.initial, aggregate.populations.followUp]))
  lines.push('')
  lines.push(...judgementLines([aggregate.populations.initial, aggregate.populations.followUp]))
  lines.push('')
  lines.push('## Per set')
  lines.push('')
  for (const population of [aggregate.populations.initial, aggregate.populations.followUp]) {
    lines.push(`### ${population.label}`)
    lines.push('')
    lines.push(...populationTable(population.perSet.map((entry) => ({ ...entry.population, label: entry.setId }))))
    lines.push('')
    lines.push(...verdictTable(population.perSet.map((entry) => ({ ...entry.population, label: entry.setId }))))
    lines.push('')
  }
  if (aggregate.caveats.length > 0) {
    lines.push('## Caveats')
    lines.push('')
    for (const caveat of aggregate.caveats) lines.push(`- ${caveat}`)
    lines.push('')
  }
  return lines.join('\n')
}
