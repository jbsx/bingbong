import { VisionDeadlineError, VISION_DEADLINE_NUDGE } from '../ports/vision'
import type { PipelineEvent } from './events'
import type { RiskVerdict, Tool, ToolContext } from './tool'
import type { Clock } from '../ports/clock'
import type { AssistantTurn, LlmClient, LlmStreamDelta, ToolCall, ToolResult, ToolResultOutcome } from '../ports/llm'
import { selectDelegatedMemory } from '../agent/subagentReport'
import { createLlmDeltaBatcher } from './deltaBatcher'
import type { TtsSpeaker } from '../ports/tts'
import { spokenErrorLine } from '../agent/answerContract'
import type { LearnedTermsControls } from '../voice/learnedTerms'
import { MAX_RUN_NOTE_CHARS, type RunJournalEntry, type RunJournalSnapshot } from '../session/runJournal'
import type { MemoryPatch, WorkingMemorySnapshot } from '../session/workingMemory'
import type { PerfTracer } from '../perf/perfTracer'
import { createTurnIdSource } from '../perf/perfTracer'
import type { BrowserSubspans } from '../perf/browserSubspans'
import { emitTurnSummary } from '../perf/turnSummary'
import {
  createVisionBudget,
  MAX_ORCHESTRATOR_VISION_CALLS,
  type VisionBudget,
} from '../agent/subagentRails'
import type { SearchLoopRail } from './searchLoopRail'
import { createSearchLoopRail } from './searchLoopRail'
import type { SnapshotRef } from '../browser/snapshot'
import type { BlockerGate } from './blockerGate'
import { createBlockerGate } from './blockerGate'
import { MAX_TOOL_ROUNDS_DEFAULT } from '../settings/settings'

export interface CommandPipelineDeps {
  llm: LlmClient
  tts: TtsSpeaker
  clock: Clock
  tools: Tool[]
  confirmTimeoutMs?: number
  /** How long an ask_user window stays open (voice + typed answers). */
  askTimeoutMs?: number
  maxToolRounds?: number
  /**
   * Live source for the tool-round ceiling: read at the start of each run,
   * so settings changes apply to the next command without a restart.
   * Overrides the static `maxToolRounds` when both are provided.
   */
  getMaxToolRounds?: () => number
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
  onAbort?(): void
  onPause?(): void
  onResume?(): void
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
  onContinuityDegraded?: (reason: 'missing' | 'malformed' | 'invalid_memory' | 'commit_rejected', turnId: string) => void
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
  /**
   * Aborts the in-flight LLM round's HTTP request (#47): set while the
   * round is awaiting, fired by abort() so Stop cancels the request
   * immediately instead of waiting out the request timeout.
   */
  abortLlm?: () => void
}

class CommandAbortedError extends Error {
  constructor() {
    super('command aborted')
    this.name = 'CommandAbortedError'
  }
}

/** Default ask_user window: ~45s for a spoken or typed free-text answer. */
export const ASK_TIMEOUT_MS = 45_000

/** Default orchestrator tool-round ceiling — the settings store's default, so the pipeline and the settings page agree. */
const DEFAULT_MAX_TOOL_ROUNDS = MAX_TOOL_ROUNDS_DEFAULT

const STEERED_CANCELLED = 'cancelled by the user\'s steering'

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function deterministicRunNote(command: string, outcome: RunJournalEntry['outcome']): string {
  const task = command.trim().replace(/\s+/g, ' ').slice(0, 500) || '(empty command)'
  const label = outcome === 'done' ? 'Completed' : outcome === 'failed' ? 'Failed' : 'Cancelled'
  return `${label} run: ${task}`
}

function logContinuityDegradation(
  sink: CommandPipelineDeps['onContinuityDegraded'],
  reason: 'missing' | 'malformed' | 'invalid_memory' | 'commit_rejected',
  turnId: string,
): void {
  try {
    ;(sink ?? ((why, id) => console.warn(`[run-journal] ${why} Run Note for ${id}`)))(reason, turnId)
  } catch {
    // Diagnostics cannot suppress a valid Answer or its done boundary.
  }
}

/**
 * Advisory bookkeeping (#29/#30): the perf log must never fail a command,
 * so a throwing sink/tracer is swallowed at the recording call sites.
 */
function recordSpan(
  tracer: PerfTracer | undefined,
  turnId: string,
  stage: string,
  durMs: number,
  detail?: Record<string, unknown>,
): void {
  if (!tracer) return
  try {
    tracer.span(turnId, stage, durMs, detail)
  } catch {
    // swallowed — see above
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
  commit(
    outcome: RunJournalEntry['outcome'],
    note: string,
    patch: MemoryPatch,
  ): 'committed' | 'invalid_patch' | 'rejected'
}

/**
 * A pipeline event before turn stamping (#28): the run body constructs
 * events without knowing the turn id; `execute` stamps every one of them on
 * the way out, which is the single place a stamp can be missed.
 */
type WithoutTurnId<T> = T extends unknown ? Omit<T, 'turnId'> : never
type UnstampedEvent = WithoutTurnId<PipelineEvent>

/** Stamps one run-body event with the turn's id. */
function stampTurn(event: UnstampedEvent, turnId: string): PipelineEvent {
  return { ...event, turnId } as PipelineEvent
}

export function createCommandPipeline(deps: CommandPipelineDeps): CommandPipeline {
  const { llm, tts, clock, tools } = deps
  const mintTurnId = createTurnIdSource(deps.tracer)
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 60_000
  const askTimeoutMs = deps.askTimeoutMs ?? ASK_TIMEOUT_MS
  const maxToolRounds = deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const pendingConfirmations = new Map<string, PendingDecision<ConfirmationDecision>>()
  const pendingAsks = new Map<string, PendingDecision<AskDecision>>()
  let confirmationCounter = 0
  let askCounter = 0
  let activeRun: ActiveRun | null = null

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
        await new Promise<void>((resolve) => {
          run.releasePause = resolve
        })
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
    const run: ActiveRun = { turnId, aborted: false, paused: false }
    activeRun = run
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
        const toolResults: ToolResult[] = []
        const visionBudget = createVisionBudget(MAX_ORCHESTRATOR_VISION_CALLS)
        // Run rails (#74/#82/#83): per-run streak of consecutive similar
        // GUI searches — q= navigations or text typed into a search input —
        // nudges first, refuses at the cap, resets on a successful other
        // tool call. Created fresh per run, like the vision budget.
        const searchLoopRail = createSearchLoopRail({ describeRef: deps.describeRef })
        // Same-wall Blocker gate (#80, ADR 0010): arms when a tool result
        // carries a BLOCKER marker; while armed, browser calls targeting
        // that host (other than read_page/look/ask_user) are refused
        // pre-execution with the escalation instruction. Fresh per run,
        // like the vision budget and the search-loop rail.
        const blockerGate = createBlockerGate(deps.currentHost)
        const toolContext: ToolContext = {
          clock,
          acquireVision: () => visionBudget.tryAcquire(),
          // The turn id rides the context so fan-out tools (spawn_agent)
          // correlate their subagent rounds to this turn (#29).
          turnId,
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
          ...(emitDetail
            ? {
                // Progress detail (#43): what the run waits on, live.
                waitingOnAgents: (running: number): void =>
                  emitDetail({ type: 'waiting_on_agents', running, at: clock.now() }),
              }
            : {}),
        }
        let rounds = 0
        let steering: string | undefined
        // Re-read per run: a settings change applies to the next command.
        const effectiveMaxToolRounds = deps.getMaxToolRounds?.() ?? maxToolRounds

        for (;;) {
          if (rounds >= effectiveMaxToolRounds) {
            throw new Error(`tool round limit (${effectiveMaxToolRounds}) reached`)
          }
          steering = (yield* checkpoint(run, 'thinking')) ?? steering
          // Stop reaches the in-flight request through this signal (#47):
          // abort() fires it, the client cancels the HTTP request, and the
          // rejection below maps back to a cancelled run — no waiting out
          // the request timeout.
          const roundAbort = new AbortController()
          run.abortLlm = () => roundAbort.abort()
          let turn: AssistantTurn
          try {
            turn = await llm.complete({
              command,
              toolResults,
              // The truncation flag (#61) rides every round: the model sees
              // the possibly-cut-off note for as long as the turn runs.
              ...(truncated ? { truncated: true } : {}),
              // The turn id rides the request so the perf wrapper keys each
              // llm span to this turn (#29).
              turnId,
              ...(continuity ? { journal: continuity.snapshot } : {}),
              ...(continuity ? { memory: continuity.memory } : {}),
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
              signal: roundAbort.signal,
            })
          } catch (err) {
            // The aborted signal rejects the request; the run was stopped,
            // so this is a cancellation whatever the rejection looks like.
            if (run.aborted) throw new CommandAbortedError()
            throw err
          } finally {
            run.abortLlm = undefined
            // Round end (#47): drain the streamed tail (and reset the
            // batcher) before the round's events continue — the feed gets
            // every fragment ahead of the answer's display entry.
            batcher?.flush()
          }
          steering = undefined
          const afterModelSteering = yield* checkpoint(run, 'thinking')
          if (afterModelSteering) {
            steering = afterModelSteering
            continue
          }
          if (turn.kind === 'answer') {
            finalAnswer = turn
            yield { type: 'display', text: turn.display, at: clock.now() }
            yield* speakLine(turn.speak, turnId)
            yield* checkpoint(run, 'thinking')
            break
          }

          yield { type: 'status', status: 'acting', at: clock.now() }
          rounds += 1
          // Session Reset boundary (#99): the whole response is known
          // before any of it executes, so when it carries a reset call,
          // every other call in it — before or after — is a discarded
          // sibling: none executes, emits, or observes. Only the reset
          // call itself runs; if it fails anyway, its suppressed siblings
          // answer with a uniform not-executed notice so the next round
          // stays protocol-consistent.
          const resetCallIndex = turn.calls.findIndex((candidate) => toolsByName.get(candidate.name)?.sessionReset)
          let steerAfterTool = false
          for (const [index, call] of turn.calls.entries()) {
            if (resetCallIndex !== -1 && index !== resetCallIndex) continue
            const beforeToolSteering = yield* checkpoint(run, 'acting')
            if (beforeToolSteering) {
              steering = beforeToolSteering
              steerAfterTool = true
              break
            }
            yield { type: 'tool_call', callId: call.id, name: call.name, args: call.args, at: clock.now() }
            const outcome = yield* runGatedTool(call, turnId, visionBudget, searchLoopRail, blockerGate, toolContext, run)
            // Same-wall Blocker gate (#80): marker lines riding successful
            // results arm it; a successful different-host browser
            // interaction disarms it. Sees the raw outcome — advisory
            // nudges appended below change nothing it consumes.
            blockerGate.observe(call, outcome)
            // Search-loop rail (#74/#82): observe every processed call (this is
            // what tracks and resets the streak — a failed intervening tool
            // leaves it alone) and let an advisory nudge ride the search
            // result the model sees and the feed shows.
            const searchLoopNudge = await searchLoopRail.observe(call, outcome)
            const observedOutcome: ToolResultOutcome =
              searchLoopNudge && outcome.ok && typeof outcome.result === 'string'
                ? { ok: true, result: `${outcome.result}\n\n${searchLoopNudge}` }
                : outcome
            toolResults.push({ call, outcome: observedOutcome })
            yield {
              type: 'tool_result',
              callId: call.id,
              name: call.name,
              ok: observedOutcome.ok,
              ...(observedOutcome.ok ? { result: observedOutcome.result } : { error: observedOutcome.error }),
              at: clock.now(),
            }
            // The reset call succeeded: this run ends here — its result is
            // the last thing it ever emits.
            if (observedOutcome.ok && toolsByName.get(call.name)?.sessionReset) {
              resetConsumed = true
              break
            }
            const afterToolSteering = yield* checkpoint(run, 'acting')
            if (afterToolSteering) {
              steering = afterToolSteering
              steerAfterTool = true
              break
            }
          }
          if (steerAfterTool) continue
          // The reset call ran and failed: its discarded siblings still
          // need answers for the following round to be protocol-consistent.
          if (resetCallIndex !== -1 && !resetConsumed) {
            for (const [index, call] of turn.calls.entries()) {
              if (index === resetCallIndex) continue
              const error = 'not executed: this response carried a session reset, but it failed'
              toolResults.push({ call, outcome: { ok: false, error } })
              yield { type: 'tool_result', callId: call.id, name: call.name, ok: false, error, at: clock.now() }
            }
          }
          if (resetConsumed) break
          yield { type: 'status', status: 'thinking', at: clock.now() }
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
      yield { type: 'done', outcome: resetConsumed ? 'reset' : runOutcome, at: clock.now() }
    } finally {
      if (activeRun === run) activeRun = null
      // Run end (#30): close the turn out — one synthetic `summary` event
      // in the log and the same data as a one-line console summary. Turns
      // that recorded nothing (no tracer, an untraced run) degrade to a
      // no-op; bookkeeping failures never break the run.
      emitTurnSummary(deps.tracer, turnId, deps.printSummary ?? console.log)
    }
  }

  async function* runGatedTool(
    call: ToolCall,
    turnId: string,
    visionBudget: VisionBudget,
    searchLoopRail: SearchLoopRail,
    blockerGate: BlockerGate,
    toolContext: ToolContext,
    run: ActiveRun,
  ): AsyncGenerator<UnstampedEvent, ToolResultOutcome> {
    const tool = toolsByName.get(call.name)
    if (!tool) return { ok: false, error: `unknown tool: '${call.name}'` }

    // ask_user (Tier 3): the pipeline owns the ask — render + speak the
    // question, wait for a voice or typed answer, hand it back as the result.
    if (tool.askUser) {
      let question: string
      try {
        question = tool.askUser(call)
      } catch (err) {
        return { ok: false, error: toErrorMessage(err) }
      }
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
      throwIfAborted(run)
      return {
        ok: true,
        result:
          resolved.reason === 'steered'
            ? 'cancelled by the user\'s steering'
            : resolved.answer ?? "user didn't answer",
      }
    }

    // Same-wall Blocker gate (#80, ADR 0010): while armed, browser calls
    // targeting the walled host — other than read_page, look, and ask_user
    // — are refused before it executes, with the escalation instruction.
    // Ahead of the risk tiers on purpose: a call this run will not perform
    // must never reach a user-facing confirmation.
    const blockerGateVerdict = blockerGate.gate(call)
    if (!blockerGateVerdict.ok) return { ok: false, error: blockerGateVerdict.reason }

    // Hard policy lives here, in code: a denied call never reaches execute,
    // even if the user would have approved it.
    const verdict = await assessCall(tool, call)
    throwIfAborted(run)
    yield* checkpoint(run, 'acting', false)
    if (run.steering) {
      return { ok: false, error: `${STEERED_CANCELLED}; do not retry this action` }
    }
    if (verdict.kind === 'deny') {
      return { ok: false, error: verdict.reason }
    }
    if (verdict.kind === 'confirm') {
      const confirmationId = `confirm-${++confirmationCounter}`
      const decision = waitForConfirmation(confirmationId)
      yield {
        type: 'confirmation_requested',
        confirmationId,
        callId: call.id,
        toolName: call.name,
        prompt: verdict.prompt,
        expiresAt: decision.expiresAt()!,
        at: clock.now(),
      }
      // The prompt is both shown (dialog) and spoken; voice yes/no lands in T9.
      const deadlineEvent = (expiresAt: number | null): UnstampedEvent => ({
        type: 'confirmation_deadline',
        confirmationId,
        expiresAt,
        at: clock.now(),
      })
      while (run.paused) yield* waitThroughPause(decision, run, deadlineEvent)
      if (!run.aborted && !run.steering) yield* speakLine(verdict.prompt, turnId)
      const resolved = yield* awaitDecision(decision, run, deadlineEvent)
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
        return { ok: false, error: detail }
      }
    }

    if (tool.usesVision) {
      const grant = visionBudget.tryAcquire()
      if (!grant.ok) return { ok: false, error: grant.reason }
    }

    // Run rails (#74/#82/#83): a blind search loop — consecutive similar
    // GUI searches (q= navigations, typed search box queries) with
    // nothing in between — is refused before it executes, like the vision
    // budget. Any other tool call clears the cap.
    const searchLoopGate = await searchLoopRail.gate(call)
    if (!searchLoopGate.ok) return { ok: false, error: searchLoopGate.reason }

    try {
      throwIfAborted(run)
      // The tool span (#30): one span per gated execution, tool name in
      // detail, so "navigate cost 4.1s p95" is answerable. Confirmation
      // waits above are user time and stay out of it; a call that never
      // reaches execute records nothing. Recorded even when the tool
      // fails — the time was spent either way.
      const tracer = deps.tracer
      const toolStart = tracer?.now()
      let result: unknown
      try {
        // The sub-span turn scope (#32): emissions inside the tool (browser
        // controller internals) key to this turn while it is open. Absent
        // channel — the call runs untouched.
        result = deps.browserSubspans
          ? await deps.browserSubspans.runInTurn(turnId, () => tool.execute(call, toolContext))
          : await tool.execute(call, toolContext)
      } finally {
        if (tracer && toolStart !== undefined) {
          recordSpan(tracer, turnId, 'tool', tracer.now() - toolStart, { tool: call.name })
        }
      }
      throwIfAborted(run)
      return { ok: true, result }
    } catch (err) {
      if (err instanceof CommandAbortedError) throw err
      // A missed Vision Deadline must not become a blind browse (ADR 0008;
      // ADR 0016 keeps the nudge): the failure carries an advisory nudge to
      // fall back to the DOM or escalate, mirroring the Blocker nudge
      // pattern. Subagent Looks get the same nudge in their runner.
      if (err instanceof VisionDeadlineError) {
        return { ok: false, error: `${err.message}\n${VISION_DEADLINE_NUDGE}` }
      }
      return { ok: false, error: toErrorMessage(err) }
    }
  }

  async function assessCall(tool: Tool, call: ToolCall): Promise<RiskVerdict> {
    if (!tool.assessRisk) return { kind: 'allow' }
    try {
      return await tool.assessRisk(call)
    } catch {
      // Fail closed: when risk can't be assessed, ask the user.
      return { kind: 'confirm', prompt: `Run ${call.name}?` }
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
      deps.onResume?.()
      activeRun.releasePause?.()
      return true
    },
    getState: () => (activeRun ? (activeRun.paused ? 'paused' : 'running') : 'idle'),
  }
}
