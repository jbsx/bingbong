import type { PipelineEvent, UnstampedEvent } from './events'
import type { Tool, ToolContext } from './tool'
import type { Clock } from '../ports/clock'
import { toErrorMessage } from '../errors'
import type { AssistantTurn, LlmClient, LlmStreamDelta, ToolCall, ToolResult, ToolResultOutcome } from '../ports/llm'
import { selectDelegatedMemory } from '../agent/subagentReport'
import { createLlmDeltaBatcher } from './deltaBatcher'
import type { TtsSpeaker } from '../ports/tts'
import { spokenErrorLine } from '../agent/answerContract'
import type { LearnedTermsControls } from '../voice/learnedTerms'
import { MAX_RUN_NOTE_CHARS, finalizeRun, type RunFinalization, type RunJournalEntry, type RunJournalSnapshot } from '../session/runJournal'
import type { MemoryEntryId, MemoryPatch, WorkingMemorySnapshot } from '../session/workingMemory'
import type { PerfTracer } from '../perf/perfTracer'
import { createTurnIdSource } from '../perf/perfTracer'
import type { BrowserSubspans } from '../perf/browserSubspans'
import { emitTurnSummary } from '../perf/turnSummary'
import type { SettledPageState } from './progressFingerprints'
import type { SnapshotRef } from '../browser/snapshot'
import { createToolRoundExecutor, type ToolRoundExecutor } from './toolRound'
import {
  createEffortEpoch,
  deterministicFinalAnswer,
  type EffortEpoch,
} from './effortEpoch'
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
import type { RunTraceWriter } from '../trace/runTrace'
import { completedEvidenceIsFresh } from './evidenceFreshness'
import { evaluateCandidateCheckpoint, type CandidateCheckpointOutcome, type EvidenceSessionSource } from './candidateCheckpoint'
import { deriveAnswerSources, scrubAnswerText } from './answerEvidence'
import { deriveFallbackSources } from './fallbackAnswer'
import { compactRunContext, type RunEvidenceCheckpoint } from './runContextCompaction'

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
   * Finalization entry (#120, ADR 0027): fired when a work rail trips the
   * run into Finalization — unfinished delegated acquisition is cancelled,
   * while completed reports stay available to the reserved Answer round.
   * Wired by main to the subagent rail's cancelAll.
   */
  onFinalize?(): void
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
   * Aborts the in-flight LLM round's HTTP request (#47): set while the
   * round is awaiting, fired by abort() so Stop cancels the request
   * immediately instead of waiting out the request timeout.
   */
  abortLlm?: () => void
}

/** Default ask_user window: ~45s for a spoken or typed free-text answer. */
export const ASK_TIMEOUT_MS = 45_000

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
  } catch {
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
   * The Session generation this Run was admitted under (#111): the
   * Observation ledger's staleness guard. Absent in tests that carry no
   * runtime; production always passes it from admission.
   */
  readonly generation?: SessionGeneration
  commit(
    outcome: RunJournalEntry['outcome'],
    note: string,
    patch: MemoryPatch,
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
        // the run's active-work deadline.
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
    // warning and Finalization directive — is owed to and delivered by
    // this one module, in its one precedence. The plan nudge is owed
    // until it actually rides a useful result, so a round whose siblings
    // all fail does not swallow it.
    const notices = createNotices()
    const run: ActiveRun = {
      turnId,
      aborted: false,
      paused: false,
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
        } catch {
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
    // The live evidence Session handle (#122): resolved per call, so
    // a Session that ended (Reset, Lapse) refuses later work instead
    // of writing into the void. Grounds user citations, Candidate
    // checkpoints, Answer support, and derived source links against
    // live Observations — including ones this Run checkpointed
    // mid-flight.
    const evidenceSession: EvidenceSessionSource | undefined = continuity?.evidenceSession
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
          effortEpoch.replan(DEFAULT_EFFORT_TIER)
          correctedObjective = directive
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

    try {
      let runOutcome: 'done' | 'failed' | 'cancelled' = 'done'
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
      } catch {
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
                // Recorded History keeps only the display line, so a
                // rejected or vanished checkpoint is diagnosed from here.
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
          // correlate their subagent rounds to this turn (#29).
          turnId,
          // Bounded delegation (#120): the live tier epoch gates browse
          // spawns — only Investigation branches delegate — and workers
          // share this run's active-work deadline as a live predicate, so
          // a tier escalation re-arm reaches them without a respawn.
          effortTier: () => effortEpoch.tier,
          delegationDeadline: effortEpoch.delegationDeadline,
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
          capabilities: { searchLoopRail: true, noProgressRail: true, deadlineGate: true },
          intercept: (call) => interceptCall(call),
          // A successful Session Reset (#99) discards the rest of the run.
          terminalResult: (call, outcome) => outcome.ok && toolsByName.get(call.name)?.sessionReset === true,
          // Session Reset boundary (#99): the reset call runs alone, and
          // its discarded siblings answer only if it failed anyway.
          soleCall: {
            select: (call) => toolsByName.get(call.name)?.sessionReset === true,
            notExecuted: 'not executed: this response carried a session reset, but it failed',
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
        // reserved Answer round fails or requests tools.
        let deterministicFallback = false

        for (;;) {
          // The loop top asks the epoch's rails (#146–#148): a tripped rail
          // enters Finalization there — the phase this round runs under is
          // read from the epoch below, so the answer needs no unpacking.
          effortEpoch.decideLoopTop()
          steering = (yield* interrupts.check('thinking')) ?? steering
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
          let turn: AssistantTurn
          try {
            turn = await llm.complete({
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
              ...(isAnswerOnly() ? { answerOnly: true } : {}),
              ...(continuity ? { journal: continuity.snapshot } : {}),
              ...(continuity ? { memory: continuity.memory } : {}),
              // Checkpointed Session Evidence this Run starts beside (#121):
              // the immutable admission snapshot — mid-Run checkpoints ride
              // tool results, later Runs' admissions.
              ...(continuity?.evidence ? { evidence: continuity.evidence } : {}),
              ...(steering ? { steering } : {}),
              // Retry visibility (#43): each attempt beyond the first is a
              // detail event on the side channel — emitted before the next
              // attempt starts, while this round is still in flight.
              ...(emitDetail
                ? {
                    onRetryAttempt: (attempt: number, maxAttempts: number): void => {
                      // Drain the failed attempt's partial stream first (#47):
                      // its fragments close as their own feed run, so the
                      // next attempt streams fresh instead of concatenating
                      // onto stale buffer.
                      batcher?.flush()
                      emitDetail({ type: 'llm_retry', attempt, maxAttempts, at: clock.now() })
                    },
                  }
                : {}),
              // Streaming (#47): the round streams only when the detail
              // channel is wired (absent → the non-streaming fallback).
              ...(batcher ? { onDelta: (delta: LlmStreamDelta): void => batcher.onDelta(delta) } : {}),
              signal: armedRound.signal,
            })
          } catch (err) {
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
            // a raw provider error.
            if (isAnswerOnly()) {
              deterministicFallback = true
              break
            }
            throw err
          } finally {
            armedRound.disarm()
            run.abortLlm = undefined
            // Round end (#47): drain the streamed tail (and reset the
            // batcher) before the round's events continue — the feed gets
            // every fragment ahead of the answer's display entry.
            batcher?.flush()
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
          // answers deterministically instead of working further.
          if (isAnswerOnly()) {
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
              runPlan = lookupFallbackPlan(command)
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
          const fallback = deterministicFinalAnswer({
            // The task the stopped run was working on, in words the user
            // recognizes: their Steering correction once one landed (#119)
            // — the fresh plan's objective when that declaration made it,
            // the directive's own words otherwise — and their command on
            // a never-steered run.
            command: correctedObjective ?? command,
            cause: effortEpoch.phase.kind === 'working' ? 'hard_limit' : effortEpoch.phase.cause,
            sources: deriveFallbackSources({
              records: ledger.snapshot(),
              checkpoints: acceptedCheckpoints,
              resolveObservation: resolveSessionObservation,
            }),
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
          // Errors are spoken as one-liners; the full detail reaches the
          // dashboard via the error event.
          const message = toErrorMessage(err)
          const spoken = spokenErrorLine(message)
          yield { type: 'error', message, at: clock.now() }
          yield* speakLine(spoken, turnId)
        }
      }
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
        let commit = continuity.commit(runOutcome, note, patch)
        if (commit === 'invalid_patch') {
          patch = []
          logContinuityDegradation(deps.onContinuityDegraded, 'invalid_memory', turnId)
          commit = continuity.commit(runOutcome, note, patch)
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
        } catch {
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
      const finalization: RunFinalization | null = resetConsumed
        ? null
        : finalizeRun({
            mechanicalCause: effortEpoch.phase.kind === 'working' ? null : effortEpoch.phase.cause,
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
