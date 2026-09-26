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
//     Off-key Acquisitions, an Early Stop, an Answer Omission, the verdict,
//     overrules of mechanical labels and flags for a human — validated here
//     against the digest it was given (a round it names must exist, an
//     overrule must change something, a secondary verdict must differ from
//     the primary, a check it names must be one the Grade left unsatisfied)
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
import { blockedOrInertAction, type ConsumedNothing } from '../../src/core/browser/actionOutcome.ts'
import { parseBlockerMarker } from '../../src/core/browser/blockerNudge.ts'
import { classifyNotFoundPage, NOT_FOUND_BASES, type NotFoundBasis, type NotFoundLanding } from '../../src/core/browser/notFoundPage.ts'
import { classifyUnavailablePage, isUnavailableBasis, type UnavailableLanding } from '../../src/core/browser/unavailablePage.ts'
import type { ComposedAddressRewriteStamp } from '../../src/core/pipeline/composedAddressRail.ts'
import type { UnseenPhraseRewriteStamp } from '../../src/core/pipeline/unseenPhraseRail.ts'
import type { EngineRewriteStamp } from '../../src/core/pipeline/engineRewriteRail.ts'
import type { ResultPickStamp } from '../../src/core/pipeline/resultPick.ts'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { EffortTier } from '../../src/core/pipeline/runPlan'
import { DECISION_THRESHOLDS } from '../../src/core/ports/decisionModel.ts'
import type { SearchObservation, SearchSignature } from '../../src/core/pipeline/searchLoopRail'
import { isSearchInspection, SEARCH_LOOP_NUDGE_AFTER, SEARCH_SIGNATURES, searchStreakAfter, searchStreakMoveOf, similarQueries } from '../../src/core/pipeline/searchLoopRule.ts'
import { normalizeUrlInput, parseSearchUrl, SEARCH_URL_FORMS, type SearchUrlForm } from '../../src/core/browser/urlInput.ts'
import type { TraceRecord } from '../../src/core/trace/runTrace'
import { decisionSeamsLabel } from './launchRouting.ts'
import { allowedDifferenceLine, type AllowedDifference, type AllowedDifferenceRecord } from './allowedDifference.ts'
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

export const AUDIT_VERDICTS = ['rounds_wasted', 'tier_too_small_or_never_escalated', 'budget_too_small_for_the_hunt', 'stopped_early', 'answer_omitted', 'failed_rounds'] as const
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

/** Why a reached budget or deadline was not a Tier Escalation (#266, `TIER_ESCALATION_DECLINE_REASONS`), in guard order, pinned by the same test. */
export const TIER_ESCALATION_DECLINE_REASONS = ['no_rail', 'no_tier_above', 'once_spent', 'hard_ceiling', 'no_progress'] as const
/** The two arms an automatic Tier Escalation fires from (#216, #266): the Run Plan event's `source`. */
export const TIER_ESCALATION_ARMS = ['deadline', 'budget'] as const

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
/**
 * The Search Loop rail's advisory (`SEARCH_LOOP_NUDGE`, searchLoopRail.ts):
 * its wording since #260 first, then the wording every capture before it
 * carries, so an older trace still reads its nudges.
 */
export const SEARCH_LOOP_NUDGE_MARKS: readonly string[] = ['The last searches ran one after another with nothing opened between them', 'The last searches reword one intent']
/** The refusal prefix every "the run will not do this" answer carries (`notExecuted`, effortEpoch.ts). */
export const NOT_EXECUTED_PREFIX = 'Not executed — '
/** What a scroll that brought nothing into view says (`SCROLL_END_OF_PAGE`, scrollDelta.ts). */
export const END_OF_PAGE_MARK = 'end of page'
/** The head of the line every Tier-1 consent dismissal reports (`consentDismissalLine`, dialogPolicy.ts; #263). */
export const CONSENT_DISMISSAL_MARK = 'dismissed consent dialog: clicked ['
/**
 * A consent-style control label (`CONSENT_LABEL_RE`, dialogPolicy.ts; #263,
 * ADR 0061), copied rather than imported like every fragment here, and
 * pinned to the source by the test.
 */
export const CONSENT_LABEL_PATTERN =
  /\b(accept|reject|allow|decline)\s+((optional|necessary|essential)\s+cookies?|all(\s+cookies?)?|cookies?(\s+consent)?|consent)\b|\b(accept|reject)\s+all\b/i

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
/**
 * The Run Trace version from which a Run records its Identity Slips (#246):
 * a trace below it cannot say whether an Answer slipped, so it reads "not
 * recorded", never zero.
 */
export const IDENTITY_SLIP_TRACE_VERSION = 2
/** The Run Trace version from which a Finalization entry records whether it skipped its bookkeeping round (#256). */
export const FINALIZATION_ENTRY_TRACE_VERSION = 3
/** The Run Trace version from which an `llm_round` record carries `firstTokenMs` (#256, ADR 0057): below it, no round says whether it streamed before it ended. */
export const FIRST_TOKEN_TRACE_VERSION = 4
/** The Run Trace version from which a budget or deadline `finalization_entry` carries `declined` (#266, ADR 0063): below it, no stop says whether an escalation was refused. */
export const TIER_ESCALATION_DECLINE_TRACE_VERSION = 5
/** How far apart a perf `llm` span's end and an `llm_round` record may be and still be the same round. */
const LATENCY_JOIN_TOLERANCE_MS = 2_000
/** A search at this streak followed a search with nothing opened between them (ADR 0058): no Progress. */
const SEARCH_STREAK_WITHOUT_PROGRESS = 2
/** The streak from which a search is a Search Loop round for the second counter (#259): the rail's own nudge tier, never a copy of it. */
const SEARCH_STREAK_NUDGED = SEARCH_LOOP_NUDGE_AFTER

// ---------------------------------------------------------------------------
// Shapes

/**
 * One attempt's orchestrator navigate or read_page rounds on a Delegated
 * Page (#273, ADR 0065), by the digest's round numbers, filed by the
 * holder's state when the call settled. The first two are the gate's
 * absolute zero; the third is reported until #272 lands.
 */
export interface DelegatedPageRounds {
  readonly running: readonly number[]
  readonly finished: readonly number[]
  readonly collected: readonly number[]
}

/** Delegated Page rounds summed over a population's attempts (#273). */
export interface DelegatedPageCounts {
  running: number
  finished: number
  collected: number
}

/**
 * One attempt's tier shadow (#278, ADR 0068): the Decision Model's round-1
 * answers, asked before the first orchestrator call and never acted on,
 * beside the tier the model's own first Run Plan declared.
 */
export interface TierShadow {
  /** The tier it picked; null when it was unavailable. */
  readonly pick: EffortTier | null
  readonly confidence: number | null
  /** The garble Noul: that the command is garbled, cut off or nonsensical. */
  readonly garbled: number | null
  /** Why no answer came back; null when one did. */
  readonly unavailable: string | null
  /** The tier the first model Run Plan declared — what a tier picked before round 1 would stand in for; null when none was. */
  readonly declared: EffortTier | null
}

/** Answered tier shadows under one Finalization Cause (#278), and those whose garble Noul clears the tier seam's threshold. */
export interface GarbleCounts {
  answered: number
  garbled: number
}

/** Tier shadows summed over attempts (#278): agreement against the model's declaration, and the garble Noul by Finalization Cause. */
export interface TierShadowCounts {
  asked: number
  unavailable: number
  /** Answered, and the model declared a tier to compare with. */
  compared: number
  agreed: number
  /** Of the compared, the picks whose confidence clears the tier seam's Choice threshold. */
  confident: number
  confidentAgreed: number
  /** Answered attempts by the Run's Finalization Cause (`none` without one). */
  garbledByCause: Record<string, GarbleCounts>
}

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
  /**
   * The Not-found Landing the call settled on (#239, ADR 0050): `<status|title>
   * <host>`. Read from the Run Trace's field on the result; a trace written
   * before the field was kept is read by the app's own title rule over the
   * page the result names. Present only on a landing, so an attempt with none
   * keeps the digest it always had.
   */
  readonly notFound?: string
  /**
   * The Unavailable Landing the call settled on (#262, ADR 0060): `<status|title>
   * <host>`, the Not-found Landing's sibling, read the same way — the Run
   * Trace's field, else the app's title rule on a trace written before it.
   * Present only on a landing, so an attempt with none keeps its digest.
   */
  readonly unavailable?: string
  /**
   * The search a Composed Address was rewritten into (#255, ADR 0055): the
   * query that ran, read from the Run Trace's field on the result, while
   * `args` keep the address the model composed. Present only on a rewrite, so
   * an attempt with none keeps the digest it always had.
   */
  readonly rewritten?: string
  /**
   * The Unseen Phrases a search ran without (#267, ADR 0064): the quoted
   * spans the Run was never shown, read from the Run Trace's field on the
   * result, while `args` keep the terms as the model wrote them. Present only
   * on a rewrite, so an attempt with none keeps the digest it always had.
   */
  readonly unquoted?: readonly string[]
  /**
   * The Engine Rewrite a search ran under (#270, ADR 0067): the Web Engine
   * the model searched on and the Run Engine it ran on, `google → duckduckgo`,
   * read from the Run Trace's field on the result, while `args` keep the
   * address as the model wrote it. Present only on a rewrite, so an attempt
   * with none keeps the digest it always had.
   */
  readonly engineRewrite?: string
  /**
   * The Result Pick this search's result was opened by (#277, ADR 0070): the
   * ref and whole href the Run opened from the listing and whether the open
   * landed, read from the Run Trace's field on the result. Where it landed,
   * `url`, `title` and `signature` are the opened page's — the Run settled
   * there. Present only on a pick, so an attempt with none keeps its digest.
   */
  readonly resultPick?: Omit<ResultPickStamp, 'label'>
  /** An Evidence Checkpoint's verdict: accepted, or the rejection's head. */
  readonly checkpoint: { readonly accepted: boolean; readonly outcome: string } | null
  /** The app's own Notices riding the result, as marker names. */
  readonly notices: readonly string[]
  /**
   * The search this call was and the streak it left. Which calls were
   * searches, and their queries, come from the rail's Search Observations
   * where the attempt carries them, with the signature the search ran under
   * (#243, ADR 0049); otherwise from a `navigate`'s query with no signature.
   * The streak is the rail's rule replayed over those calls (ADR 0058: a
   * search after a search with nothing opened between them), so a trace
   * recorded under the older same-intent rule is read by the current one.
   * From streak 2, `rewords` says whether the search shares a Search Intent
   * with the one before it — the reviewer's aid, no longer the rule.
   */
  readonly search: { readonly query: string; readonly streak: number; readonly signature?: SearchSignature; readonly rewords?: boolean } | null
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

/**
 * Where an attempt's search rounds came from (#243, ADR 0049): the rail's own
 * Search Observations; a replay of its rule over `navigate` searches, on a
 * trace written before observations were kept; or neither, when the trace
 * carries no observation and the replay finds no search.
 */
export const SEARCH_SOURCES = ['rail', 'replay', 'none'] as const
export type AuditSearchSource = (typeof SEARCH_SOURCES)[number]

/** The Asked Items counts of one attempt (#250). */
export interface AuditAskedItems {
  /** Items the last model Run Plan declared; null when no model plan carried the field. */
  readonly declared: number | null
  /** Standings the final Answer's display carried, by kind; null when it carried none. */
  readonly stated: number | null
  readonly unverified: number | null
  /** `asked_items_shape` records: Answers whose list was not the declared one, and how many of those were retried. */
  readonly shapeFailures: number
  readonly shapeRetried: number
}

export interface AuditPlan {
  readonly tier: EffortTier
  readonly source: string
  /** The Tool Round budget an escalation plan re-armed (#266, ADR 0042 note), when the event carried it. */
  readonly roundBudget?: number
}

/**
 * One automatic Tier Escalation as the audit reads it (#266, ADR 0063): the
 * arm that fired, the digest round before it, and the audit's own replay
 * verdict on that round — independent of the rail's record the arm read.
 */
export interface AuditTierEscalation {
  readonly arm: string
  /** The digest round that preceded the escalation; null when none had. */
  readonly before: number | null
  /** Whether the replay found Progress in that round; null with no round, or no call the replay judged. */
  readonly progressBefore: boolean | null
}

/**
 * The refusal a budget or deadline stop recorded (#266): the arm reached,
 * the guard that declined, the digest round before the stop and the
 * replay's Progress verdict on it — the capture's wiring gate reads a
 * `no_progress` decline against that verdict.
 */
export interface AuditTierEscalationDecline {
  readonly arm: string
  readonly reason: string
  readonly before: number | null
  readonly progressBefore: boolean | null
}

/**
 * An attempt's automatic Tier Escalations and its recorded refusal (#266).
 * Beside the rounds, never in them, so counting them re-keys no cached
 * judgement.
 */
export interface TierEscalationRecord {
  readonly fired: readonly AuditTierEscalation[]
  /** The decline the Run's own `finalization_entry` carried; null when it carried none — or could not (see `declineRecorded`). */
  readonly declined: AuditTierEscalationDecline | null
  /** Whether the trace is new enough to have recorded a decline at all ({@link TIER_ESCALATION_DECLINE_TRACE_VERSION}). */
  readonly declineRecorded: boolean
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
  /** Automatic Tier Escalations by arm, the replay's verdict on the round before each, and the recorded decline (#266); absent on an audit written before the counter. */
  readonly tierEscalations?: TierEscalationRecord
  /** The budget the Run's last plan holds: an escalation's re-armed budget when the event carried one (#266), else the tier table's. */
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
  /**
   * Accepted Evidence Checkpoints the store merged into an Observation the
   * Session already held (#240, ADR 0051), read from the trace's own verdict:
   * a trace written before the field merged none. A floor — the merge is
   * exact-text, so a paraphrased re-recording is not one.
   */
  readonly mergedCheckpoints: number
  /**
   * Acquisition rounds — with or without Progress — carrying an accepted
   * Evidence Checkpoint beside the action (#254): the checkpoints that rode
   * the next action instead of a round of their own. Beside the rounds,
   * outside the digest. Not `mergedCheckpoints`, which counts re-recordings.
   */
  readonly bundledCheckpoints: number
  /**
   * Rounds carrying an `excerpt_unsupported` Evidence Checkpoint rejection
   * whose source the previous or next round's `excerpt_unsupported` rejection
   * also cites, canonical under the audit's rule (#257, ADR 0054): the
   * retries of one refused source, which a cluster scores at two or more.
   * Beside the rounds, outside the digest. Not the raw rejected count, which
   * keeps the first refusal of every genuine paraphrase.
   */
  readonly sameSourceUnsupportedRounds: number
  /**
   * Acquisition rounds without Progress with a call — never a navigate — on a
   * Held Page (#240, ADR 0051): a page the initial attempt checkpointed, or
   * one this attempt checkpointed in an earlier round. Beside the rounds,
   * never in them, so it re-keys no cached judgement.
   */
  readonly heldPageRoundsWithoutProgress: number
  /**
   * The orchestrator's navigate or read_page rounds on a Delegated Page
   * (#273, ADR 0065), by its holder's state. Beside the rounds, never in
   * them; absent on an audit written before the counter.
   */
  readonly delegatedPageRounds?: DelegatedPageRounds
  /** The tier shadow (#278), beside the rounds; absent when the Run asked no tier question. */
  readonly tierShadow?: TierShadow
  /** Search Loop rounds by the streak rule: the rounds at streak 2 or beyond, and the heads of those loops. */
  readonly mechanicalSearchRounds: number
  /**
   * The rounds whose search started a streak that went on to reach 2 (ADR
   * 0048): a loop's head is a Search Loop round too. Kept beside the rounds,
   * never in them, so counting it changes no digest and re-keys no cached
   * judgement.
   */
  readonly searchLoopHeads: readonly number[]
  /**
   * The rounds with a search at streak 2 or beyond, and at 3 or beyond, by
   * the rail's rule (#259, ADR 0058). Two searches in a row are free to the
   * rail; 3 is its nudge tier, so the second count is the rounds the live
   * rail nudged or refused on. Beside the rounds, never in them.
   */
  readonly searchRoundsAtStreak2: number
  readonly searchRoundsAtStreak3: number
  /** Where the search rounds came from (#243) — beside the rounds, never in them, so it re-keys no cached judgement. */
  readonly searchSource: AuditSearchSource
  /**
   * The navigate searches by the Search URL form `parseSearchUrl` matched
   * (#260, ADR 0059): an engine's `q=`, another parameter named for terms,
   * or the path segment after `search`; a rewritten Composed Address counts
   * as the `q=` search it ran as. Beside the rounds, never in them. Absent on
   * an audit written before the counter.
   */
  readonly searchForms?: Readonly<Record<SearchUrlForm, number>>
  /**
   * The calls that reported success and consumed nothing (#261, note on ADR
   * 0058): the round of every Blocked Action and every inert click, one entry
   * per call, and of those that were neither a search nor inspection, the ones
   * met at streak 1 or beyond — each reset the Search Loop streak before #261
   * and holds it now. Beside the rounds, never in them. Absent on an audit
   * written before the counter.
   */
  readonly blockedOrInert?: BlockedOrInertRounds
  /**
   * The Unavailable Landings (#262, ADR 0060): the round of every call that
   * settled on an Unavailable Page, one entry per call, by what said so — a
   * 5xx status or the title — and of those, the ones whose next call other
   * than inspection was a search. Beside the rounds, never in them. Absent
   * on an audit written before the counter.
   */
  readonly unavailableLandings?: UnavailableLandingRounds
  /**
   * The consent walls (#263, ADR 0061): the round of every call that
   * reported a Tier-1 dismissal, of every click on a ref last listed with a
   * consent-style label — a consent wall cleared by hand — and of every
   * Blocked Action such a click followed within two rounds. Read from the
   * full result text, beside the rounds, never in them. Absent on an audit
   * written before the counter.
   */
  readonly consentWalls?: ConsentWallRounds
  readonly walledRounds: number
  /**
   * The round of every navigate that landed on a Not-found Page, one entry per
   * navigate (#239, ADR 0050). Beside the rounds, never in them, so counting it
   * re-keys no cached judgement.
   */
  readonly notFoundNavigates: readonly number[]
  /**
   * The round of every Composed Address rewritten into a search of its site,
   * one entry per call (#255, ADR 0055). Beside the rounds, never in them, so
   * counting it re-keys no cached judgement. Absent on an audit written
   * before the counter.
   */
  readonly rewrittenComposedAddresses?: readonly number[]
  /**
   * Of those, the round of every rewritten navigate whose address an earlier
   * successful result of the same Run had printed, whole or cut at the
   * snapshot's href cap (#258) — one entry per call. The count keys on the
   * cut href's prefix, since the trace holds only the printed text, so an
   * address that merely extends a cut link counts too. Beside the rounds,
   * never in them. Absent on an audit written before the counter.
   */
  readonly rewrittenShownAddresses?: readonly number[]
  /**
   * The round of every search that ran with an Unseen Phrase unquoted, one
   * entry per call (#267, ADR 0064), read from the stamp and never from the
   * head. Beside the rounds, never in them. Absent on an audit written
   * before the counter.
   */
  readonly unseenPhraseRewrites?: readonly number[]
  /**
   * The orchestrator's kind "subagent" citations (#272, ADR 0054): those
   * refused `excerpt_unsupported`, and those applied with an offered excerpt
   * dropped, read from the trace's checkpoint records by their `agentId` and
   * `correction`. Beside the rounds, never in them. Absent on an audit
   * written before the counter.
   */
  readonly subagentCitations?: Readonly<SubagentCitationCounts>
  /**
   * The round of every search that ran on the Run Engine in place of the
   * Web Engine the model named, one entry per call (#270, ADR 0067), read
   * from the stamp and never from the line. Beside the rounds, never in
   * them. Absent on an audit written before the counter.
   */
  readonly engineRewrites?: readonly number[]
  /**
   * The round of every search whose result a Result Pick opened (#277, ADR
   * 0070), read from the stamp. Beside the rounds, never in them. Absent on
   * an audit written before the counter.
   */
  readonly resultPicks?: readonly number[]
  /**
   * The round of every Evidence Checkpoint the Run made itself from a
   * Selected Passage and the store accepted (#276, ADR 0069), read from the
   * trace's `origin`. Beside the rounds, never in them: the checkpoint rode
   * a landing or a Page Read, so it made no round a bookkeeping one. Absent
   * on an audit written before the counter.
   */
  readonly runMadeCheckpoints?: readonly number[]
  /** The model's own record_evidence calls, accepted or refused (#276): what a Selected Passage spares it. */
  readonly modelRecordEvidenceCalls?: number
  /** The round of every successful search whose listing reached the model with no result opened for it (#277). */
  readonly listingsReturned?: readonly number[]
  /**
   * Every search that landed on a listing and the round a result of it was
   * opened in (#277): by its Result Pick, in its own round, or by the next
   * navigate or click that consumed something before another search; null
   * when another search, or the end of the attempt, came first.
   */
  readonly searchesToOpened?: readonly { readonly round: number; readonly openedRound: number | null }[]
  /**
   * The Answers that carried an Identity Slip and the ids slipped in them
   * (#246, ADR 0028), counted from the Run's own `identity_slip` records.
   * Null — not recorded — for a trace written below
   * {@link IDENTITY_SLIP_TRACE_VERSION}. Beside the rounds, never in them, so
   * it re-keys no cached judgement and bears on no verdict.
   */
  readonly identitySlips: { readonly answers: number; readonly ids: number } | null
  /**
   * Malformed Answers (#245): the turn's `malformed_answer` records, the
   * Run's and its Subagents'. Read from the records and never re-parsed from
   * Answer text, so a trace written before the record counts none. Beside the
   * rounds, never in them: the malformed round keeps its class and reason, and
   * no cached judgement is re-keyed.
   */
  readonly malformedAnswers: number
  /** Answer Retries (#245): the turn's `answer_retry` records, on the same terms. */
  readonly answerRetries: number
  /**
   * Transport Failures (#271): `llm_round` attempts, the Run's and its
   * Subagents', that ended `transport`. Absent from an audit written before
   * the counter; beside the rounds, never in them.
   */
  readonly transportAttempts?: number
  /** Rounds, the Run's and its Subagents', whose Transport Retry completed (#271). */
  readonly transportRetriesRecovered?: number
  /** 1 when the Run finalized `model_unreachable` (#271), else 0. */
  readonly modelUnreachableRuns?: number
  /**
   * Finalization entries that skipped their bookkeeping round (#256, ADR
   * 0056): the Run's own `finalization_entry` records saying so. Null — not
   * recorded — for a trace below {@link FINALIZATION_ENTRY_TRACE_VERSION}, and
   * absent from an audit written before the field. Beside the rounds, never in
   * them, so it re-keys no cached judgement.
   */
  readonly skippedBookkeepingRounds?: number | null
  /** Finalization rounds that ended `allowance` (#256): cut by their share of the Finalization Allowance. */
  readonly allowanceFinalizationRounds?: number
  /**
   * Of those, the rounds cut after their first token had streamed (#256, ADR
   * 0057): the share restarted at the token and still ran out. Null — not
   * recorded — for a trace below {@link FIRST_TOKEN_TRACE_VERSION}, whose
   * `llm_round` records carry no `firstTokenMs`, and absent from an audit
   * written before the field. Beside the rounds, so it re-keys no judgement.
   */
  readonly allowanceFinalizationRoundsStreaming?: number | null
  /**
   * First-token latency per orchestrator round (#256, ADR 0057): the digest's
   * round number and how many milliseconds its attempt waited for its first
   * fragment. Only rounds that streamed something appear. Null for a trace
   * below {@link FIRST_TOKEN_TRACE_VERSION}. Beside the rounds, never in them.
   */
  readonly firstTokens?: readonly { readonly round: number; readonly ms: number }[] | null
  /**
   * Asked Items (#250, ADR 0052), read from the Run's own events and records
   * and never from Answer text: what the last model Run Plan declared, the
   * standings the final Answer's display carried, and the Answers whose list
   * was not the declared one. `null` where the event carried no field — a
   * trace written before the field existed. Beside the rounds; the digest
   * does not move.
   */
  readonly askedItems: AuditAskedItems
  readonly latency: { readonly llmMs: number | null; readonly joined: number; readonly unjoined: number }
  readonly usage: { readonly promptTokens: number; readonly completionTokens: number; readonly roundsWithUsage: number }
  readonly subagent: { readonly rounds: number; readonly agents: number; readonly byStop: Readonly<Record<string, number>> }
  readonly grade: { readonly status: string; readonly reviewer: string } | null
  /**
   * Check ids the Grade judged unsatisfied (#244), or every check when the
   * attempt is ungraded — `isUngraded` says which, and the report labels
   * those "ungraded: every check". Null when the key has no task for the slot.
   */
  readonly checksUnsatisfied: readonly string[] | null
  readonly checksTotal: number | null
  readonly digestHash: string
}

/**
 * One of the two judgements over the checks unsatisfied (#244): whether it
 * holds, why, and the check ids it covers — none when it does not hold.
 */
export interface AuditCheckJudgement {
  readonly value: boolean
  readonly reason: string
  readonly checks: readonly string[]
}

export interface AuditJudgement {
  readonly searchLoops: readonly { readonly rounds: readonly number[]; readonly reason: string }[]
  readonly offKey: readonly { readonly round: number; readonly url: string | null; readonly reason: string }[]
  readonly overrules: readonly { readonly round: number; readonly kind: RoundKind; readonly reason: string }[]
  /** An Early Stop: budget and time left, and an unsatisfied check needed a page the Run had not read. */
  readonly stoppedEarly: AuditCheckJudgement
  /** An Answer Omission: an unsatisfied check follows from a page the Run had read, however the attempt ended. */
  readonly answerOmitted: AuditCheckJudgement
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
  /** The `BINGBONG_DECISION_SEAMS` list the launches forwarded (#279), or null; absent on audits written before it. */
  readonly decisionSeams?: string | null
  readonly effortOverrides: readonly string[]
  readonly adblock: string
  /** Whether any launch retained the verbose browser sub-spans (#247): timing records only. */
  readonly browserSubspans: boolean
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
  /** Rounds at streak 2 or beyond, and at 3 or beyond, by the rail's rule (#259). */
  readonly searchRoundsAtStreak2: number
  readonly searchRoundsAtStreak3: number
  /** Attempts by where their search rounds came from (#243). */
  readonly searchSources: Readonly<Record<AuditSearchSource, number>>
  /** Navigate searches by Search URL form over the attempts that count them (#260); absent when none does. */
  readonly searchForms?: Readonly<Record<SearchUrlForm, number>>
  /**
   * Blocked Actions by kind (#264: Covered, Not Shown, and pre-#264 heads),
   * inert clicks, those met inside a Search Loop streak (#261), post-block
   * vision rounds and recovery rounds, over the attempts that count them; absent when none does.
   */
  readonly blockedOrInert?: Readonly<BlockedOrInertCounts>
  /** Unavailable Landings by basis, and those followed by a search, over the attempts that count them (#262); absent when none does. */
  readonly unavailableLandings?: Readonly<Record<keyof UnavailableLandingRounds, number>>
  /** Consent dismissals, hand consent clicks, and blocks a hand consent click followed, over the attempts that count them (#263); absent when none does. */
  readonly consentWalls?: Readonly<ConsentWallCounts>
  /** Automatic Tier Escalations by arm, replay verdicts on the round before each, and declines by reason, over the attempts that count them (#266); absent when none does. */
  readonly tierEscalations?: Readonly<TierEscalationCounts>
  readonly inheritedRounds: number
  /** Merged Evidence Checkpoints over the attempts (#240): a floor. */
  readonly mergedCheckpoints: number
  /** Acquisition rounds carrying an accepted Evidence Checkpoint over the attempts (#254). */
  readonly bundledCheckpoints: number
  /** Same-source unsupported rounds over the attempts (#257). */
  readonly sameSourceUnsupportedRounds: number
  /** Held Page rounds without Progress over the attempts (#240). */
  readonly heldPageRoundsWithoutProgress: number
  /** Delegated Page rounds over the attempts, by the holder's state (#273); absent when no attempt's audit carries the counter. */
  readonly delegatedPageRounds?: DelegatedPageCounts
  /** Tier shadows over the attempts (#278); absent when no attempt asked one. */
  readonly tierShadow?: TierShadowCounts
  readonly rejectedCheckpoints: number
  readonly walledRounds: number
  /** Navigates that landed on a Not-found Page (#239). */
  readonly notFoundNavigates: number
  /** Of those, the ones in a round the reviewer judged Off-key; judged attempts only. */
  readonly notFoundOffKey: number
  /** Composed Addresses rewritten into a search of the site (#255); absent on an audit written before the counter. */
  readonly rewrittenComposedAddresses?: number
  /** Of those, the ones in a round the reviewer judged Off-key; judged attempts only. */
  readonly rewrittenComposedAddressesOffKey?: number
  /** Of the rewrites, the navigates to an address the Run was shown, whole or cut (#258); absent on an audit written before the counter. */
  readonly rewrittenShownAddresses?: number
  /** Searches that ran with an Unseen Phrase unquoted (#267); absent on an audit written before the counter. */
  readonly unseenPhraseRewrites?: number
  /** Of those, the ones in a round the reviewer judged Off-key; judged attempts only. */
  readonly unseenPhraseRewritesOffKey?: number
  /** Kind "subagent" citations refused `excerpt_unsupported` and applied with a dropped excerpt, over the attempts that count them (#272); absent when none does. */
  readonly subagentCitations?: Readonly<SubagentCitationCounts>
  /** Searches that ran on the Run Engine in place of another Web Engine (#270); absent on an audit written before the counter. */
  readonly engineRewrites?: number
  /** Of those, the ones in a round the reviewer judged Off-key; judged attempts only. */
  readonly engineRewritesOffKey?: number
  /** Searches whose result a Result Pick opened (#277); absent when no attempt counts them. */
  readonly resultPicks?: number
  /** Searches whose listing reached the model with no result opened (#277). */
  readonly listingsReturned?: number
  /** Successful searches over the attempts that count them (#277). */
  readonly searchesCounted?: number
  /** Of those, the searches a result of which was opened (#277). */
  readonly searchesOpened?: number
  /** Rounds from a search to its opened result, summed over the opened ones, the search's own round counted (#277). */
  readonly roundsToOpened?: number
  /** Run-made Evidence Checkpoints from a Selected Passage, over the attempts that count them (#276); absent when none does. */
  readonly runMadeCheckpoints?: number
  /** The model's own record_evidence calls over the same attempts (#276). */
  readonly modelRecordEvidenceCalls?: number
  /** Bookkeeping-only rounds over the same attempts (#276): the rounds a Selected Passage is meant to remove. */
  readonly bookkeepingRoundsWherePassagesCounted?: number
  /** Answers with an Identity Slip over the attempts whose trace recorded them (#246). */
  readonly identitySlipAnswers: number
  /** Ids slipped in those Answers (#246). */
  readonly identitySlipIds: number
  /** Attempts whose trace predates the record: their slips are not recorded, and count in neither number. */
  readonly identitySlipsNotRecorded: number
  /** Malformed Answers over the attempts (#245). */
  readonly malformedAnswers: number
  /** Answer Retries over the attempts (#245). */
  readonly answerRetries: number
  /** Transport Failure attempts over the attempts (#271); absent on an audit written before the counter. */
  readonly transportAttempts?: number
  /** Rounds recovered by a Transport Retry over the attempts (#271). */
  readonly transportRetriesRecovered?: number
  /** Runs that finalized `model_unreachable` over the attempts (#271). */
  readonly modelUnreachableRuns?: number
  /** Skipped bookkeeping rounds over the attempts whose trace recorded them (#256). */
  readonly skippedBookkeepingRounds: number
  /** Attempts whose trace predates the `finalization_entry` record: their skips count nowhere. */
  readonly skippedBookkeepingNotRecorded: number
  /** Finalization rounds cut by the Finalization Allowance over the attempts (#256). */
  readonly allowanceFinalizationRounds: number
  /** Of those, the rounds cut after their first token had streamed (#256, ADR 0057), over the attempts whose trace recorded it. */
  readonly allowanceFinalizationRoundsStreaming: number
  /** Of those, the rounds cut before any fragment streamed, over the same attempts. */
  readonly allowanceFinalizationRoundsSilent: number
  /** Cut rounds from attempts whose trace predates `firstTokenMs`: streaming or silent, nobody recorded. */
  readonly allowanceFinalizationRoundsNotRecorded: number
  /** First-token latency over the attempts' orchestrator rounds that streamed (#256, ADR 0057): how many, and the median and ninetieth percentile in milliseconds. */
  readonly firstToken: { readonly rounds: number; readonly p50: number | null; readonly p90: number | null }
  /** Attempts whose model Run Plan declared at least one Asked Item (#250). */
  readonly askedItemsDeclared: number
  /** Attempts whose final Answer carried at least one `unverified` standing (#250). */
  readonly askedItemsUnverified: number
  /** Answers whose list was not the declared one, and how many of those were retried (#250). */
  readonly askedItemsShapeFailures: number
  readonly askedItemsShapeRetried: number
  readonly subagentRounds: number
  readonly stoppedEarly: number
  /** Judged attempts whose Answer Omission holds (#244), whatever their verdict. */
  readonly answerOmitted: number
  readonly overrules: number
  readonly flags: number
  readonly finalizationCauses: Readonly<Record<string, number>>
  readonly attemptsAtBudget: number
  /**
   * The rounds outside Finalization that called each tool (#235, ADR 0047),
   * most called first: a round counts once for a tool however many calls it
   * made to it, refused calls included, and the share is over the tool rounds
   * used. Counted from the Run Trace, never shown to the reviewer.
   */
  readonly toolRounds: readonly AuditToolRounds[]
}

export interface AuditToolRounds {
  readonly tool: string
  readonly rounds: number
  /** Over the population's tool rounds used; null when it used none. */
  readonly share: number | null
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
    /** The one shared field the caller let differ (#279, `--allow-differs`), with each set's value, or null when all were held fixed. */
    readonly allowedDifference: AllowedDifferenceRecord | null
  }
  readonly populations: { readonly initial: AuditAggregatePopulation; readonly followUp: AuditAggregatePopulation }
  /** Primary verdicts over every attempt of both populations, most counted first. Arithmetic, never an opinion. */
  readonly rankedCauses: readonly { readonly verdict: AuditVerdict; readonly count: number; readonly initial: number; readonly followUp: number }[]
  /** Consent dismissals, hand consent clicks and blocks they followed per hunt, over every set's attempts that count them (#263); absent when none does. */
  readonly consentWallsByHunt?: Readonly<Record<string, Readonly<ConsentWallCounts>>>
  /** Blocked Actions by kind, post-block vision rounds and recovery rounds per hunt, over every set's attempts that count them (#264); absent when none does. */
  readonly blockedActionsByHunt?: Readonly<Record<string, Readonly<BlockedOrInertCounts>>>
  /** Tier Escalations by arm and declines by reason per hunt, over every set's attempts that count them (#266); absent when none does. */
  readonly tierEscalationsByHunt?: Readonly<Record<string, Readonly<TierEscalationCounts>>>
  /** Composed Address and Unseen Phrase rewrites per hunt, over every set's attempts that count both (#267); absent when none does. */
  readonly rewritesByHunt?: Readonly<Record<string, Readonly<RewriteCounts>>>
  /** Tier shadow agreement and garble by cause per hunt, over every set's attempts that asked one (#278); absent when none did. */
  readonly tierShadowByHunt?: Readonly<Record<string, Readonly<TierShadowCounts>>>
  readonly caveats: readonly string[]
  readonly note: string
}

/** The rewrite kinds an attempt's searches ran under (#255, #267, #270), counted per call. */
export interface RewriteCounts {
  readonly composedAddresses: number
  readonly unseenPhrases: number
  /** Engine Rewrites (#270); absent where no attempt of the hunt counted them. */
  readonly engines?: number
}

export const AUDIT_COUNTS_NOTE = 'This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.'

// ---------------------------------------------------------------------------
// Small pure helpers

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isSearchSignature = (value: unknown): value is SearchSignature => (SEARCH_SIGNATURES as readonly unknown[]).includes(value)

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

/**
 * The search a `navigate` argument is: the terms of a Search URL, or the
 * plain terms the browser normalizes into one. Null for a plain page. The
 * rail's own test (`parseSearchUrl`, ADR 0059), never a copy — the copy this
 * replaced read `q=` alone and drifted from the rail (#260).
 */
export function searchQueryOf(raw: string): string | null {
  return parseSearchUrl(raw)?.query ?? null
}

/** The Search URL form of a navigate a search observation came from; a rewritten Composed Address ran on the `q=` engine (ADR 0055). */
function searchFormOf(call: AuditCall): SearchUrlForm | null {
  if (call.name !== 'navigate' || call.search === null) return null
  if (call.rewritten !== undefined) return 'q'
  return isString(call.args.url) ? (parseSearchUrl(call.args.url)?.form ?? null) : null
}

function emptySearchForms(): Record<SearchUrlForm, number> {
  return Object.fromEntries(SEARCH_URL_FORMS.map((form) => [form, 0])) as Record<SearchUrlForm, number>
}

function searchFormsText(forms: Readonly<Record<SearchUrlForm, number>> | undefined): string {
  return forms === undefined ? 'not counted' : SEARCH_URL_FORMS.map((form) => `${form} ${forms[form]}`).join(', ')
}

function roundsText(rounds: readonly number[]): string {
  return `${rounds.length}${rounds.length > 0 ? ` (round ${rounds.join(', ')})` : ''}`
}

/** Each recovery as `round +N`, or `round never` for a Blocked Action nothing recovered from. */
function recoveriesText(recoveries: BlockedOrInertRounds['recoveries']): string {
  if (recoveries === undefined) return 'not counted'
  if (recoveries.length === 0) return 'none'
  return recoveries.map((recovery) => `${recovery.at} ${recovery.rounds === null ? 'never' : `+${recovery.rounds}`}`).join(', ')
}

function blockedOrInertText(counted: BlockedOrInertRounds | undefined): string {
  if (counted === undefined) return 'Blocked Actions and inert clicks not counted'
  const kinds =
    counted.covered === undefined || counted.notShown === undefined
      ? `Blocked Actions ${roundsText(counted.blocked)}`
      : `Blocked Actions covered ${roundsText(counted.covered)}, not shown ${roundsText(counted.notShown)}${counted.blocked.length > 0 ? `, pre-#264 ${roundsText(counted.blocked)}` : ''}`
  const aftermath =
    counted.postBlockVision === undefined ? '' : `; post-block vision rounds ${roundsText(counted.postBlockVision)}; recovery rounds by block ${recoveriesText(counted.recoveries)}`
  return `${kinds}, inert clicks ${roundsText(counted.inert)}; inside a Search Loop streak, holding it: ${roundsText(counted.inStreak)}${aftermath}`
}

function populationBlockedOrInertText(counted: AuditPopulation['blockedOrInert']): string {
  return counted === undefined
    ? 'Blocked Actions and inert clicks not counted'
    : `${counted.covered} covered, ${counted.notShown} not shown and ${counted.blocked} pre-#264 Blocked Action(s), ${counted.inert} inert click(s), ${counted.inStreak} inside a Search Loop streak, ${counted.postBlockVision} post-block vision round(s), ${counted.recoveryRounds} recovery round(s) over ${counted.recovered} recovered block(s) and ${counted.unrecovered} never recovered`
}

/**
 * The Blocked Actions per hunt (#264, AC9), summed over the attempts that
 * count them, so a zero not-shown count is visible as a count rather than as
 * silence; a hunt no attempt counted is left out. Undefined when none does.
 */
export function blockedActionsByHuntOf(attempts: readonly AuditAttempt[]): Record<string, BlockedOrInertCounts> | undefined {
  const byHunt: Record<string, Record<keyof BlockedOrInertCounts, number>> = {}
  let counted = false
  for (const { mechanical } of attempts) {
    if (mechanical.blockedOrInert === undefined) continue
    counted = true
    addBlockedOrInert((byHunt[mechanical.huntId] ??= emptyBlockedOrInertCounts()), mechanical.blockedOrInert)
  }
  return counted ? byHunt : undefined
}

/** The per-hunt Blocked Actions as a section — heading, note and table; empty when nothing counted them. */
function blockedActionsByHuntSection(byHunt: Readonly<Record<string, Readonly<BlockedOrInertCounts>>> | undefined): string[] {
  if (byHunt === undefined) return []
  return [
    '## Blocked Actions by hunt',
    '',
    'Covered and Not Shown outcomes (ADR 0062; pre-#264 heads named no kind), Look or visual grounding rounds within two rounds of one, and the rounds from each to the next round whose action landed or that answered.',
    '',
    '| hunt | covered | not shown | pre-#264 | post-block vision rounds | recovery rounds | recovered | never recovered |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(byHunt).map(
      ([hunt, counted]) =>
        `| ${hunt} | ${counted.covered} | ${counted.notShown} | ${counted.blocked} | ${counted.postBlockVision} | ${counted.recoveryRounds} | ${counted.recovered} | ${counted.unrecovered} |`,
    ),
  ]
}

/** The Tier Escalations by arm, the replay's verdict on the round before each, and the declines by reason, as counts: over a population, or a hunt (#266). */
export interface TierEscalationCounts {
  readonly budget: number
  readonly deadline: number
  /** Escalations whose preceding round the replay found Progress in, and those it did not; the rest had no round or no judged call. */
  readonly progressBefore: number
  readonly noProgressBefore: number
  /** Recorded declines by reason, in guard order; a reason outside the closed set counts under `other`. */
  readonly declined: Readonly<Record<(typeof TIER_ESCALATION_DECLINE_REASONS)[number] | 'other', number>>
  /** Declines for `no_progress` on a round the replay found Progress in — the #266 wiring gate's number; the rail's record and the replay disagree. */
  readonly declinedAgainstReplay: number
  /** Attempts whose trace predates the decline record: their refusals count nowhere. */
  readonly declinesNotRecorded: number
}

function emptyTierEscalationCounts(): TierEscalationCounts {
  return { budget: 0, deadline: 0, progressBefore: 0, noProgressBefore: 0, declined: { no_rail: 0, no_tier_above: 0, once_spent: 0, hard_ceiling: 0, no_progress: 0, other: 0 }, declinedAgainstReplay: 0, declinesNotRecorded: 0 }
}

/** Add one attempt's escalations and decline to a running count. */
function addTierEscalations(total: TierEscalationCounts, record: TierEscalationRecord): TierEscalationCounts {
  const declined = { ...total.declined }
  if (record.declined !== null) {
    const reason = (TIER_ESCALATION_DECLINE_REASONS as readonly string[]).includes(record.declined.reason) ? (record.declined.reason as (typeof TIER_ESCALATION_DECLINE_REASONS)[number]) : 'other'
    declined[reason] += 1
  }
  return {
    budget: total.budget + firedByArm(record, 'budget'),
    deadline: total.deadline + firedByArm(record, 'deadline'),
    progressBefore: total.progressBefore + record.fired.filter((escalation) => escalation.progressBefore === true).length,
    noProgressBefore: total.noProgressBefore + record.fired.filter((escalation) => escalation.progressBefore === false).length,
    declined,
    declinedAgainstReplay: total.declinedAgainstReplay + (record.declined?.reason === 'no_progress' && record.declined.progressBefore === true ? 1 : 0),
    declinesNotRecorded: total.declinesNotRecorded + (record.declineRecorded ? 0 : 1),
  }
}

/** The replay's Progress verdict on the digest round before a boundary: any judged call that made Progress; null with no round, or none the replay judged. */
function progressBeforeOf(rounds: readonly AuditRound[], before: number | null): boolean | null {
  const round = before === null ? undefined : rounds[before - 1]
  if (round === undefined) return null
  const judged = round.calls.filter((call) => call.progress !== null)
  return judged.length === 0 ? null : judged.some((call) => call.progress?.made === true)
}

/** The escalations one arm fired. */
function firedByArm(record: TierEscalationRecord, arm: (typeof TIER_ESCALATION_ARMS)[number]): number {
  return record.fired.filter((escalation) => escalation.arm === arm).length
}

/** The round before a boundary and the replay's word on it, as the per-Run block prints them. */
function roundBeforeText(at: { readonly before: number | null; readonly progressBefore: boolean | null }): string {
  const before = at.before === null ? 'before any round' : `after round ${at.before}`
  const replay = at.progressBefore === null ? 'replay: no judged call' : at.progressBefore ? 'replay: Progress' : 'replay: no Progress'
  return `${before}, ${replay}`
}

/** One escalation as the per-Run block prints it: the arm, the round before, and the replay's word on it. */
function firedText(escalation: AuditTierEscalation): string {
  return `${escalation.arm} arm ${roundBeforeText(escalation)}`
}

function tierEscalationsText(record: TierEscalationRecord | undefined): string {
  if (record === undefined) return 'Tier Escalations not counted'
  const fired = record.fired.length === 0 ? 'none fired' : record.fired.map(firedText).join(', ')
  const declined = !record.declineRecorded
    ? `decline not recorded (a Run Trace below version ${TIER_ESCALATION_DECLINE_TRACE_VERSION})`
    : record.declined === null
      ? 'none declined'
      : `declined at the ${record.declined.arm}: ${record.declined.reason} (${roundBeforeText(record.declined)})`
  return `Tier Escalations: ${fired}; ${declined}`
}

/** The attempt line's parenthetical: how many fired, by arm; empty when none did. */
/** "N of M Tool Rounds used" — or, after an escalation, the rounds over every epoch against the last epoch's budget, which is what M then is. */
function toolRoundsUsedText(mechanical: AuditMechanical): string {
  const fired = mechanical.tierEscalations?.fired.length ?? mechanical.deadlineEscalations
  return fired > 0
    ? `${mechanical.toolRoundsUsed} Tool Rounds used over ${fired + 1} tier epochs, the last budgeted ${mechanical.toolRoundBudget ?? '?'}`
    : `${mechanical.toolRoundsUsed} of ${mechanical.toolRoundBudget ?? '?'} Tool Rounds used`
}

function attemptTierEscalationsText(mechanical: AuditMechanical): string {
  const budget = mechanical.tierEscalations === undefined ? 0 : firedByArm(mechanical.tierEscalations, 'budget')
  const deadline = mechanical.tierEscalations === undefined ? mechanical.deadlineEscalations : firedByArm(mechanical.tierEscalations, 'deadline')
  const parts = [deadline > 0 ? `${deadline} at the deadline` : null, budget > 0 ? `${budget} at the budget` : null].filter((part): part is string => part !== null)
  return parts.length === 0 ? '' : ` (${deadline + budget} Tier Escalation(s): ${parts.join(', ')})`
}

function declinedText(declined: TierEscalationCounts['declined']): string {
  return [...TIER_ESCALATION_DECLINE_REASONS, 'other' as const].filter((reason) => declined[reason] > 0).map((reason) => `${reason} ${declined[reason]}`).join(', ') || 'none'
}

function populationTierEscalationsText(counted: TierEscalationCounts | undefined): string {
  return counted === undefined
    ? 'Tier Escalations not counted'
    : `${counted.budget} budget-armed and ${counted.deadline} deadline-armed Tier Escalation(s) (replay found Progress before ${counted.progressBefore}, none before ${counted.noProgressBefore}), declined ${declinedText(counted.declined)}, ${counted.declinedAgainstReplay} declined no_progress against the replay${counted.declinesNotRecorded > 0 ? ` (${counted.declinesNotRecorded} attempt(s) not recorded)` : ''}`
}

/**
 * The Tier Escalations per hunt (#266, AC9), summed over the attempts that
 * count them, so a zero budget-armed count is visible as a count rather
 * than as silence; a hunt no attempt counted is left out. Undefined when
 * none does.
 */
export function tierEscalationsByHuntOf(attempts: readonly AuditAttempt[]): Record<string, TierEscalationCounts> | undefined {
  const byHunt: Record<string, TierEscalationCounts> = {}
  let counted = false
  for (const { mechanical } of attempts) {
    if (mechanical.tierEscalations === undefined) continue
    counted = true
    byHunt[mechanical.huntId] = addTierEscalations(byHunt[mechanical.huntId] ?? emptyTierEscalationCounts(), mechanical.tierEscalations)
  }
  return counted ? byHunt : undefined
}

/** The per-hunt Tier Escalations as a section — heading, note and table; empty when nothing counted them. */
function tierEscalationsByHuntSection(byHunt: Readonly<Record<string, Readonly<TierEscalationCounts>>> | undefined): string[] {
  if (byHunt === undefined) return []
  return [
    '## Tier Escalations by hunt',
    '',
    'Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.',
    '',
    `| hunt | budget arm | deadline arm | Progress before | no Progress before | ${TIER_ESCALATION_DECLINE_REASONS.map((reason) => `declined ${reason}`).join(' | ')} | against the replay | not recorded |`,
    `| --- | --- | --- | --- | --- | ${TIER_ESCALATION_DECLINE_REASONS.map(() => '---').join(' | ')} | --- | --- |`,
    ...Object.entries(byHunt).map(
      ([hunt, counted]) =>
        `| ${hunt} | ${counted.budget} | ${counted.deadline} | ${counted.progressBefore} | ${counted.noProgressBefore} | ${TIER_ESCALATION_DECLINE_REASONS.map((reason) => counted.declined[reason]).join(' | ')} | ${counted.declinedAgainstReplay} | ${counted.declinesNotRecorded} |`,
    ),
  ]
}

function unavailableLandingsText(counted: UnavailableLandingRounds | undefined): string {
  return counted === undefined
    ? 'Unavailable Landings not counted'
    : `Unavailable Landings by status ${roundsText(counted.status)}, by title ${roundsText(counted.title)}; followed by a search: ${roundsText(counted.followedBySearch)}`
}

function consentWallsText(counted: ConsentWallRounds | undefined): string {
  return counted === undefined
    ? 'consent walls not counted'
    : `consent walls: dismissals ${roundsText(counted.dismissals)}, hand consent clicks ${roundsText(counted.handConsentClicks)}, blocked then hand consent ${roundsText(counted.blockedThenHandConsent)}`
}

function populationConsentWallsText(counted: AuditPopulation['consentWalls']): string {
  return counted === undefined
    ? 'consent walls not counted'
    : `${counted.dismissals} consent dismissal(s), ${counted.handConsentClicks} hand consent click(s), ${counted.blockedThenHandConsent} blocked then hand consent`
}

/**
 * The consent walls per hunt (#263, AC6), summed over the attempts that
 * count them, so a zero stands beside the dismissals that earned it; a hunt
 * no attempt counted is left out. Undefined when no attempt counts them.
 */
export function consentWallsByHuntOf(attempts: readonly AuditAttempt[]): Record<string, ConsentWallCounts> | undefined {
  const byHunt: Record<string, ConsentWallCounts> = {}
  let counted = false
  for (const { mechanical } of attempts) {
    if (mechanical.consentWalls === undefined) continue
    counted = true
    addConsentWalls((byHunt[mechanical.huntId] ??= emptyConsentWallCounts()), mechanical.consentWalls)
  }
  return counted ? byHunt : undefined
}

/** The per-hunt consent walls as a section — heading, note and table; empty when nothing counted them. */
function consentWallsByHuntSection(byHunt: Readonly<Record<string, Readonly<ConsentWallCounts>>> | undefined): string[] {
  if (byHunt === undefined) return []
  return [
    '## Consent walls by hunt',
    '',
    'Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).',
    '',
    '| hunt | dismissals | hand consent clicks | blocked then hand consent |',
    '| --- | --- | --- | --- |',
    ...Object.entries(byHunt).map(([hunt, counted]) => `| ${hunt} | ${counted.dismissals} | ${counted.handConsentClicks} | ${counted.blockedThenHandConsent} |`),
  ]
}

/**
 * The rewrites per hunt (#267, AC3), both kinds, summed over the attempts
 * that count both — an audit written before the Unseen Phrase counter counts
 * neither here, so a zero is a zero and never a missing field; a hunt no
 * attempt counted is left out. Undefined when no attempt counts them.
 */
export function rewritesByHuntOf(attempts: readonly AuditAttempt[]): Record<string, RewriteCounts> | undefined {
  const byHunt: Record<string, { composedAddresses: number; unseenPhrases: number; engines?: number }> = {}
  let counted = false
  for (const { mechanical } of attempts) {
    if (mechanical.unseenPhraseRewrites === undefined || mechanical.rewrittenComposedAddresses === undefined) continue
    counted = true
    const into = (byHunt[mechanical.huntId] ??= { composedAddresses: 0, unseenPhrases: 0 })
    into.composedAddresses += mechanical.rewrittenComposedAddresses.length
    into.unseenPhrases += mechanical.unseenPhraseRewrites.length
    // Engine Rewrites (#270) only where the attempt counts them: an older one leaves the column "not counted".
    if (mechanical.engineRewrites !== undefined) into.engines = (into.engines ?? 0) + mechanical.engineRewrites.length
  }
  return counted ? byHunt : undefined
}

/** The per-hunt rewrites as a section — heading, note and table; empty when nothing counted them. */
function rewritesByHuntSection(byHunt: Readonly<Record<string, Readonly<RewriteCounts>>> | undefined): string[] {
  if (byHunt === undefined) return []
  return [
    '## Rewrites by hunt',
    '',
    'Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.',
    '',
    '| hunt | composed addresses | unseen phrases | engine rewrites |',
    '| --- | --- | --- | --- |',
    ...Object.entries(byHunt).map(([hunt, counted]) => `| ${hunt} | ${counted.composedAddresses} | ${counted.unseenPhrases} | ${counted.engines ?? 'not counted'} |`),
  ]
}

function populationUnavailableLandingsText(counted: AuditPopulation['unavailableLandings']): string {
  return counted === undefined
    ? 'Unavailable Landings not counted'
    : `${counted.status + counted.title} Unavailable Landing(s) (${counted.status} by status, ${counted.title} by title), ${counted.followedBySearch} followed by a search`
}

/** The navigate searches over an attempt's rounds by Search URL form (#260, AC5). */
export function searchFormsOf(rounds: readonly AuditRound[]): Record<SearchUrlForm, number> {
  const forms = emptySearchForms()
  for (const round of rounds) {
    for (const call of round.calls) {
      const form = searchFormOf(call)
      if (form !== null) forms[form] += 1
    }
  }
  return forms
}

/** The Search Loop rail's same-intent test, the rail's own code (ADR 0048): a replay of a rule that does not run the rule's code is not a replay. */
export { similarQueries }

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
  if (SEARCH_LOOP_NUDGE_MARKS.some((mark) => text.includes(mark))) notices.push('search_loop_nudge')
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

/** What the Run Trace recorded beside a call's result as fields (#239, #255, #262), each null when absent. */
interface ResultFields {
  landing: NotFoundLanding | null
  unavailable: UnavailableLanding | null
  rewritten: ComposedAddressRewriteStamp | null
  unquoted: UnseenPhraseRewriteStamp | null
  engineRewrite: EngineRewriteStamp | null
  resultPick: ResultPickStamp | null
}

interface RawRound {
  readonly record: TraceLine
  readonly round: number
  readonly attempt: number
  readonly calls: ({ call: ToolCallEvent; result: ToolResultEvent | undefined; checkpoint: TraceLine | undefined } & ResultFields)[]
}

/** The Composed Address rewrite a `tool_result` record carries as a field (#255), or null. */
function rewrittenFieldOf(record: TraceLine): ComposedAddressRewriteStamp | null {
  const field = record.rewritten
  return isRecord(field) && isString(field.site) && isString(field.query) ? { site: field.site, query: field.query } : null
}

/** The Unseen Phrase rewrite a `tool_result` record carries as a field (#267), or null. */
function unquotedFieldOf(record: TraceLine): UnseenPhraseRewriteStamp | null {
  const field = record.unquoted
  return isRecord(field) && Array.isArray(field.phrases) && field.phrases.every(isString) && isString(field.query)
    ? { phrases: field.phrases as string[], query: field.query }
    : null
}

/** The Engine Rewrite a `tool_result` record carries as a field (#270), or null. */
function engineRewriteFieldOf(record: TraceLine): EngineRewriteStamp | null {
  const field = record.engineRewrite
  return isRecord(field) && isString(field.from) && isString(field.to) && isString(field.query) ? { from: field.from, to: field.to, query: field.query } : null
}

/** The Result Pick a `tool_result` record carries as a field (#277), or null. */
function resultPickFieldOf(record: TraceLine): ResultPickStamp | null {
  const field = record.resultPick
  return isRecord(field) && isFiniteNumber(field.ref) && isString(field.label) && isString(field.href) && typeof field.opened === 'boolean'
    ? { ref: field.ref, label: field.label, href: field.href, opened: field.opened }
    : null
}

/** The Not-found Landing a `tool_result` record carries as a field (#239), or null. */
function landingFieldOf(record: TraceLine): NotFoundLanding | null {
  const field = record.notFound
  return isRecord(field) && isString(field.basis) && NOT_FOUND_BASES.has(field.basis) && isString(field.host)
    ? { basis: field.basis as NotFoundBasis, host: field.host }
    : null
}

/** The Unavailable Landing a `tool_result` record carries as a field (#262), or null. */
function unavailableFieldOf(record: TraceLine): UnavailableLanding | null {
  const field = record.unavailable
  return isRecord(field) && isString(field.basis) && isUnavailableBasis(field.basis) && isString(field.host) ? { basis: field.basis, host: field.host } : null
}

/** The decline the Run's own `finalization_entry` record carries (#266), with the orchestrator round before it, or null; a Subagent's entry is not the Run's. */
function recordedDeclineOf(records: readonly TraceLine[]): { arm: string; reason: string; before: number | null } | null {
  let roundsSeen = 0
  for (const record of records) {
    if (record.agentId !== undefined) continue
    if (record.kind === 'llm_round') roundsSeen += 1
    if (record.kind !== 'finalization_entry') continue
    const declined = record.declined
    if (isRecord(declined) && isString(declined.arm) && isString(declined.reason)) return { arm: declined.arm, reason: declined.reason, before: roundsSeen === 0 ? null : roundsSeen }
  }
  return null
}

function eventOf(record: TraceLine): Record<string, unknown> | null {
  return record.kind === 'pipeline_event' && isRecord(record.event) ? record.event : null
}

/**
 * The three Transport Failure counters (#271) over one attempt's records.
 * A round is keyed by whose it is and its number, so a Subagent's round 2
 * is never the Run's; it is recovered when it holds a `transport` attempt
 * and its last attempt completed.
 */
function transportCountsOf(
  records: readonly TraceLine[],
  terminal: AuditMechanical['terminal'],
): Pick<AuditMechanical, 'transportAttempts' | 'transportRetriesRecovered' | 'modelUnreachableRuns'> {
  let transportAttempts = 0
  const rounds = new Map<string, { transport: boolean; last: { attempt: number; outcome: unknown } }>()
  for (const record of records) {
    if (record.kind !== 'llm_round') continue
    if (record.outcome === 'transport') transportAttempts += 1
    const key = `${isString(record.agentId) ? record.agentId : ''}#${isFiniteNumber(record.round) ? record.round : 0}`
    const attempt = isFiniteNumber(record.attempt) ? record.attempt : 1
    const seen = rounds.get(key)
    const transport = (seen?.transport ?? false) || record.outcome === 'transport'
    const last = seen === undefined || attempt >= seen.last.attempt ? { attempt, outcome: record.outcome } : seen.last
    rounds.set(key, { transport, last })
  }
  const transportRetriesRecovered = [...rounds.values()].filter((round) => round.transport && round.last.outcome === 'completed').length
  return { transportAttempts, transportRetriesRecovered, modelUnreachableRuns: terminal?.finalizationCause === 'model_unreachable' ? 1 : 0 }
}

/** Group the turn's orchestrator records into rounds: each `llm_round` owns the tool calls that follow it until the next. */
function rawRounds(records: readonly TraceLine[]): RawRound[] {
  const rounds: RawRound[] = []
  const results = new Map<string, { event: ToolResultEvent } & ResultFields>()
  for (const record of records) {
    const event = eventOf(record)
    if (event !== null && event.type === 'tool_result' && isString(event.callId) && !results.has(event.callId) && record.agentId === undefined) {
      results.set(event.callId, {
        event: event as unknown as ToolResultEvent,
        landing: landingFieldOf(record),
        unavailable: unavailableFieldOf(record),
        rewritten: rewrittenFieldOf(record),
        unquoted: unquotedFieldOf(record),
        engineRewrite: engineRewriteFieldOf(record),
        resultPick: resultPickFieldOf(record),
      })
    }
  }
  let current: RawRound | null = null
  for (const record of records) {
    if (record.agentId !== undefined) continue
    if (record.kind === 'llm_round') {
      const round = isFiniteNumber(record.round) ? record.round : rounds.length + 1
      // An attempt a Transport Retry abandoned (#271) is not a round of its
      // own: it made no call, and the round is classed by the attempt that
      // followed it, so a recovered round is never a failed one.
      if (current !== null && current.round === round && current.record.outcome === 'transport' && current.calls.length === 0) rounds.pop()
      current = { record, round, attempt: isFiniteNumber(record.attempt) ? record.attempt : 1, calls: [] }
      rounds.push(current)
      continue
    }
    if (record.kind === 'evidence_checkpoint') {
      // The trace writes tool_call, then evidence_checkpoint, then
      // tool_result: the checkpoint belongs to the latest call of its tool
      // in this round that has none yet.
      // A Run-made one (#276) belongs to no call: `selectedPassageCountsOf` counts it.
      if (current === null || record.origin === 'run') continue
      const owner = [...current.calls].reverse().find((entry) => entry.call.name === record.tool && entry.checkpoint === undefined)
      if (owner !== undefined) owner.checkpoint = record
      continue
    }
    const event = eventOf(record)
    if (event === null || event.type !== 'tool_call' || current === null) continue
    const call = event as unknown as ToolCallEvent
    const settled = results.get(call.callId)
    current.calls.push({
      call,
      result: settled?.event,
      landing: settled?.landing ?? null,
      unavailable: settled?.unavailable ?? null,
      rewritten: settled?.rewritten ?? null,
      unquoted: settled?.unquoted ?? null,
      engineRewrite: settled?.engineRewrite ?? null,
      resultPick: settled?.resultPick ?? null,
      checkpoint: undefined,
    })
  }
  return rounds
}

// A link ref's href as the snapshot prints it: JSON-quoted, and cut with an
// ellipsis past the href cap. The same shape the rail parses (`hrefsIn` in
// composedAddressRail.ts), kept apart on purpose: the audit is evidence
// about the rail, and the rail's module cannot load under plain Node, which
// `scripts/live-audit.ts` must.
const PRINTED_HREF_RE = /\bhref=("(?:[^"\\]|\\.)*")/g
const ELLIPSIS = '…'

function printedHrefsIn(text: string): string[] {
  const hrefs: string[] = []
  for (const match of text.matchAll(PRINTED_HREF_RE)) {
    try {
      const href: unknown = JSON.parse(match[1]!)
      if (isString(href) && href !== '') hrefs.push(href)
    } catch {
      // Not an href line the snapshot printed; nothing was shown here.
    }
  }
  return hrefs
}

/**
 * An address as this counter compares it: the browser's own input
 * normalization, then no hash and no trailing slash — the two differences
 * the rail's fingerprint folds that a model's spelling of a shown link
 * actually varies by. Null for what is no URL at all.
 */
function comparableAddress(raw: string): string | null {
  const normalized = normalizeUrlInput(raw)
  if (normalized === null) return null
  try {
    const url = new URL(normalized)
    url.hash = ''
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
    return url.toString()
  } catch {
    return null
  }
}

/**
 * The rounds of the rewritten navigates whose address an earlier successful
 * result of the Run had printed (#258), one entry per call, in order: whole
 * — matched as a comparable address — or cut, where the address extends the
 * printed prefix. A result offers to the calls after it, a later call of its
 * own round included; a failed one showed nothing.
 */
function rewrittenShownAddressesOf(raw: readonly RawRound[]): number[] {
  const whole = new Set<string>()
  const prefixes: string[] = []
  const rounds: number[] = []
  const shown = (address: string): boolean => {
    const comparable = comparableAddress(address)
    if (comparable !== null && whole.has(comparable)) return true
    return prefixes.some((prefix) => address.startsWith(prefix) || (comparable !== null && comparable.startsWith(prefix)))
  }
  for (const round of raw) {
    for (const entry of round.calls) {
      if (entry.rewritten !== null && isString(entry.call.args.url) && shown(entry.call.args.url)) rounds.push(round.round)
      const text = entry.result !== undefined && entry.result.ok ? resultText(entry.result.result) : null
      if (text === null) continue
      for (const href of printedHrefsIn(text)) {
        if (href.endsWith(ELLIPSIS)) prefixes.push(href.slice(0, -ELLIPSIS.length))
        else {
          const comparable = comparableAddress(href)
          if (comparable !== null) whole.add(comparable)
        }
      }
    }
  }
  return rounds
}

/** The Progress reason of a call that landed on a Not-found Page (ADR 0050): neutral in the app, without Progress here. */
export const NOT_FOUND_LANDING_REASON = 'landed on a Not-found Page'

/** The Progress reason of a call that landed on an Unavailable Page (ADR 0060): neutral in the app, without Progress here. */
export const UNAVAILABLE_LANDING_REASON = 'landed on an Unavailable Page'

/** The Progress reason of a search at streak 2 or beyond (ADR 0058), the similarity beside it for the reviewer. */
function searchWithoutProgressReason(search: NonNullable<AuditCall['search']>): string {
  return `a search after a search with nothing opened between them (streak ${search.streak}${search.rewords === true ? ', rewording the one before it' : ''})`
}

/**
 * The Search Loop counts by the streak rule over an attempt's rounds (ADR
 * 0048, ADR 0058): the rounds at streak 2 or beyond and at 3 or beyond, the
 * heads — a search at streak 2 always follows the streak-1 search that
 * started it, with no search between — and the members of every streak that
 * reached 2, heads included, which is `mechanicalSearchRounds`. Reads the
 * streaks as the rounds carry them; `replaySearchStreaks` re-derives those
 * for a report written under an older rule.
 */
export function searchLoopCountsOf(rounds: readonly AuditRound[]): Pick<AuditMechanical, 'mechanicalSearchRounds' | 'searchLoopHeads' | 'searchRoundsAtStreak2' | 'searchRoundsAtStreak3'> {
  const heads = new Set<number>()
  const atStreak2 = new Set<number>()
  const atStreak3 = new Set<number>()
  let streakHead: number | null = null
  for (const round of rounds) {
    for (const call of round.calls) {
      if (call.search === null) continue
      if (call.search.streak === 1) streakHead = round.round
      else if (call.search.streak === SEARCH_STREAK_WITHOUT_PROGRESS && streakHead !== null) heads.add(streakHead)
      if (call.search.streak >= SEARCH_STREAK_WITHOUT_PROGRESS) atStreak2.add(round.round)
      if (call.search.streak >= SEARCH_STREAK_NUDGED) atStreak3.add(round.round)
    }
  }
  return {
    mechanicalSearchRounds: new Set([...atStreak2, ...heads]).size,
    searchLoopHeads: [...heads].sort((left, right) => left - right),
    searchRoundsAtStreak2: atStreak2.size,
    searchRoundsAtStreak3: atStreak3.size,
  }
}

/**
 * An attempt's rounds with every search's streak re-derived by the rail's
 * current rule from the calls as audited (ADR 0058): which calls were
 * searches, which succeeded, and which landed on a Not-found Page. This is
 * the replay `classifyAttempt` runs on a fresh trace, applied to a report
 * already written, so a capture audited under the same-intent rule counts
 * under the consecutive one. Kinds and reasons are left as judged — they are
 * the digest the reviewer saw — and `rewords` is recomputed beside the streak.
 */
export function replaySearchStreaks(rounds: readonly AuditRound[]): AuditRound[] {
  const state: SearchStreakState = { streak: 0, lastSearchQuery: null }
  return rounds.map((round) => ({
    ...round,
    calls: round.calls.map((call) => {
      const search = advanceSearchStreak(state, {
        name: call.name,
        consumed: consumedOf(call),
        search: call.search === null ? null : { query: call.search.query, ...(call.search.signature === undefined ? {} : { signature: call.search.signature }) },
      })
      if (call.resultPick?.opened === true) replayResultPick(state, consumedOf(call))
      return search === null ? call : { ...call, search }
    }),
  }))
}

/**
 * How the Opened line begins (#277): `resultOpenedLine` in
 * src/core/pipeline/resultPick.ts writes it, which plain Node cannot load, so
 * the audit holds the prefix and a test pins the two together.
 */
export const RESULT_OPENED_PREFIX = 'Opened ['

/** What a Result Pick's opened page said (#277): the result after the Opened line, or the whole text where there is none. */
function openedPageText(text: string | null): string | null {
  if (text === null) return null
  const at = text.indexOf(`\n${RESULT_OPENED_PREFIX}`)
  if (at === -1) return text
  const next = text.indexOf('\n', at + 1)
  return next === -1 ? '' : text.slice(next + 1)
}

/** The open a Result Pick made (#277, ADR 0070): escape, as the rail observed it, right after the search it came from. */
function replayResultPick(state: SearchStreakState, consumed: boolean): void {
  advanceSearchStreak(state, { name: 'navigate', consumed, search: null })
}

/** The calls that open a result: a navigate or a click that consumed something (#277). */
const OPENING_TOOLS: ReadonlySet<string> = new Set(['navigate', 'click'])

/**
 * The Result Pick counts over an attempt's rounds (#277, ADR 0070): the
 * searches a pick opened a result of, the ones whose listing reached the
 * model with nothing opened, and for every search that landed on a listing
 * the round a result of it was opened in — the pick's own round, or the next
 * navigate or click that consumed something before another search came. A
 * search that landed on a wall or a missing page put no listing in front of
 * the model, as it put none in front of the Decision Model.
 */
export function resultPickCountsOf(rounds: readonly AuditRound[]): Required<Pick<AuditMechanical, 'resultPicks' | 'listingsReturned' | 'searchesToOpened'>> {
  const resultPicks: number[] = []
  const listingsReturned: number[] = []
  const searches: { round: number; openedRound: number | null }[] = []
  let waiting: { round: number; openedRound: number | null } | null = null
  for (const round of rounds) {
    for (const call of round.calls) {
      if (call.search !== null) {
        waiting = null
        if (!consumedOf(call) || call.wall !== null) continue
        const opened = call.resultPick?.opened === true
        const search = { round: round.round, openedRound: opened ? round.round : null }
        searches.push(search)
        if (opened) resultPicks.push(round.round)
        else {
          listingsReturned.push(round.round)
          waiting = search
        }
        continue
      }
      if (waiting !== null && OPENING_TOOLS.has(call.name) && consumedOf(call)) {
        waiting.openedRound = round.round
        waiting = null
      }
    }
  }
  return { resultPicks, listingsReturned, searchesToOpened: searches }
}

/**
 * The Selected Passage counts over an attempt (#276, ADR 0069): the round of
 * each Evidence Checkpoint the Run made and the store accepted — its trace
 * record says `origin: run` and has no record_evidence call of its own to
 * join, so it is read from the trace, numbered by the llm_round before it —
 * and the model's own record_evidence calls, from the rounds.
 */
export function selectedPassageCountsOf(
  traceRecords: readonly object[],
  rounds: readonly AuditRound[],
): Required<Pick<AuditMechanical, 'runMadeCheckpoints' | 'modelRecordEvidenceCalls'>> {
  const runMadeCheckpoints: number[] = []
  let round = 0
  for (const raw of traceRecords as readonly Record<string, unknown>[]) {
    if (raw.agentId !== undefined) continue
    if (raw.kind === 'llm_round' && isFiniteNumber(raw.round)) round = raw.round
    if (raw.kind === 'evidence_checkpoint' && raw.origin === 'run' && raw.outcome === 'accepted') runMadeCheckpoints.push(round)
  }
  const modelRecordEvidenceCalls = rounds.reduce((total, audited) => total + audited.calls.filter((call) => call.name === 'record_evidence').length, 0)
  return { runMadeCheckpoints, modelRecordEvidenceCalls }
}

/**
 * Whether an audited call consumed something, as the rail decides it: it
 * succeeded, was not refused, landed on no Not-found or Unavailable Page, and
 * was neither a Blocked Action nor an inert click.
 */
function consumedOf(call: AuditCall): boolean {
  return call.ok === true && !call.refused && call.notFound === undefined && call.unavailable === undefined && blockedOrInertOfCall(call) === null
}

/**
 * A written call's Blocked Action or inert click (#261), read by the rail's
 * own helper. The head keeps the outcome's first line; the settled state that
 * rules an inert click out is the `signature` the audit already read off the
 * whole result, since the head flattens and may cut it.
 */
function blockedOrInertOfCall(call: AuditCall): AuditConsumedNothing | null {
  if (call.ok !== true || call.refused || call.resultHead === null) return null
  const verdict = consumedNothingOf(call.resultHead)
  return verdict === 'inert' && call.signature !== null ? null : verdict
}

/**
 * The Blocked Action head the port wrote before #264 (ADR 0062), which named
 * no cause: a trace captured before it — the `fix-263` Reference among them —
 * still reads as a Blocked Action, of a kind the outcome never recorded.
 */
const LEGACY_BLOCKED_HEAD_RE = /^(?:clicked|typed) \[\d+\]: not (?:clicked|typed) — blocked by overlay/

/** How a call consumed nothing as the audit reads it: the port's own verdicts, or a pre-#264 Blocked Action. */
type AuditConsumedNothing = ConsumedNothing | 'blocked'

/** The rail's helper over an outcome text, with the pre-#264 head read as a Blocked Action of no recorded kind. */
function consumedNothingOf(text: string): AuditConsumedNothing | null {
  return LEGACY_BLOCKED_HEAD_RE.test(text) ? 'blocked' : blockedOrInertAction(text)
}

/** Whether a verdict is a Blocked Action — Covered, Not Shown, or pre-#264 — rather than an inert click. */
function isBlockedAction(verdict: AuditConsumedNothing | null): boolean {
  return verdict === 'covered' || verdict === 'notShown' || verdict === 'blocked'
}

/** Visual inspection tools: what a model reached for when an outcome left it hunting for a cover (#264). */
const VISION_TOOLS: ReadonlySet<string> = new Set(['look', 'ground_visual'])

/** How many rounds after a Blocked Action a Look or visual grounding call is a post-block vision round (ADR 0062). */
const POST_BLOCK_VISION_WITHIN_ROUNDS = 2

/**
 * Whether a call's action landed: a page action — never inspection or
 * vision — that reported success and consumed something, as the rail decides it.
 */
function landedOf(call: AuditCall): boolean {
  return ACQUISITION_TOOLS.has(call.name) && !isSearchInspection(call.name) && !VISION_TOOLS.has(call.name) && consumedOf(call)
}

/**
 * The rounds of an attempt's Blocked Actions and inert clicks, of those met
 * inside a streak (#261), and what followed a Blocked Action (#264).
 */
export interface BlockedOrInertRounds {
  /** Covered and Not Shown Blocked Actions (ADR 0062); absent on an audit written before #264. */
  readonly covered?: readonly number[]
  readonly notShown?: readonly number[]
  /** Blocked Actions under the pre-#264 head, whose kind the outcome never recorded. */
  readonly blocked: readonly number[]
  readonly inert: readonly number[]
  readonly inStreak: readonly number[]
  /** Rounds with a Look or visual grounding call within two rounds after a Blocked Action, by tool name (#264). */
  readonly postBlockVision?: readonly number[]
  /**
   * Per Blocked Action, in order, the rounds from it to the next round whose
   * action landed or that answered (Finalization); null when neither followed (#264).
   */
  readonly recoveries?: readonly { readonly at: number; readonly rounds: number | null }[]
}

/**
 * An attempt's Blocked Actions and inert clicks over its rounds as audited
 * (#261, AC4): one entry per call, and, of the calls that were neither a
 * search nor inspection, the ones met at streak 1 or beyond — the calls that
 * reset a Search Loop streak before #261 and hold it now. Reads the streaks
 * the rounds carry, as `searchLoopCountsOf` does. #264 (ADR 0062) splits the
 * Blocked Actions into Covered and Not Shown and tags what followed each:
 * the rounds a Look or visual grounding call came within two rounds of one,
 * and the rounds until an action landed or the Run answered.
 */
export function blockedOrInertOf(rounds: readonly AuditRound[]): BlockedOrInertRounds {
  const covered: number[] = []
  const notShown: number[] = []
  const blocked: number[] = []
  const inert: number[] = []
  const inStreak: number[] = []
  const postBlockVision: number[] = []
  const recoveries: { at: number; rounds: number | null }[] = []
  let lastBlock: number | null = null
  let streak = 0
  for (const round of rounds) {
    if (round.kind === 'finalization' || round.calls.some(landedOf)) {
      for (const recovery of recoveries) if (recovery.rounds === null && recovery.at < round.round) recovery.rounds = round.round - recovery.at
    }
    for (const call of round.calls) {
      if (VISION_TOOLS.has(call.name) && lastBlock !== null && round.round - lastBlock <= POST_BLOCK_VISION_WITHIN_ROUNDS && postBlockVision.at(-1) !== round.round) {
        postBlockVision.push(round.round)
      }
      const verdict = blockedOrInertOfCall(call)
      if (verdict === 'covered') covered.push(round.round)
      if (verdict === 'notShown') notShown.push(round.round)
      if (verdict === 'blocked') blocked.push(round.round)
      if (verdict === 'inert') inert.push(round.round)
      if (isBlockedAction(verdict)) {
        lastBlock = round.round
        recoveries.push({ at: round.round, rounds: null })
      }
      if (call.search !== null) {
        streak = call.search.streak
        continue
      }
      const inspection = isSearchInspection(call.name)
      if (verdict !== null && !inspection && streak >= 1) inStreak.push(round.round)
      streak = searchStreakAfter(streak, searchStreakMoveOf(inspection ? 'inspection' : 'other', consumedOf(call)))
    }
  }
  return { covered, notShown, blocked, inert, inStreak, postBlockVision, recoveries }
}

/** The Blocked Actions, inert clicks and what followed as counts: over a population, or a hunt. */
export interface BlockedOrInertCounts {
  readonly covered: number
  readonly notShown: number
  readonly blocked: number
  readonly inert: number
  readonly inStreak: number
  readonly postBlockVision: number
  /** Rounds from each recovered Blocked Action to its recovery, summed; `recovered` of them recovered, `unrecovered` never did. */
  readonly recoveryRounds: number
  readonly recovered: number
  readonly unrecovered: number
}

function emptyBlockedOrInertCounts(): Record<keyof BlockedOrInertCounts, number> {
  return { covered: 0, notShown: 0, blocked: 0, inert: 0, inStreak: 0, postBlockVision: 0, recoveryRounds: 0, recovered: 0, unrecovered: 0 }
}

/** Add one attempt's rounds to a running count; the #264 fields count zero on an audit written before them. */
function addBlockedOrInert(into: Record<keyof BlockedOrInertCounts, number>, rounds: BlockedOrInertRounds): void {
  into.covered += rounds.covered?.length ?? 0
  into.notShown += rounds.notShown?.length ?? 0
  into.blocked += rounds.blocked.length
  into.inert += rounds.inert.length
  into.inStreak += rounds.inStreak.length
  into.postBlockVision += rounds.postBlockVision?.length ?? 0
  for (const recovery of rounds.recoveries ?? []) {
    if (recovery.rounds === null) into.unrecovered += 1
    else {
      into.recovered += 1
      into.recoveryRounds += recovery.rounds
    }
  }
}

/** The rounds of an attempt's Unavailable Landings by basis, and of those followed by a search (#262). */
export interface UnavailableLandingRounds {
  readonly status: readonly number[]
  readonly title: readonly number[]
  readonly followedBySearch: readonly number[]
}

/**
 * An attempt's Unavailable Landings over its rounds as audited (#262, ADR
 * 0060): one entry per call, by basis, and of those, the ones whose next call
 * that was not inspection was a search — the move the landing held the
 * streak for. A landing with no call after it was followed by nothing.
 */
export function unavailableLandingsOf(rounds: readonly AuditRound[]): UnavailableLandingRounds {
  const status: number[] = []
  const title: number[] = []
  const followedBySearch: number[] = []
  let pending: number | null = null
  for (const round of rounds) {
    for (const call of round.calls) {
      if (pending !== null && !(call.search === null && isSearchInspection(call.name))) {
        if (call.search !== null) followedBySearch.push(pending)
        pending = null
      }
      if (call.unavailable === undefined) continue
      if (call.unavailable.startsWith('title ')) title.push(round.round)
      else status.push(round.round)
      pending = round.round
    }
  }
  return { status, title, followedBySearch }
}

/** The rounds of an attempt's consent dismissals, hand consent clicks, and blocks a hand consent click followed (#263). */
export interface ConsentWallRounds {
  readonly dismissals: readonly number[]
  readonly handConsentClicks: readonly number[]
  readonly blockedThenHandConsent: readonly number[]
}

/** The consent walls as counts: over an attempt's rounds, a population, or a hunt. */
export type ConsentWallCounts = Record<keyof ConsentWallRounds, number>

function emptyConsentWallCounts(): ConsentWallCounts {
  return { dismissals: 0, handConsentClicks: 0, blockedThenHandConsent: 0 }
}

/** Add one attempt's consent walls to a running count. */
function addConsentWalls(into: ConsentWallCounts, rounds: ConsentWallRounds): void {
  into.dismissals += rounds.dismissals.length
  into.handConsentClicks += rounds.handConsentClicks.length
  into.blockedThenHandConsent += rounds.blockedThenHandConsent.length
}

/** A whole listing's head: the page signature a read or a settled state prints, and a scroll's new-in-view block never does. */
const LISTING_HEAD_RE = /^signature [0-9a-f]+$/m

/** A listed ref and its label, as `formatRefLine` prints it: `[8] button "Reject all cookies"`. */
const LISTED_REF_RE = /^\[(\d+)\] \S+ "(.*?)"(?= |$)/gm

/** How many rounds after a block a hand consent click still answers it: pass 2 read the page in between (ADR 0061). */
const HAND_CONSENT_WITHIN_ROUNDS = 2

/**
 * An attempt's consent walls over its raw rounds (#263, ADR 0061), read from
 * the full result text because a listing sits past the digest's head: one
 * entry per call reporting a dismissal; one per click on a ref whose label,
 * in the last listing that numbered it, is consent-style — a hand consent
 * click, which no dismissal ever is, since a dismissal is never a call; and
 * one per Blocked Action a hand consent click followed within two rounds.
 */
function consentWallsOf(raw: readonly RawRound[]): ConsentWallRounds {
  const labels = new Map<number, string>()
  const dismissals: number[] = []
  const handConsentClicks: number[] = []
  const blockedThenHandConsent: number[] = []
  let blocked: number[] = []
  for (const round of raw) {
    for (const entry of round.calls) {
      const ref = Number(entry.call.args.ref)
      if (entry.call.name === 'click' && CONSENT_LABEL_PATTERN.test(labels.get(ref) ?? '')) {
        handConsentClicks.push(round.round)
        blockedThenHandConsent.push(...blocked.filter((at) => round.round - at <= HAND_CONSENT_WITHIN_ROUNDS))
        blocked = []
      }
      const text = entry.result !== undefined && entry.result.ok ? resultText(entry.result.result) : null
      if (text === null) continue
      if (text.includes(CONSENT_DISMISSAL_MARK)) dismissals.push(round.round)
      if (isBlockedAction(consumedNothingOf(text))) blocked.push(round.round)
      // A whole listing renumbers the page, so a number it leaves out names
      // nothing; a scroll's block overlays only the numbers it prints.
      if (LISTING_HEAD_RE.test(text)) labels.clear()
      for (const match of text.matchAll(LISTED_REF_RE)) labels.set(Number(match[1]), match[2]!)
    }
  }
  return { dismissals, handConsentClicks, blockedThenHandConsent }
}

/**
 * An audit's rounds with the Unavailable Landings a report written before
 * the counter never marked, recounted by the app's title rule over the page
 * each call names (#262, ADR 0060) — the status was never in a trace, so the
 * title is all a recount has. A call already marked, walled, or landed on a
 * Not-found Page keeps what it had. Kinds and reasons stay as judged; the
 * Fix Ledger replays the streak over the result.
 */
export function recountUnavailableByTitle(rounds: readonly AuditRound[]): AuditRound[] {
  return rounds.map((round) => ({
    ...round,
    calls: round.calls.map((call) => {
      if (call.unavailable !== undefined || call.notFound !== undefined || call.wall !== null || call.ok !== true || call.refused) return call
      const landing = unavailableByTitle(call.name, call.resultHead, call.title === null || call.url === null ? null : { url: call.url, title: call.title })
      return landing === null ? call : { ...call, unavailable: `${landing.basis} ${landing.host}` }
    }),
  }))
}

/** The Search Loop rail's streak as the audit replays it, and the streak's last query for `rewords`. */
interface SearchStreakState {
  streak: number
  lastSearchQuery: string | null
}

/**
 * One call's step of the streak, shared by the fresh classification and the
 * recount of a written report so the two cannot drift: a search advances the
 * streak and yields its search line (`rewords` from streak 2, against the
 * streak's previous search); any other call holds or, when it consumed
 * something and is not inspection, escapes. The caller says what the call
 * was — which only it can read off its source — and whether it consumed.
 */
function advanceSearchStreak(
  state: SearchStreakState,
  call: { readonly name: string; readonly consumed: boolean; readonly search: { readonly query: string; readonly signature?: SearchSignature } | null },
): NonNullable<AuditCall['search']> | null {
  if (call.search !== null) {
    state.streak = searchStreakAfter(state.streak, 'search')
    const rewords = state.streak >= SEARCH_STREAK_WITHOUT_PROGRESS ? { rewords: state.lastSearchQuery !== null && similarQueries(call.search.query, state.lastSearchQuery) } : {}
    state.lastSearchQuery = call.search.query
    return { query: head(call.search.query, 120)!, streak: state.streak, ...(call.search.signature === undefined ? {} : { signature: call.search.signature }), ...rewords }
  }
  const move = searchStreakMoveOf(isSearchInspection(call.name) ? 'inspection' : 'other', call.consumed)
  state.streak = searchStreakAfter(state.streak, move)
  if (move === 'escape') state.lastSearchQuery = null
  return null
}

/**
 * A landing on a trace written before the Run Trace kept the field: the app's
 * own title rule over the page the result names, on the calls that carry the
 * marker live — the navigation verbs, and a click that left the page.
 */
function landingByTitle(name: string, text: string | null, page: { url: string; title: string | null } | null): NotFoundLanding | null {
  if (page === null || text === null || !carriesLanding(name, text)) return null
  const verdict = classifyNotFoundPage({ url: page.url, title: page.title ?? '' })
  return verdict === null ? null : { basis: verdict.basis, host: verdict.host }
}

/** Its sibling for an Unavailable Landing (#262): the app's own title rule, on the same calls. */
function unavailableByTitle(name: string, text: string | null, page: { url: string; title: string | null } | null): UnavailableLanding | null {
  if (page === null || text === null || !carriesLanding(name, text)) return null
  const verdict = classifyUnavailablePage({ url: page.url, title: page.title ?? '' })
  return verdict === null ? null : { basis: verdict.basis, host: verdict.host }
}

/** The calls that carry a landing marker live: the navigation verbs, and a click that left the page. */
function carriesLanding(name: string, text: string): boolean {
  return name === 'navigate' || name === 'back' || name === 'go_forward' || (name === 'click' && text.includes('urlChanged=true'))
}

interface ProgressState {
  /** Canonical URLs the Run has put in front of itself. */
  readonly acquiredUrls: Set<string>
  /** Page states each Observation Producer has already observed. */
  readonly observed: Set<string>
  /** The page the Run is on, as the last successful result said. */
  currentUrl: string | null
  /** The Search Loop rail's streak, replayed by its rule. */
  readonly search: SearchStreakState
}

/**
 * The orchestrator's Search Observations by call id (#243, ADR 0049). A
 * Browse Subagent's are its own rail's, and stay out as its rounds do.
 */
function railObservationsOf(records: readonly TraceLine[]): Map<string, SearchObservation> {
  const observations = new Map<string, SearchObservation>()
  for (const record of records) {
    if (record.kind !== 'search_observation' || record.agentId !== undefined) continue
    const { callId, query, signature, streak } = record
    if (!isString(callId) || !isString(query) || !isSearchSignature(signature) || !isFiniteNumber(streak)) continue
    observations.set(callId, { query, signature, streak })
  }
  return observations
}

function classifyCall(
  entry: RawRound['calls'][number],
  state: ProgressState,
  parentUrls: ReadonlySet<string> | null,
  railObservations: ReadonlyMap<string, SearchObservation> | null,
): { call: AuditCall; inherited: boolean } {
  const { call, result, checkpoint } = entry
  const text = result === undefined ? null : result.ok ? resultText(result.result) : (result.error ?? null)
  // A Bookkeeping tool's error is a rejected Evidence Checkpoint — counted
  // beside the round, not a refusal of the round; a `Not executed —` answer
  // is a refusal whatever the tool.
  // A rewritten Composed Address (#255, ADR 0055) ran as a search whatever
  // became of the search, so it is never a refusal: its round is never Failed.
  const refused =
    entry.rewritten === null && result !== undefined && ((!result.ok && !BOOKKEEPING_TOOLS.has(call.name)) || (text !== null && text.startsWith(NOT_EXECUTED_PREFIX)))
  // A search whose result a Result Pick opened (#277, ADR 0070) settled on
  // the opened page: its outcome follows the Opened line, the listing's
  // head above it.
  const settled = entry.resultPick?.opened === true ? openedPageText(text) : text
  const page = result !== undefined && result.ok ? pageOf(settled) : null
  const signature = result !== undefined && result.ok ? signatureOf(settled) : null
  const wall = text === null ? null : parseBlockerMarker(text)
  // A wall wins over a landing, as it does live; the recorded field wins over
  // the title rule, which only reads a trace that predates it.
  const landing = result !== undefined && result.ok && wall === null ? (entry.landing ?? landingByTitle(call.name, settled, page)) : null
  // Its sibling (#262, ADR 0060), read the same way; the two never both
  // answer live, and a Not-found Landing wins here as its status did there.
  const unavailable = result !== undefined && result.ok && wall === null && landing === null ? (entry.unavailable ?? unavailableByTitle(call.name, settled, page)) : null
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
    ...(landing !== null ? { notFound: `${landing.basis} ${landing.host}` } : {}),
    ...(unavailable !== null ? { unavailable: `${unavailable.basis} ${unavailable.host}` } : {}),
    ...(entry.rewritten !== null ? { rewritten: entry.rewritten.query } : {}),
    ...(entry.unquoted !== null ? { unquoted: entry.unquoted.phrases } : {}),
    ...(entry.engineRewrite !== null ? { engineRewrite: `${entry.engineRewrite.from} → ${entry.engineRewrite.to}` } : {}),
    ...(entry.resultPick !== null ? { resultPick: { ref: entry.resultPick.ref, href: entry.resultPick.href, opened: entry.resultPick.opened } } : {}),
    checkpoint: checkpointVerdict,
    notices,
  }

  // The search streak: the rail's own rule (ADR 0058), replayed over the
  // calls. Which calls were searches comes from the rail's Search
  // Observations where the attempt carries them — query and signature, typed
  // and refused searches included (#243, ADR 0049) — and otherwise from a
  // `navigate`'s query alone: a trace written before observations were kept
  // holds no element facts, so a typed search cannot be told from other
  // typing and a successful type resets here where the live rail may have
  // counted it. The streak itself is never read off the observation: the
  // rule is a count of what happened between searches, and replaying it is
  // what lets a capture taken under the older same-intent rule be read by
  // the current one. On a trace the current rail wrote the two agree.
  let observed: { readonly query: string; readonly signature?: SearchSignature } | null = null
  if (railObservations !== null) {
    const record = railObservations.get(call.callId)
    if (record !== undefined) observed = { query: record.query, signature: record.signature }
  } else if (call.name === 'navigate' && !refused) {
    // A rewritten call replays as the search that ran, not the address it
    // replaced; an unquoted one as the terms that ran, not the ones written
    // (#267); one moved to the Run Engine by the terms the stamp read (#270),
    // which an engine's own parameter (Yahoo's `p=`) may hold.
    const query = entry.rewritten?.query ?? entry.unquoted?.query ?? entry.engineRewrite?.query ?? searchQueryOf(isString(call.args.url) ? call.args.url : '')
    if (query !== null) observed = { query }
  }
  // A navigate that landed on a Not-found Page is inspection to the rail
  // (#239, ADR 0050): it never resets the streak; nor does a refused or
  // failed call, which consumed nothing, nor a Blocked Action or an inert
  // click (#261), read by the rail's own helper over the whole result text,
  // nor an Unavailable Landing (#262), read from the field, never the head.
  const consumed =
    result !== undefined && result.ok && !refused && landing === null && unavailable === null && (settled === null || consumedNothingOf(settled) === null)
  const search = advanceSearchStreak(state.search, { name: call.name, consumed, search: observed })
  if (entry.resultPick?.opened === true) replayResultPick(state.search, consumed)

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
      if (landing !== null) {
        progress = { made: false, reason: NOT_FOUND_LANDING_REASON }
      } else if (unavailable !== null) {
        progress = { made: false, reason: UNAVAILABLE_LANDING_REASON }
      } else if (landedCanonical !== null && parentUrls !== null && parentUrls.has(landedCanonical)) {
        inherited = true
        progress = { made: false, reason: 'a re-acquisition of a page the initial attempt already checkpointed (inherited)' }
      } else if (landedCanonical !== null && state.acquiredUrls.has(landedCanonical)) {
        progress = { made: false, reason: 'a navigate to a URL this Run already acquired' }
      } else if (search !== null && search.streak >= SEARCH_STREAK_WITHOUT_PROGRESS) {
        progress = { made: false, reason: searchWithoutProgressReason(search) }
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
      if (landing !== null) {
        progress = { made: false, reason: NOT_FOUND_LANDING_REASON }
      } else if (unavailable !== null) {
        progress = { made: false, reason: UNAVAILABLE_LANDING_REASON }
      } else if (landedCanonical !== null && parentUrls !== null && parentUrls.has(landedCanonical) && !state.acquiredUrls.has(landedCanonical)) {
        inherited = true
        progress = { made: false, reason: 'a re-acquisition of a page the initial attempt already checkpointed (inherited)' }
      } else if (search !== null && search.streak >= SEARCH_STREAK_WITHOUT_PROGRESS) {
        // Only a typed search the rail observed carries one here (#243).
        progress = { made: false, reason: searchWithoutProgressReason(search) }
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
  return { rounds_wasted: 0, tier_too_small_or_never_escalated: 0, budget_too_small_for_the_hunt: 0, stopped_early: 0, answer_omitted: 0, failed_rounds: 0 }
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

/** A call that sat on a Held Page without making Progress (#240): any Acquisition but a navigate. */
function withoutProgressOnHeldPage(call: AuditCall, held: ReadonlySet<string>): boolean {
  if (call.name === 'navigate' || call.progress === null || call.progress.made || call.url === null) return false
  const canonical = canonicalUrl(call.url)
  return canonical !== null && held.has(canonical)
}

// The addresses a spawn's task names: the app's reader (`urlsInTask` in
// delegatedPage.ts), kept apart for the same reason PRINTED_HREF_RE is — that
// module cannot load under plain Node, which `scripts/live-audit.ts` must.
const TASK_URL_RE = /https?:\/\/[^\s"'<>)\]]+/g
const CLOSING_PUNCTUATION_RE = /[.,;:!?]+$/
const SPAWNED_BROWSE_RE = /^spawned (\S+) \[browse\]/

/**
 * The orchestrator's navigate or read_page rounds on a Delegated Page (#273,
 * ADR 0065), by the digest's round numbers, filed under the state its holder
 * was in when the call settled: running, finished with the report
 * uncollected, collected. Read in one pass over the interleaved Run Trace —
 * no field of its own: a Delegated Page is a URL a browse spawn's task names
 * or one of that Subagent's own results settled on, canonical under the
 * audit's rule. It is released at once by a successful `cancel_agent` naming
 * it (or "all" while it runs), as the app releases it when the cancel is
 * decided; it finishes at its `subagent_finalized` (a cancelled or failed one
 * is released there too), and is collected when an `agent_results` result
 * carries its completed header — whatever order those two reached the trace
 * in, since a waiting collection can settle before the finish is written. A
 * round on pages of two states counts in both; a round counts once per state.
 */
export function delegatedPageRoundsOf(records: readonly TraceLine[]): DelegatedPageRounds {
  interface Holder {
    readonly pages: Set<string>
    state: keyof DelegatedPageRounds
  }
  const holders = new Map<string, Holder>()
  const spawnTasks = new Map<string, string>()
  const cancelTargets = new Map<string, string>()
  const orchestratorCalls = new Map<string, string>()
  const phases = { running: new Set<number>(), finished: new Set<number>(), collected: new Set<number>() }
  let roundsSeen = 0
  let round: number | null = null
  let currentUrl: string | null = null
  const addPage = (holder: Holder, url: string): void => {
    const canonical = canonicalUrl(url)
    if (canonical !== null) holder.pages.add(canonical)
  }
  for (const record of records) {
    if (record.agentId === undefined && record.kind === 'llm_round') {
      roundsSeen += 1
      round = isFiniteNumber(record.round) ? record.round : roundsSeen
      continue
    }
    const event = eventOf(record)
    if (event === null) continue
    if (event.type === 'subagent_finalized' && isString(event.agentId)) {
      const holder = holders.get(event.agentId)
      if (holder === undefined) continue
      if (event.status !== 'completed') holders.delete(event.agentId)
      else if (holder.state === 'running') holder.state = 'finished'
      continue
    }
    if (event.type === 'tool_call' && isString(event.callId) && isString(event.name) && record.agentId === undefined) {
      orchestratorCalls.set(event.callId, event.name)
      if (event.name === 'spawn_agent' && isRecord(event.args) && isString(event.args.task)) spawnTasks.set(event.callId, event.args.task)
      if (event.name === 'cancel_agent' && isRecord(event.args) && isString(event.args.agent_id)) cancelTargets.set(event.callId, event.args.agent_id)
      continue
    }
    if (event.type !== 'tool_result' || event.ok !== true) continue
    const text = resultText(event.result)
    if (isString(record.agentId)) {
      // A Subagent's own result: where its tab settled joins its pages.
      const holder = holders.get(record.agentId)
      const page = pageOf(text)
      if (holder !== undefined && page !== null) addPage(holder, page.url)
      continue
    }
    const name = isString(event.callId) ? orchestratorCalls.get(event.callId) : undefined
    const page = pageOf(text)
    if (name === 'spawn_agent') {
      const spawned = text === null ? null : SPAWNED_BROWSE_RE.exec(text)
      if (spawned === null) continue
      const holder: Holder = { pages: new Set(), state: 'running' }
      for (const url of (spawnTasks.get(String(event.callId)) ?? '').match(TASK_URL_RE) ?? []) addPage(holder, url.replace(CLOSING_PUNCTUATION_RE, ''))
      holders.set(spawned[1]!, holder)
      continue
    }
    if (name === 'cancel_agent') {
      const target = cancelTargets.get(String(event.callId))
      for (const [id, holder] of holders) {
        if (target === id || (target === 'all' && holder.state === 'running')) holders.delete(id)
      }
      continue
    }
    if (name === 'agent_results') {
      const lines = text?.split('\n') ?? []
      for (const [id, holder] of holders) {
        if (lines.some((line) => line.startsWith(`${id} [`) && line.includes('] completed — '))) holder.state = 'collected'
      }
      continue
    }
    const onPage = page?.url ?? (name === 'navigate' ? null : currentUrl)
    if (page !== null) currentUrl = page.url
    if ((name !== 'navigate' && name !== 'read_page') || onPage === null || round === null) continue
    const canonical = canonicalUrl(onPage)
    if (canonical === null) continue
    for (const holder of holders.values()) {
      if (holder.pages.has(canonical)) phases[holder.state].add(round)
    }
  }
  const sorted = (rounds: Set<number>): number[] => [...rounds].sort((left, right) => left - right)
  return { running: sorted(phases.running), finished: sorted(phases.finished), collected: sorted(phases.collected) }
}

/** The canonical source a checkpoint call's arguments cite, or null when they cite none the audit can canonicalize. */
function canonicalSourceOf(args: Readonly<Record<string, unknown>>): string | null {
  const source = args.source_url
  return isString(source) ? canonicalUrl(source) : null
}

/**
 * The same-source unsupported rounds of an attempt (#257, ADR 0054): a
 * round carrying an `excerpt_unsupported` rejection whose canonical source
 * the previous or next round's `excerpt_unsupported` rejection also cites.
 * Rounds are the digest's own consecutive numbering, so a retry one round
 * later counts and the same source refused again five rounds on does not.
 * Read from the trace's verdict word, so a trace whose verdict was the
 * error's head counts nothing. A cluster scores at least two.
 */
export function sameSourceUnsupportedRoundsOf(rounds: readonly AuditRound[]): number {
  const cited = rounds.map((round) => {
    const sources = new Set<string>()
    for (const call of round.calls) {
      if (call.checkpoint === null || call.checkpoint.accepted || call.checkpoint.outcome !== 'excerpt_unsupported') continue
      const canonical = canonicalSourceOf(call.args)
      if (canonical !== null) sources.add(canonical)
    }
    return sources
  })
  let count = 0
  cited.forEach((sources, index) => {
    if (sources.size === 0) return
    const shared = (other: ReadonlySet<string> | undefined): boolean => other !== undefined && [...sources].some((source) => other.has(source))
    if (shared(cited[index - 1]) || shared(cited[index + 1])) count += 1
  })
  return count
}

/** The two numbers the #272 gate reads over kind "subagent" citations. */
export interface SubagentCitationCounts {
  /** Refused `excerpt_unsupported`: none should remain once the excerpt is dropped. */
  excerptUnsupported: number
  /** Applied with an offered excerpt dropped, the acceptance carrying its Notice. */
  droppedExcerpts: number
}

/**
 * An attempt's kind "subagent" citations (#272, ADR 0054), read straight
 * from the trace's checkpoint records rather than the rounds: such a record
 * carries the cited Subagent's `agentId`, which the round join reads as a
 * Subagent's own record and skips, so the digest never holds its verdict.
 * No Subagent checkpoints for itself, so every one is the orchestrator's.
 */
export function subagentCitationsOf(traceRecords: readonly object[]): SubagentCitationCounts {
  const counts = emptySubagentCitationCounts()
  for (const raw of traceRecords as unknown as readonly TraceLine[]) {
    if (raw.kind !== 'evidence_checkpoint' || raw.tool !== 'record_evidence' || !isString(raw.agentId)) continue
    if (raw.outcome === 'excerpt_unsupported') counts.excerptUnsupported += 1
    else if (raw.outcome === 'accepted' && isString(raw.correction) && raw.correction.startsWith(DROPPED_EXCERPT_NOTICE_HEAD)) counts.droppedExcerpts += 1
  }
  return counts
}

/**
 * The head of the Notice a dropped subagent excerpt carries
 * (`SUBAGENT_EXCERPT_DROPPED_NOTICE` in evidenceCheckpoint.ts), kept apart
 * because that module cannot load under plain Node, which the audit's CLI
 * must: matched by head, so another Notice on the same acceptance never
 * counts as a dropped excerpt.
 */
const DROPPED_EXCERPT_NOTICE_HEAD = 'Notice: record_evidence stored the finding without its excerpt.'

function emptySubagentCitationCounts(): SubagentCitationCounts {
  return { excerptUnsupported: 0, droppedExcerpts: 0 }
}

function emptyDelegatedPageCounts(): DelegatedPageCounts {
  return { running: 0, finished: 0, collected: 0 }
}

function addDelegatedPageRounds(into: DelegatedPageCounts, from: Readonly<DelegatedPageRounds>): void {
  into.running += from.running.length
  into.finished += from.finished.length
  into.collected += from.collected.length
}

function tierOf(value: unknown): EffortTier | null {
  return value === 'direct_action' || value === 'lookup' || value === 'investigation' ? value : null
}

/**
 * The Run's tier shadow (#278, ADR 0068): its own `decision` record for the
 * tier seam, joined with the tier its first model Run Plan declared. The
 * first, not the last: the shadow is asked before round 1 and stands in for
 * round 1's declaration, so an escalation or a Steering correction that later
 * re-declared is not what it would have replaced. (The #275 replay reads the
 * last model Run Plan; the two differ only where Steering re-declared.) Undefined when
 * the Run asked no tier question.
 */
export function tierShadowOf(records: readonly TraceLine[]): TierShadow | undefined {
  const record = records.find((line) => line.kind === 'decision' && line.seam === 'tier' && line.agentId === undefined)
  if (record === undefined) return undefined
  let declared: EffortTier | null = null
  for (const line of records) {
    if (line.agentId !== undefined) continue
    const event = eventOf(line)
    if (event?.type === 'run_plan' && event.source === 'model') {
      declared = tierOf(event.effortTier)
      if (declared !== null) break
    }
  }
  const answers = (record.answers ?? null) as { pick?: { choice?: unknown; confidence?: unknown }; garbled?: { noul?: unknown } } | null
  const unavailable = (record.unavailable ?? null) as { reason?: unknown } | null
  return {
    pick: tierOf(answers?.pick?.choice),
    confidence: isFiniteNumber(answers?.pick?.confidence) ? answers.pick.confidence : null,
    garbled: isFiniteNumber(answers?.garbled?.noul) ? answers.garbled.noul : null,
    unavailable: isString(unavailable?.reason) ? unavailable.reason : null,
    declared,
  }
}

function emptyTierShadowCounts(): TierShadowCounts {
  return { asked: 0, unavailable: 0, compared: 0, agreed: 0, confident: 0, confidentAgreed: 0, garbledByCause: {} }
}

/** Adds one attempt's tier shadow, judged against the tier seam's own thresholds. */
function addTierShadow(into: TierShadowCounts, shadow: Readonly<TierShadow>, finalizationCause: string | null): void {
  const { choice, noul } = DECISION_THRESHOLDS.tier
  into.asked += 1
  if (shadow.pick === null) {
    into.unavailable += 1
    return
  }
  if (shadow.declared !== null) {
    const agrees = shadow.pick === shadow.declared
    into.compared += 1
    if (agrees) into.agreed += 1
    if (shadow.confidence !== null && shadow.confidence >= choice) {
      into.confident += 1
      if (agrees) into.confidentAgreed += 1
    }
  }
  const cause = finalizationCause ?? 'none'
  const byCause = (into.garbledByCause[cause] ??= { answered: 0, garbled: 0 })
  byCause.answered += 1
  if (shadow.garbled !== null && shadow.garbled >= noul) byCause.garbled += 1
}

/**
 * The tier shadow counts per hunt and relation (#278), keyed `hunt (initial)`
 * or `hunt (follow-up)`: a follow-up is asked with its own command alone, so
 * "and the second one?" can read as cut off where an initial never would, and
 * pooling the two would blur both tables. Undefined when no attempt asked one.
 */
export function tierShadowByHuntOf(attempts: readonly AuditAttempt[]): Record<string, TierShadowCounts> | undefined {
  const byHunt: Record<string, TierShadowCounts> = {}
  let counted = false
  for (const { mechanical } of attempts) {
    if (mechanical.tierShadow === undefined) continue
    counted = true
    const key = `${mechanical.huntId} (${mechanical.relation === 'initial' ? 'initial' : 'follow-up'})`
    addTierShadow((byHunt[key] ??= emptyTierShadowCounts()), mechanical.tierShadow, mechanical.terminal?.finalizationCause ?? null)
  }
  return counted ? byHunt : undefined
}

function shareText(count: number, of: number): string {
  return `${count} (${pct(of === 0 ? null : count / of)})`
}

/** The tier shadow as a section — agreement per hunt, then the garble Noul by Finalization Cause; empty when nothing asked one. */
function tierShadowByHuntSection(byHunt: Readonly<Record<string, Readonly<TierShadowCounts>>> | undefined): string[] {
  if (byHunt === undefined) return []
  const { choice, noul } = DECISION_THRESHOLDS.tier
  return [
    '## Tier shadow',
    '',
    `The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of ${choice}. Reported, never gated.`,
    '',
    `| hunt | asked | unavailable | compared | agreed | confident (≥ ${choice}) | confident agreed |`,
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(byHunt).map(
      ([hunt, counted]) =>
        `| ${hunt} | ${counted.asked} | ${counted.unavailable} | ${counted.compared} | ${shareText(counted.agreed, counted.compared)} | ${counted.confident} | ${shareText(counted.confidentAgreed, counted.confident)} |`,
    ),
    '',
    `| hunt | Finalization Cause | answered | garbled (≥ ${noul}) |`,
    '| --- | --- | --- | --- |',
    ...Object.entries(byHunt).flatMap(([hunt, counted]) =>
      Object.entries(counted.garbledByCause).map(([cause, entry]) => `| ${hunt} | ${cause} | ${entry.answered} | ${shareText(entry.garbled, entry.answered)} |`),
    ),
  ]
}

function tierShadowText(shadow: TierShadow | undefined): string {
  if (shadow === undefined) return 'not asked'
  if (shadow.pick === null) return `unavailable (${shadow.unavailable ?? 'unknown'})`
  const against = shadow.declared === null ? 'with no declared tier' : `against the declared ${shadow.declared} (${shadow.pick === shadow.declared ? 'agrees' : 'disagrees'})`
  return `${shadow.pick} at ${shadow.confidence?.toFixed(2) ?? '?'} ${against}; garbled ${shadow.garbled?.toFixed(2) ?? '?'}`
}

function addSubagentCitations(into: SubagentCitationCounts, from: Readonly<SubagentCitationCounts>): void {
  into.excerptUnsupported += from.excerptUnsupported
  into.droppedExcerpts += from.droppedExcerpts
}

/** The canonical URLs an attempt's accepted Evidence Checkpoints cite — what a follow-up would inherit. */
export function checkpointedUrlsOf(traceRecords: readonly object[]): Set<string> {
  const urls = new Set<string>()
  for (const raw of traceRecords as unknown as readonly TraceLine[]) {
    if (raw.kind !== 'evidence_checkpoint' || raw.outcome !== 'accepted' || !isRecord(raw.args)) continue
    const canonical = canonicalSourceOf(raw.args)
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
  // The automatic escalations in trace order, each with the orchestrator
  // round that preceded it (#266): the `llm_round` records seen so far are
  // the digest's numbering, since the digest numbers rounds by position.
  const raised: { arm: string; before: number | null }[] = []
  let roundsSeen = 0
  let terminal: AuditMechanical['terminal'] = null
  let askedDeclared: number | null = null
  let askedStated: number | null = null
  let askedUnverified: number | null = null
  for (const record of records) {
    if (record.agentId !== undefined) continue
    if (record.kind === 'llm_round') roundsSeen += 1
    const event = eventOf(record)
    if (event === null) continue
    if (event.type === 'run_plan' && isString(event.effortTier)) {
      const source = isString(event.source) ? event.source : 'unknown'
      plans.push({ tier: event.effortTier as EffortTier, source, ...(isFiniteNumber(event.roundBudget) ? { roundBudget: event.roundBudget } : {}) })
      if ((TIER_ESCALATION_ARMS as readonly string[]).includes(source)) raised.push({ arm: source, before: roundsSeen === 0 ? null : roundsSeen })
    }
    // The Asked Items (#250): the last model plan's declaration, and the
    // standings the final Answer carried — read from the events, never
    // from the Card's text.
    if (event.type === 'run_plan' && event.source === 'model' && Array.isArray(event.askedItems)) askedDeclared = event.askedItems.length
    if (event.type === 'display' && event.finalAnswer === true && Array.isArray(event.askedItems)) {
      const standings = event.askedItems as readonly { standing?: unknown }[]
      askedStated = standings.filter((entry) => entry.standing === 'stated').length
      askedUnverified = standings.filter((entry) => entry.standing === 'unverified').length
    }
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

  // Pass one: calls and Progress, in trace order. The search rounds come
  // from the rail's observations when the attempt carries any (#243).
  const observations = railObservationsOf(records)
  const railObservations = observations.size > 0 ? observations : null
  const state: ProgressState = { acquiredUrls: new Set(), observed: new Set(), currentUrl: null, search: { streak: 0, lastSearchQuery: null } }
  const classified = raw.map((round) => {
    const calls = round.calls.map((entry) => classifyCall(entry, state, input.parentCheckpointedUrls, railObservations))
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
      reason =
        outcome === 'deadline'
          ? 'cut by the active-work deadline'
          : outcome === 'timeout'
            ? 'the client’s request timeout ended the round'
            : outcome === 'transport'
              ? 'the model could not be reached'
              : `the round ended ${outcome}`
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
  const checksUnsatisfied =
    input.task === null
      ? null
      : input.grade === null || isUngraded(input)
        ? input.task.checks.map((check) => check.checkId)
        : input.grade.checks.filter((check) => !check.satisfied).map((check) => check.checkId)

  // Pass three, after the digest's rounds are built: the Search Loop counts
  // by the streak rule, heads included (ADR 0048, ADR 0058).
  const searchLoop = searchLoopCountsOf(rounds)
  // Pass four, beside the rounds (#240, ADR 0051): the checkpoints the store
  // merged, and the rounds spent without Progress on a Held Page. The held set
  // at a round is the initial's checkpointed pages plus this attempt's own
  // accepted checkpoints before it, under the same rule `checkpointedUrlsOf`
  // gives the initial's.
  const mergedCheckpoints = raw.reduce((total, round) => total + round.calls.filter((entry) => entry.checkpoint?.outcome === 'accepted' && entry.checkpoint.merged === true).length, 0)
  const held = new Set(input.parentCheckpointedUrls ?? [])
  let heldPageRoundsWithoutProgress = 0
  rounds.forEach((round, index) => {
    if (round.kind === 'acquisition_without_progress' && round.calls.some((call) => withoutProgressOnHeldPage(call, held))) heldPageRoundsWithoutProgress += 1
    const checkpoints = raw[index]!.calls.flatMap((entry) => (entry.checkpoint === undefined ? [] : [entry.checkpoint]))
    for (const url of checkpointedUrlsOf(checkpoints)) held.add(url)
  })

  // Pass five, beside the rounds (#246): the Run's own Identity Slips, where
  // its trace is new enough to have recorded them at all.
  const slipRecords = records.filter((record) => record.kind === 'identity_slip')
  // Whether the trace is new enough to have recorded a kind of record at all:
  // read off the version, so an absence is told from a record nobody could write.
  const traceAtLeast = (version: number): boolean => records.some((record) => isFiniteNumber(record.v) && record.v >= version)
  const identitySlips = traceAtLeast(IDENTITY_SLIP_TRACE_VERSION)
    ? { answers: slipRecords.length, ids: slipRecords.reduce((total, record) => total + (Array.isArray(record.slips) ? record.slips.length : 0), 0) }
    : null

  const disposition: AuditDisposition =
    attempt.accepted.status !== 'observed' ? 'acceptance_unconfirmed' : attempt.finalAnswer.status === 'observed' ? 'answered' : 'no_answer'

  // Whether this trace's rounds say when their first fragment arrived (#256,
  // ADR 0057), so a round that streamed nothing is told from one whose trace
  // could not have said.
  const firstTokenRecorded = traceAtLeast(FIRST_TOKEN_TRACE_VERSION)
  // Pass seven, beside the rounds (#266, ADR 0063): the Run's automatic
  // Tier Escalations by arm with the replay's verdict on the round before
  // each, and the decline its budget or deadline stop recorded — where the
  // trace is new enough to have recorded one at all.
  const declined = recordedDeclineOf(records)
  const tierEscalations: TierEscalationRecord = {
    fired: raised.map((escalation) => ({ ...escalation, progressBefore: progressBeforeOf(rounds, escalation.before) })),
    declined: declined === null ? null : { ...declined, progressBefore: progressBeforeOf(rounds, declined.before) },
    declineRecorded: traceAtLeast(TIER_ESCALATION_DECLINE_TRACE_VERSION),
  }
  const tierShadow = tierShadowOf(records)
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
    tierEscalations,
    // An escalation's re-armed budget when the event carried one (#266),
    // else the table: the warnings and the ending count the same number.
    toolRoundBudget: plans.at(-1)?.roundBudget ?? (tier === null ? null : TIER_TOOL_ROUND_BUDGETS[tier]),
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
    mergedCheckpoints,
    bundledCheckpoints: rounds.filter((round) => isAcquisitionRound(round) && round.tags.acceptedCheckpoints > 0).length,
    sameSourceUnsupportedRounds: sameSourceUnsupportedRoundsOf(rounds),
    heldPageRoundsWithoutProgress,
    // Pass eight, beside the rounds (#273, ADR 0065): the orchestrator's reads
    // of a page a Browse Subagent held, from the interleaved trace.
    delegatedPageRounds: delegatedPageRoundsOf(records),
    // Pass nine, beside the rounds (#278, ADR 0068): the tier shadow's answer
    // beside the tier the model declared.
    ...(tierShadow !== undefined ? { tierShadow } : {}),
    mechanicalSearchRounds: searchLoop.mechanicalSearchRounds,
    searchLoopHeads: searchLoop.searchLoopHeads,
    searchRoundsAtStreak2: searchLoop.searchRoundsAtStreak2,
    searchRoundsAtStreak3: searchLoop.searchRoundsAtStreak3,
    searchSource: railObservations !== null ? 'rail' : rounds.some((round) => round.tags.search) ? 'replay' : 'none',
    searchForms: searchFormsOf(rounds),
    blockedOrInert: blockedOrInertOf(rounds),
    unavailableLandings: unavailableLandingsOf(rounds),
    consentWalls: consentWallsOf(raw),
    walledRounds: rounds.filter((round) => round.tags.wall).length,
    notFoundNavigates: rounds.flatMap((round) => round.calls.filter((call) => call.name === 'navigate' && call.notFound !== undefined).map(() => round.round)),
    rewrittenComposedAddresses: rounds.flatMap((round) => round.calls.filter((call) => call.rewritten !== undefined).map(() => round.round)),
    rewrittenShownAddresses: rewrittenShownAddressesOf(raw),
    unseenPhraseRewrites: rounds.flatMap((round) => round.calls.filter((call) => call.unquoted !== undefined).map(() => round.round)),
    subagentCitations: subagentCitationsOf(records),
    engineRewrites: rounds.flatMap((round) => round.calls.filter((call) => call.engineRewrite !== undefined).map(() => round.round)),
    // Result Picks (#277, ADR 0070), beside the rounds: the picks, the
    // listings returned, and the round a result of each search opened in.
    ...resultPickCountsOf(rounds),
    // Selected Passages (#276, ADR 0069), beside the rounds: the checkpoints
    // the Run made, and the model's own record_evidence calls.
    ...selectedPassageCountsOf(records, rounds),
    identitySlips,
    malformedAnswers: records.filter((record) => record.kind === 'malformed_answer').length,
    answerRetries: records.filter((record) => record.kind === 'answer_retry').length,
    // Transport Failures (#271), the Run's and its Subagents', from the
    // `llm_round` records alone: every attempt that failed at the transport,
    // the rounds whose Transport Retry then completed, and whether the Run
    // stopped because the model could not be reached.
    ...transportCountsOf(records, terminal),
    // Pass six, beside the rounds (#256, ADR 0056): the Run's own skipped
    // bookkeeping rounds, where its trace is new enough to have recorded them,
    // and the Finalization rounds its Allowance cut.
    skippedBookkeepingRounds: traceAtLeast(FINALIZATION_ENTRY_TRACE_VERSION)
      ? records.filter((record) => record.kind === 'finalization_entry' && record.agentId === undefined && record.bookkeeping === 'skipped').length
      : null,
    allowanceFinalizationRounds: allowanceFinalizationRoundsOf(rounds),
    // And of those, the ones cut after a first token had streamed, with every
    // round's first-token latency beside them (#256, ADR 0057). Selected from
    // the same rounds as the count above — `rounds` and `classified` share
    // an index — so the silent remainder can never go below zero.
    allowanceFinalizationRoundsStreaming: firstTokenRecorded
      ? rounds.filter((round, index) => round.kind === 'finalization' && round.outcome === 'allowance' && isFiniteNumber(classified[index]!.round.record.firstTokenMs)).length
      : null,
    firstTokens: firstTokenRecorded
      ? classified.flatMap(({ round }, index) => (isFiniteNumber(round.record.firstTokenMs) ? [{ round: index + 1, ms: round.record.firstTokenMs }] : []))
      : null,
    askedItems: {
      declared: askedDeclared,
      stated: askedStated,
      unverified: askedUnverified,
      shapeFailures: records.filter((record) => record.kind === 'asked_items_shape').length,
      shapeRetried: records.filter((record) => record.kind === 'asked_items_shape' && record.retried === true).length,
    },
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
    checksUnsatisfied,
    checksTotal,
  }
  return { ...withoutHash, digestHash: sha256(JSON.stringify(digestPayloadOf(withoutHash))) }
}

/** An Acquisition round, with or without Progress (#254). */
function isAcquisitionRound(round: AuditRound): boolean {
  return round.kind === 'acquisition_with_progress' || round.kind === 'acquisition_without_progress'
}

/**
 * What the hash covers: the digest the reviewer is shown, and nothing about
 * who reviewed it. The grade's status is the reviewer's to read too (#244): an
 * ungraded attempt and one graded with every check unsatisfied hand on the
 * same ids under different labels, so they must not share a cached judgement.
 */
export function digestPayloadOf(mechanical: Omit<AuditMechanical, 'digestHash'>): unknown {
  return {
    attemptId: mechanical.attemptId,
    tier: mechanical.tier,
    plans: mechanical.plans,
    toolRoundBudget: mechanical.toolRoundBudget,
    terminal: mechanical.terminal,
    rounds: mechanical.rounds,
    counts: mechanical.counts,
    shares: mechanical.shares,
    gradeStatus: mechanical.grade?.status ?? null,
    checksUnsatisfied: mechanical.checksUnsatisfied,
    subagent: mechanical.subagent,
  }
}

/** The Finalization rounds the Finalization Allowance cut (#256): read off the rounds, so an audit written before the field still has them. */
function allowanceFinalizationRoundsOf(rounds: readonly AuditRound[]): number {
  return rounds.filter((round) => round.kind === 'finalization' && round.outcome === 'allowance').length
}

/** The nearest-rank percentile of some milliseconds (#256, ADR 0057), or null of none. */
function percentileOf(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!
}

/** One attempt's Finalization line (#256): its skipped bookkeeping rounds, or "not recorded", its cut rounds, and which of those had streamed (ADR 0057). */
function finalizationText(mechanical: AuditMechanical): string {
  const skipped = mechanical.skippedBookkeepingRounds ?? null
  const skips = skipped === null ? `skipped bookkeeping rounds not recorded (a Run Trace below version ${FINALIZATION_ENTRY_TRACE_VERSION})` : `${skipped} bookkeeping round(s) skipped`
  const cut = allowanceFinalizationRoundsOf(mechanical.rounds)
  const streaming = mechanical.allowanceFinalizationRoundsStreaming ?? null
  const split = cut === 0 ? '' : streaming === null ? ' (streaming or silent not recorded)' : ` (${streaming} after a first token, ${cut - streaming} silent)`
  return `${skips}, ${cut} round(s) cut by the Finalization Allowance${split}`
}

/** A population's cut rounds (#256) and their split (ADR 0057), with the first-token latency its rounds measured. */
function populationCutsText(population: AuditPopulation): string {
  const cut = `${population.allowanceFinalizationRounds} Finalization round(s) cut by the Allowance`
  const split =
    population.allowanceFinalizationRounds === 0
      ? ''
      : ` (${population.allowanceFinalizationRoundsStreaming} after a first token, ${population.allowanceFinalizationRoundsSilent} silent${population.allowanceFinalizationRoundsNotRecorded > 0 ? `, ${population.allowanceFinalizationRoundsNotRecorded} not recorded` : ''})`
  const latency = population.firstToken.rounds === 0 ? 'first-token latency not recorded' : `first-token latency p50 ${population.firstToken.p50} ms, p90 ${population.firstToken.p90} ms over ${population.firstToken.rounds} round(s)`
  return `${cut}${split}; ${latency}`
}

/** A population's skipped bookkeeping rounds (#256): the count, or "not recorded" when no attempt's trace could hold one. */
function populationSkipsText(population: AuditPopulation): string {
  if (population.attempts > 0 && population.skippedBookkeepingNotRecorded === population.attempts) return 'skipped bookkeeping rounds not recorded'
  const notRecorded = population.skippedBookkeepingNotRecorded > 0 ? ` (${population.skippedBookkeepingNotRecorded} attempt(s) not recorded)` : ''
  return `${population.skippedBookkeepingRounds} skipped bookkeeping round(s)${notRecorded}`
}

/** One attempt's Asked Items line (#250): "not recorded" where the trace predates the field. */
export function askedItemsText(askedItems: AuditAskedItems | undefined): string {
  if (askedItems === undefined || askedItems.declared === null) return 'not recorded'
  const standings = askedItems.stated === null ? 'no standings on the Answer' : `Answer standings ${askedItems.stated} stated, ${askedItems.unverified} unverified`
  return `${askedItems.declared} declared; ${standings}; ${askedItems.shapeFailures} shape failure(s) (${askedItems.shapeRetried} retried)`
}

/** An attempt with no grade, or a pending one: its `checksUnsatisfied` is every check, and says so as "ungraded". */
export function isUngraded(attempt: { readonly grade: { readonly status: string } | null }): boolean {
  return attempt.grade === null || attempt.grade.status === 'pending'
}

/**
 * The checks unsatisfied in the words the reviewer and the report both read
 * (#244): an ungraded attempt's are "ungraded: every check", never listed as
 * unsatisfied, since no Grade decided them.
 */
export function checksUnsatisfiedText(mechanical: Pick<AuditMechanical, 'grade' | 'checksUnsatisfied' | 'checksTotal'>): string {
  const unsatisfied = mechanical.checksUnsatisfied
  if (unsatisfied === null) return 'no task in the key'
  if (isUngraded(mechanical)) return `ungraded: every check (${unsatisfied.length} of ${mechanical.checksTotal})`
  return unsatisfied.length === 0 ? 'none' : `${unsatisfied.join(', ')} (${unsatisfied.length} of ${mechanical.checksTotal})`
}

// ---------------------------------------------------------------------------
// The reviewer's output

const CHECK_JUDGEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'reason', 'checks'],
  properties: { value: { type: 'boolean' }, reason: { type: 'string' }, checks: { type: 'array', items: { type: 'string' } } },
} as const

/** The JSON schema the reviewer's structured output must satisfy (`claude -p --json-schema`). */
export const JUDGEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['searchLoops', 'offKey', 'overrules', 'stoppedEarly', 'answerOmitted', 'verdict', 'flags'],
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
    stoppedEarly: CHECK_JUDGEMENT_SCHEMA,
    answerOmitted: CHECK_JUDGEMENT_SCHEMA,
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

  // The Early Stop and the Answer Omission (#244): each names checks the Grade
  // left unsatisfied, and no check is named by both.
  const unsatisfied = new Set(mechanical.checksUnsatisfied ?? [])
  const checkJudgement = (field: 'stoppedEarly' | 'answerOmitted'): AuditCheckJudgement | null => {
    const item = isRecord(raw[field]) ? raw[field] : null
    const { value, reason, checks } = item ?? {}
    if (typeof value !== 'boolean' || !isString(reason) || !Array.isArray(checks) || !checks.every(isString)) {
      errors.push(`${field} must carry a boolean value, a reason and a list of checks`)
      return null
    }
    if (reason.trim() === '') errors.push(`${field}.reason is missing`)
    for (const check of checks) if (!unsatisfied.has(check)) errors.push(`${field}.checks names ${check}, which is not a check the Grade left unsatisfied`)
    if (value && checks.length === 0) errors.push(`${field} is true and names no check`)
    if (!value && checks.length > 0) errors.push(`${field} is false and still names ${checks.join(', ')}`)
    return { value, reason, checks: [...checks] }
  }
  const stopped = checkJudgement('stoppedEarly')
  const omitted = checkJudgement('answerOmitted')
  if (stopped !== null && omitted !== null) {
    for (const check of stopped.checks.filter((id) => omitted.checks.includes(id))) {
      errors.push(`${check} is named by both stoppedEarly and answerOmitted — a check needed an unread page or follows from a read one, not both`)
    }
  }

  const verdict = isRecord(raw.verdict) ? raw.verdict : null
  if (verdict === null) errors.push('verdict is missing')
  else {
    if (!isString(verdict.primary) || !(AUDIT_VERDICTS as readonly string[]).includes(verdict.primary)) errors.push('verdict.primary is outside the closed set')
    if (!isString(verdict.primaryReason) || verdict.primaryReason.trim() === '') errors.push('verdict.primaryReason is missing')
    if (verdict.secondary !== null && (!isString(verdict.secondary) || !(AUDIT_VERDICTS as readonly string[]).includes(verdict.secondary))) errors.push('verdict.secondary is outside the closed set')
    if (verdict.secondary !== null && verdict.secondary === verdict.primary) errors.push('verdict.secondary repeats the primary — a secondary verdict must differ')
    if (verdict.secondary !== null && (!isString(verdict.secondaryReason) || verdict.secondaryReason.trim() === '')) errors.push('verdict.secondaryReason is missing for the secondary verdict')
    // A verdict needs its judgement; a judgement never needs its verdict.
    for (const slot of ['primary', 'secondary'] as const) {
      if (verdict[slot] === 'stopped_early' && stopped !== null && !stopped.value) errors.push(`verdict.${slot} is stopped_early, but stoppedEarly.value is false`)
      if (verdict[slot] === 'answer_omitted' && omitted !== null && !omitted.value) errors.push(`verdict.${slot} is answer_omitted, but answerOmitted.value is false`)
    }
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
      stoppedEarly: stopped!,
      answerOmitted: omitted!,
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

/** What stands in an output for a string that restated Grading Key text. */
export const WITHHELD_KEY_TEXT = '[withheld: restates Grading Key text]'

/**
 * The attempts as an output may carry them (#235): any call argument, result
 * head or search query that restates Grading Key text is replaced by
 * WITHHELD_KEY_TEXT. A Run that finds a required fact checkpoints it in words
 * the key uses, and those words are the model's, copied into the digest — the
 * write guard would otherwise refuse the whole set for a hunt that succeeded.
 * Only what is written changes: the digest the reviewer judged, and its hash,
 * stay as they were, so no cached judgement re-keys.
 */
export function withholdKeyText(
  attempts: readonly AuditAttempt[],
  keyTextsFor: (huntId: string) => readonly { readonly label: string; readonly text: string }[],
): { attempts: AuditAttempt[]; withheld: number } {
  let withheld = 0
  const guard = (value: string, texts: readonly { readonly label: string; readonly text: string }[]): string => {
    if (keyLeaks(value, texts).length === 0) return value
    withheld += 1
    return WITHHELD_KEY_TEXT
  }
  const guarded = attempts.map((attempt) => {
    const texts = keyTextsFor(attempt.mechanical.huntId)
    if (texts.length === 0) return attempt
    const rounds = attempt.mechanical.rounds.map((round) => ({
      ...round,
      calls: round.calls.map((call) => ({
        ...call,
        args: Object.fromEntries(Object.entries(call.args).map(([name, value]) => [name, typeof value === 'string' ? guard(value, texts) : value])),
        resultHead: call.resultHead === null ? null : guard(call.resultHead, texts),
        search: call.search === null ? null : { ...call.search, query: guard(call.search.query, texts) },
      })),
    }))
    return { ...attempt, mechanical: { ...attempt.mechanical, rounds } }
  })
  return { attempts: guarded, withheld }
}

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

/** Tool counts, most rounds first and ties by name, so every output lists tools in one order. */
function mostCalledFirst(counts: ReadonlyMap<string, number>): [string, number][] {
  return [...counts.entries()].sort(([leftTool, left], [rightTool, right]) => right - left || leftTool.localeCompare(rightTool))
}

/** The navigates that landed on a Not-found Page in rounds the reviewer judged Off-key (#239). */
export function notFoundOffKeyOf(mechanical: AuditMechanical, judgement: AuditJudgement): number {
  return mechanical.notFoundNavigates.filter((round) => judgement.offKey.some((item) => item.round === round)).length
}

/** The rewritten Composed Addresses in rounds the reviewer judged Off-key (#255); an audit written before the counter holds none. */
export function rewrittenOffKeyOf(mechanical: AuditMechanical, judgement: AuditJudgement): number {
  return (mechanical.rewrittenComposedAddresses ?? []).filter((round) => judgement.offKey.some((item) => item.round === round)).length
}

/** The Unseen Phrase rewrites in rounds the reviewer judged Off-key (#267); an audit written before the counter holds none. */
export function unseenPhraseOffKeyOf(mechanical: AuditMechanical, judgement: AuditJudgement): number {
  return (mechanical.unseenPhraseRewrites ?? []).filter((round) => judgement.offKey.some((item) => item.round === round)).length
}

/** The Engine Rewrites in rounds the reviewer judged Off-key (#270); an audit written before the counter holds none. */
export function engineRewriteOffKeyOf(mechanical: AuditMechanical, judgement: AuditJudgement): number {
  return (mechanical.engineRewrites ?? []).filter((round) => judgement.offKey.some((item) => item.round === round)).length
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
  let atStreak2 = 0
  let atStreak3 = 0
  let inherited = 0
  let merged = 0
  let bundled = 0
  let sameSourceUnsupported = 0
  let heldPageRounds = 0
  let delegatedPageRounds: DelegatedPageCounts | undefined
  let tierShadow: TierShadowCounts | undefined
  let rejected = 0
  let walled = 0
  let notFound = 0
  let notFoundOffKey = 0
  let rewritten = 0
  let rewrittenOffKey = 0
  let rewrittenShown = 0
  let unseenPhrases = 0
  let unseenPhrasesOffKey = 0
  let engineRewrites = 0
  let engineRewritesOffKey = 0
  let resultPicks: { picks: number; listings: number; searches: number; opened: number; rounds: number } | undefined
  let passages: { runMade: number; modelCalls: number; bookkeeping: number } | undefined
  let searchForms: Record<SearchUrlForm, number> | undefined
  let blockedOrInert: Record<keyof BlockedOrInertCounts, number> | undefined
  let unavailableLandings: Record<keyof UnavailableLandingRounds, number> | undefined
  let consentWalls: ConsentWallCounts | undefined
  let tierEscalations: TierEscalationCounts | undefined
  let subagentCitations: SubagentCitationCounts | undefined
  let slipAnswers = 0
  let slipIds = 0
  let slipsNotRecorded = 0
  let malformedAnswers = 0
  let answerRetries = 0
  let transportAttempts = 0
  let transportRetriesRecovered = 0
  let modelUnreachableRuns = 0
  let skippedBookkeeping = 0
  let skippedBookkeepingNotRecorded = 0
  let allowanceFinalization = 0
  let allowanceStreaming = 0
  let allowanceSilent = 0
  let allowanceNotRecorded = 0
  const firstTokens: number[] = []
  let askedItemsDeclared = 0
  let askedItemsUnverified = 0
  let askedItemsShapeFailures = 0
  let askedItemsShapeRetried = 0
  let subagentRounds = 0
  let stoppedEarly = 0
  let answerOmitted = 0
  let overrules = 0
  let flags = 0
  let atBudget = 0
  const sources: Record<AuditSearchSource, number> = { rail: 0, replay: 0, none: 0 }
  const byTool = new Map<string, number>()
  for (const attempt of attempts) {
    const { mechanical } = attempt
    // The same rounds `toolRoundsUsed` counts: outside Finalization, with a call.
    for (const round of mechanical.rounds) {
      if (round.kind === 'finalization') continue
      for (const tool of new Set(round.calls.map((call) => call.name))) byTool.set(tool, (byTool.get(tool) ?? 0) + 1)
    }
    addCounts(counts, mechanical.counts)
    addCounts(after, attempt.countsAfterOverrules)
    rounds += mechanical.orchestratorRounds
    budgeted += mechanical.budgetedRounds
    toolRoundsUsed += mechanical.toolRoundsUsed
    mechanicalSearch += mechanical.mechanicalSearchRounds
    atStreak2 += mechanical.searchRoundsAtStreak2
    atStreak3 += mechanical.searchRoundsAtStreak3
    sources[mechanical.searchSource] += 1
    inherited += mechanical.inheritedRounds
    merged += mechanical.mergedCheckpoints
    bundled += mechanical.bundledCheckpoints
    sameSourceUnsupported += mechanical.sameSourceUnsupportedRounds
    heldPageRounds += mechanical.heldPageRoundsWithoutProgress
    if (mechanical.delegatedPageRounds !== undefined) addDelegatedPageRounds((delegatedPageRounds ??= emptyDelegatedPageCounts()), mechanical.delegatedPageRounds)
    if (mechanical.tierShadow !== undefined) addTierShadow((tierShadow ??= emptyTierShadowCounts()), mechanical.tierShadow, mechanical.terminal?.finalizationCause ?? null)
    rejected += mechanical.rejectedCheckpoints
    walled += mechanical.walledRounds
    notFound += mechanical.notFoundNavigates.length
    rewritten += mechanical.rewrittenComposedAddresses?.length ?? 0
    rewrittenShown += mechanical.rewrittenShownAddresses?.length ?? 0
    unseenPhrases += mechanical.unseenPhraseRewrites?.length ?? 0
    engineRewrites += mechanical.engineRewrites?.length ?? 0
    if (mechanical.resultPicks !== undefined && mechanical.listingsReturned !== undefined && mechanical.searchesToOpened !== undefined) {
      resultPicks ??= { picks: 0, listings: 0, searches: 0, opened: 0, rounds: 0 }
      resultPicks.picks += mechanical.resultPicks.length
      resultPicks.listings += mechanical.listingsReturned.length
      resultPicks.searches += mechanical.searchesToOpened.length
      for (const search of mechanical.searchesToOpened) {
        if (search.openedRound === null) continue
        resultPicks.opened += 1
        resultPicks.rounds += search.openedRound - search.round + 1
      }
    }
    if (mechanical.runMadeCheckpoints !== undefined && mechanical.modelRecordEvidenceCalls !== undefined) {
      passages ??= { runMade: 0, modelCalls: 0, bookkeeping: 0 }
      passages.runMade += mechanical.runMadeCheckpoints.length
      passages.modelCalls += mechanical.modelRecordEvidenceCalls
      passages.bookkeeping += mechanical.counts.bookkeeping
    }
    if (mechanical.searchForms !== undefined) {
      searchForms ??= emptySearchForms()
      for (const form of SEARCH_URL_FORMS) searchForms[form] += mechanical.searchForms[form]
    }
    if (mechanical.blockedOrInert !== undefined) addBlockedOrInert((blockedOrInert ??= emptyBlockedOrInertCounts()), mechanical.blockedOrInert)
    if (mechanical.unavailableLandings !== undefined) {
      unavailableLandings ??= { status: 0, title: 0, followedBySearch: 0 }
      unavailableLandings.status += mechanical.unavailableLandings.status.length
      unavailableLandings.title += mechanical.unavailableLandings.title.length
      unavailableLandings.followedBySearch += mechanical.unavailableLandings.followedBySearch.length
    }
    if (mechanical.consentWalls !== undefined) addConsentWalls((consentWalls ??= emptyConsentWallCounts()), mechanical.consentWalls)
    if (mechanical.tierEscalations !== undefined) tierEscalations = addTierEscalations(tierEscalations ?? emptyTierEscalationCounts(), mechanical.tierEscalations)
    if (mechanical.subagentCitations !== undefined) addSubagentCitations((subagentCitations ??= emptySubagentCitationCounts()), mechanical.subagentCitations)
    if (mechanical.identitySlips === null) slipsNotRecorded += 1
    else {
      slipAnswers += mechanical.identitySlips.answers
      slipIds += mechanical.identitySlips.ids
    }
    malformedAnswers += mechanical.malformedAnswers
    answerRetries += mechanical.answerRetries
    transportAttempts += mechanical.transportAttempts ?? 0
    transportRetriesRecovered += mechanical.transportRetriesRecovered ?? 0
    modelUnreachableRuns += mechanical.modelUnreachableRuns ?? 0
    // An attempt read from an audit written before #256 has no field at all: not recorded, like a version-2 trace.
    if ((mechanical.skippedBookkeepingRounds ?? null) === null) skippedBookkeepingNotRecorded += 1
    else skippedBookkeeping += mechanical.skippedBookkeepingRounds!
    allowanceFinalization += allowanceFinalizationRoundsOf(mechanical.rounds)
    // The split (#256, ADR 0057): an attempt whose trace could not say counts its cuts as not recorded, never as silent.
    const streaming = mechanical.allowanceFinalizationRoundsStreaming ?? null
    if (streaming === null) allowanceNotRecorded += allowanceFinalizationRoundsOf(mechanical.rounds)
    else {
      allowanceStreaming += streaming
      allowanceSilent += allowanceFinalizationRoundsOf(mechanical.rounds) - streaming
    }
    for (const token of mechanical.firstTokens ?? []) firstTokens.push(token.ms)
    if ((mechanical.askedItems?.declared ?? 0) > 0) askedItemsDeclared += 1
    if ((mechanical.askedItems?.unverified ?? 0) > 0) askedItemsUnverified += 1
    askedItemsShapeFailures += mechanical.askedItems?.shapeFailures ?? 0
    askedItemsShapeRetried += mechanical.askedItems?.shapeRetried ?? 0
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
    notFoundOffKey += notFoundOffKeyOf(mechanical, judgement)
    rewrittenOffKey += rewrittenOffKeyOf(mechanical, judgement)
    unseenPhrasesOffKey += unseenPhraseOffKeyOf(mechanical, judgement)
    engineRewritesOffKey += engineRewriteOffKeyOf(mechanical, judgement)
    searchLoop += new Set(judgement.searchLoops.flatMap((loop) => loop.rounds)).size
    if (judgement.stoppedEarly.value) stoppedEarly += 1
    if (judgement.answerOmitted.value) answerOmitted += 1
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
    searchRoundsAtStreak2: atStreak2,
    searchRoundsAtStreak3: atStreak3,
    searchSources: sources,
    ...(searchForms === undefined ? {} : { searchForms }),
    ...(blockedOrInert === undefined ? {} : { blockedOrInert }),
    ...(unavailableLandings === undefined ? {} : { unavailableLandings }),
    ...(consentWalls === undefined ? {} : { consentWalls }),
    ...(tierEscalations === undefined ? {} : { tierEscalations }),
    ...(subagentCitations === undefined ? {} : { subagentCitations }),
    inheritedRounds: inherited,
    mergedCheckpoints: merged,
    bundledCheckpoints: bundled,
    sameSourceUnsupportedRounds: sameSourceUnsupported,
    heldPageRoundsWithoutProgress: heldPageRounds,
    ...(delegatedPageRounds !== undefined ? { delegatedPageRounds } : {}),
    ...(tierShadow !== undefined ? { tierShadow } : {}),
    rejectedCheckpoints: rejected,
    walledRounds: walled,
    notFoundNavigates: notFound,
    notFoundOffKey,
    rewrittenComposedAddresses: rewritten,
    rewrittenComposedAddressesOffKey: rewrittenOffKey,
    rewrittenShownAddresses: rewrittenShown,
    unseenPhraseRewrites: unseenPhrases,
    unseenPhraseRewritesOffKey: unseenPhrasesOffKey,
    engineRewrites,
    engineRewritesOffKey,
    ...(resultPicks !== undefined
      ? {
          resultPicks: resultPicks.picks,
          listingsReturned: resultPicks.listings,
          searchesCounted: resultPicks.searches,
          searchesOpened: resultPicks.opened,
          roundsToOpened: resultPicks.rounds,
        }
      : {}),
    ...(passages !== undefined
      ? { runMadeCheckpoints: passages.runMade, modelRecordEvidenceCalls: passages.modelCalls, bookkeepingRoundsWherePassagesCounted: passages.bookkeeping }
      : {}),
    identitySlipAnswers: slipAnswers,
    identitySlipIds: slipIds,
    identitySlipsNotRecorded: slipsNotRecorded,
    malformedAnswers,
    answerRetries,
    transportAttempts,
    transportRetriesRecovered,
    modelUnreachableRuns,
    skippedBookkeepingRounds: skippedBookkeeping,
    skippedBookkeepingNotRecorded,
    allowanceFinalizationRounds: allowanceFinalization,
    allowanceFinalizationRoundsStreaming: allowanceStreaming,
    allowanceFinalizationRoundsSilent: allowanceSilent,
    allowanceFinalizationRoundsNotRecorded: allowanceNotRecorded,
    firstToken: { rounds: firstTokens.length, p50: percentileOf(firstTokens, 0.5), p90: percentileOf(firstTokens, 0.9) },
    askedItemsDeclared,
    askedItemsUnverified,
    askedItemsShapeFailures,
    askedItemsShapeRetried,
    subagentRounds,
    stoppedEarly,
    answerOmitted,
    overrules,
    flags,
    finalizationCauses: Object.fromEntries(Object.entries(causes).sort(([left], [right]) => left.localeCompare(right))),
    attemptsAtBudget: atBudget,
    toolRounds: mostCalledFirst(byTool).map(([tool, rounds]) => ({ tool, rounds, share: toolRoundsUsed === 0 ? null : rounds / toolRoundsUsed })),
  }
}

/**
 * Malformed Answers that predate the `malformed_answer` record (#245), named
 * from the issue's diagnosis rather than re-parsed from Answer text (ADR
 * 0049): the attempt's count stays zero, and the set holding it says why.
 */
export const PRE_RECORD_MALFORMED_ANSWERS: readonly { readonly captureId: string; readonly attemptId: string; readonly round: number }[] = [
  { captureId: 'baseline-1--rule-eurostar-luggage', attemptId: 'rule-eurostar-luggage--initial', round: 7 },
]

/** The caveat each known pre-record Malformed Answer among these attempts earns. */
export function preRecordMalformedAnswerCaveats(attempts: readonly AuditAttempt[]): string[] {
  return PRE_RECORD_MALFORMED_ANSWERS.filter((known) =>
    attempts.some(({ mechanical }) => mechanical.captureId === known.captureId && mechanical.attemptId === known.attemptId),
  ).map(
    (known) =>
      `${known.attemptId} replied with a Malformed Answer in round ${known.round}, before the malformed_answer record existed (#245): its count reads 0, and the audit does not re-parse Answer text to find it`,
  )
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
    caveats: [...caveats, ...preRecordMalformedAnswerCaveats(attempts)],
    note: AUDIT_COUNTS_NOTE,
  }
}

/** Which provenance fields every set of one audit must share, and how each reads. */
const SHARED_FIELDS: readonly { readonly name: string; readonly allowable?: AllowedDifference; readonly of: (provenance: AuditProvenance) => string }[] = [
  { name: 'key version', of: (provenance) => provenance.keyVersion },
  { name: 'key manifest digest', of: (provenance) => provenance.keyManifestDigest },
  { name: 'routing', allowable: 'routing', of: (provenance) => provenance.roles.join('; ') },
  { name: 'grades reviewer', of: (provenance) => provenance.gradesReviewers.join('; ') },
  { name: 'study', of: (provenance) => provenance.study },
  { name: 'protocol version', of: (provenance) => provenance.protocolVersion },
  { name: 'mode', of: (provenance) => provenance.mode },
  { name: 'adblock', of: (provenance) => provenance.adblock },
  { name: 'reasoning-effort override', of: (provenance) => provenance.reasoningEffortOverride ?? 'none' },
  { name: 'decision seams', of: (provenance) => decisionSeamsLabel(provenance.decisionSeams) },
  { name: 'effort overrides', of: (provenance) => provenance.effortOverrides.join(', ') || 'none' },
  { name: 'browser sub-spans', of: (provenance) => (provenance.browserSubspans ? 'on' : 'off') },
  { name: 'prompt versions', of: (provenance) => provenance.promptVersions.join(', ') },
  { name: 'audit reviewer model', of: (provenance) => provenance.reviewerModel },
  { name: 'audit reviewer effort', of: (provenance) => provenance.reviewerEffort },
  { name: 'audit prompt version', of: (provenance) => provenance.reviewerPromptVersion },
]

function aggregatePopulation(label: string, relation: AttemptRelation, sets: readonly AuditSetOutput[], pick: (set: AuditSetOutput) => AuditPopulation): AuditAggregatePopulation {
  const attempts = sets.flatMap((set) => set.attempts.filter((attempt) => attempt.mechanical.relation === relation))
  return { ...populationOf(label, attempts), perSet: sets.map((set) => ({ setId: set.provenance.setId, population: pick(set) })) }
}

/** How an aggregate may be told to pool across one shared field (#279). */
export interface AuditAggregateOptions {
  /** The one field allowed to differ between sets; every other stays refused. */
  readonly allowDiffers?: AllowedDifference
}

/** Read N per-set audits together. Refuses sets whose shared provenance differs, save one field the caller allows; counts the rest. */
export function buildAuditAggregate(sets: readonly AuditSetOutput[], generatedAt: string, options: AuditAggregateOptions = {}): Validation<AuditAggregate> {
  if (sets.length < 2) return { ok: false, errors: [`${sets.length} set(s) named; an aggregate needs at least two — for one set, read its audit`] }
  const errors: string[] = []
  const ids = new Map<string, number>()
  for (const set of sets) ids.set(set.provenance.setId, (ids.get(set.provenance.setId) ?? 0) + 1)
  for (const [setId, count] of ids) if (count > 1) errors.push(`capture set ${setId} is named ${count} times: one set counts once`)
  if (errors.length > 0) return { ok: false, errors }
  const ordered = [...sets].sort((left, right) => Date.parse(left.provenance.createdAt) - Date.parse(right.provenance.createdAt))
  for (const field of SHARED_FIELDS) {
    if (field.allowable !== undefined && field.allowable === options.allowDiffers) continue
    const values = ordered.map((set) => field.of(set.provenance))
    if (new Set(values).size > 1) errors.push(`${field.name} differs: ${ordered.map((set, index) => `${set.provenance.setId}=${values[index]}`).join(', ')}`)
  }
  if (errors.length > 0) return { ok: false, errors }

  const shared = ordered[0]!.provenance
  const initial = aggregatePopulation('initial', 'initial', ordered, (set) => set.populations.initial)
  const followUp = aggregatePopulation('follow_up', 'revised_objective', ordered, (set) => set.populations.followUp)
  const consentWallsByHunt = consentWallsByHuntOf(ordered.flatMap((set) => set.attempts))
  const blockedActionsByHunt = blockedActionsByHuntOf(ordered.flatMap((set) => set.attempts))
  const tierEscalationsByHunt = tierEscalationsByHuntOf(ordered.flatMap((set) => set.attempts))
  const rewritesByHunt = rewritesByHuntOf(ordered.flatMap((set) => set.attempts))
  const tierShadowByHunt = tierShadowByHuntOf(ordered.flatMap((set) => set.attempts))
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
          decisionSeams: shared.decisionSeams ?? null,
          effortOverrides: shared.effortOverrides,
          adblock: shared.adblock,
          browserSubspans: shared.browserSubspans,
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
        allowedDifference:
          options.allowDiffers === undefined
            ? null
            : {
                field: options.allowDiffers,
                values: ordered.map((set) => ({
                  setId: set.provenance.setId,
                  value: SHARED_FIELDS.find((field) => field.allowable === options.allowDiffers)!.of(set.provenance),
                })),
              },
      },
      populations: { initial, followUp },
      rankedCauses,
      ...(consentWallsByHunt === undefined ? {} : { consentWallsByHunt }),
      ...(blockedActionsByHunt === undefined ? {} : { blockedActionsByHunt }),
      ...(tierEscalationsByHunt === undefined ? {} : { tierEscalationsByHunt }),
      ...(rewritesByHunt === undefined ? {} : { rewritesByHunt }),
      ...(tierShadowByHunt === undefined ? {} : { tierShadowByHunt }),
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
  answer_omitted: 'answer omitted',
  failed_rounds: 'failed rounds',
}

/** What each search source means, as an attempt's report names it (#243). */
const SEARCH_SOURCE_NOTES: Readonly<Record<AuditSearchSource, string>> = {
  rail: 'the rail’s own Search Observations, the streak replayed by its rule',
  replay: 'the streak rule re-run over navigate searches',
  none: 'no Search Observation in the trace, and no navigate search for the replay to find',
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

/** Each tool's rounds and share, one column per population, most called overall first (#235). */
function toolRoundTable(populations: readonly AuditPopulation[]): string[] {
  const totals = new Map<string, number>()
  for (const population of populations) {
    for (const entry of population.toolRounds) totals.set(entry.tool, (totals.get(entry.tool) ?? 0) + entry.rounds)
  }
  const tools = mostCalledFirst(totals).map(([tool]) => tool)
  const lines = [`| tool | ${populations.map((population) => population.label).join(' | ')} |`, `| --- | ${populations.map(() => '---').join(' | ')} |`]
  for (const tool of tools) {
    const cells = populations.map((population) => {
      const entry = population.toolRounds.find((candidate) => candidate.tool === tool)
      return entry === undefined ? '0' : `${entry.rounds} (${pct(entry.share)})`
    })
    lines.push(`| ${tool} | ${cells.join(' | ')} |`)
  }
  return lines
}

const TOOL_ROUNDS_NOTE = 'The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.'

function verdictTable(populations: readonly AuditPopulation[]): string[] {
  const lines = ['| verdict | ' + populations.map((population) => `${population.label} primary | ${population.label} secondary`).join(' | ') + ' |', `| --- | ${populations.map(() => '--- | ---').join(' | ')} |`]
  for (const verdict of AUDIT_VERDICTS) {
    lines.push(`| ${VERDICT_LABELS[verdict]} | ${populations.map((population) => `${population.verdictsPrimary[verdict]} | ${population.verdictsSecondary[verdict]}`).join(' | ')} |`)
  }
  return lines
}

/** The two Identity Slip counts (#246), in the one wording an attempt and a population share. */
function slipCountsText(answers: number, ids: number): string {
  return `${answers} Answer(s) with an Identity Slip, ${ids} id(s) slipped`
}

/** A population's Identity Slips (#246): the two counts, or "not recorded" when no attempt's trace could hold one. */
function populationSlipsText(population: AuditPopulation): string {
  if (population.attempts > 0 && population.identitySlipsNotRecorded === population.attempts) return 'Identity Slips not recorded'
  const notRecorded = population.identitySlipsNotRecorded > 0 ? ` (${population.identitySlipsNotRecorded} attempt(s) not recorded)` : ''
  return `${slipCountsText(population.identitySlipAnswers, population.identitySlipIds)}${notRecorded}`
}

/** The #272 gate's two numbers, or that the audit predates them — never a zero it did not count. */
function subagentCitationsText(counts: Readonly<SubagentCitationCounts> | undefined): string {
  return counts === undefined
    ? 'subagent citations not counted'
    : `subagent citations: ${counts.excerptUnsupported} excerpt_unsupported, ${counts.droppedExcerpts} applied with a dropped excerpt`
}

/** The Transport Failure counters in one phrase (#271); an audit written before them says so. */
function transportText(counts: Pick<AuditMechanical, 'transportAttempts' | 'transportRetriesRecovered' | 'modelUnreachableRuns'>): string {
  if (counts.transportAttempts === undefined) return 'Transport Failures not counted'
  return `${counts.transportAttempts} Transport Failure attempt(s) (${counts.transportRetriesRecovered ?? 0} round(s) recovered by a Transport Retry, ${counts.modelUnreachableRuns ?? 0} Run(s) model_unreachable)`
}

/** A population's Delegated Page rounds by the holder's state (#273), or that no audit counted them. */
function delegatedPageCountsText(counts: DelegatedPageCounts | undefined): string {
  return counts === undefined
    ? 'Delegated Page rounds not counted'
    : `Delegated Page rounds ${counts.running} while running, ${counts.finished} while finished and uncollected, ${counts.collected} after collection`
}

/** One attempt's Delegated Page rounds by the holder's state, with their round numbers (#273). */
function delegatedPageRoundsText(rounds: DelegatedPageRounds | undefined): string {
  if (rounds === undefined) return 'not counted'
  const phase = (label: string, numbers: readonly number[]): string => `${numbers.length} ${label}${numbers.length > 0 ? ` (round ${numbers.join(', ')})` : ''}`
  return [phase('while running', rounds.running), phase('while finished and uncollected', rounds.finished), phase('after collection', rounds.collected)].join(', ')
}

/** A population's Result Picks (#277): the picks against the listings returned, and how soon a result of a search was opened. */
function populationResultPicksText(population: AuditPopulation): string {
  if (population.resultPicks === undefined) return 'Result Picks not counted'
  const opened = population.searchesOpened ?? 0
  const mean = opened === 0 ? 'no search had a result opened' : `a search’s result opened in ${((population.roundsToOpened ?? 0) / opened).toFixed(1)} round(s) on average`
  return `${population.resultPicks} Result Pick(s) against ${population.listingsReturned ?? 0} listing(s) returned to the model, ${mean} (${opened} of ${population.searchesCounted ?? 0} searches)`
}

/** A population's Selected Passages (#276): the Run's checkpoints against the model's own calls and the bookkeeping-only rounds. */
function populationSelectedPassagesText(population: AuditPopulation): string {
  if (population.runMadeCheckpoints === undefined) return 'Selected Passages not counted'
  return `${population.runMadeCheckpoints} Run-made Evidence Checkpoint(s) from a Selected Passage against ${population.modelRecordEvidenceCalls ?? 0} record_evidence call(s) by the model and ${population.bookkeepingRoundsWherePassagesCounted ?? 0} bookkeeping-only round(s)`
}

function judgementLines(populations: readonly AuditPopulation[]): string[] {
  return populations.map(
    (population) =>
      `- ${population.label}: ${population.offKeyRounds} Off-key round(s), ${population.searchLoopRounds} Search Loop round(s) by the reviewer (${population.mechanicalSearchRounds} by the streak rule, heads included: ${population.searchRoundsAtStreak2} at streak 2 or beyond, ${population.searchRoundsAtStreak3} at 3 or beyond; attempts by search source ${SEARCH_SOURCES.map((source) => `${source} ${population.searchSources[source]}`).join(', ')}; navigate searches by Search URL form ${searchFormsText(population.searchForms)}; ${populationBlockedOrInertText(population.blockedOrInert)}; ${populationUnavailableLandingsText(population.unavailableLandings)}; ${populationConsentWallsText(population.consentWalls)}; ${populationTierEscalationsText(population.tierEscalations)}), ` +
      `${population.inheritedRounds} inherited, ${population.rejectedCheckpoints} rejected Evidence Checkpoint(s), ${population.walledRounds} walled round(s), ${population.notFoundNavigates} navigate(s) landed on a Not-found Page (${population.notFoundOffKey} judged Off-key), ${population.rewrittenComposedAddresses ?? 0} Composed Address(es) rewritten into a site search (${population.rewrittenComposedAddressesOffKey ?? 0} judged Off-key, ${population.rewrittenShownAddresses ?? 'not counted'} to an address the Run was shown), ${population.unseenPhraseRewrites ?? 'not counted'} search(es) ran with an Unseen Phrase unquoted (${population.unseenPhraseRewritesOffKey ?? 0} judged Off-key), ${population.engineRewrites ?? 'not counted'} search(es) ran on the Run Engine in place of another Web Engine (${population.engineRewritesOffKey ?? 0} judged Off-key), ${populationResultPicksText(population)}, ${populationSelectedPassagesText(population)}, ${population.subagentRounds} Subagent round(s), ` +
      `${population.mergedCheckpoints} merged Evidence Checkpoint(s) (a floor), ${population.heldPageRoundsWithoutProgress} Held Page round(s) without Progress, ${population.bundledCheckpoints} bundled checkpoint round(s), ${population.sameSourceUnsupportedRounds} same-source unsupported round(s), ${subagentCitationsText(population.subagentCitations)}, ${populationSlipsText(population)}, ${delegatedPageCountsText(population.delegatedPageRounds)}, ` +
      `${population.malformedAnswers} Malformed Answer(s) (${population.answerRetries} retried), ` +
      `${transportText(population)}, ` +
      `${populationSkipsText(population)}, ${populationCutsText(population)}, ` +
      `${population.askedItemsDeclared} declared Asked Items (${population.askedItemsUnverified} with an unverified standing, ${population.askedItemsShapeFailures} shape failure(s), ${population.askedItemsShapeRetried} retried), ` +
      `${population.stoppedEarly} stopped early, ${population.answerOmitted} answer omitted, ${population.overrules} overrule(s), ${population.flags} flag(s); Finalization Causes: ${Object.entries(population.finalizationCauses)
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
      `tier ${mechanical.tier ?? 'none'}${attemptTierEscalationsText(mechanical)}; ` +
      `${toolRoundsUsedText(mechanical)}; ${mechanical.orchestratorRounds} orchestrator rounds, ${mechanical.counts.finalization} in Finalization; ` +
      `Run duration ${msOf(mechanical.runDurationMs)}; LLM stage ${mechanical.latency.llmMs === null ? 'unjoined' : `${mechanical.latency.llmMs} ms over ${mechanical.latency.joined} joined round(s)`}${mechanical.latency.unjoined > 0 ? ` (${mechanical.latency.unjoined} unjoined)` : ''}`,
  )
  lines.push(
    `- grade ${mechanical.grade?.status ?? 'none'}; checks unsatisfied: ${checksUnsatisfiedText(mechanical)}`,
  )
  lines.push(
    `- ${mechanical.subagent.rounds} Subagent round(s) over ${mechanical.subagent.agents} Subagent(s)${Object.keys(mechanical.subagent.byStop).length > 0 ? `, stopped by ${Object.entries(mechanical.subagent.byStop).map(([stop, count]) => `${stop} ${count}`).join(', ')}` : ''}; ` +
      `${mechanical.acceptedCheckpoints} accepted (${mechanical.mergedCheckpoints} merged, a floor) and ${mechanical.rejectedCheckpoints} rejected Evidence Checkpoint(s); ${mechanical.inheritedRounds} inherited round(s); ` +
      `${mechanical.heldPageRoundsWithoutProgress} Held Page round(s) without Progress; ${mechanical.bundledCheckpoints} bundled checkpoint round(s); ${mechanical.sameSourceUnsupportedRounds} same-source unsupported round(s); ${subagentCitationsText(mechanical.subagentCitations)}; ${mechanical.walledRounds} walled round(s)`,
  )
  lines.push(`- Delegated Page rounds: ${delegatedPageRoundsText(mechanical.delegatedPageRounds)}`)
  lines.push(`- Tier shadow: ${tierShadowText(mechanical.tierShadow)}`)
  lines.push(`- Malformed Answers: ${mechanical.malformedAnswers} (${mechanical.answerRetries} retried)`)
  lines.push(`- Transport Failures: ${transportText(mechanical)}`)
  lines.push(`- Finalization: ${finalizationText(mechanical)}`)
  lines.push(`- Asked Items: ${askedItemsText(mechanical.askedItems)}`)
  const landings = mechanical.notFoundNavigates
  lines.push(`- navigates that landed on a Not-found Page: ${landings.length}${landings.length > 0 ? ` (round ${landings.join(', ')})` : ''}`)
  lines.push(`- of those, judged Off-key by the reviewer: ${judgement === null ? 'not judged' : notFoundOffKeyOf(mechanical, judgement)}`)
  const rewrites = mechanical.rewrittenComposedAddresses ?? []
  lines.push(`- Composed Addresses rewritten into a site search: ${rewrites.length}${rewrites.length > 0 ? ` (round ${rewrites.join(', ')})` : ''}`)
  lines.push(`- of the rewrites, judged Off-key by the reviewer: ${judgement === null ? 'not judged' : rewrittenOffKeyOf(mechanical, judgement)}`)
  const shown = mechanical.rewrittenShownAddresses
  lines.push(`- of the rewrites, to an address the Run was shown, whole or cut: ${shown === undefined ? 'not counted' : `${shown.length}${shown.length > 0 ? ` (round ${shown.join(', ')})` : ''}`}`)
  const unseen = mechanical.unseenPhraseRewrites
  lines.push(`- searches that ran with an Unseen Phrase unquoted: ${unseen === undefined ? 'not counted' : `${unseen.length}${unseen.length > 0 ? ` (round ${unseen.join(', ')})` : ''}`}`)
  lines.push(`- of those, judged Off-key by the reviewer: ${judgement === null ? 'not judged' : unseenPhraseOffKeyOf(mechanical, judgement)}`)
  const engines = mechanical.engineRewrites
  lines.push(`- searches that ran on the Run Engine in place of another Web Engine: ${engines === undefined ? 'not counted' : `${engines.length}${engines.length > 0 ? ` (round ${engines.join(', ')})` : ''}`}`)
  lines.push(`- of those, judged Off-key by the reviewer: ${judgement === null ? 'not judged' : engineRewriteOffKeyOf(mechanical, judgement)}`)
  const rounds = (numbers: readonly number[]): string => `${numbers.length}${numbers.length > 0 ? ` (round ${numbers.join(', ')})` : ''}`
  lines.push(
    mechanical.resultPicks === undefined || mechanical.listingsReturned === undefined
      ? '- Result Picks: not counted'
      : `- Result Picks: ${rounds(mechanical.resultPicks)}; listings returned to the model: ${rounds(mechanical.listingsReturned)}`,
  )
  lines.push(
    mechanical.runMadeCheckpoints === undefined || mechanical.modelRecordEvidenceCalls === undefined
      ? '- Selected Passages: not counted'
      : `- Evidence Checkpoints the Run made from a Selected Passage: ${rounds(mechanical.runMadeCheckpoints)}; record_evidence calls by the model: ${mechanical.modelRecordEvidenceCalls}; bookkeeping-only rounds: ${mechanical.counts.bookkeeping}`,
  )
  const toOpen = mechanical.searchesToOpened
  lines.push(
    `- rounds from a search to an opened result: ${
      toOpen === undefined ? 'not counted' : toOpen.length === 0 ? 'no search' : toOpen.map((search) => (search.openedRound === null ? 'none' : String(search.openedRound - search.round + 1))).join(', ')
    }`,
  )
  const slips = mechanical.identitySlips
  lines.push(`- Identity Slips: ${slips === null ? `not recorded (a Run Trace below version ${IDENTITY_SLIP_TRACE_VERSION})` : slipCountsText(slips.answers, slips.ids)}`)
  lines.push(`- kinds: ${ROUND_KINDS.map((kind) => `${KIND_LABELS[kind]} ${mechanical.counts[kind]} (${pct(mechanical.shares[kind])})`).join(' · ')}`)
  lines.push(`- search source ${mechanical.searchSource}: ${SEARCH_SOURCE_NOTES[mechanical.searchSource]}`)
  lines.push(`- navigate searches by Search URL form: ${searchFormsText(mechanical.searchForms)}`)
  lines.push(`- ${blockedOrInertText(mechanical.blockedOrInert)}`)
  lines.push(`- ${unavailableLandingsText(mechanical.unavailableLandings)}`)
  lines.push(`- ${consentWallsText(mechanical.consentWalls)}`)
  lines.push(`- ${tierEscalationsText(mechanical.tierEscalations)}`)
  if (review === null) lines.push('- reviewer: not consulted')
  else if (judgement === null) lines.push(`- reviewer: no judgement — ${review.caveats.join('; ')}`)
  else {
    const { verdict } = judgement
    lines.push(`- **verdict: ${VERDICT_LABELS[verdict.primary]}** — ${verdict.primaryReason}`)
    if (verdict.secondary !== null) lines.push(`- secondary: ${VERDICT_LABELS[verdict.secondary]} — ${verdict.secondaryReason}`)
    for (const [label, item] of [['stopped early', judgement.stoppedEarly], ['answer omitted', judgement.answerOmitted]] as const) {
      lines.push(`- ${label}: ${item.value ? `yes (${item.checks.join(', ')})` : 'no'} — ${item.reason}`)
    }
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
    const markers = [round.tags.inherited ? 'inherited' : '', round.tags.wall ? 'walled' : '', round.calls.some((call) => call.notFound !== undefined) ? 'not found' : '', round.calls.some((call) => call.unavailable !== undefined) ? 'unavailable' : '', round.calls.some((call) => call.rewritten !== undefined) ? 'rewritten' : '', round.calls.some((call) => call.unquoted !== undefined) ? 'unquoted' : '', round.calls.some((call) => call.engineRewrite !== undefined) ? 'engine rewritten' : '', round.calls.some((call) => call.resultPick?.opened === true) ? 'result pick' : '', offKey ? 'off-key' : '', inLoop ? 'search loop' : '', mechanical.searchLoopHeads.includes(round.round) ? 'loop head by the streak rule' : '', round.tags.rejectedCheckpoints > 0 ? `${round.tags.rejectedCheckpoints} rejected checkpoint` : ''].filter((marker) => marker !== '')
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
  lines.push(`- routing: ${provenance.roles.join('; ')} | reasoning override: ${provenance.reasoningEffortOverride ?? 'none'} | decision seams: ${decisionSeamsLabel(provenance.decisionSeams)} | effort overrides: ${provenance.effortOverrides.length === 0 ? 'none' : provenance.effortOverrides.join(', ')} | adblock: ${provenance.adblock} | browser sub-spans: ${provenance.browserSubspans ? 'on' : 'off'}`)
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
  lines.push('')
  lines.push('## Tool rounds')
  lines.push('')
  lines.push(TOOL_ROUNDS_NOTE)
  lines.push('')
  lines.push(...toolRoundTable([audit.populations.initial, audit.populations.followUp]))
  const consentByHunt = consentWallsByHuntSection(consentWallsByHuntOf(audit.attempts))
  if (consentByHunt.length > 0) lines.push('', ...consentByHunt)
  const blockedByHunt = blockedActionsByHuntSection(blockedActionsByHuntOf(audit.attempts))
  if (blockedByHunt.length > 0) lines.push('', ...blockedByHunt)
  const escalationsByHunt = tierEscalationsByHuntSection(tierEscalationsByHuntOf(audit.attempts))
  if (escalationsByHunt.length > 0) lines.push('', ...escalationsByHunt)
  const rewritesByHunt = rewritesByHuntSection(rewritesByHuntOf(audit.attempts))
  if (rewritesByHunt.length > 0) lines.push('', ...rewritesByHunt)
  const tierShadowByHunt = tierShadowByHuntSection(tierShadowByHuntOf(audit.attempts))
  if (tierShadowByHunt.length > 0) lines.push('', ...tierShadowByHunt)
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
  if (provenance.allowedDifference?.field === 'routing') {
    lines.push(allowedDifferenceLine(provenance.allowedDifference))
    lines.push(`- mode ${provenance.shared.mode} | protocol ${provenance.shared.protocolVersion} | prompt version(s) ${provenance.shared.promptVersions.join(', ')}`)
  } else {
    lines.push(`- routing: ${provenance.shared.roles.join('; ')} | mode ${provenance.shared.mode} | protocol ${provenance.shared.protocolVersion} | prompt version(s) ${provenance.shared.promptVersions.join(', ')}`)
  }
  lines.push(`- reasoning override: ${provenance.shared.reasoningEffortOverride ?? 'none'} | decision seams: ${decisionSeamsLabel(provenance.shared.decisionSeams)} | effort overrides: ${provenance.shared.effortOverrides.length === 0 ? 'none' : provenance.shared.effortOverrides.join(', ')} | adblock: ${provenance.shared.adblock} | browser sub-spans: ${provenance.shared.browserSubspans ? 'on' : 'off'}`)
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
  lines.push('## Tool rounds')
  lines.push('')
  lines.push(TOOL_ROUNDS_NOTE)
  lines.push('')
  lines.push(...toolRoundTable([aggregate.populations.initial, aggregate.populations.followUp]))
  lines.push('')
  const consentByHunt = consentWallsByHuntSection(aggregate.consentWallsByHunt)
  if (consentByHunt.length > 0) lines.push(...consentByHunt, '')
  const blockedByHunt = blockedActionsByHuntSection(aggregate.blockedActionsByHunt)
  if (blockedByHunt.length > 0) lines.push(...blockedByHunt, '')
  const escalationsByHunt = tierEscalationsByHuntSection(aggregate.tierEscalationsByHunt)
  if (escalationsByHunt.length > 0) lines.push(...escalationsByHunt, '')
  const rewritesByHunt = rewritesByHuntSection(aggregate.rewritesByHunt)
  if (rewritesByHunt.length > 0) lines.push(...rewritesByHunt, '')
  const tierShadowByHunt = tierShadowByHuntSection(aggregate.tierShadowByHunt)
  if (tierShadowByHunt.length > 0) lines.push(...tierShadowByHunt, '')
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
