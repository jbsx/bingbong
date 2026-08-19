import type { PipelineEvent } from './events'
import type { RiskVerdict, Tool, ToolContext } from './tool'
import type { Clock } from '../ports/clock'
import type { LlmClient, SessionTurn, ToolCall, ToolResult, ToolResultOutcome } from '../ports/llm'
import type { TtsSpeaker } from '../ports/tts'
import type { SessionHistorySource } from '../session/sessionMemory'
import { spokenErrorLine } from '../agent/answerContract'
import type { PerfTracer } from '../perf/perfTracer'
import { createTurnIdSource } from '../perf/perfTracer'
import type { BrowserSubspans } from '../perf/browserSubspans'
import { emitTurnSummary } from '../perf/turnSummary'
import {
  createVisionBudget,
  MAX_ORCHESTRATOR_VISION_CALLS,
  type VisionBudget,
} from '../agent/subagentRails'

export interface CommandPipelineDeps {
  llm: LlmClient
  tts: TtsSpeaker
  clock: Clock
  tools: Tool[]
  /** Distilled session turns that ride along on every LLM round (spec #23). */
  session?: SessionHistorySource
  confirmTimeoutMs?: number
  /** How long an ask_user window stays open (voice + typed answers). */
  askTimeoutMs?: number
  maxToolRounds?: number
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
  aborted: boolean
  paused: boolean
  steering?: string
  releasePause?: () => void
  releaseControl?: () => void
}

class CommandAbortedError extends Error {
  constructor() {
    super('command aborted')
    this.name = 'CommandAbortedError'
  }
}

/** Default ask_user window: ~45s for a spoken or typed free-text answer. */
export const ASK_TIMEOUT_MS = 45_000

const STEERED_CANCELLED = 'cancelled by the user\'s steering'

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
   * stamps every event of the turn with it.
   */
  execute(command: string, turnId?: string): AsyncIterable<PipelineEvent>
  resolveConfirmation(confirmationId: string, approved: boolean): void
  /** Answer an open ask_user window (typed card or voice transcript). */
  resolveAsk(askId: string, answer: string): void
  abort(): void
  pause(): void
  resume(steering?: string): void
  getState(): CommandRunState
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
  const maxToolRounds = deps.maxToolRounds ?? 40
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

  async function* execute(command: string, turnId?: string): AsyncIterable<PipelineEvent> {
    // One id per turn (#28): adopted when the voice session minted it at
    // utterance end, freshly minted for text-box commands.
    const id = turnId ?? mintTurnId()
    for await (const event of runTurn(command, id)) {
      yield stampTurn(event, id)
    }
  }

  async function* runTurn(command: string, turnId: string): AsyncIterable<UnstampedEvent> {
    const run: ActiveRun = { aborted: false, paused: false }
    activeRun = run

    try {
      let runOutcome: 'done' | 'failed' | 'cancelled' = 'done'
      yield { type: 'command', text: command, at: clock.now() }
      yield { type: 'status', status: 'thinking', at: clock.now() }

      try {
        const toolResults: ToolResult[] = []
        const visionBudget = createVisionBudget(MAX_ORCHESTRATOR_VISION_CALLS)
        const toolContext: ToolContext = {
          clock,
          acquireVision: () => visionBudget.tryAcquire(),
          // The turn id rides the context so fan-out tools (spawn_agent)
          // correlate their subagent rounds to this turn (#29).
          turnId,
        }
        let rounds = 0
        let steering: string | undefined

        for (;;) {
          if (rounds >= maxToolRounds) {
            throw new Error(`tool round limit (${maxToolRounds}) reached`)
          }
          steering = (yield* checkpoint(run, 'thinking')) ?? steering
          const history: SessionTurn[] = deps.session?.history() ?? []
          const turn = await llm.complete({
            command,
            toolResults,
            // The turn id rides the request so the perf wrapper keys each
            // llm span to this turn (#29).
            turnId,
            ...(history.length > 0 ? { history } : {}),
            ...(steering ? { steering } : {}),
          })
          steering = undefined
          const afterModelSteering = yield* checkpoint(run, 'thinking')
          if (afterModelSteering) {
            steering = afterModelSteering
            continue
          }
          if (turn.kind === 'answer') {
            yield { type: 'display', text: turn.display, at: clock.now() }
            yield* speakLine(turn.speak, turnId)
            yield* checkpoint(run, 'thinking')
            break
          }

          yield { type: 'status', status: 'acting', at: clock.now() }
          rounds += 1
          let steerAfterTool = false
          for (const call of turn.calls) {
            const beforeToolSteering = yield* checkpoint(run, 'acting')
            if (beforeToolSteering) {
              steering = beforeToolSteering
              steerAfterTool = true
              break
            }
            yield { type: 'tool_call', callId: call.id, name: call.name, args: call.args, at: clock.now() }
            const outcome = yield* runGatedTool(call, turnId, visionBudget, toolContext, run)
            toolResults.push({ call, outcome })
            yield {
              type: 'tool_result',
              callId: call.id,
              name: call.name,
              ok: outcome.ok,
              ...(outcome.ok ? { result: outcome.result } : { error: outcome.error }),
              at: clock.now(),
            }
            const afterToolSteering = yield* checkpoint(run, 'acting')
            if (afterToolSteering) {
              steering = afterToolSteering
              steerAfterTool = true
              break
            }
          }
          if (steerAfterTool) continue
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
      yield { type: 'done', outcome: runOutcome, at: clock.now() }
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
      if (!activeRun || activeRun.aborted || !activeRun.paused) return
      const trimmed = steering?.trim()
      if (trimmed) {
        activeRun.steering = trimmed
        // A steering correction invalidates blocked, not-yet-executed work.
        settlePendingDecisions('steered')
      } else {
        eachPendingDecision((pending) => pending.resume())
      }
      activeRun.paused = false
      deps.onResume?.()
      activeRun.releasePause?.()
    },
    getState: () => (activeRun ? (activeRun.paused ? 'paused' : 'running') : 'idle'),
  }
}
