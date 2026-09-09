// The live-web capture contract (#224, slice 1 of #223): what one
// isolated information-hunt capture records, in a shape the scheduler
// (#225) writes and the offline grader/reporter (#226) reads without
// either importing the other. Everything here is JSON-safe — the files
// under e2e/live/artifacts/ are these objects serialized — and every src
// import is type-only, so the module loads under plain Node with no
// Electron, no routing resolution, and no import-time work.
//
// Two rules the shapes enforce rather than document. First, a missing
// observation is never a zero and never an absent field: every timing,
// identity and usage figure that can fail to be observed is an
// {@link Observed}, which says *why* it is missing when it is. Second,
// nothing here says whether a hunt succeeded — Task Success is an
// independent verification (#223) and belongs to the grading records
// #226 owns, never to a raw capture.

import type { AgentRole } from '../../src/core/agent/modelRouting'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { FinalizationCause, RunResolution } from '../../src/core/session/runJournal'
import type { EffortTier } from '../../src/core/pipeline/runPlan'

/** The `kind` discriminator a capture-set file carries. */
export const LIVE_CAPTURE_SET_KIND = 'bingbong.live.capture-set'
/** The `kind` discriminator a session-capture file carries. */
export const LIVE_SESSION_CAPTURE_KIND = 'bingbong.live.session-capture'
/**
 * The one schema version. There are no compatibility aliases: a reader
 * that meets another version, or a release-evaluation artifact, refuses
 * it rather than guessing.
 */
export const LIVE_CAPTURE_SCHEMA_VERSION = 1

/**
 * `measured` runs the real app under effective production routing,
 * reasoning, browser settings and ad blocking against the live web;
 * `verification` runs it hermetically — scripted model, local fixture
 * pages — to prove the runner. Verification captures are never baseline
 * evidence, and the mode is stamped on every file so they cannot be mixed.
 */
export type LiveCaptureMode = 'measured' | 'verification'

/**
 * One figure that may or may not have been observed. The four statuses
 * are distinct on purpose (#226 keeps them apart in every report):
 * `observed` carries a value, zero included; `unavailable` means the
 * source never produced one; `invalid` means it produced one the reader
 * refuses (a terminal stamp before the accepted command); and
 * `not_applicable` means the question does not arise for this capture
 * (voice-input latency on a typed command).
 */
export type Observed<T> =
  | { readonly status: 'observed'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'not_applicable'; readonly reason: string }

/**
 * How an attempt relates to the one before it. `initial` opens a hunt;
 * `revised_objective` is the predefined constraint-changing follow-up in
 * the same Session; `corrective` describes a genuine retry recorded
 * outside the pilot protocol — the relation exists so such records are
 * representable, not because the capture offers a retry feature.
 */
export type AttemptRelation = 'initial' | 'revised_objective' | 'corrective'

/** A prompt's version label and the sha256 of its exact text. */
export interface LivePromptIdentity {
  readonly version: string
  readonly hash: string
}

/**
 * One slot of a set's expected population: planned identity only. The
 * set carries its own population so a report can name a slot that was
 * never reached without importing the scheduler that planned it.
 */
export interface LiveScheduledAttempt {
  readonly attemptId: string
  readonly huntId: string
  /** Which step of the hunt: `initial`, `follow_up`, or a protocol's own label. */
  readonly stepId: string
  /** Execution order within the set, from 0. */
  readonly order: number
  readonly prompt: LivePromptIdentity
  readonly relation: AttemptRelation
  /** Required for every relation but `initial`. */
  readonly parentAttemptId?: string
}

/** Where a set stands: the scheduler moves it, the reporter reads it. */
export type LiveCaptureSetState = 'in_progress' | 'complete' | 'interrupted' | 'measurement_failed'

/** One Session capture a set refers to, by its file. */
export interface LiveSessionReference {
  readonly captureId: string
  readonly huntId: string
  /** Relative to the set file's directory. */
  readonly path: string
}

/**
 * A capture set: one protocol run over several hunts. #225 writes it;
 * #224's reader validates it. A set is complete only when the scheduler
 * says so — a set whose file stops updating is `in_progress` forever,
 * which is the honest reading of an interrupted run.
 */
export interface LiveCaptureSet {
  readonly kind: typeof LIVE_CAPTURE_SET_KIND
  readonly schemaVersion: typeof LIVE_CAPTURE_SCHEMA_VERSION
  readonly setId: string
  readonly study: { readonly name: string; readonly protocolVersion: string }
  readonly mode: LiveCaptureMode
  /** ISO-8601 wall clock of the evaluator process. */
  readonly createdAt: string
  /** The expected population, in execution order. */
  readonly slots: readonly LiveScheduledAttempt[]
  readonly sessions: readonly LiveSessionReference[]
  readonly state: LiveCaptureSetState
  readonly stateReason?: string
}

/** The diagnostic families a capture may retain, by name. */
export type LiveArtifactFamily =
  | 'events'
  | 'run_trace'
  | 'host_trace'
  | 'perf'
  | 'screenshot'
  | 'usage_ledger'
  | 'stderr'
  | 'provenance'

/**
 * One retained file. `path` is relative to the session capture's
 * directory; `locator` is the stable name the record had at its source
 * (the file name under the profile's logs dir), so a reader can join a
 * copied trace back to the sink that wrote it. `complete` is the
 * archiver's own claim: false when the copy stopped short — a torn
 * final line dropped, a payload limit hit — and `truncated` says the
 * source itself was cut (a trace's own `chars` beside a shortened
 * result). `redacted` says known secrets were replaced before the write.
 */
export interface LiveArtifactReference {
  readonly path: string
  readonly family: LiveArtifactFamily
  readonly locator?: string
  /** `sha256:<hex>` of the file as written. */
  readonly digest: string
  readonly bytes: number
  readonly complete: boolean
  readonly truncated?: boolean
  readonly redacted?: boolean
  readonly note?: string
}

/**
 * One role's effective endpoint, without its credential. A scripted
 * role (verification mode) is `configured: false` with the reason naming
 * the hook — a scripted model is not production routing.
 */
export type LiveRoleProvenance =
  | { readonly configured: true; readonly baseUrl: string; readonly model: string; readonly keyFingerprint: string }
  | { readonly configured: false; readonly reason: string }

/**
 * The benchmark settings the launched app ran under: a sanitized view
 * of the seeded settings.json. Routing fields and provider keys are
 * never copied here — `routingOverrides` records only whether the
 * seed carried any, so a capture can say the env alone decided routing.
 */
export interface LiveSettingsProvenance {
  /** Whether the caller supplied benchmark settings or the app defaults were selected. */
  readonly source: 'explicit' | 'defaults'
  /** sha256 of the seeded settings.json as written. */
  readonly digest: string
  readonly adblockEnabled: boolean
  readonly webZoomPercent: number
  readonly appearance: string
  readonly sttModel: string
  /** True when the seed carried any role routing or provider key — it must not in measured mode. */
  readonly routingOverrides: boolean
}

/**
 * Everything a later reader needs to attribute a capture to known code
 * and configuration (#223): commit and dirty tree, effective role
 * endpoints without credentials, the reasoning override, which effort
 * overrides were in force (none, in measured mode), the env file the app
 * read, the seeded settings, the adblock configuration and the scripted
 * hooks — the last two being the fixtures that must not silently reach
 * measured mode.
 */
export interface LiveLaunchProvenance {
  readonly mode: LiveCaptureMode
  readonly commit: string
  readonly dirtyTree: boolean
  /** Paths `git status --porcelain` listed; capped, so a capture never carries a whole working tree. */
  readonly dirtyPaths: readonly string[]
  readonly platform: { readonly node: string; readonly os: string; readonly electron: string | null }
  readonly roles: Readonly<Record<AgentRole, LiveRoleProvenance>>
  /** The `BINGBONG_REASONING_EFFORT` override forwarded, or null when the Effort Tier map decides. */
  readonly reasoningEffortOverride: string | null
  /**
   * The test-only timing overrides (active-work deadline, Finalization
   * Allowance, Report Grace, ask timeout, Session Window, …) present in
   * the launched env. Empty in measured mode by construction — the
   * composer refuses otherwise — and listed rather than asserted so the
   * file shows what the app actually ran under.
   */
  readonly effortOverrides: Readonly<Record<string, string>>
  /** The env file the app's own loader read: the path and whether it existed. */
  readonly envFile: { readonly path: string; readonly present: boolean; readonly digest: string | null }
  readonly settings: LiveSettingsProvenance
  readonly adblock: {
    /** `production_default` follows the app's built-in lists; `override` names an env-supplied list. */
    readonly lists: 'production_default' | 'override' | 'disabled'
    readonly listsOverride: string | null
    readonly resourcesOverride: string | null
  }
  /** Scripted serving hooks present in the launched env — must be empty in measured mode. */
  readonly scriptedHooks: readonly string[]
  /** Wake-word monitoring was turned off for typed capture; recorded, never implied. */
  readonly wakeMonitoring: 'off'
  readonly traceFlags: { readonly runTrace: boolean; readonly hostTrace: boolean }
  /** The profile seed: always a fresh benchmark directory, never a discovered personal profile. */
  readonly profile: { readonly seed: 'fresh_benchmark'; readonly downloadsDir: 'benchmark_owned' }
  /** Whether the measurement access guard (file: loads refused) was in force. */
  readonly accessGuard: boolean
}

/** The accepted command as the app's own `command` event published it. */
export interface LiveAcceptedCommand {
  /** The event's own `at` — app-process wall clock, epoch ms. */
  readonly at: number
  readonly text: string
  readonly turnId: string
  readonly runId: string
  readonly sessionId: string
  readonly sessionGeneration: number
  readonly submissionId: string
}

/**
 * The final Answer's display as published: the `display` event the
 * pipeline marked `finalAnswer`. `at` is the event publication boundary,
 * not renderer paint and not audible onset — see README.
 */
export interface LiveFinalAnswer {
  readonly at: number
  readonly text: string
  readonly turnId: string
  /** True when the pipeline composed the deterministic fallback rather than a model round. */
  readonly deterministic: boolean
}

/** The Run's `done` event as published. */
export interface LiveTerminal {
  readonly at: number
  readonly turnId: string
  readonly outcome: 'done' | 'failed' | 'cancelled' | 'reset' | null
  /** The model-proposed Run Resolution — never independently verified Task Success. */
  readonly resolution: RunResolution | null
  readonly finalizationCause: FinalizationCause | null
}

/** One interval the Run spent waiting on the user. */
export interface LiveWaitInterval {
  readonly kind: 'ask' | 'confirmation'
  readonly id: string
  readonly requestedAt: number
  /** Null while unresolved at capture end. */
  readonly resolvedAt: number | null
  readonly reason?: string
}

/**
 * Something the capture saw that the protocol did not plan for. A
 * model-requested Session reset replays the command in a fresh Session
 * (#99): the replay is recorded here under the attempt that dispatched
 * it, never merged into the original Run's figures.
 */
export interface LiveAnomaly {
  readonly kind: 'session_reset_replay' | 'busy_rejection' | 'foreign_command' | 'clock' | 'observer'
  readonly at: number | null
  readonly detail: string
}

/** Why the capture stopped observing an attempt. */
export type LiveStopReason =
  | 'terminal'
  | 'attempt_timeout'
  | 'acceptance_timeout'
  | 'rejected'
  | 'observer_failure'
  | 'session_lost'

/** Per-role token usage summed over the rounds that reported it. */
export interface LiveRoleUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  /** Rounds recorded for the role. */
  readonly rounds: number
  /** Rounds whose provider reported usage — the sum covers only these. */
  readonly roundsWithUsage: number
  /** False when some rounds reported nothing: the sum is a floor, not a total. */
  readonly complete: boolean
  readonly models: readonly string[]
}

/**
 * The raw metric projection over one attempt's events and diagnostics
 * (`extractLiveMetrics`). Observed timings, waits, usage and coverage —
 * never Task Success. Every figure that reads from a source that may be
 * absent is an {@link Observed}; counters that read from a source that is
 * always present (the event tape) are plain numbers.
 */
export interface LiveMetrics {
  /** Which stamp the Answer latency reads — always event publication for this capture. */
  readonly answerBoundary: 'event_publication'
  readonly acceptedAt: Observed<number>
  readonly finalAnswerAt: Observed<number>
  readonly terminalAt: Observed<number>
  /** Marked final display `at` minus accepted command `at`. */
  readonly answerLatencyMs: Observed<number>
  /** `done.at` minus accepted command `at` — full Run duration, distinct from the Answer. */
  readonly runDurationMs: Observed<number>
  /** Sum of resolved user waits; observed 0 when the Run never waited. */
  readonly userWaitMs: Observed<number>
  readonly waits: readonly LiveWaitInterval[]
  readonly speech: {
    /** Typed capture: not applicable, never zero. */
    readonly inputLatencyMs: Observed<number>
    /** Perf `tts-synthesis` spans of the turn. */
    readonly synthesis: Observed<{ readonly spans: number; readonly totalMs: number }>
    /** Perf `tts-playback` spans of the turn — overlapping spans are not wall time. */
    readonly playback: Observed<{ readonly spans: number; readonly totalMs: number }>
  }
  readonly outcome: LiveTerminal['outcome']
  readonly resolution: RunResolution | null
  readonly finalizationCause: FinalizationCause | null
  readonly deterministicAnswer: boolean
  readonly effortTier: EffortTier | null
  readonly deadlineTierEscalations: number
  readonly counts: {
    /** Perf `llm` spans — orchestrator rounds that finished. */
    readonly llmSpans: number
    readonly llmRetries: number
    readonly toolCalls: number
    /** Perf `tool` spans — calls that reached execute. */
    readonly toolSpans: number
    readonly visionRequests: number
    readonly workersFinalized: number
    readonly errors: number
  }
  readonly usage: Readonly<Record<AgentRole, Observed<LiveRoleUsage>>>
  /**
   * Per-stage perf spans of the turn. `totalMs` is a plain sum and is
   * NOT additive across stages — tool, browser, vision and worker spans
   * nest and overlap — so `unionMs` (the union of each stage's
   * [t − durMs, t] intervals) is beside it. Both are meaningful only
   * within one launch: `t` is monotonic from the app's own start, and
   * `clockOrigin` names that launch. The synthetic `summary` record and
   * the zero-length `llm-retry` markers are excluded — retries are
   * counted, never timed. Unavailable when the turn recorded no span.
   */
  readonly spans: Observed<{
    readonly clockOrigin: string
    readonly stages: Readonly<Record<string, { readonly count: number; readonly totalMs: number; readonly unionMs: number }>>
  }>
  /** Vision request durations from the `vision_request` records; tokens stay unavailable. */
  readonly vision: Observed<{ readonly requests: number; readonly totalMs: number; readonly outcomes: Readonly<Record<string, number>> }>
  readonly coverage: {
    readonly events: number
    readonly traceRecords: number
    readonly llmRoundRecords: number
    /** `pipeline_event` records whose tool result was cut at the trace limit. */
    readonly truncatedToolResults: number
    readonly perfRecords: number
  }
}

/** The bounds one attempt's observation ran under, in ms. */
export interface LiveAttemptBounds {
  readonly acceptanceMs: number
  readonly attemptMs: number
  readonly drainMs: number
  readonly abortMs: number
}

/** One dispatched attempt and everything observed about it. */
export interface LiveAttemptCapture {
  readonly kind: 'attempt'
  readonly attemptId: string
  readonly huntId: string
  readonly stepId: string
  readonly order: number
  readonly relation: AttemptRelation
  readonly parentAttemptId?: string
  readonly command: { readonly text: string; readonly prompt: LivePromptIdentity }
  readonly dispatch: {
    /** ISO-8601, evaluator process clock, just before the Prompt Bar was driven. */
    readonly requestedAt: string
    /** What the Prompt Bar script returned. */
    readonly submitResult: string
    /** The event-tape index taken before submission — acceptance is matched after it. */
    readonly cursor: number
  }
  readonly accepted: Observed<LiveAcceptedCommand>
  readonly finalAnswer: Observed<LiveFinalAnswer>
  readonly terminal: Observed<LiveTerminal>
  /** When the initial submit's IPC Promise settled (Prompt Bar `aria-busy` cleared), evaluator clock. */
  readonly settlement: Observed<string>
  readonly stop: { readonly at: string; readonly reason: LiveStopReason; readonly detail?: string }
  readonly waits: readonly LiveWaitInterval[]
  readonly anomalies: readonly LiveAnomaly[]
  /** Whether the same Session could accept a follow-up when this attempt stopped, and why not. */
  readonly continuation: { readonly ready: boolean; readonly reason: string; readonly checkedAt: string }
  readonly bounds: LiveAttemptBounds
  readonly metrics: LiveMetrics
  /** The attempt's own event tape, as retained. */
  readonly events: LiveArtifactReference | null
}

/**
 * A planned slot that was not dispatched: identity and reason only. No
 * Run id, no accepted stamp — nothing is invented. A dispatch whose
 * acceptance could not be confirmed is a {@link LiveAttemptCapture} with
 * an unavailable `accepted`, never a not-reached slot.
 */
export interface LiveNotReachedAttempt {
  readonly kind: 'not_reached'
  readonly attemptId: string
  readonly huntId: string
  readonly stepId: string
  readonly order: number
  readonly relation: AttemptRelation
  readonly parentAttemptId?: string
  readonly command: { readonly text: string; readonly prompt: LivePromptIdentity }
  readonly reason: string
  readonly decidedAt: string
}

export type LiveAttemptRecord = LiveAttemptCapture | LiveNotReachedAttempt

/** How a Session capture ended. */
export type LiveSessionCloseState = 'open' | 'closed' | 'interrupted' | 'launch_failed'

/** One error the capture itself hit, redacted before it was written. */
export interface LiveCaptureError {
  readonly at: string
  readonly stage: string
  readonly message: string
}

/**
 * One application Session's capture: one launch of the app in a fresh
 * benchmark profile, every attempt dispatched into it, and the
 * diagnostics archived from the profile before it was removed.
 */
export interface LiveSessionCapture {
  readonly kind: typeof LIVE_SESSION_CAPTURE_KIND
  readonly schemaVersion: typeof LIVE_CAPTURE_SCHEMA_VERSION
  readonly captureId: string
  readonly setId?: string
  readonly huntId: string
  readonly mode: LiveCaptureMode
  readonly startedAt: string
  readonly closedAt: string | null
  readonly launch: LiveLaunchProvenance
  readonly attempts: readonly LiveAttemptRecord[]
  readonly artifacts: readonly LiveArtifactReference[]
  readonly closeState: LiveSessionCloseState
  readonly errors: readonly LiveCaptureError[]
  /**
   * The archiver's verdict on what was kept: false when any family it
   * meant to retain could not be copied whole, with the note saying
   * which. A capture that reports incomplete retention still kept what
   * it could — the profile is never removed before the attempt.
   */
  readonly retention: { readonly complete: boolean; readonly note: string | null }
}

/** The event-tape file an attempt retains: the events with a turn id, as published. */
export interface LiveEventTape {
  readonly attemptId: string
  readonly turnId: string | null
  readonly events: readonly PipelineEvent[]
}
