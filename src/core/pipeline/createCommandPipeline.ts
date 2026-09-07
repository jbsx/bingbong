import type { PipelineEvent, UnstampedEvent } from './events'
import type { Tool, ToolContext } from './tool'
import type { Clock } from '../ports/clock'
import { toErrorMessage } from '../errors'
import type {
  AssistantTurn,
  LlmAttemptSent,
  LlmClient,
  LlmRequest,
  LlmStreamDelta,
  ReasoningEffort,
  ToolCall,
  ToolResult,
  ToolResultOutcome,
} from '../ports/llm'
import { selectDelegatedMemory } from '../agent/subagentReport'
import { createLlmDeltaBatcher } from './deltaBatcher'
import type { TtsSpeaker } from '../ports/tts'
import { answerText, spokenErrorLine } from '../agent/answerContract'
import type { LearnedTermsControls } from '../voice/learnedTerms'
import { MAX_RUN_NOTE_CHARS, finalizeRun, runStopRecord, type FinalizationCause, type RunFinalization, type RunJournalEntry, type RunJournalSnapshot, type RunStopRecord } from '../session/runJournal'
import { currentUserObjective, type MemoryEntryId, type MemoryPatch, type WorkingMemorySnapshot } from '../session/workingMemory'
import type { PerfTracer } from '../perf/perfTracer'
import { createTurnIdSource } from '../perf/perfTracer'
import type { BrowserSubspans } from '../perf/browserSubspans'
import { emitTurnSummary } from '../perf/turnSummary'
import type { SettledPageState } from './progressFingerprints'
import type { SnapshotRef } from '../browser/snapshot'
import { createToolRoundExecutor, type ToolRoundExecutor } from './toolRound'
import {
  createEffortEpoch,
  finalizationDetailSentence,
  deterministicFinalAnswer,
  injectedReportDirective,
  requestFinalizeInstruction,
  type EffortEpoch,
  type FinalizationDetail,
} from './effortEpoch'
import {
  createFinalizationAllowance,
  resolveFinalizationAllowanceMs,
  type FinalizationAllowance,
} from './finalizationAllowance'
import {
  DEFAULT_EFFORT_TIER,
  lookupFallbackPlan,
  parsePlanReport,
  reviewPlanReport,
  RUN_PLAN_INVALID,
  RUN_PLAN_NUDGE,
  RUN_PLAN_STANDALONE_ROUND,
  type RunPlan,
} from './runPlan'
import { createNotices } from './notices'
import type { ConfirmDecision, RunDecisions } from './decisions'
import { CommandAbortedError, STEERED_CANCELLED, type RunInterrupts } from './interrupts'
import {
  createObservationLedger,
  type ObservationId,
  type ObservationInput,
  type ObservationRecord,
} from '../session/observationLedger'
import type { SessionEvidenceSnapshot, SessionEvidenceStore, ObservationCheckpointResult } from '../session/sessionEvidence'
import { retainedUserObjective } from '../session/objectiveContinuity'
import { retainedInspectionSubject, type RetainedInspectionReference } from '../session/inspectionReference'
import { correctionsInheritedBy, userCorrectionSubjects, type RetainedUserCorrection } from '../session/userCorrections'
import {
  eligibleVerificationCandidates,
  heldVerificationCandidates,
  verificationSubject,
  type VerificationSubject,
} from '../session/verificationAttempts'
import type { RunId, SessionGeneration } from '../session/sessionIdentity'
import {
  evaluateEvidenceCheckpoint,
  subagentEvidenceCommit,
  userEvidenceCommit,
  type EvidenceCheckpointOutcome,
  type EvidenceCommit,
  type EvidenceCommitInput,
} from './evidenceCheckpoint'
import { candidateCheckpointEvent, evidenceCheckpointEvent } from '../trace/evidenceCheckpointTrace'
import type { LlmRequestShape, LlmRoundOutcome, RunTraceWriter } from '../trace/runTrace'
import type { VisionTraceReporter } from '../trace/visionTrace'
import { createReasoningRounds, reasoningEvent, type TracedReasoningRound } from '../trace/reasoningTrace'
import { createLlmRounds, llmRequestShape, llmRoundEvent, llmRoundFailure, type LlmRound, type TracedLlmRound } from '../trace/llmRoundTrace'
import { pipelineEventTraceBody, tracesPipelineEvent } from '../trace/pipelineEventTrace'
import { offContractReplyEvent, recordOffContractReply, type TracedOffContractReply } from '../trace/offContractReplyTrace'
import { completedEvidenceIsFresh } from './evidenceFreshness'
import { evaluateCandidateCheckpoint, type CandidateCheckpointOutcome, type EvidenceSessionSource } from './candidateCheckpoint'
import { deriveAnswerSources, scrubAnswerText } from './answerEvidence'
import { deriveFallbackSources, hasUnresolvedImageCheck } from './fallbackAnswer'
import { compactRunContext, type RunEvidenceCheckpoint } from './runContextCompaction'
import { reportFault } from '../trace/fault'
import type { CollectedSubagentReport } from '../agent/subagentManager'

export interface CommandPipelineDeps {
  llm: LlmClient
  tts: TtsSpeaker
  clock: Clock
  tools: Tool[]
  confirmTimeoutMs?: number
  /** How long an ask_user window stays open (voice + typed answers). */
  askTimeoutMs?: number
  /**
   * Test/e2e override for every tier's active-work deadline (#135):
   * `BINGBONG_ACTIVE_WORK_DEADLINE_MS` threaded by the assistant
   * pipeline — time-based coverage reproduces a deadline crossing in
   * seconds. Production never sets it; the tier table applies.
   */
  activeWorkDeadlineMs?: number
  /**
   * Hostname of the page the browser tab is currently on (#80, ADR 0010) —
   * what current-page browser verbs (click/type/scroll/…) target for the
   * same-wall Blocker gate. Absent, the gate still arms from BLOCKER marker
   * lines and still refuses same-host navigate calls by their URL argument.
   */
  currentHost?: () => string | null
  /**
   * Resolves a snapshot ref to its facts (#82) — how the search-loop rail
   * recognizes text typed into a search input (the GUI search signature).
   * Absent, typed searches cannot be classified and the rail still tracks
   * q= navigations.
   */
  describeRef?: (ref: number) => Promise<SnapshotRef | undefined>
  /**
   * Live source for the URL of the page the visible browser tab is on
   * (#111): the source URL recorded on page-facing observations in the
   * Run's Observation ledger. Absent, observations carry no source URL.
   */
  currentPageUrl?: () => string | null
  /**
   * The visible tab's settled page state (#126, ADR 0027): the no-progress
   * rails' comparison input — read at gate time (the state an attempt
   * starts from) and after each successful page-facing action (the state
   * it left). Absent, the rails are inert: they never judge actions they
   * cannot observe.
   */
  settledPageState?: () => Promise<SettledPageState | null> | SettledPageState | null
  /**
   * Delegated workers' retained observations (#123, ADR 0028): the hidden
   * provenance a completed worker's report carried, by agent id — what a
   * kind "subagent" Evidence Checkpoint grounds its citation against.
   * Absent, subagent citations fail recoverably (unknown agent).
   */
  subagentObservations?: (agentId: string) => readonly ObservationRecord[] | null
  /**
   * Observation ledger sink (#111): every record the run's ledger accepts
   * — diagnostic only, the ledger itself is private Run Working State and
   * never reaches the model. A throwing sink never fails a run.
   */
  onObservation?: (record: ObservationRecord) => void
  onAbort?(): void
  onPause?(): void
  onResume?(): void
  /**
   * Steering's stale-work cancellation (#119, ADR 0027): fired when a
   * resume carries a directive — delegated Subagent work spawned under
   * the corrected-away objective is cancelled, not resumed. Wired by
   * main to the subagent rail's cancelAll.
   */
  onSteer?(): void
  /**
   * Finalization entry (#120, ADR 0027; #199, ADR 0035): fired when a work
   * rail trips the run into Finalization. It no longer cancels delegated
   * work — every live Subagent is *told* the parent is finalizing, so it
   * enters its own Finalization and writes a report. Wired by main to the
   * subagent rail's tellParentFinalizing.
   */
  onFinalize?(): void
  /**
   * The Report Grace (#199, ADR 0035): resolves once every Subagent live
   * at the call has settled. The Run races it against the grace before
   * its bookkeeping Tool Round — a Finalization with no live worker
   * therefore waits for nothing. Absent (no delegation is wired at all),
   * Finalization waits for nothing either.
   */
  subagentReportsSettled?(): Promise<void>
  /**
   * The Report Grace's end (#199): every Subagent still running abandons
   * its round and returns its bounded Subagent Report. Not a
   * cancellation — those workers finish `completed`.
   */
  onReportGraceEnd?(): void
  /**
   * Test/e2e override for the Report Grace (#199):
   * `BINGBONG_REPORT_GRACE_MS` threaded by the assistant pipeline —
   * coverage reproduces the grace in milliseconds. Production never sets
   * it; the Finalization Allowance's own grace share applies.
   */
  reportGraceMs?: number
  /**
   * Test/e2e override for the whole Finalization Allowance (#209, ADR
   * 0038): `BINGBONG_FINALIZATION_ALLOWANCE_MS` threaded by the assistant
   * pipeline. The three shares scale with it, so a scaled run still
   * exercises the grace and bookkeeping rather than collapsing them into
   * the Answer's protected floor. Production never sets it.
   */
  finalizationAllowanceMs?: number
  /**
   * The Finalization cutoff (#209, ADR 0038): fired once per Finalization
   * entry, when the allowance has spent everything but the reserved
   * Answer's protected share. The Run lets go of whatever it is still
   * waiting on — an outstanding browser action's *wait* ends now, so the
   * Card cannot be postponed by an action that will not settle. Wired by
   * main to the pane custody's abandon (#205): letting go of the wait is
   * not undoing the action, and the resource stays withheld until it is
   * observed to end.
   */
  onFinalizationCutoff?(): void
  /**
   * Collection at Finalization entry (#192): takes completed worker reports
   * that have not entered this Run's transcript yet.
   */
  collectCompletedSubagentResults?(turnId: string): readonly CollectedSubagentReport[]
  /** Turn-id source (#28) and span/summary recorder (#29/#30); absent falls back to a local id mint. */
  tracer?: PerfTracer
  /**
   * Verbose browser sub-spans (#32): when wired, the tool gate opens the
   * channel's turn scope around each gated execution, so the browser
   * controller's internal delays and extra round-trips key to this turn.
   * Must be the same channel instance the controller holds.
   */
  browserSubspans?: BrowserSubspans
  /** Where the per-turn summary line goes (#30); defaults to console.log. */
  printSummary?: (line: string) => void
  /**
   * Progress detail sink (#43): live signals that fire while the run body
   * is blocked mid-await — LLM retry attempts inside `llm.complete`, the
   * agent wait inside a blocking tool. They cannot ride the generator
   * (it is suspended), so they fan out through this side channel onto the
   * same pipeline event stream. Order stays FIFO: the sink only fires
   * while the generator is parked, so the two transports never interleave.
   * Turn-stamped by the run before delivery.
   */
  emitDetail?: (event: PipelineEvent) => void
  /** Diagnostic-only sink; continuity degradation never becomes a user-visible pipeline error. */
  onContinuityDegraded?: (
    reason: 'missing' | 'malformed' | 'invalid_memory' | 'commit_rejected' | 'unsupported_assessment',
    turnId: string,
  ) => void
  /**
   * Run Context Compaction threshold (#124, ADR 0028): compaction
   * engages once the Run's serialized tool-result context crosses this
   * many characters. Defaults to RUN_CONTEXT_COMPACTION_THRESHOLD_CHARS;
   * tests lower it to exercise the seam.
   */
  runContextCompactionThresholdChars?: number
  /**
   * Learned Terms seam (ADR 0022): the run's input text touches the LRU
   * order at run start, and a done run's validated Mishear proposals apply
   * at the Memory Commit tail — end of message, never mid-run. Absent in
   * tests unless asserted; a throwing implementation never fails a run.
   */
  learnedTerms?: LearnedTermsControls
  /**
   * The vision seam's reporter (#186, ADR 0031): what a Look, an
   * auto-vision Describe or a ground_visual Locate records through. Unlike
   * `traceRun` it binds no identity — it takes the ids the call site had,
   * so the same reporter serves a Run's tools and anything that calls
   * vision outside one. Absent when nothing is tracing.
   */
  traceVision?: VisionTraceReporter
}

interface ConfirmationDecision {
  approved: boolean
  reason: 'user' | 'timeout' | 'cancelled' | 'steered'
}

interface AskDecision {
  answer: string | null
  reason: 'user' | 'timeout' | 'cancelled' | 'steered'
}

interface PendingDecision<T> {
  promise: Promise<T>
  settle(decision: T): void
  pause(): void
  resume(): void
  expiresAt(): number | null
}

export type CommandRunState = 'idle' | 'running' | 'paused'

interface ActiveRun {
  /** The turn's id — stamps the steer echo resume() emits outside the generator (#46). */
  turnId: string
  aborted: boolean
  paused: boolean
  steering?: string
  releasePause?: () => void
  releaseControl?: () => void
  /** The Run's bounded-effort window, including its suspendable active-work clock. */
  effortEpoch: EffortEpoch
  /**
   * The Run's Finalization Allowance while it has one (#209, ADR 0038):
   * null until Finalization is entered, and null again if a Steering
   * replan reopens acquisition. It lives here rather than in the run body
   * because Pause reaches it through the same checkpoint that suspends
   * the active-work clock.
   */
  finalizationAllowance: FinalizationAllowance | null
  /**
   * Aborts the in-flight LLM round's HTTP request (#47): set while the
   * round is awaiting, fired by abort() so Stop cancels the request
   * immediately instead of waiting out the request timeout.
   */
  abortLlm?: () => void
}

/** Default ask_user window: ~45s for a spoken or typed free-text answer. */
export const ASK_TIMEOUT_MS = 45_000

/**
 * What a hard run failure says out loud (#203/AC1): the state of the
 * task, with the provider's own words left to the error event and the
 * Run's stop record. The user cannot act on an exception message.
 */
const RUN_FAILED_SPOKEN = 'I could not finish that request.'

function deterministicRunNote(command: string, outcome: RunJournalEntry['outcome']): string {
  const task = command.trim().replace(/\s+/g, ' ').slice(0, 500) || '(empty command)'
  const label = outcome === 'done' ? 'Completed' : outcome === 'failed' ? 'Failed' : 'Cancelled'
  return `${label} run: ${task}`
}

/** A Memory Patch addition whose kind must stand on active Session Evidence (#122). */
function isAssessmentAdd(operation: MemoryPatch[number]): boolean {
  return operation.op === 'add' && operation.entry.kind === 'assessment'
}

function logContinuityDegradation(
  sink: CommandPipelineDeps['onContinuityDegraded'],
  reason: 'missing' | 'malformed' | 'invalid_memory' | 'commit_rejected' | 'unsupported_assessment',
  turnId: string,
): void {
  try {
    ;(sink ?? ((why, id) => console.warn(`[run-journal] ${why} Run Note for ${id}`)))(reason, turnId)
  } catch (error) {
    reportFault('pipeline.createCommandPipeline.continuityDegraded', error, { turnId })
    // Diagnostics cannot suppress a valid Answer or its done boundary.
  }
}

export interface CommandPipeline {
  /**
   * Runs one command as a turn (#28): adopts the given `turnId` (the voice
   * session's, minted at utterance end) or mints a fresh one (text box), and
   * stamps every event of the turn with it. `truncated` (#61) is true when
   * the spoken utterance hit the 30 s cap — the flag rides every LLM round
   * so the model asks the user to finish instead of guessing.
   */
  execute(command: string, turnId?: string, truncated?: boolean, continuity?: RunContinuityContext): AsyncIterable<PipelineEvent>
  resolveConfirmation(confirmationId: string, approved: boolean): void
  /** Answer an open ask_user window (typed card or voice transcript). */
  resolveAsk(askId: string, answer: string): void
  abort(): void
  pause(): void
  /**
   * Resume a paused run, optionally with a steering directive. Returns
   * whether the resume (and the directive, if any) was actually taken —
   * false means no paused run accepted it.
   */
  resume(steering?: string): boolean
  getState(): CommandRunState
}

export interface RunContinuityContext {
  readonly snapshot: RunJournalSnapshot
  readonly memory: WorkingMemorySnapshot
  /**
   * The Session Evidence snapshot accepted with this Run's admission
   * (#121, ADR 0028): immutable for the Run's lifetime — mid-Run
   * checkpoints join the Session store and later admissions, never this
   * snapshot.
   */
  readonly evidence?: SessionEvidenceSnapshot
  /**
   * The Inspection Reference the Session retained (#210, ADR 0039): the
   * Candidate a previous Answer presented, admitted with this Run and
   * resolved against the evidence snapshot beside it. Absent when the
   * Session holds no inspection subject.
   */
  readonly inspection?: RetainedInspectionReference
  /**
   * The user's own words this Session retains unresolved (#211, ADR
   * 0039), admitted with this Run — its own utterance included, retained
   * before the first model request so a request that never returned
   * cannot erase what the user said.
   */
  readonly corrections?: readonly RetainedUserCorrection[]
  /**
   * The verification routes this objective has already spent (#212, ADR
   * 0041), admitted with this Run: what each attempt reported, and
   * whether one fresh attempt is open. Absent when nothing has failed.
   */
  readonly verification?: VerificationSubject
  /**
   * Resolves the words this Run was itself admitted with (#211, ADR
   * 0039), called only when the model has written an Answer: answering
   * the user's latest command is what an Answer is. A correction
   * inherited from an earlier Run that never answered is untouched — it
   * is discharged by grounding alone. A Run that fails, is cancelled, or
   * falls back to a deterministic Answer never reaches this at all,
   * which is the point. Absent when the run carries no evidence
   * continuity.
   */
  resolveCorrections?(): void
  /**
   * The Session generation this Run was admitted under (#111): the
   * Observation ledger's staleness guard. Absent in tests that carry no
   * runtime; production always passes it from admission.
   */
  readonly generation?: SessionGeneration
  commit(
    outcome: RunJournalEntry['outcome'],
    note: string,
    patch: MemoryPatch,
    /**
     * Why this Run stopped (#203, ADR 0038): the authoritative
     * Finalization Cause and any execution failure recorded after it,
     * retained in bounded Session continuity so a later explicit "why did
     * you stop?" is answered from the Run rather than guessed. Null when
     * the Run simply answered.
     */
    stop?: RunStopRecord | null,
  ): 'committed' | 'invalid_patch' | 'rejected'
  /**
   * The Evidence Checkpoint commit seam (#121, ADR 0028): stores one
   * Run-validated grounded Observation in the live Session's store under
   * this Run's provenance. Returns the store's verdict — null means the
   * Session refused (ended, sealed, or out-of-bounds fields). Absent when
   * the run carries no evidence continuity.
   */
  checkpointEvidence?(input: EvidenceCommitInput): ObservationCheckpointResult | null
  /**
   * The live Session's evidence store under this Run's identity (#122,
   * ADR 0028): grounds User Observations, Candidate checkpoints, Answer
   * support, and derived source links against live Session Evidence —
   * including Observations this Run checkpointed mid-flight. Resolved
   * per call; null once the Session ended (Reset, Lapse). Absent when
   * the run carries no evidence continuity.
   */
  evidenceSession?(): { store: SessionEvidenceStore; runId: RunId } | null
  /**
   * The Run Trace seam (#180, ADR 0030): records one of this Run's
   * internal decisions for diagnosis, already bound to the Run's
   * identity. Diagnosis only — nothing here is ever rendered, and no
   * Session reads it back. Absent when nothing is tracing.
   */
  traceRun?: RunTraceWriter
}

/** Stamps one run-body event with the turn's id. */
function stampTurn(event: UnstampedEvent, turnId: string): PipelineEvent {
  return { ...event, turnId } as PipelineEvent
}

export function createCommandPipeline(deps: CommandPipelineDeps): CommandPipeline {
  const { llm, tts, clock, tools } = deps
  const mintTurnId = createTurnIdSource(deps.tracer)
  // The Finalization Allowance and the Report Grace inside it (#199/#209,
  // ADR 0035, ADR 0038): the constants, or their single test/e2e
  // overrides — resolved once, since neither varies within a run.
  const finalizationAllowanceMs = resolveFinalizationAllowanceMs(deps.finalizationAllowanceMs)
  const reportGraceOverrideMs = deps.reportGraceMs
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 60_000
  const askTimeoutMs = deps.askTimeoutMs ?? ASK_TIMEOUT_MS
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const pendingConfirmations = new Map<string, PendingDecision<ConfirmationDecision>>()
  const pendingAsks = new Map<string, PendingDecision<AskDecision>>()
  let confirmationCounter = 0
  let askCounter = 0
  let activeRun: ActiveRun | null = null
  // The newest Session generation this pipeline has served (#111): the
  // Observation ledger's staleness check — a ledger admitted under a
  // superseded generation (a Session Reset happened between Runs) can
  // never record again.
  let latestSessionGeneration: SessionGeneration = 0

  function throwIfAborted(run: ActiveRun): void {
    if (run.aborted) throw new CommandAbortedError()
  }

  function settlePendingDecisions(reason: 'cancelled' | 'steered'): void {
    for (const pending of pendingConfirmations.values()) {
      pending.settle({ approved: false, reason })
    }
    for (const pending of pendingAsks.values()) {
      pending.settle({ answer: null, reason })
    }
  }

  function eachPendingDecision(visit: (pending: { pause(): void; resume(): void }) => void): void {
    for (const pending of pendingConfirmations.values()) visit(pending)
    for (const pending of pendingAsks.values()) visit(pending)
  }

  async function* checkpoint(
    run: ActiveRun,
    resumeStatus: 'thinking' | 'acting',
    consumeSteering = true,
  ): AsyncGenerator<UnstampedEvent, string | undefined> {
    throwIfAborted(run)
    while (run.paused) {
      yield { type: 'status', status: 'paused', at: clock.now() }
      if (run.paused) {
        // Paused time is user-dependent (#117): it never counts toward
        // the run's active-work deadline. The Finalization Allowance is
        // suspended by pause() itself rather than here (#209/AC4) — it
        // has to stop the moment the user does, not at the next
        // checkpoint, because a Finalization round already in flight is
        // bounded against it.
        run.effortEpoch.suspend()
        try {
          await new Promise<void>((resolve) => {
            run.releasePause = resolve
          })
        } finally {
          run.effortEpoch.resume()
        }
      }
      run.releasePause = undefined
      throwIfAborted(run)
      yield { type: 'status', status: resumeStatus, at: clock.now() }
    }
    const steering = run.steering
    if (consumeSteering) run.steering = undefined
    return steering
  }

  async function* awaitDecision<T>(
    decision: PendingDecision<T>,
    run: ActiveRun,
    deadlineEvent: (expiresAt: number | null) => UnstampedEvent,
  ): AsyncGenerator<UnstampedEvent, T> {
    // The whole wait is user-dependent (#117): Confirmation and ask_user
    // windows pause the active-work clock, however the decision resolves.
    run.effortEpoch.suspend()
    try {
      for (;;) {
        if (run.aborted) return await decision.promise
        while (run.paused) {
          yield* waitThroughPause(decision, run, deadlineEvent)
          if (run.aborted) return await decision.promise
        }

        const outcome = await Promise.race([
          decision.promise.then((value) => ({ kind: 'decision' as const, value })),
          new Promise<{ kind: 'control' }>((resolve) => {
            run.releaseControl = () => resolve({ kind: 'control' })
          }),
        ])
        run.releaseControl = undefined
        if (outcome.kind === 'decision') return outcome.value
      }
    } finally {
      run.effortEpoch.resume()
    }
  }

  async function* waitThroughPause<T>(
    decision: PendingDecision<T>,
    run: ActiveRun,
    deadlineEvent: (expiresAt: number | null) => UnstampedEvent,
  ): AsyncGenerator<UnstampedEvent> {
    yield deadlineEvent(null)
    try {
      yield* checkpoint(run, 'acting', false)
    } catch (error) {
      if (!(error instanceof CommandAbortedError)) throw error
      return
    }
    if (!run.steering) yield deadlineEvent(decision.expiresAt())
  }

  /**
   * The Report Grace's wait (#199/#209, ADR 0035, ADR 0038): returns when
   * every Subagent live at Finalization entry has settled, when the
   * grace's share of the Finalization Allowance is spent, or at once on a
   * Stop. Four things can end it and only one of them is the workers, so
   * none of the other three may be held by a worker that never answers:
   * Stop and Pause reach it through the run's control release, and the
   * grace's own share through a watch the allowance suspends with itself.
   *
   * A Pause suspends the allowance for as long as the user holds it and
   * yields the same paused/resumed status the checkpoint does; a directive
   * that arrived with the resume is left for the caller's checkpoint,
   * because a replan may reopen acquisition and there would then be no
   * grace to finish waiting out.
   */
  async function* awaitReportGrace(run: ActiveRun, settled: Promise<void>): AsyncGenerator<UnstampedEvent> {
    let workersSettled = false
    let wake: (() => void) | null = null
    const finish = (): void => {
      workersSettled = true
      wake?.()
    }
    void settled.then(finish, finish)
    for (;;) {
      if (run.aborted || workersSettled) return
      // A directive arrived with the resume (#119/#209/AC4): it corrects
      // the objective the grace is waiting on reports about, and its
      // replan may reopen acquisition. The caller's checkpoint consumes
      // it — there is nothing here left worth waiting out.
      if (run.steering !== undefined) return
      if (run.paused) {
        yield { type: 'status', status: 'paused', at: clock.now() }
        run.effortEpoch.suspend()
        try {
          await new Promise<void>((resolve) => {
            run.releasePause = resolve
          })
        } finally {
          run.releasePause = undefined
          run.effortEpoch.resume()
        }
        yield { type: 'status', status: 'thinking', at: clock.now() }
        continue
      }
      const allowance = run.finalizationAllowance
      if (allowance === null) return
      const remainingGraceMs = allowance.reportGraceMs()
      if (remainingGraceMs <= 0) return
      let spent = false
      let cancelWatch: () => void = () => {}
      try {
        await new Promise<void>((resolve) => {
          wake = resolve
          // Stop and Pause both reach the wait here: abort() and pause()
          // fire the control release, and the loop above reads which.
          run.releaseControl = resolve
          cancelWatch = allowance.watch(remainingGraceMs, () => {
            spent = true
            resolve()
          })
          if (workersSettled) resolve()
        })
      } finally {
        cancelWatch()
        wake = null
        run.releaseControl = undefined
      }
      if (spent) return
    }
  }

  async function* speakLine(text: string, turnId: string): AsyncGenerator<UnstampedEvent> {
    yield { type: 'status', status: 'speaking', at: clock.now() }
    yield { type: 'speak', text, at: clock.now() }
    // The turn id rides the line so the coordinator keys its synthesis and
    // playback spans to this turn (#31).
    const outcome = await tts.speak(text, turnId)
    if (!outcome.ok) {
      // Voice is gone — the text is already on the dashboard, so the failure
      // itself degrades to a displayed one-liner.
      yield { type: 'error', message: spokenErrorLine(outcome.error), at: clock.now() }
    }
  }

  async function* execute(
    command: string,
    turnId?: string,
    truncated?: boolean,
    continuity?: RunContinuityContext,
  ): AsyncIterable<PipelineEvent> {
    // One id per turn (#28): adopted when the voice session minted it at
    // utterance end, freshly minted for text-box commands.
    const id = turnId ?? mintTurnId()
    for await (const event of runTurn(command, id, truncated, continuity)) {
      yield stampTurn(event, id)
    }
  }

  async function* runTurn(
    command: string,
    turnId: string,
    truncated?: boolean,
    continuity?: RunContinuityContext,
  ): AsyncIterable<UnstampedEvent> {
    // The Run Plan (#116, ADR 0027): null until a useful Tool Round
    // establishes one — a valid model report or the fallback Lookup
    // plan. `modelDeclaredPlan` distinguishes the fallback from a
    // declaration: the first valid report is always accepted.
    let runPlan: RunPlan | null = null
    let modelDeclaredPlan = false
    // The Run's Notices (#154): every advisory line a tool result carries
    // — rail verdicts, the plan's corrective nudge, the epoch's budget
    // warning and Finalize Instruction — is owed to and delivered by
    // this one module, in its one precedence. The plan nudge is owed
    // until it actually rides a useful result, so a round whose siblings
    // all fail does not swallow it.
    const notices = createNotices()
    // The Finalization Allowance (#209, ADR 0038): minted at Finalization
    // entry and null until then. Everything Finalization does — the
    // Report Grace, the bookkeeping round and its retries, the reserved
    // Answer, and any wait on an action that will not settle — spends
    // this one budget. It is never re-created for the same entry, so a
    // retry or a phase change reads it rather than restarting it; a
    // Steering replan that reopens acquisition drops it, so a later entry
    // mints a fresh one instead of inheriting a spent timer.
    //
    // It starts at the entry, not at the loop top: the door often opens
    // mid-round (a no-Progress trip, the deadline timer), and the round's
    // remaining calls settle before the loop comes back round.
    // The cutoff watch on that allowance, cancelled when the allowance is.
    let cancelCutoffWatch: () => void = () => {}
    // The Report Grace is owed once per Finalization entry (#199, ADR
    // 0035) and consumed at the loop top before the bookkeeping round —
    // so a Steering replan that exits Finalization and a later re-entry
    // each get their own wait, exactly as the entry hook fires twice.
    let reportGraceOwed = false
    /**
     * Drops the allowance (#209): a Steering replan reopened acquisition,
     * or the Run ended. The cutoff watch goes with it — a timer that
     * outlived its Finalization would abandon a browser action the
     * reopened Run is legitimately using.
     */
    const dropAllowance = (): void => {
      cancelCutoffWatch()
      cancelCutoffWatch = () => {}
      run.finalizationAllowance = null
      reportGraceOwed = false
    }
    const run: ActiveRun = {
      turnId,
      aborted: false,
      paused: false,
      finalizationAllowance: null,
      // The Effort Epoch (#146–#148, ADR 0027) owns this Run's bounded
      // effort end to end — the tier budget, the deadline and its
      // cancellation boundary, the hard ceiling, the no-Progress trip,
      // the Steering replan, and Finalization's one door. The pipeline
      // holds no effort state of its own.
      effortEpoch: createEffortEpoch({
        clock,
        activeWorkDeadlineMs: deps.activeWorkDeadlineMs,
        // What the run owes at every Finalization entry (#120/#148):
        // unfinished delegated acquisition is cancelled, and the phase's
        // own directive supersedes the still-owed plan nudge — the epoch
        // clears its own owed budget warning.
        onFinalizationEntered: () => {
          deps.onFinalize?.()
          // One allowance per entry (#209/AC1), started here — including
          // an entry made while a browser action is still outstanding.
          dropAllowance()
          const entered = createFinalizationAllowance({
            clock,
            totalMs: finalizationAllowanceMs,
            ...(reportGraceOverrideMs !== undefined ? { reportGraceMs: reportGraceOverrideMs } : {}),
          })
          run.finalizationAllowance = entered
          reportGraceOwed = true
          // The cutoff (#209/AC6): once only the reserved Answer's
          // protected share is left, the Run stops waiting on anything
          // else. An action that will not settle keeps its resource
          // withheld, but it no longer holds the Card.
          cancelCutoffWatch = entered.watch(entered.cutoffMs(), () => {
            try {
              deps.onFinalizationCutoff?.()
            } catch (err) {
              // The cutoff fires from a timer, where a throw would escape
              // the run entirely — and letting go is best-effort anyway.
              reportFault('pipeline.createCommandPipeline.finalizationCutoff', err, { turnId })
            }
          })
          notices.clear('run_plan')
        },
      }),
    }
    activeRun = run
    // The epoch owes its two Notices itself (#117): worded at delivery,
    // superseded by its own Finalization entry and re-armed by its own
    // replan — Notices only asks when a result can carry them.
    notices.supply('budget', () => run.effortEpoch.takeBudgetWarning())
    notices.supply('finalization', () => run.effortEpoch.takeFinalizationNotice())
    // When this Run started (#123): the freshness boundary — evidence
    // observed before it predates the Run, however it is cited.
    const runStartedAt = clock.now()
    // The Run Observation ledger (#111): private Run Working State. The
    // run's Session generation is the guard — recording stops the moment
    // a newer generation exists, and the ledger dies with the run.
    const runGeneration = continuity?.generation ?? latestSessionGeneration
    if (continuity?.generation !== undefined && continuity.generation > latestSessionGeneration) {
      latestSessionGeneration = continuity.generation
    }
    const ledger = createObservationLedger({
      now: () => clock.now(),
      generation: runGeneration,
      isCurrentGeneration: (generation) => generation === latestSessionGeneration,
    })
    const observe = (input: ObservationInput): ObservationRecord | null => {
      const record = ledger.record(input)
      if (record !== null && deps.onObservation) {
        try {
          deps.onObservation(record)
        } catch (error) {
          reportFault('pipeline.createCommandPipeline.observe', error, { turnId })
          // Diagnostics cannot fail a run.
        }
      }
      return record
    }
    // The Run's decisions (#156): gated execution reaches the user through
    // this one adapter — the ask window and the Confirmation window.
    const decisions = createDecisions(turnId, run, observe)
    const effortEpoch = run.effortEpoch
    const isAnswerOnly = (): boolean => effortEpoch.phase.kind === 'answer_only'
    // The Steering-corrected objective (#119): the directive's text
    // once consumed, superseded by the fresh plan's objective when that
    // declaration lands. Null on a never-steered run — its deterministic
    // fallback Answer names the command the user actually said.
    let correctedObjective: string | null = null
    // The Standing Directive (#167): the user's own words from the last
    // correction, in force for the rest of the Run. `correctedObjective`
    // above is the model's restatement once a fresh plan lands — useful
    // for the deterministic Answer, but it cannot be the thing that keeps
    // the correction alive, because a model that misremembered the
    // correction is exactly what overwrites it. The user's words are
    // never overwritten and are never cleared: a Run only stops needing
    // the correction when it ends.
    let standingDirective: string | null = null
    // The live evidence Session handle (#122): resolved per call, so
    // a Session that ended (Reset, Lapse) refuses later work instead
    // of writing into the void. Grounds user citations, Candidate
    // checkpoints, Answer support, and derived source links against
    // live Observations — including ones this Run checkpointed
    // mid-flight.
    const evidenceSession: EvidenceSessionSource | undefined = continuity?.evidenceSession
    /**
     * The user's standing objective (#206, ADR 0039), read once from the
     * same admission snapshot the Working Memory block rides — immutable
     * for the Run, like the snapshot it comes from. Every round carries
     * it, the reserved Answer round included: a Run that started as
     * "keep looking" must still be answering the user's task at the end,
     * and by then its own Run Notes are the loudest thing in context.
     */
    const retainedObjective = continuity
      ? retainedUserObjective(continuity.memory, continuity.evidence)
      : null
    /**
     * The Candidate this Run's inspection commands address (#210, ADR
     * 0039), read from the same admission the objective and the evidence
     * come from. "Show me that again" arrives with no subject in its own
     * words, and the page the last Run left open is not one — a Run that
     * browsed on after presenting would otherwise inspect, or reject,
     * whatever it last happened to open. Null when the Session retained
     * no subject, or when a replacement objective retired the one it was
     * presented under: an unresolved subject is a question for the user,
     * never a guess from the current page.
     */
    const inspectionSubject = continuity
      ? retainedInspectionSubject(continuity.inspection, continuity.memory, continuity.evidence)
      : null
    /**
     * The words this Run inherited (#211, ADR 0039; #218, ADR 0043),
     * projected from the same admission the subject and the objective
     * come from — never its own command, which it answers by answering.
     * Every round carries them, the reserved Answer round included: a Run
     * that fails on its way to an Answer must leave them exactly as it
     * found them, and a Run that resolves one does so by grounding a
     * decision the Session retains — never by having read the words once.
     */
    const retainedCorrections = userCorrectionSubjects(continuity?.corrections ?? [], continuity?.evidence)
    /**
     * The objective this Run's Session decisions are scoped to (#208):
     * admission memory's, because a Run's own Memory Commit lands after
     * its Answer — the same reading `presentInspectionSubject` takes,
     * named once so the two cannot drift.
     */
    const objectiveInForce = (): MemoryEntryId | undefined =>
      continuity ? currentUserObjective(continuity.memory)?.id : undefined
    /**
     * What this Run is told about verification, read fresh each round
     * (#212, ADR 0041). Admission's projection is the starting value, but
     * a Run spends its own fresh attempt mid-flight and records its own
     * Candidates mid-flight — so a block frozen at admission would tell
     * round four that an attempt is open which round three already spent,
     * or forbid one the rail would now allow. The gate reads live state;
     * so must the sentence describing it.
     *
     * Falls back to admission's value when no Session answers, which is
     * the same thing a caller with no evidence continuity already had.
     */
    /**
     * Whether this Run actually spent a verification route — asked a
     * check and watched it fail (#212, ADR 0041). Deliberately not the
     * deterministic Answer's `hasUnresolvedImageCheck`, which counts any
     * failed `look` record including one refused before it ran. The two
     * answer different questions: the Answer names a check the Run wanted
     * and did not get, which a refusal also is, while the Resolution
     * decides whether `needs_user` is the assistant handing over its own
     * work — and a check nobody made was never the assistant's to hand
     * over.
     */
    let verificationSpent = false
    const verificationInForce = (): VerificationSubject | null => {
      const session = evidenceSession?.()
      if (!session) return continuity?.verification ?? null
      const snapshot = session.store.snapshot()
      return verificationSubject({
        failures: session.store.verificationFailures(),
        objectiveId: objectiveInForce(),
        eligible: eligibleVerificationCandidates(snapshot, {
          objectiveId: objectiveInForce(),
          corrections: correctionsInheritedBy(session.store.unresolvedCorrections(), session.runId),
        }),
        evidence: snapshot,
        // What this Run has already spent, which the store cannot know.
        spentInRun: verificationSpent,
      })
    }
    /**
     * Retains the Candidate an Answer presented, under the objective in
     * force as it was presented. Admission memory is that objective: a
     * Run's own Memory Commit lands after its Answer, so an Answer that
     * replaces the objective *and* presents a Candidate stamps the
     * reference with the objective the user had when they saw it — and
     * the replacement then clears it, as a replacement should.
     */
    const presentInspectionSubject = (candidateId: MemoryEntryId | undefined): void => {
      if (candidateId === undefined) return
      const session = evidenceSession?.()
      if (!session) return
      const objectiveId = objectiveInForce()
      session.store.presentInspection({
        candidateId,
        ...(objectiveId !== undefined ? { objectiveId } : {}),
        runId: session.runId,
      })
    }
    // Admission evidence identities (#123): which Observations this Run
    // starts beside — anything else in the live store was checkpointed
    // mid-Run, so it is fresh by construction. The staleness gate reads
    // this; the admission snapshot itself stays immutable (#121).
    const admissionEvidenceIds = new Set<MemoryEntryId>(
      (continuity?.evidence?.observations ?? []).map((observation) => observation.id),
    )
    // One shared live-evidence resolver (#122–#124): read-only lookups of
    // Session Observations by Memory Entry identity, against the live
    // store the moment they run — null once the Session ended (Reset,
    // Lapse). Answer source derivation and Run Context Compaction both
    // resolve through it.
    const resolveSessionObservation = (id: MemoryEntryId) => evidenceSession?.()?.store.observation(id) ?? null
    // This Run's Tool Round executor (#157): created below, once the tool
    // context it executes against exists. Named here because the Steering
    // replan reaches its no-progress accounting (see interrupts.check).
    let toolRound: ToolRoundExecutor | null = null
    // The Run's interrupts (#156): one door for Pause, Steering, and Stop
    // between the loop's calls and around its model rounds. Steering
    // observations (#111): every directive is recorded exactly once, here,
    // at the checkpoint that consumes it into the run. The Run's own
    // hook is the pause-aware steering checkpoint together with everything
    // a consumed Directive resets below; a delegated worker satisfies the
    // same shape with a cancel-only hook.
    const interrupts: RunInterrupts = {
      check: async function* (status) {
        const directive = yield* checkpoint(run, status)
        if (directive !== undefined) {
          observe({ producer: 'steering', ok: true, payload: directive })
          // The Steering replan (#119, ADR 0027): the directive corrects
          // the objective, so everything planned for the stale one is
          // discarded atomically here, at the one checkpoint every
          // directive passes through. The plan slot reopens — the
          // corrected objective reports a fresh initial plan, and a
          // plan-less round falls back to Lookup with one fresh nudge,
          // exactly like the run's start. While working, or when a tier rail
          // caused Finalization, Effort re-arms at the default tier without
          // rewinding cumulative rounds or observations. Other Finalization
          // causes and an already spent bookkeeping round stay terminal. The
          // no-progress accounting resets for a working corrected objective,
          // but cannot reopen a Run whose no_progress cause already latched.
          runPlan = null
          modelDeclaredPlan = false
          notices.replan()
          toolRound?.replan()
          // A replan that reopened acquisition drops the allowance with
          // everything else planned for the stale objective (#209/AC4):
          // reopened work is not Finalization, and a timer left running
          // across it would cut the fresh work short or abandon a browser
          // action it is legitimately using. A later Finalization entry
          // mints its own.
          if (effortEpoch.replan(DEFAULT_EFFORT_TIER)) dropAllowance()
          correctedObjective = directive
          standingDirective = directive
        }
        return directive
      },
      peek: async function* (status) {
        // The mid-gate peek (#157): park like `check`, but leave the
        // Directive for the loop's own check to consume into the replan.
        yield* checkpoint(run, status, false)
        return Boolean(run.steering)
      },
      throwIfStopped: () => throwIfAborted(run),
    }
    const emitDetail = deps.emitDetail
      ? (event: UnstampedEvent): void => deps.emitDetail!(stampTurn(event, turnId))
      : undefined
    // Streamed deltas (#47): one batcher per run — fragments accumulate
    // per round and flush (resetting it) at each round's end. Tool-intent
    // snapshots (#48) ride the same window as their own detail variant.
    const batcher = emitDetail
      ? createLlmDeltaBatcher({
          clock,
          emit: (fragment) =>
            emitDetail(
              fragment.kind === 'tool_intent'
                ? { type: 'llm_tool_intent', index: fragment.index, name: fragment.name, args: fragment.args, at: fragment.at }
                : { type: 'llm_delta', kind: fragment.kind, text: fragment.text, at: fragment.at },
            ),
        })
      : undefined
    // The reasoning records (#182): one collector per run when the Run is
    // tracing at all, assembling each round's reasoning deltas. Absent by
    // default — with nothing here, no reasoning is retained anywhere. The
    // writer's presence is the whole opt-in since #184: with nothing to
    // write to, collecting would retain the model's reasoning in memory
    // only to drop it, and the point of the opt-in is that unasked-for
    // reasoning is never collected in the first place. Turning it on makes
    // every round stream, because the reasoning only exists in the stream.
    const traceRun = continuity?.traceRun
    const reasoningRounds = traceRun ? createReasoningRounds() : undefined
    // The one write every reasoning record goes through — the Run's own
    // rounds, an abandoned attempt, and a delegated Subagent's rounds
    // (#183) alike — stamped with this turn. Truncation happens inside the
    // writer's guard. Absent with the collector, since both need the writer.
    const writeReasoning =
      traceRun && reasoningRounds
        ? (round: TracedReasoningRound): void => traceRun(() => ({ turnId, ...reasoningEvent(round) }))
        : undefined
    // The llm_round records (#191): one per attempt, numbered as the
    // reasoning records are, carrying what the client reported it sent —
    // model, prompt hash, rung — with the request's shape and the
    // provider's usage. The same one write serves the Run's own rounds and
    // a delegated worker's (handed down as `traceSubagentLlmRound`).
    const llmRounds = traceRun ? createLlmRounds() : undefined
    const writeLlmRound =
      traceRun && llmRounds
        ? (round: TracedLlmRound): void => traceRun(() => ({ turnId, ...llmRoundEvent(round) }))
        : undefined
    // The off_contract_reply records (#198): one per reserved Answer round
    // whose reply was not the contract's shape — the Run's own round and a
    // delegated worker's (handed down as `traceSubagentOffContractReply`).
    // The round's raw text reaches no view, so this write is the only place
    // it is kept; the fault beside it is reported at the failure itself.
    const writeOffContractReply = traceRun
      ? (reply: TracedOffContractReply): void => traceRun(() => ({ turnId, ...offContractReplyEvent(reply) }))
      : undefined
    // A delegated worker's Tool Rounds (#185): the same one write, for the
    // events a worker's rounds publish to nobody. Its events arrive
    // unstamped — a worker knows no turn — so the Run stamps its own,
    // which is the turn a diagnosis joins the worker's calls to the
    // delegation that made them.
    const writeSubagentPipelineEvent = traceRun
      ? (event: UnstampedEvent, agentId: string | undefined): void => {
          // The one decision made outside the writer's guard, because it
          // reads nothing but the event's type: whether to write at all.
          if (!tracesPipelineEvent(event)) return
          traceRun(() => ({ turnId, ...pipelineEventTraceBody(stampTurn(event, turnId), agentId) }))
        }
      : undefined

    try {
      let runOutcome: 'done' | 'failed' | 'cancelled' = 'done'
      // The execution failure Finalization recorded, if any (#203, ADR
      // 0038): kept beside the entry cause, never in place of it. A
      // reserved Answer round that threw, narrated, or asked for tools
      // failed *after* the run had already stopped for its own reason —
      // so it is additional information about the stop, and letting it
      // overwrite the entry cause would lose the only true answer to
      // "why did you stop?". It is declared out here, beside the run's
      // outcome, because the Memory Commit that retains it runs past the
      // catch that the failing round lands in.
      let finalizationFailure: string | null = null
      // A successful Session Reset tool (#99) discards the rest of the run:
      // siblings never execute, no later round happens, nothing commits.
      let resetConsumed = false
      let finalAnswer: Extract<AssistantTurn, { kind: 'answer' }> | undefined
      yield { type: 'command', text: command, at: clock.now() }
      observe({ producer: 'command', ok: true, payload: command })
      yield { type: 'status', status: 'thinking', at: clock.now() }
      // LRU touch (ADR 0022): the run's input is the transcript an admitted
      // term was heard in — use is the honest "recently biased" signal.
      // Bookkeeping can never fail the run.
      try {
        deps.learnedTerms?.observeTranscript(command)
      } catch (error) {
        reportFault('pipeline.createCommandPipeline.observeTranscript', error, { turnId })
        // swallowed — the ledger is advisory
      }

      try {
        // The Run's model context: one assistant/tool pair per tool call
        // (#124). `let` because Run Context Compaction swaps the array —
        // historical request snapshots keep the context they were sent.
        // The observation ids stay index-aligned with every push.
        let toolResults: ToolResult[] = []
        const resultObservationIds: (ObservationId | null)[] = []
        // The user-citation commit (#122): the same seam, stamped like
        // the web commit — provenance is Session-side, never forged by
        // the Run layer.
        const commitUser: EvidenceCommit | undefined = evidenceSession
          ? (input) => {
              const session = evidenceSession()
              return session === null ? null : userEvidenceCommit(() => session.store, session.runId)(input)
            }
          : undefined
        // The Subagent-finding commit (#123): the same Session seam, plus
        // the worker's id as Subagent provenance — the store stamps both.
        // Like the user commit, the store is resolved per call, so a
        // Session that ended refuses instead of writing into the void.
        const commitSubagent: ((agentId: string) => EvidenceCommit) | undefined = evidenceSession
          ? (agentId) => (input) => {
              const session = evidenceSession()
              return session === null ? null : subagentEvidenceCommit(() => session.store, session.runId, agentId)(input)
            }
          : undefined
        // Run Context Compaction (#124, ADR 0028): accepted Evidence
        // Checkpoints grounded in this Run's ledger, in acceptance order.
        // Subagent citations ground worker-ledger identities, never this
        // list — they map to no orchestrator tool result.
        const acceptedCheckpoints: RunEvidenceCheckpoint[] = []
        const checkpointEvidenceHandler: ((call: ToolCall) => EvidenceCheckpointOutcome) | undefined =
          continuity?.checkpointEvidence || commitUser
            ? (call) => {
                const outcome = evaluateEvidenceCheckpoint(call, {
                  records: ledger.snapshot(),
                  ...(continuity?.checkpointEvidence ? { commit: continuity.checkpointEvidence } : {}),
                  ...(commitUser ? { commitUser } : {}),
                  ...(commitSubagent ? { commitSubagent } : {}),
                  ...(deps.subagentObservations ? { workerObservations: deps.subagentObservations } : {}),
                })
                // The Run Trace (#180): what was cited, what it was graded
                // against, and the verdict — accepted or rejected alike.
                // The Feed shows only the display line, so a rejected
                // or vanished checkpoint is diagnosed from here.
                continuity?.traceRun?.(() => ({
                  turnId,
                  ...evidenceCheckpointEvent({
                    call,
                    outcome,
                    records: ledger.snapshot(),
                    ...(deps.subagentObservations ? { workerObservations: deps.subagentObservations } : {}),
                  }),
                }))
                // Only checkpoints whose grounding record is this Run's
                // own ledger observation can compact a tool result: the
                // membership check excludes worker-ledger ids even on an
                // id collision, and user-event records never align with
                // a tool result's tracked observation.
                if (outcome.ok && outcome.agentId === undefined && ledger.get(outcome.sourceObservationId) !== null) {
                  acceptedCheckpoints.push({
                    entryId: outcome.entryId,
                    sourceObservationId: outcome.sourceObservationId,
                  })
                }
                return outcome
              }
            : undefined
        const checkpointCandidateHandler: ((call: ToolCall) => CandidateCheckpointOutcome) | undefined = evidenceSession
          ? (call) => {
              const outcome = evaluateCandidateCheckpoint(call, { session: evidenceSession })
              continuity?.traceRun?.(() => ({ turnId, ...candidateCheckpointEvent({ call, outcome }) }))
              return outcome
            }
          : undefined
        const toolContext: ToolContext = {
          clock,
          // The turn id rides the context so fan-out tools (spawn_agent)
          // correlate their subagent rounds to this turn (#29) — and so
          // the vision records name the turn that made them (#186).
          turnId,
          // The vision records (#186): the reporter routes by the ids the
          // tool hands it, so a Look inside this Run joins its decisions.
          ...(deps.traceVision ? { traceVision: deps.traceVision } : {}),
          // Bounded delegation (#120): the live tier epoch gates browse
          // spawns — only Investigation branches delegate — and workers
          // share this run's active-work deadline as a live predicate, so
          // a tier escalation re-arm reaches them without a respawn.
          effortTier: () => effortEpoch.tier,
          finalizing: () => effortEpoch.phase.kind !== 'working',
          delegationDeadline: effortEpoch.delegationDeadline,
          // A delegated worker's reasoning records (#183): the Run's own
          // writer and turn, closed over here so the worker never sees
          // either — its thinking lands already joined to the Run that
          // delegated it, stamped with the worker's own agentId. Gated on
          // the writer as well as the flag, so nothing is collected in a
          // worker that has nowhere to write.
          ...(writeReasoning ? { traceSubagentReasoning: writeReasoning } : {}),
          // And its llm_round records (#191), through the same hand-down.
          ...(writeLlmRound ? { traceSubagentLlmRound: writeLlmRound } : {}),
          // And its failed reserved round (#198), through the same hand-down:
          // a worker's off-contract report reply is dropped on the floor for
          // the bounded report, so the trace is the only record of it.
          ...(writeOffContractReply ? { traceSubagentOffContractReply: writeOffContractReply } : {}),
          // And what those rounds called (#185), through the same writer:
          // a worker's stream reaches no view at all, so this is the only
          // record of it there will ever be.
          ...(writeSubagentPipelineEvent ? { traceSubagentPipelineEvent: writeSubagentPipelineEvent } : {}),
          // Delegation's memory selection (#98): spawn_agent resolves
          // memory_ids against this Run's immutable snapshot — the same one
          // every model round sees — so a worker can never receive entries
          // the orchestrator has not, and shared slices stay stable for the
          // whole run.
          ...(continuity
            ? {
                selectMemoryEntries: (ids: readonly string[]): WorkingMemorySnapshot =>
                  selectDelegatedMemory(continuity.memory, ids),
              }
            : {}),
          // The Evidence Checkpoint seam (#121/#122): the Run's Observation
          // ledger grounds the citation — a web source must have been
          // observed this Run with a verbatim excerpt, a user citation's
          // text must be the user's exact recorded words — before the
          // Session side stores anything. Invalid citations fail
          // recoverably and mutate no Session state. The Candidate seam
          // (#122) grounds support ids against the live store.
          ...(checkpointEvidenceHandler ? { checkpointEvidence: checkpointEvidenceHandler } : {}),
          ...(checkpointCandidateHandler ? { checkpointCandidate: checkpointCandidateHandler } : {}),
          ...(emitDetail
            ? {
                // Progress detail (#43): what the run waits on, live.
                waitingOnAgents: (running: number): void =>
                  emitDetail({ type: 'waiting_on_agents', running, at: clock.now() }),
              }
            : {}),
        }
        // What the round hands back to the pipeline (#116/#157): the Run
        // Plan's own report call, answered here rather than executed.
        // Rewritten once per round, just before the round runs.
        let interceptCall: (call: ToolCall) => ToolResultOutcome | null = () => null
        // The Tool Round executor (#157): gated execution, observation,
        // both rails, the Vision Budget, Notice attachment, the sole-call
        // boundary and the epoch's round protocol live in the one module
        // that owns their order. The Run runs every capability.
        toolRound = createToolRoundExecutor({
          clock,
          tools,
          effortEpoch,
          notices,
          observe,
          toolContext,
          decisions,
          interrupts,
          capabilities: { searchLoopRail: true, verificationRail: true, noProgressRail: true, perCallGate: true },
          intercept: (call) => interceptCall(call),
          // A successful Session Reset (#99) discards the rest of the run.
          terminalResult: (call, outcome) => outcome.ok && toolsByName.get(call.name)?.sessionReset === true,
          // Session Reset boundary (#99): the reset call runs alone, and
          // its discarded siblings answer only if it failed anyway.
          soleCall: {
            select: (call) => toolsByName.get(call.name)?.sessionReset === true,
            notExecuted: 'not executed: this response carried a session reset, but it failed',
          },
          // The verification rail's Session seams (#212, ADR 0041). All
          // four resolve per call against the live store rather than
          // against admission: a Candidate this Run has only just
          // recorded is exactly the specific lead a fresh check exists
          // for, and one the user has just spoken about has stopped
          // being one. A Session that ended (Reset, Lapse) answers with
          // nothing, and the rail falls back to this Run's own spend.
          verification: {
            retainedFailures: () => evidenceSession?.()?.store.verificationFailures() ?? [],
            eligibleCandidates: () => {
              const session = evidenceSession?.()
              if (!session) return []
              return eligibleVerificationCandidates(session.store.snapshot(), {
                objectiveId: objectiveInForce(),
                // Inherited words only — the rule the store already
                // applies to a decision and a presentation (#211). This
                // Run's own command is what it is here to answer, and
                // checking a Candidate is one of the ways it answers it.
                corrections: correctionsInheritedBy(session.store.unresolvedCorrections(), session.runId),
              })
            },
            // Whether there is a shortlist at all (#212): with none, a
            // spent route reopens rather than staying shut on a rule
            // written about shortlists.
            heldCandidates: () => heldVerificationCandidates(evidenceSession?.()?.store.snapshot()),
            objectiveId: objectiveInForce,
            retainFailure: (spent) => {
              // The Run's own record that a route was actually asked and
              // actually failed (#212). Set whether or not a Session is
              // there to retain it, because the Resolution rule below
              // reads it and a Run without evidence continuity still made
              // the attempt.
              verificationSpent = true
              const session = evidenceSession?.()
              session?.store.retainVerificationFailure({
                route: spent.route,
                failure: spent.failure,
                runId: session.runId,
              })
            },
          },
          ...(deps.currentHost ? { currentHost: deps.currentHost } : {}),
          ...(deps.currentPageUrl ? { currentPageUrl: deps.currentPageUrl } : {}),
          ...(deps.describeRef ? { describeRef: deps.describeRef } : {}),
          ...(deps.settledPageState ? { settledPageState: deps.settledPageState } : {}),
          ...(deps.tracer !== undefined || deps.browserSubspans !== undefined
            ? {
                diagnostics: {
                  ...(deps.tracer ? { tracer: deps.tracer } : {}),
                  ...(deps.browserSubspans ? { browserSubspans: deps.browserSubspans } : {}),
                },
              }
            : {}),
        })
        let steering: string | undefined
        // The Run Headline (ADR 0025): the last one this run emitted — the
        // next report lands as an event only when it changes the title.
        let lastHeadline: string | null = null
        // The Run Plan state, the effort epoch, and Finalization live in
        // the run scope — the Steering replan (see interrupts.check)
        // resets them at the checkpoint that consumes a directive.
        // The deterministic fallback Answer (#117): produced when the
        // reserved Answer round fails, requests tools, or replies off
        // contract (#198).
        let deterministicFallback = false
        // The cause that fallback answers under, asked in one place so the
        // Answer the user hears and the trace record of the failed round
        // can never disagree: the phase's own Finalization Cause, or the
        // hard round ceiling when the loop broke while still working.
        const fallbackCause = (): FinalizationCause =>
          effortEpoch.phase.kind === 'working' ? 'hard_limit' : effortEpoch.phase.cause
        // The cause's own detail, asked from the same place (#202): a
        // `blocker` stop's Answer names the wall, and a wall named in the
        // spoken Answer but not the displayed one would be two stories.
        const fallbackDetail = (): FinalizationDetail | undefined =>
          effortEpoch.phase.kind === 'working' ? undefined : effortEpoch.phase.detail

        for (;;) {
          // The loop top asks the epoch's rails (#146–#148): a tripped rail
          // enters Finalization there — the phase this round runs under is
          // read from the epoch below, so the answer needs no unpacking.
          effortEpoch.decideLoopTop()
          steering = (yield* interrupts.check('thinking')) ?? steering
          // The Report Grace (#199, ADR 0035): Finalization no longer
          // cancels a live Subagent, so before the bookkeeping Tool Round
          // the Run waits for each one's report — that round is the last
          // place a worker's findings can become Session Evidence (ADR
          // 0028). The wait ends the moment every worker has settled, so
          // a Run that delegated nothing pays nothing, and a Stop — which
          // cancels them all — ends it the same way. Whatever is still
          // running when the grace elapses has its round abandoned and
          // returns its bounded report, too late for this round's context.
          //
          // Since #209 the grace is a share of the Finalization Allowance
          // rather than a wait of its own: it may only spend what
          // bookkeeping's share and the Answer's protected share leave it,
          // a Pause suspends it, and a Stop ends it at once even where the
          // workers themselves never answer.
          let graceJustEnded = false
          if (reportGraceOwed) {
            reportGraceOwed = false
            const settled = deps.subagentReportsSettled?.()
            if (settled !== undefined) {
              yield* awaitReportGrace(run, settled)
              graceJustEnded = true
              // A Stop during the wait cancelled every worker, which is
              // what ended it: the run is over, and no bookkeeping round
              // follows a Stop.
              if (run.aborted) throw new CommandAbortedError()
              // A directive that landed while the grace was paused is
              // consumed here, at the checkpoint every one passes through
              // — its replan may have reopened acquisition, so the loop
              // has to start over rather than fall into bookkeeping.
              const afterGrace = yield* interrupts.check('thinking')
              if (afterGrace !== undefined) {
                steering = afterGrace
                continue
              }
            }
          }
          // A report that completed before Finalization is Collection, not
          // Acquisition (#192). Put it through the same call/result transcript
          // and event shapes as an explicit agent_results call before the
          // bookkeeping request (or the reserved Answer request) is built.
          if (effortEpoch.phase.kind !== 'working') {
            for (;;) {
              const completedReports = deps.collectCompletedSubagentResults?.(turnId) ?? []
              if (completedReports.length === 0) break
              for (const completed of completedReports) {
                const call: ToolCall = {
                  id: `finalization-agent-results-${completed.agentId}`,
                  name: 'agent_results',
                  args: { agent_id: completed.agentId },
                }
                // Phase-aware (#200, ADR 0036): while the epoch is
                // finalizing a bookkeeping round is next and the report
                // invites a checkpoint; once it is Answer-only the report
                // claims nothing about Bookkeeping, because a call from
                // there fails the round.
                const result = `${completed.formattedReport}\n\n${injectedReportDirective(effortEpoch.phase)}`
                const outcome: ToolResultOutcome = { ok: true, result }
                yield { type: 'tool_call', callId: call.id, name: call.name, args: call.args, at: clock.now() }
                const observed = observe({ producer: 'subagent_report', ok: true, payload: completed.formattedReport })
                toolResults.push({ call, outcome })
                resultObservationIds.push(observed?.id ?? null)
                yield {
                  type: 'tool_result',
                  callId: call.id,
                  name: call.name,
                  ok: true,
                  result,
                  at: clock.now(),
                }
              }
            }
          }
          // Abandoning what is still running comes after this round's
          // collection (#199): what a worker managed to report inside the
          // grace is in the round, and cutting the rest off cannot race
          // with reading them. A bounded report that lands after this
          // point is collected by the reserved Answer round instead.
          if (graceJustEnded) deps.onReportGraceEnd?.()
          // What this round may spend of the Finalization Allowance
          // (#209/AC3): bookkeeping's share while the epoch is finalizing,
          // everything left once it is Answer-only, and nothing at all
          // while the run is still working — the active-work deadline
          // bounds those. An opportunity with no share left is *skipped*
          // rather than started: opening another full client timeout for
          // it is the accumulation this allowance exists to end.
          const roundAllowanceMs =
            run.finalizationAllowance === null || effortEpoch.phase.kind === 'working'
              ? null
              : isAnswerOnly()
                ? run.finalizationAllowance.reservedAnswerMs()
                : run.finalizationAllowance.bookkeepingMs()
          if (roundAllowanceMs !== null && roundAllowanceMs <= 0) {
            // The reserved Answer's own share is gone: the run answers
            // deterministically from what it retained, now, rather than
            // spending a round it has no time for.
            if (isAnswerOnly()) {
              reportFault(
                'pipeline.createCommandPipeline.reservedAnswerAllowanceSpent',
                `the Finalization Allowance was spent before the reserved Answer round (${fallbackCause()})`,
                { turnId },
              )
              finalizationFailure = 'the Finalization Allowance was spent before the reserved Answer round could run'
              deterministicFallback = true
              break
            }
            // Bookkeeping's was: it is one *optional* opportunity, and one
            // there is no time to take is one the run advances past, under
            // the cause it entered Finalization with. The epoch refuses
            // only from a phase that has no opportunity to spend, and this
            // branch is unreachable from one — but falling through would
            // arm a zero watch that abort the round before it was sent and
            // escape as the raw error ADR 0038 forbids, so it answers
            // deterministically instead.
            reportFault(
              'pipeline.createCommandPipeline.bookkeepingAllowanceSpent',
              `the Finalization Allowance was spent before the bookkeeping round (${fallbackCause()})`,
              { turnId },
            )
            if (effortEpoch.spendBookkeepingOpportunity()) {
              finalizationFailure =
                'the Finalization bookkeeping round was skipped: the Finalization Allowance had no time left for it'
              continue
            }
            finalizationFailure = 'the Finalization Allowance was spent with no opportunity left to take'
            deterministicFallback = true
            break
          }
          // Run Context Compaction (#124, ADR 0028): before every model
          // round, past the deterministic size threshold, older tool
          // results an accepted Evidence Checkpoint represents are
          // replaced in context by their Session Evidence references —
          // deterministic, idempotent, no summarization model. The live
          // Session store is only read; the immutable admission snapshot
          // is never touched. Advisory notices that once rode a compacted
          // result retire with it — they were bound to the round they
          // rode. Any failure falls back to the original context —
          // compaction can never fail a run.
          try {
            const compacted = compactRunContext({
              toolResults,
              observationIds: resultObservationIds,
              records: ledger.snapshot(),
              checkpoints: acceptedCheckpoints,
              resolveObservation: resolveSessionObservation,
              ...(deps.runContextCompactionThresholdChars !== undefined
                ? { thresholdChars: deps.runContextCompactionThresholdChars }
                : {}),
            })
            if (compacted !== toolResults) toolResults = [...compacted]
          } catch (err) {
            console.warn('[run-context-compaction] fell back to the original context:', toErrorMessage(err))
          }
          // The round's cancellation boundary (#47/#135, ADR 0027): the
          // epoch arms it, so the active-work deadline aborts an in-flight
          // acquisition round the moment it expires. Stop reaches the same
          // signal — abort() fires it, the client cancels the HTTP
          // request, and the rejection below maps back to a cancelled run
          // rather than waiting out the request timeout.
          const armedRound = effortEpoch.armRound()
          run.abortLlm = () => armedRound.abort()
          // The same boundary for a Finalization round (#209/AC3), which
          // the epoch deliberately arms nothing for: this round's share of
          // the allowance, holding the *whole* request — every retry the
          // client makes inside `llm.complete`, an empty reply retried
          // included, shares it rather than starting another full client
          // timeout of its own. The allowance suspends the watch on a
          // Pause, so a held round is not aborted for the user's time.
          //
          // The tool handling that follows a bookkeeping round is charged
          // to the same allowance but cannot be cut short by it: a Tool
          // takes no signal, and the one seam that can end a wait on
          // something outstanding is the pane custody's (#205), which the
          // cutoff below fires. So a bookkeeping tool that overruns costs
          // the reserved Answer its round rather than its own — the run
          // still answers, deterministically, inside the allowance.
          let allowanceSpent = false
          const cancelRoundWatch =
            roundAllowanceMs === null || run.finalizationAllowance === null
              ? () => {}
              : run.finalizationAllowance.watch(roundAllowanceMs, () => {
                  allowanceSpent = true
                  armedRound.abort()
                })
          let turn: AssistantTurn
          // What this round's llm_round records carry (#191): the request's
          // shape and rung as it was sent — captured once the request is
          // built, so an attempt closed after an escalation still says what
          // it went out under — and the usage of the attempt that returned.
          let sentRound: { readonly request: LlmRequestShape; readonly reasoningEffort: ReasoningEffort } | undefined
          let roundUsage: AssistantTurn['usage']
          // How the round ended (#218): set where the outcome is decided
          // — the return, or the catch that maps the abort back to what
          // caused it — and read by the record in the finally.
          let roundOutcome: LlmRoundOutcome = 'failed'
          const closeLlmAttempt = (closed: LlmRound): void => {
            // The request is built before any attempt can close, so this
            // is the llmRounds gate restated, never a missing shape.
            if (sentRound === undefined) return
            writeLlmRound?.({ ...closed, role: 'orchestrator', ...sentRound })
          }
          // Whether this round is the reserved Answer round, read once as
          // the request is built: the phase cannot change while a round is
          // in flight, and the streaming and off-contract branches below
          // both ask the same question.
          const reservedRound = isAnswerOnly()
          // The phase's own instruction, read from the same place and at
          // the same moment (#207): the bookkeeping round is told
          // Bookkeeping is still open, the reserved Answer round that no
          // tool round remains.
          const roundFinalizeInstruction = requestFinalizeInstruction(effortEpoch.phase)
          // Read per round, not per Run (#212): what this round is told
          // about spent routes has to be what the gate it meets will
          // decide from.
          const verificationRound = verificationInForce()
          try {
            const request: LlmRequest = {
              command,
              toolResults,
              // How hard this round thinks (#166): a pure function of the
              // Effort Epoch, read here so an escalation or a Steering
              // replan reaches the very next round with everything else.
              reasoningEffort: effortEpoch.reasoningEffort,
              // The truncation flag (#61) rides every round: the model sees
              // the possibly-cut-off note for as long as the turn runs.
              ...(truncated ? { truncated: true } : {}),
              // The turn id rides the request so the perf wrapper keys each
              // llm span to this turn (#29).
              turnId,
              // The reserved Answer round (#136): this request is the
              // tool-free one — the flag rides the contract so the
              // adapter sends no tool definitions and no automatic tool
              // choice, whatever the catalog still holds for bookkeeping.
              ...(reservedRound ? { answerOnly: true } : {}),
              // The Finalize Instruction (#207, ADR 0038): every
              // Finalization request states outright that acquisition has
              // ended and what this round may still do. The captured
              // failure was a Run whose first request was aborted at the
              // active-work deadline — no tool call, no tool result, so
              // none of the instruction's other three carriers existed,
              // and a bookkeeping round that read as ordinary work.
              ...(roundFinalizeInstruction !== null ? { finalizeInstruction: roundFinalizeInstruction } : {}),
              ...(continuity ? { journal: continuity.snapshot } : {}),
              ...(continuity ? { memory: continuity.memory } : {}),
              // The user's own objective (#206), beside the memory it was
              // projected from — never in place of it.
              ...(retainedObjective ? { objective: retainedObjective } : {}),
              // The Candidate a previous Answer presented (#210): what
              // this Run's inspection commands are about, beside the
              // objective they are about it under.
              ...(inspectionSubject ? { inspection: inspectionSubject } : {}),
              // The user's unresolved words (#211): what they said, still
              // waiting on a Run to resolve it, beside the subject it was
              // said about.
              ...(retainedCorrections.length > 0 ? { corrections: retainedCorrections } : {}),
              // The routes this objective already spent checking itself
              // (#212), read fresh: every round carries what is true when
              // that round is built, so the block and the gate it will
              // meet cannot contradict each other mid-Run.
              ...(verificationRound !== null ? { verification: verificationRound } : {}),
              // Checkpointed Session Evidence this Run starts beside (#121):
              // the immutable admission snapshot — mid-Run checkpoints ride
              // tool results, later Runs' admissions.
              ...(continuity?.evidence ? { evidence: continuity.evidence } : {}),
              // The arriving directive rides the round that consumed it;
              // every round after that carries the same words as the
              // Standing Directive (#167), the reserved Answer round
              // included — so the correction outlives the model's memory
              // of it however little the rung deliberates.
              ...(steering !== undefined
                ? { steering }
                : standingDirective !== null
                  ? { standingDirective }
                  : {}),
              // Retry visibility (#43): each attempt beyond the first is a
              // detail event on the side channel — emitted before the next
              // attempt starts, while this round is still in flight.
              // Wired for the reasoning records too (#182), so a retry
              // splits its attempts even where no detail channel listens.
              ...(emitDetail || reasoningRounds
                ? {
                    onRetryAttempt: (attempt: number, maxAttempts: number): void => {
                      // Drain the failed attempt's partial stream first (#47):
                      // its fragments close as their own feed run, so the
                      // next attempt streams fresh instead of concatenating
                      // onto stale buffer.
                      batcher?.flush()
                      // The abandoned attempt's thinking (#182) closes with
                      // it, as its own record: concatenating it into the
                      // attempt that survives would hide that two happened.
                      if (reasoningRounds) writeReasoning?.(reasoningRounds.takeAttempt())
                      // And its llm_round record (#191), numbered alike:
                      // an abandoned attempt carries no usage.
                      if (llmRounds) closeLlmAttempt(llmRounds.takeAttempt())
                      emitDetail?.({ type: 'llm_retry', attempt, maxAttempts, at: clock.now() })
                    },
                  }
                : {}),
              // Attempt identity (#191): the client reports what each attempt
              // is sent under; the next take carries it into the record.
              ...(llmRounds ? { onAttempt: (sent: LlmAttemptSent): void => llmRounds.onAttempt(sent) } : {}),
              // Streaming (#47): the round streams only when the detail
              // channel is wired (absent → the non-streaming fallback).
              // Streaming is also what the reasoning records read (#182):
              // reasoning exists only as deltas, so the opt-in wires the
              // round to stream even where no detail channel is listening.
              ...(batcher || reasoningRounds || llmRounds
                ? {
                    onDelta: (delta: LlmStreamDelta): void => {
                      // A reserved round streams nothing (#198, ADR 0034).
                      // The partial Answer streams to the Card as it
                      // arrives and prose streams raw, so a narrating
                      // reserved round would flash its narration before the
                      // deterministic fallback replaced it. The Card renders
                      // the final Answer or the fallback, never both. The
                      // reasoning collector still sees every delta: the
                      // reserved round's thinking is exactly what a
                      // diagnosis wants (#183), and it reaches no view.
                      if (!reservedRound) batcher?.onDelta(delta)
                      reasoningRounds?.onDelta(delta)
                      // And the round's record counts it (#218): how much
                      // thinking a cut round streamed is what tells it
                      // from an empty completion.
                      llmRounds?.onDelta(delta)
                    },
                  }
                : {}),
              signal: armedRound.signal,
            }
            if (llmRounds) sentRound = { request: llmRequestShape(request), reasoningEffort: request.reasoningEffort ?? effortEpoch.reasoningEffort }
            turn = await llm.complete(request)
            roundUsage = turn.usage
            roundOutcome = 'completed'
          } catch (err) {
            // What ended the round, for its record (#218): the cuts this
            // loop made itself first — they all reach the client as one
            // abort — then the client's own word on why it threw.
            roundOutcome = run.aborted
              ? 'cancelled'
              : armedRound.deadlineAborted
                ? 'deadline'
                : allowanceSpent
                  ? 'allowance'
                  : llmRoundFailure(err)
            // The aborted signal rejects the request; the run was stopped,
            // so this is a cancellation whatever the rejection looks like.
            if (run.aborted) throw new CommandAbortedError()
            // The deadline aborted the in-flight round (#135): acquisition
            // work stops here — no provider or abort error is surfaced.
            // The run enters Finalization like every work rail and picks
            // up at its normal phase: a pending Steering directive is
            // consumed at the loop-top checkpoint (where a replan can
            // still exit a tier-rail Finalization), then bookkeeping and
            // the reserved Answer round follow as always.
            if (armedRound.deadlineAborted) continue
            // The reserved Answer round failed (#117): the run still ends
            // with a guaranteed Answer — the deterministic fallback — not
            // a raw provider error. The lost round is diagnostics (#207,
            // ADR 0038): the run is not stopping *because* this request
            // failed — it stopped for its own cause a round ago, and that
            // cause is what the Answer and the record still say. So the
            // failure is reported under a site naming the round it lost,
            // carrying the thrown error itself so a provider failure keeps
            // its stack, and joined to the Run's own cause by the turn id.
            if (reservedRound) {
              if (allowanceSpent) {
                // The round ran out of allowance rather than failing
                // (#209/AC3): the bound did its job, so the record names
                // the exhaustion instead of the abort error it produced.
                reportFault(
                  'pipeline.createCommandPipeline.reservedAnswerAllowanceSpent',
                  `the reserved Answer round ran out of Finalization Allowance (${fallbackCause()})`,
                  { turnId },
                )
                finalizationFailure = 'the reserved Answer round ran out of Finalization Allowance'
              } else {
                reportFault('pipeline.createCommandPipeline.reservedAnswerRequestFailed', err, { turnId })
                finalizationFailure = `the reserved Answer round failed: ${toErrorMessage(err)}`
              }
              deterministicFallback = true
              break
            }
            // The bookkeeping request failed (#207, ADR 0038). Bookkeeping
            // is one *optional* opportunity: a request that failed has
            // used it, so the run advances to its reserved Answer under
            // the cause it entered Finalization with. It does not reopen
            // Acquisition, does not ask for bookkeeping again, and does
            // not escape as the raw provider error the user would
            // otherwise hear instead of an Answer.
            if (effortEpoch.spendBookkeepingOpportunity()) {
              // Retained for a later "why did you stop?" (#203) on the
              // same terms as the round's own record: a Finalization
              // failure beside the entry cause, never in place of it. The
              // reserved Answer round is still to come, and if that fails
              // too its failure supersedes this one — it is the more
              // proximate answer to what the user actually got.
              if (allowanceSpent) {
                // Filed like the reserved Answer's exhaustion, and worded
                // for the bound rather than the abort error it produced.
                reportFault(
                  'pipeline.createCommandPipeline.bookkeepingAllowanceSpent',
                  `the bookkeeping round ran out of Finalization Allowance (${fallbackCause()})`,
                  { turnId },
                )
                finalizationFailure = 'the Finalization bookkeeping round ran out of Finalization Allowance'
              } else {
                reportFault('pipeline.createCommandPipeline.bookkeepingRequestFailed', err, { turnId })
                finalizationFailure = `the Finalization bookkeeping round failed: ${toErrorMessage(err)}`
              }
              continue
            }
            throw err
          } finally {
            cancelRoundWatch()
            armedRound.disarm()
            run.abortLlm = undefined
            // Round end (#47): drain the streamed tail (and reset the
            // batcher) before the round's events continue — the feed gets
            // every fragment ahead of the answer's display entry.
            batcher?.flush()
            // The round's reasoning record (#182): written here, so a round
            // that aborted or failed — the one a diagnosis wants most —
            // leaves its thinking behind exactly like a round that
            // returned. Truncation happens inside the writer's guard.
            if (reasoningRounds) writeReasoning?.(reasoningRounds.takeRound())
            // The round's llm_round record (#191), on the same terms: an
            // aborted or failed round leaves what it was sent under and
            // how it ended (#218), and only a round that returned carries
            // usage.
            if (llmRounds) closeLlmAttempt(llmRounds.takeRound(roundOutcome, roundUsage))
          }
          // The round can resolve despite the deadline abort (a client that
          // ignored the signal, or the response landing in the race
          // window): the epoch already entered Finalization at the
          // crossing, so an Answer turn still concludes the run honestly
          // stamped deadline_reached, and a tool round meets the closed
          // tools below.
          steering = undefined
          const afterModelSteering = yield* interrupts.check('thinking')
          if (afterModelSteering) {
            steering = afterModelSteering
            continue
          }
          // An Off-contract Reply in the reserved Answer round (#198, ADR
          // 0034): prose, or JSON of the wrong shape, where the round's one
          // job was the Answer contract the Finalize Instruction stated a
          // message earlier and the model held no tools. It is a failed
          // round beside the thrown and tool-requesting cases — the model
          // narrating, not answering — so it takes the same deterministic
          // fallback with the phase's own cause, and its text is never
          // spoken, displayed, or recorded as an Answer. No retry: the
          // directive was already read, and another round costs a run that
          // has just declared itself out of budget or progress ten to
          // eighty seconds for a second chance at the behaviour it showed.
          if (reservedRound && turn.kind === 'answer' && turn.shape === 'off_contract') {
            recordOffContractReply({
              site: 'pipeline.createCommandPipeline.offContractReply',
              role: 'orchestrator',
              shape: turn.shape,
              text: answerText(turn),
              cause: fallbackCause(),
              ...(writeOffContractReply ? { trace: writeOffContractReply } : {}),
              turnId,
            })
            finalizationFailure = 'the reserved Answer round replied off contract instead of answering'
            deterministicFallback = true
            break
          }

          if (turn.kind === 'answer') {
            finalAnswer = turn
            // Displayed Answers are evidence-grounded (#122, ADR 0028;
            // #141): the live text is the model's own wording with
            // internal identities scrubbed — nothing else. The declared
            // evidence identities ride the event as Session-only
            // metadata for the live Answer Evidence Summary, and the
            // derived source links travel beside them for Recorded
            // History to flatten back into the recorded text; the live
            // Feed renders the structured summary instead of a
            // generated Sources list.
            const answerSources = deriveAnswerSources(turn.evidenceIds, resolveSessionObservation)
            // The Inspection Reference lands here (#210, ADR 0039) — at
            // the presentation itself, not at the parse. A draft the
            // model abandoned, a reserved round that asked for tools
            // instead of answering, a run that failed on its way here:
            // none of them presented a Candidate to anyone, so none of
            // them may leave a subject behind for the next command to
            // address. The store refuses an identity that is not a live
            // Candidate, and a refusal leaves the standing subject
            // untouched rather than silently clearing it.
            presentInspectionSubject(turn.inspectionCandidateId)
            // And the user's unresolved words are resolved here (#211,
            // ADR 0039) — after the presentation, never before. The Run
            // had them in front of it on every round and has now
            // answered; what the words decided about a Candidate it
            // recorded on the way, and the gate above still held for
            // this Answer. Every other way a Run can end reaches none of
            // this, so the words outlive it.
            continuity?.resolveCorrections?.()
            yield {
              type: 'display',
              text: scrubAnswerText(turn.display),
              at: clock.now(),
              ...(turn.evidenceIds !== undefined ? { evidenceIds: turn.evidenceIds } : {}),
              ...(answerSources.length > 0 ? { sources: answerSources } : {}),
            }
            yield* speakLine(turn.speak, turnId)
            yield* checkpoint(run, 'thinking')
            break
          }

          // The reserved Answer round requested tools (#117): Finalization
          // granted its one bookkeeping Tool Round already — the run now
          // answers deterministically instead of working further. The
          // third of the round's three failure modes, and recorded like
          // the other two (#207, ADR 0038): a fallback Answer nobody can
          // account for is the diagnosis this seam exists to prevent.
          if (reservedRound) {
            reportFault(
              'pipeline.createCommandPipeline.reservedAnswerRequestedTools',
              `reserved Answer round requested tools (${fallbackCause()}): ${turn.calls.map((call) => call.name).join(', ')}`,
              { turnId },
            )
            finalizationFailure = 'the reserved Answer round asked for tools instead of answering'
            deterministicFallback = true
            break
          }

          // The Run Plan (#116, ADR 0027): a tool round may carry a
          // report_run_plan call alongside its work — the plan lands the
          // moment the round does, ahead of the work. The first valid
          // model report establishes objective, Run Headline, and Effort
          // Tier; later reports update the headline at the same tier or
          // escalate one level with a reason. A malformed report or a
          // missing plan on the first useful round defaults the run to
          // Lookup (Command Echo retained) with exactly one corrective
          // nudge — never a stall, never a failed round. A Steering
          // correction reopens the initial-plan slot in the replan (see
          // interrupts.check): the corrected objective reports a fresh
          // plan, not an update.
          let planResultError: string | null = null
          let planResultNotice: string | null = null
          let planCallHandled = false
          // Planning engages only where the model can actually report a
          // plan: a catalog without the tool (tests, lean pipelines) never
          // nudges toward a call it cannot make.
          if (toolsByName.has('report_run_plan')) {
            const planCall = turn.calls.find((call) => call.name === 'report_run_plan')
            const planReport = planCall ? parsePlanReport(planCall) : null
            if (planCall !== undefined) planCallHandled = true
            if (planReport !== null) {
              const review = reviewPlanReport(runPlan, modelDeclaredPlan, planReport)
              if (review.kind === 'rejected') {
                planResultError = review.reason
              } else {
                const initialDeclaration = !modelDeclaredPlan
                runPlan = review.plan
                modelDeclaredPlan = true
                // A discovery objective declared below Lookup (#131) is
                // flagged, not refused — the advisory rides the plan's
                // own acknowledgement below, teaching the escalation
                // before the Direct Action budget runs dry.
                if (review.kind === 'accepted' && review.advisory !== undefined) {
                  planResultNotice = review.advisory
                }
                // A valid plan arrived; any still-owed nudge is moot.
                notices.clear('run_plan')
                // A tier change starts a fresh effort epoch (#117):
                // budget, warnings, and the active-work deadline re-arm
                // for the new tier. Cumulative rounds still count toward
                // the hard ceiling, and Finalization is never exited —
                // an escalation accepted during Finalization's
                // bookkeeping round is reported but re-arms nothing
                // (the state could never be consulted again). A fresh
                // post-Steering plan supersedes the directive's words as
                // the corrected objective (#119).
                if (correctedObjective !== null) correctedObjective = review.plan.objective
                effortEpoch.declareTier(review.plan.effortTier, initialDeclaration)
                yield {
                  type: 'run_plan',
                  objective: review.plan.objective,
                  headline: review.plan.headline,
                  effortTier: review.plan.effortTier,
                  source: 'model',
                  ...(review.kind === 'escalation' ? { escalationReason: review.reason } : {}),
                  at: clock.now(),
                }
              }
            } else if (planCall !== undefined) {
              // Malformed report: the first carries the one corrective
              // nudge, later ones the plain validation error — useful
              // sibling work in the round still executes.
              planResultError = notices.delivered('run_plan') ? RUN_PLAN_INVALID : RUN_PLAN_NUDGE
              notices.markDelivered('run_plan')
            }
            // The Run Headline (ADR 0025): the plan's headline revises the
            // Peek Card's live title when it changes; the echo or the last
            // good headline stands otherwise.
            const headlineText = runPlan?.headline ?? null
            if (headlineText !== null && headlineText !== lastHeadline) {
              lastHeadline = headlineText
              yield { type: 'run_headline', text: headlineText, at: clock.now() }
            }
            // The first useful Tool Round without a valid plan runs under
            // the fallback Lookup plan (#116); its nudge rides one of the
            // round's own tool results so the model sees it without a
            // dedicated round.
            if (runPlan === null && turn.calls.some((call) => call.name !== 'report_run_plan')) {
              // The plan slot a correction reopened falls back to the
              // corrected objective (#167), never back to the command the
              // user superseded — a plan-less post-Steering round used to
              // re-declare the original task as the Run's objective.
              runPlan = lookupFallbackPlan(correctedObjective ?? command)
              yield {
                type: 'run_plan',
                objective: runPlan.objective,
                headline: null,
                effortTier: DEFAULT_EFFORT_TIER,
                source: 'fallback',
                at: clock.now(),
              }
              if (!notices.delivered('run_plan')) notices.owe('run_plan', RUN_PLAN_NUDGE)
            }
          }

          // The plan acknowledgement's round-efficiency corrections
          // (#131): a Tool Round spent on the plan alone is named as the
          // wasted round it was — the plan still landed, so the
          // correction rides the acknowledgement rather than failing the
          // call, and a rejected or malformed lone plan call carries it
          // after its own corrective error — and a below-Lookup advisory
          // follows when the accepted declaration earned one.
          const planOnlyRound = planCallHandled && turn.calls.every((call) => call.name === 'report_run_plan')
          const planNotices = [
            ...(planOnlyRound ? [RUN_PLAN_STANDALONE_ROUND] : []),
            ...(planResultNotice !== null ? [planResultNotice] : []),
          ]
          const planAcknowledgement = planNotices.length > 0 ? `Run Plan noted. ${planNotices.join(' ')}` : 'Run Plan noted.'

          yield { type: 'status', status: 'acting', at: clock.now() }
          // The round's one interception (#116/#157): a report_run_plan
          // call never reaches a gate or an execution once the pipeline
          // handled it — accepted or duplicate calls answer with the plain
          // acknowledgement, rejected or malformed ones with the corrective
          // notice, while sibling work runs untouched. A stray call on a
          // catalog without the tool is not intercepted and falls through
          // to the ordinary unknown-tool error.
          interceptCall = (call) =>
            call.name === 'report_run_plan' && planCallHandled
              ? planResultError !== null
                ? { ok: false, error: planOnlyRound ? `${planResultError} ${RUN_PLAN_STANDALONE_ROUND}` : planResultError }
                : { ok: true, result: planAcknowledgement }
              : null
          // One round call (#157): the gate order, the `gate → observe`
          // pairing, the mid-round no-Progress trip, the deadline gate,
          // Notices and the Session Reset boundary are all inside it. The
          // results come back aligned with the Observation identities they
          // minted, so the Run's model context and its ledger stay in step
          // without two arrays maintained by hand.
          const round = yield* toolRound.run(turn, turnId)
          for (const result of round.results) {
            toolResults.push({ call: result.call, outcome: result.outcome })
            resultObservationIds.push(result.observationId)
          }
          // The reset call succeeded: this run ends at the boundary — no
          // later round happens and nothing commits.
          if (round.end.kind === 'terminal') {
            resetConsumed = true
            break
          }
          // A Directive landed between two of the round's calls: it is
          // already consumed (and its replan already done) — the next
          // model round carries it.
          if (round.end.kind === 'steered') {
            steering = round.end.directive
            continue
          }
          yield { type: 'status', status: 'thinking', at: clock.now() }
        }

        // The deterministic fallback Answer (#117/#137/AC4): displayed and
        // spoken like any Answer, but the run completes mechanically
        // failed — no model Assessment, no memory patch, only the
        // deterministic Run Note the commit below records. Built solely
        // from the command, the mechanical stop cause, and the retained
        // sources derived from the run's verified Observations and its
        // accepted Evidence Checkpoints — bounded inspectable detail for
        // the strongest source, never a bare URL list and never an
        // unverified model claim.
        if (deterministicFallback) {
          runOutcome = 'failed'
          const fallbackWall = fallbackDetail()
          const fallbackRecords = ledger.snapshot()
          const fallback = deterministicFinalAnswer({
            // The task the stopped run was working on, in words the user
            // recognizes: their Steering correction once one landed (#119)
            // — the fresh plan's objective when that declaration made it,
            // the directive's own words otherwise — and their command on
            // a never-steered run.
            command: correctedObjective ?? command,
            cause: fallbackCause(),
            ...(fallbackWall !== undefined ? { detail: fallbackWall } : {}),
            sources: deriveFallbackSources({
              records: fallbackRecords,
              checkpoints: acceptedCheckpoints,
              resolveObservation: resolveSessionObservation,
            }),
            // A Look the run could not complete is the one unresolved
            // check it actually established (#203/AC2) — named as that,
            // never as the vision failure behind it.
            ...(hasUnresolvedImageCheck(fallbackRecords) ? { imageUnverified: true } : {}),
          })
          yield { type: 'display', text: fallback.display, at: clock.now() }
          yield* speakLine(fallback.speak, turnId)
          yield* checkpoint(run, 'thinking')
        }
      } catch (err) {
        if (err instanceof CommandAbortedError) {
          runOutcome = 'cancelled'
          yield { type: 'status', status: 'cancelled', at: clock.now() }
          yield { type: 'speak', text: 'Stopped.', at: clock.now() }
          const outcome = await tts.speak('Stopped.', turnId)
          if (!outcome.ok) {
            yield { type: 'error', message: spokenErrorLine(outcome.error), at: clock.now() }
          }
        } else {
          runOutcome = 'failed'
          // The full detail reaches the dashboard on the error event and
          // the Run's stop record; what the user hears names no provider
          // (#203/AC1). A raw exception read aloud tells them nothing
          // they can act on, and it is the same leak the stopping policy
          // closes everywhere else.
          const message = toErrorMessage(err)
          finalizationFailure = `the run failed outside Finalization: ${message}`
          yield { type: 'error', message, at: clock.now() }
          yield* speakLine(RUN_FAILED_SPOKEN, turnId)
        }
      }
      // The cause the Run actually entered Finalization under (#110/#203):
      // read once, so the stop the Journal retains and the cause the
      // boundary reports are the same answer to the same question. A
      // Finalization failure recorded after it never moves it.
      const stopPhase = effortEpoch.phase
      const mechanicalCause: FinalizationCause | null = stopPhase.kind === 'working' ? null : stopPhase.cause
      // What a later explicit "why did you stop?" is answered from (#203,
      // ADR 0038): the entry cause, that cause's own specifics — which
      // the epoch words, since the vocabulary is its — and any execution
      // failure recorded afterwards. All of it rides the Journal the next
      // Run already receives, never a second diagnostic store, and never
      // the Answer the user just heard.
      const stopDetail = finalizationDetailSentence(stopPhase)
      const stop: RunStopRecord | null = runStopRecord({
        cause: mechanicalCause,
        ...(stopDetail !== undefined ? { detail: stopDetail } : {}),
        ...(finalizationFailure !== null ? { failure: finalizationFailure } : {}),
      })
      // A reset-consumed run commits nothing (#99): its observations and
      // Subagent Reports belong to the Session that just ended.
      if (continuity && !resetConsumed) {
        let note = deterministicRunNote(command, runOutcome)
        let patch: MemoryPatch = []
        if (runOutcome === 'done') {
          const candidate = finalAnswer?.runNote
          if (typeof candidate === 'string' && candidate.trim() !== '' && candidate.trim().length <= MAX_RUN_NOTE_CHARS) {
            note = candidate.trim()
          } else {
            const reason = finalAnswer?.runNoteIssue === 'malformed' || candidate !== undefined ? 'malformed' : 'missing'
            logContinuityDegradation(deps.onContinuityDegraded, reason, turnId)
          }
          // #85: reject only the invalid portion — a malformed patch never
          // discards an already-valid Run Note; the degradation is logged
          // and the Memory Commit carries no memory changes.
          if (finalAnswer?.memoryPatchIssue === 'malformed') {
            logContinuityDegradation(deps.onContinuityDegraded, 'invalid_memory', turnId)
          } else {
            patch = finalAnswer?.memoryPatch ?? []
            // Assessments must stand on active Session Evidence (#122,
            // ADR 0028): the Answer's evidence_ids must cite live
            // Observations in the Session store — mid-Run checkpoints
            // included — or every Assessment add is stripped from the
            // terminal Memory Commit; the rest of the patch survives.
            if (patch.some(isAssessmentAdd)) {
              const session = evidenceSession?.() ?? null
              const cited = finalAnswer?.evidenceIds
              const supported =
                session !== null && cited !== undefined && session.store.hasObservationSupport(cited)
              if (!supported) {
                patch = patch.filter((operation) => !isAssessmentAdd(operation))
                logContinuityDegradation(deps.onContinuityDegraded, 'unsupported_assessment', turnId)
              }
            }
          }
        }
        let commit = continuity.commit(runOutcome, note, patch, stop)
        if (commit === 'invalid_patch') {
          patch = []
          logContinuityDegradation(deps.onContinuityDegraded, 'invalid_memory', turnId)
          commit = continuity.commit(runOutcome, note, patch, stop)
        }
        if (commit !== 'committed') {
          logContinuityDegradation(deps.onContinuityDegraded, 'commit_rejected', turnId)
        }
      }
      // Mishear proposals (ADR 0022) apply at the same tail as the Memory
      // Commit: end of message, done runs only, never a reset-consumed one.
      // A malformed list was already dropped at the answer contract; an
      // empty list applies nothing. The ledger is advisory — it can never
      // fail a run.
      if (runOutcome === 'done' && !resetConsumed && finalAnswer?.mishearProposals?.length) {
        try {
          deps.learnedTerms?.applyProposals(finalAnswer.mishearProposals)
        } catch (error) {
          reportFault('pipeline.createCommandPipeline.applyProposals', error, { turnId })
          // swallowed — the ledger is advisory
        }
      }
      // The run's boundary carries the mechanical outcome unchanged, with
      // the semantic fields riding additively (#110): every valid model
      // Answer completes as `done` whatever Resolution it proposes, and a
      // cancelled, plain-error, or reset run finalizes nothing. A
      // reset-consumed run commits nothing and reports nothing (#99).
      //
      // Freshness (#123, ADR 0028): volatile Observations —
      // time-sensitive, action-critical, or checkpointed with uncertainty —
      // cannot alone support `completed`. When every cited Observation is
      // volatile and none was observed during this Run (re-observed by the
      // Run itself, or checkpointed from an observation made during it —
      // including a worker that ran during it), the recorded Resolution
      // honestly degrades to `partial`; stable evidence and revalidated
      // evidence complete as proposed.
      let proposedResolution = finalAnswer?.resolution ?? null
      if (
        runOutcome === 'done' &&
        proposedResolution === 'completed' &&
        finalAnswer?.evidenceIds !== undefined &&
        evidenceSession !== undefined
      ) {
        const session = evidenceSession()
        const fresh =
          session !== null &&
          completedEvidenceIsFresh({
            cited: finalAnswer.evidenceIds,
            resolve: (id) => session.store.observation(id),
            admissionIds: admissionEvidenceIds,
            runRecords: ledger.snapshot(),
            observedSince: runStartedAt,
          })
        if (!fresh) proposedResolution = 'partial'
      }
      // The verification a Run could not make is not the user's to make
      // (#212/AC2, ADR 0041). `needs_user` says only a specific user
      // choice or action can move this forward — and an unreadable image
      // is not one of those: it is the assistant's own check, and
      // handing it over is the ending the stopping policy rules out.
      //
      // Where it lands instead is decided by what the Run actually has.
      // Useful grounded progress with the match unverified is exactly
      // what `partial` means, so a Run holding retained sources records
      // that. A Run holding nothing was stopped by a capability it could
      // not use with no useful partial result, which is `blocked`.
      //
      // Only `needs_user` is touched. A Run that genuinely asked the
      // user something reaches this too, and it is downgraded all the
      // same: the question it asked is on the Answer either way, and the
      // Resolution is about what the Run established, not about what it
      // asked. What it never does is promote — a Run reporting
      // `unsuccessful` or `blocked` keeps its own honest reading.
      if (runOutcome === 'done' && proposedResolution === 'needs_user' && verificationSpent) {
        proposedResolution = deriveFallbackSources({ records: ledger.snapshot() }).length > 0 ? 'partial' : 'blocked'
      }
      const finalization: RunFinalization | null = resetConsumed
        ? null
        : finalizeRun({
            mechanicalCause,
            answered: runOutcome === 'done' && finalAnswer !== undefined,
            proposedResolution,
            proposedCause: finalAnswer?.finalizationCause ?? null,
          })
      yield {
        type: 'done',
        outcome: resetConsumed ? 'reset' : runOutcome,
        ...(finalization?.resolution ? { resolution: finalization.resolution } : {}),
        ...(finalization?.finalizationCause ? { finalizationCause: finalization.finalizationCause } : {}),
        at: clock.now()
      }
    } finally {
      if (activeRun === run) activeRun = null
      // Run end: the work clock stops (#120). A worker still running past
      // its parent Run finalizes against the deadline as it stood at the
      // end, not one that keeps ticking after the Run is gone.
      run.effortEpoch.stop()
      // Run end (#209): the allowance dies with its Run, cutoff watch and
      // all — the Card is out, and nothing may fire against a Run that is
      // over.
      dropAllowance()
      // Run end (#111): the Observation ledger disappears with its Run —
      // records dropped, late writers refused.
      ledger.close()
      // Run end (#30): close the turn out — one synthetic `summary` event
      // in the log and the same data as a one-line console summary. Turns
      // that recorded nothing (no tracer, an untraced run) degrade to a
      // no-op; bookkeeping failures never break the run.
      emitTurnSummary(deps.tracer, turnId, deps.printSummary ?? console.log)
    }
  }

  /**
   * The Run's decisions adapter (#156): the one seam through which gated
   * execution reaches the user — today's pipeline choreography, named.
   * The ask window and the Confirmation window both mint an id, emit their
   * request event, speak their line, wait on the pause-aware timed decision
   * window, emit their resolution, and word what the model reads. A
   * delegated worker satisfies the same interface by refusing.
   */
  function createDecisions(
    turnId: string,
    run: ActiveRun,
    observe: (input: ObservationInput) => ObservationRecord | null,
  ): RunDecisions {
    return {
      async *ask(question: string, call: ToolCall): AsyncGenerator<UnstampedEvent, ToolResultOutcome> {
        // Finish the spoken question before the answer window begins. This
        // prevents the mic from transcribing the assistant and gives the user
        // the full timeout after they can first respond.
        yield* speakLine(question, turnId)
        throwIfAborted(run)
        yield* checkpoint(run, 'acting', false)
        if (run.steering) {
          return { ok: true, result: STEERED_CANCELLED }
        }
        const askId = `ask-${++askCounter}`
        const decision = waitForAsk(askId)
        yield {
          type: 'ask_requested',
          askId,
          callId: call.id,
          question,
          expiresAt: decision.expiresAt()!,
          at: clock.now(),
        }
        const resolved = yield* awaitDecision(decision, run, (expiresAt) => ({
          type: 'ask_deadline',
          askId,
          expiresAt,
          at: clock.now(),
        }))
        yield {
          type: 'ask_resolved',
          askId,
          answer: resolved.answer,
          reason: resolved.reason,
          at: clock.now(),
        }
        // Observation ledger (#111): the user's answer (or the reason none
        // arrived) is a user-produced observation the run retains.
        observe({
          producer: 'ask_user',
          ok: resolved.reason === 'user',
          payload: resolved.reason === 'user' ? resolved.answer : `unanswered (${resolved.reason})`,
        })
        throwIfAborted(run)
        return {
          ok: true,
          result:
            resolved.reason === 'steered'
              ? STEERED_CANCELLED
              : resolved.answer ?? "user didn't answer",
        }
      },
      async *confirm(prompt: string, call: ToolCall): AsyncGenerator<UnstampedEvent, ConfirmDecision> {
        const confirmationId = `confirm-${++confirmationCounter}`
        const pending = waitForConfirmation(confirmationId)
        yield {
          type: 'confirmation_requested',
          confirmationId,
          callId: call.id,
          toolName: call.name,
          prompt,
          expiresAt: pending.expiresAt()!,
          at: clock.now(),
        }
        // The prompt is both shown (dialog) and spoken; voice yes/no lands in T9.
        const deadlineEvent = (expiresAt: number | null): UnstampedEvent => ({
          type: 'confirmation_deadline',
          confirmationId,
          expiresAt,
          at: clock.now(),
        })
        while (run.paused) yield* waitThroughPause(pending, run, deadlineEvent)
        if (!run.aborted && !run.steering) yield* speakLine(prompt, turnId)
        const resolved = yield* awaitDecision(pending, run, deadlineEvent)
        yield {
          type: 'confirmation_resolved',
          confirmationId,
          approved: resolved.approved,
          reason: resolved.reason,
          at: clock.now(),
        }
        throwIfAborted(run)
        if (!resolved.approved) {
          const detail =
            resolved.reason === 'timeout'
              ? 'denied — the user did not respond in time; do not retry this action'
              : resolved.reason === 'steered'
                ? `${STEERED_CANCELLED}; do not retry this action`
              : 'denied by the user; do not retry this action'
          return { approved: false, outcome: { ok: false, error: detail } }
        }
        return { approved: true }
      },
    }
  }

  function createPendingDecision<T>(
    timeoutMs: number,
    timeoutDecision: T,
    onSettled: () => void,
  ): PendingDecision<T> {
    let resolvePromise!: (decision: T) => void
    const promise = new Promise<T>((resolve) => {
      resolvePromise = resolve
    })
    let remainingMs = timeoutMs
    let timerStartedAt = clock.now()
    let deadline: number | null = null
    let cancelTimer = () => {}
    let settled = false
    const settle = (decision: T) => {
      if (settled) return
      settled = true
      onSettled()
      cancelTimer()
      resolvePromise(decision)
    }
    const armTimer = () => {
      timerStartedAt = clock.now()
      deadline = timerStartedAt + remainingMs
      cancelTimer = clock.setTimer(remainingMs, () => settle(timeoutDecision))
    }
    const pending: PendingDecision<T> = {
      promise,
      settle,
      pause: () => {
        remainingMs = Math.max(0, remainingMs - (clock.now() - timerStartedAt))
        cancelTimer()
        deadline = null
      },
      resume: armTimer,
      expiresAt: () => deadline,
    }
    armTimer()
    return pending
  }

  function waitForConfirmation(confirmationId: string): PendingDecision<ConfirmationDecision> {
    const pending = createPendingDecision<ConfirmationDecision>(
      confirmTimeoutMs,
      { approved: false, reason: 'timeout' },
      () => pendingConfirmations.delete(confirmationId),
    )
    pendingConfirmations.set(confirmationId, pending)
    return pending
  }

  function waitForAsk(askId: string): PendingDecision<AskDecision> {
    const pending = createPendingDecision<AskDecision>(
      askTimeoutMs,
      { answer: null, reason: 'timeout' },
      () => pendingAsks.delete(askId),
    )
    pendingAsks.set(askId, pending)
    return pending
  }

  return {
    execute,
    resolveConfirmation: (confirmationId, approved) => {
      pendingConfirmations.get(confirmationId)?.settle({ approved, reason: 'user' })
    },
    resolveAsk: (askId, answer) => {
      const trimmed = answer.trim()
      if (trimmed === '') return // Empty input never resolves a real question.
      pendingAsks.get(askId)?.settle({ answer: trimmed, reason: 'user' })
    },
    abort: () => {
      if (!activeRun || activeRun.aborted) return
      activeRun.aborted = true
      activeRun.paused = false
      deps.onAbort?.()
      // Cancel the in-flight LLM request immediately (#47) — the signal
      // flips synchronously, so the provider round ends now.
      activeRun.abortLlm?.()
      settlePendingDecisions('cancelled')
      activeRun.releaseControl?.()
      activeRun.releasePause?.()
      tts.stop()
    },
    pause: () => {
      if (!activeRun || activeRun.aborted || activeRun.paused) return
      activeRun.paused = true
      // The Finalization Allowance stops the moment the user does
      // (#209/AC4), not at the next checkpoint: a Finalization round or a
      // Report Grace already in flight is bounded against it, and time the
      // user is holding must not spend either. Resume picks the same
      // allowance back up — it never mints a new one.
      activeRun.finalizationAllowance?.suspend()
      deps.onPause?.()
      eachPendingDecision((pending) => pending.pause())
      activeRun.releaseControl?.()
      tts.stop()
    },
    resume: (steering) => {
      if (!activeRun || activeRun.aborted || !activeRun.paused) return false
      const trimmed = steering?.trim()
      if (trimmed) {
        activeRun.steering = trimmed
        // A steering correction invalidates blocked, not-yet-executed work.
        settlePendingDecisions('steered')
        // The feed echo (#46): fired before the run unparks, so it lands
        // ahead of the next model round's events on the joined channel.
        // Spoken and typed steering share this one seam.
        deps.emitDetail?.({ type: 'steer', turnId: activeRun.turnId, text: trimmed, at: clock.now() })
      } else {
        eachPendingDecision((pending) => pending.resume())
      }
      activeRun.paused = false
      // The allowance resumes with the Run (#209/AC4). A directive that
      // rides the resume may replan the Run back out of Finalization; the
      // checkpoint that consumes it drops the allowance there, so nothing
      // is left ticking against reopened work.
      activeRun.finalizationAllowance?.resume()
      // A directive supersedes the delegated work the paused run was
      // waiting on (#119): it is cancelled, not resumed. A plain resume
      // un-pauses it.
      if (trimmed) deps.onSteer?.()
      else deps.onResume?.()
      activeRun.releasePause?.()
      return true
    },
    getState: () => (activeRun ? (activeRun.paused ? 'paused' : 'running') : 'idle'),
  }
}
