import { VisionDeadlineError, VISION_DEADLINE_NUDGE } from '../ports/vision'
import type { Clock } from '../ports/clock'
import { toErrorMessage } from '../errors'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { UnstampedEvent } from './events'
import type { RiskVerdict, Tool, ToolContext } from './tool'
import type { PerfTracer } from '../perf/perfTracer'
import type { BrowserSubspans } from '../perf/browserSubspans'
import { createVisionBudget, MAX_ORCHESTRATOR_VISION_CALLS } from '../agent/subagentRails'
import { createBlockerGate, orchestratorBlockerEscalation, type BlockerEscalation } from './blockerGate'
import { createSearchLoopRail } from './searchLoopRail'
import { createNoProgressRail } from './noProgressRail'
import type { SettledPageState } from './progressFingerprints'
import type { SnapshotRef } from '../browser/snapshot'
import { finalizationToolRefusal, type EffortEpoch } from './effortEpoch'
import type { Notices } from './notices'
import type { ConfirmDecision, RunDecisions } from './decisions'
import { STEERED_CANCELLED, type Directive, type RunInterrupts } from './interrupts'
import { classifyToolObservation } from './toolObservations'
import type { ObservationId, ObservationInput, ObservationRecord } from '../session/observationLedger'

// Issue #154, step 2 (#157): the Tool Round executor.
//
// Vocabulary (CONTEXT.md, Tool Round): one model response's tool calls,
// executed in order. Every round crosses nine seams in a fixed order —
// Blocker gate, no-progress gate, risk assessment and Confirmation, the
// Vision Budget, the search-loop gate, execution, then classify →
// Observation ledger → Blocker observe → search-loop observe →
// no-progress observe → the no-Progress trip → Notices. That order is an
// ADR 0010 / ADR 0027 requirement, and it used to live as comments in a
// nine-parameter generator plus a loop body in the Run pipeline, with the
// steering variable threaded through six exits.
//
// The seam is the round, not the call: one executor per Run (and, from
// #158, per Browse Subagent) owns its Blocker gate, both no-progress and
// search-loop rails and its Vision Budget as internals nobody else
// reaches, and exposes one generator. `run` yields the round's
// `tool_call` / `tool_result` events and whatever the injected decision
// and interrupt seams yield, and returns the round's results — aligned
// with the Observation identities they minted — plus how the round ended.
//
// What stays outside: `status` choreography (the caller's), and anything
// that needs to know a tool by name. The Run Plan's own handling reaches
// the round through `intercept`; the Session Reset boundary through
// `soleCall` and `terminalResult`. The executor itself never compares a
// tool name — it reads the catalog's capability flags, delegates
// observation classification to the ledger's table, and takes every other
// judgement from its configuration.

/**
 * Which rails this round runs (#154): all true for a Run, all false for a
 * Browse Subagent's first adoption (#158) — the flags are how a
 * behaviour-preserving adoption stays behaviour-preserving.
 */
export interface ToolRoundCapabilities {
  /** The search-loop rail (#74/#82): gate after the Vision Budget, observe after execution. */
  readonly searchLoopRail: boolean
  /** The no-progress rails (#126): gate ahead of risk, observe after execution, trip mid-round. */
  readonly noProgressRail: boolean
  /** The per-call deadline gate (#135): expiry checked before every call in the round begins. */
  readonly deadlineGate: boolean
}

/**
 * How this caller's Finalization reads to its model (#159): the refusal a
 * closed tool answers with once the round's work is over, and what the
 * action exhausting a second Approach is told. The Run's own wording by
 * default — a Browse Subagent finalizes into a report rather than an
 * answer and has no Run Plan bookkeeping left to do, so it injects its
 * own, the way it already injects the Blocker escalation.
 */
export interface FinalizationWording {
  /** What a closed acquisition or ask_user call answers with in Finalization. */
  readonly toolRefusal: string
  /** What the action exhausting the second Approach is told (#126). */
  readonly approachExhausted: string
}

/**
 * One executed call and the Observation it minted. The pair is the point:
 * the caller's model context and its ledger identities stay aligned by
 * construction rather than by two arrays pushed by hand.
 */
export interface ToolRoundResult {
  readonly call: ToolCall
  /** The outcome as the model reads it — every Notice this result carries already attached. */
  readonly outcome: ToolResultOutcome
  /** The Observation this result recorded, or null when it never executed. */
  readonly observationId: ObservationId | null
}

/**
 * How the round ended: it ran to the end (`continue`), a Steering
 * Directive landed between two of its calls (`steered` — the caller
 * replans and the Directive is already consumed), or a call's result
 * ended the round outright (`terminal` — a successful Session Reset for a
 * Run, the ASK_USER relay for a worker).
 */
export type RoundEnd =
  | { readonly kind: 'continue' }
  | { readonly kind: 'steered'; readonly directive: Directive }
  | { readonly kind: 'terminal'; readonly call: ToolCall; readonly outcome: ToolResultOutcome }

export interface ToolRoundOutcome {
  readonly end: RoundEnd
  /** Every result the round produced, in the order it produced them. */
  readonly results: readonly ToolRoundResult[]
}

/**
 * The call that runs alone (#99): when a round carries one, every other
 * call in it — before it or after it — is a discarded sibling that never
 * executes, emits, or observes. Only relevant to a caller that has such a
 * boundary; the Run's is the Session Reset tool.
 */
export interface SoleCallBoundary {
  /** Whether this call, if the round carries it, is the only one that runs. */
  select(call: ToolCall): boolean
  /**
   * What the discarded siblings answer when the round did not end
   * terminally after all — the sole call ran and failed, so the next
   * round still needs a result per call to stay protocol-consistent.
   */
  readonly notExecuted: string
}

export interface ToolRoundConfig {
  readonly clock: Clock
  /** The catalog this round executes against — the executor reads its capability flags, never its names. */
  readonly tools: readonly Tool[]
  /** The caller's Effort Epoch: the round protocol, the deadline gate, the phase, and the no-Progress trip. */
  readonly effortEpoch: EffortEpoch
  /** The caller's owed-Notice queue (#154): the round attaches at its one delivery site. */
  readonly notices: Notices
  /** The caller's Observation ledger sink: the raw outcome, ahead of any Notice. */
  observe(input: ObservationInput): ObservationRecord | null
  /** The context tools execute against. The round replaces `acquireVision` with its own Vision Budget. */
  readonly toolContext: ToolContext
  /** How gated execution reaches the user: the ask window and the Confirmation window. */
  readonly decisions: RunDecisions
  /** How Pause, Steering and Stop reach the round: between calls, and inside a gated execution. */
  readonly interrupts: RunInterrupts
  readonly capabilities: ToolRoundCapabilities
  /**
   * Calls the caller answers itself, ahead of every gate (#116: the Run
   * Plan's own report tool). A non-null outcome is the result — the call
   * never executes, and it is never useful work for Notices.
   */
  intercept?(call: ToolCall): ToolResultOutcome | null
  /**
   * Whether this result ended the round (#99): a successful Session Reset
   * for a Run, the ASK_USER relay for a worker. Later siblings never
   * execute.
   */
  terminalResult?(call: ToolCall, outcome: ToolResultOutcome): boolean
  readonly soleCall?: SoleCallBoundary
  /** Hostname the visible tab is on — what current-page browser verbs target for the Blocker gate (#80). */
  currentHost?(): string | null
  /** The escalation sentence a Blocker refusal carries: the Run's route, or a worker's relay (#81). */
  readonly blockerEscalation?: BlockerEscalation
  /** How Finalization reads to this caller's model (#159). Defaults to the Run's. */
  readonly finalizationWording?: FinalizationWording
  /** The visible tab's URL: the source recorded on page-facing Observations (#111). */
  currentPageUrl?(): string | null
  /** Snapshot ref facts: how the search-loop rail recognizes a typed GUI search (#82). */
  describeRef?(ref: number): Promise<SnapshotRef | undefined>
  /** The visible tab's settled page state: the no-progress rails' comparison input (#126). */
  settledPageState?(): Promise<SettledPageState | null> | SettledPageState | null
  /** How many vision calls this round's budget grants (#83). Defaults to the orchestrator's. */
  readonly visionCalls?: number
  /** Advisory bookkeeping only — a throwing tracer never fails a round. */
  readonly diagnostics?: {
    readonly tracer?: PerfTracer
    readonly browserSubspans?: BrowserSubspans
  }
}

export interface ToolRoundExecutor {
  /**
   * Executes one model response's tool calls. Yields the round's
   * `tool_call` and `tool_result` events plus whatever the injected
   * decision and interrupt seams yield; returns the results and how the
   * round ended. Throws the caller's abort error when the run is stopped.
   * The turn id is the diagnostics channels' key: a caller that traces
   * nothing passes none.
   */
  run(turn: { readonly calls: readonly ToolCall[] }, turnId?: string): AsyncGenerator<UnstampedEvent, ToolRoundOutcome>
  /**
   * A Steering replan (#119): the corrected objective faces the
   * no-progress accounting fresh. Everything else the executor owns is
   * either already per-run state the replan keeps (the Vision Budget, the
   * search-loop streak, the Blocker gate's armed wall) or the Effort
   * Epoch's own.
   */
  replan(): void
}

/**
 * What a call names no tool in the catalog answers with. Exported because
 * an adapter can answer for the round (#158: a Subagent has no user, so
 * its decisions seam answers an interactive ask as the tool it is not).
 */
export function unknownToolError(name: string): ToolResultOutcome {
  return { ok: false, error: `unknown tool: '${name}'` }
}

/**
 * Advisory bookkeeping (#29/#30): the perf log must never fail a round,
 * so a throwing tracer is swallowed here. Absent turn id — a caller that
 * traces nothing — records nothing.
 */
function recordSpan(tracer: PerfTracer | undefined, turnId: string | undefined, durMs: number, tool: string): void {
  if (!tracer || turnId === undefined) return
  try {
    tracer.span(turnId, 'tool', durMs, { tool })
  } catch {
    // swallowed — see above
  }
}

export function createToolRoundExecutor(config: ToolRoundConfig): ToolRoundExecutor {
  const { clock, effortEpoch, notices, decisions, interrupts, capabilities } = config
  const toolsByName = new Map(config.tools.map((tool) => [tool.name, tool]))
  // The round's own rails and budget (#154): created here, reachable from
  // nowhere else. Each is fresh per executor, which is fresh per Run.
  const visionBudget = createVisionBudget(config.visionCalls ?? MAX_ORCHESTRATOR_VISION_CALLS)
  const blockerGate = createBlockerGate(
    config.currentHost ?? (() => null),
    config.blockerEscalation ?? orchestratorBlockerEscalation,
  )
  const searchLoopRail = capabilities.searchLoopRail
    ? createSearchLoopRail(config.describeRef ? { describeRef: config.describeRef } : {})
    : null
  const noProgressRail = capabilities.noProgressRail
    ? createNoProgressRail({
        ...(config.settledPageState ? { settledState: config.settledPageState } : {}),
        ...(config.finalizationWording
          ? { approachExhaustedDirective: config.finalizationWording.approachExhausted }
          : {}),
      })
    : null
  const closedToolRefusal = config.finalizationWording?.toolRefusal ?? finalizationToolRefusal
  // The Vision Budget is the round's, so the context tools execute against
  // acquires from it — a caller can never hand a tool a different one.
  const toolContext: ToolContext = { ...config.toolContext, acquireVision: () => visionBudget.tryAcquire() }

  const isInFinalization = (): boolean => effortEpoch.phase.kind !== 'working'

  async function assessCall(tool: Tool, call: ToolCall): Promise<RiskVerdict> {
    if (!tool.assessRisk) return { kind: 'allow' }
    try {
      return await tool.assessRisk(call)
    } catch {
      // Fail closed: when risk can't be assessed, ask the user.
      return { kind: 'confirm', prompt: `Run ${call.name}?` }
    }
  }

  async function* runGatedTool(call: ToolCall, turnId: string | undefined): AsyncGenerator<UnstampedEvent, ToolResultOutcome> {
    const tool = toolsByName.get(call.name)
    if (!tool) return unknownToolError(call.name)

    // ask_user (Tier 3): the round owns the ask — the tool only names the
    // question; the decisions seam (#156) puts it to the user and hands
    // back the result the model reads.
    if (tool.askUser) {
      let question: string
      try {
        question = tool.askUser(call)
      } catch (err) {
        return { ok: false, error: toErrorMessage(err) }
      }
      return yield* decisions.ask(question, call)
    }

    // Same-wall Blocker gate (#80, ADR 0010): while armed, browser calls
    // targeting the walled host — other than read_page, look, and ask_user
    // — are refused before it executes, with the escalation instruction.
    // Ahead of the risk tiers on purpose: a call this run will not perform
    // must never reach a user-facing confirmation.
    const blockerGateVerdict = blockerGate.gate(call)
    if (!blockerGateVerdict.ok) return { ok: false, error: blockerGateVerdict.reason }

    // No-progress rails (#126, ADR 0027): an objectively redundant action —
    // the same fingerprint against the state its previous attempt already
    // faced — is nudged first and refused next, before it executes and
    // like the Blocker gate, ahead of the risk tiers: a call this run will
    // not perform must never reach a user-facing confirmation.
    if (noProgressRail !== null) {
      const noProgressGate = await noProgressRail.gate(call)
      if (!noProgressGate.ok) return { ok: false, error: noProgressGate.reason }
    }

    // Hard policy lives here, in code: a denied call never reaches execute,
    // even if the user would have approved it.
    const verdict = await assessCall(tool, call)
    interrupts.throwIfStopped()
    // The mid-gate peek (#119): a Directive that landed while risk was
    // assessed cancels this call, and stays unconsumed for the round's own
    // check to end the round on.
    if (yield* interrupts.peek('acting')) {
      return { ok: false, error: `${STEERED_CANCELLED}; do not retry this action` }
    }
    if (verdict.kind === 'deny') {
      return { ok: false, error: verdict.reason }
    }
    if (verdict.kind === 'confirm') {
      // The Confirmation window (#156) is the decisions seam's second
      // question: approval passes through to the execution below, a denial
      // is already worded as the outcome the model reads.
      const confirmation: ConfirmDecision = yield* decisions.confirm(verdict.prompt, call)
      if (!confirmation.approved) return confirmation.outcome
    }

    if (tool.usesVision) {
      const grant = visionBudget.tryAcquire()
      if (!grant.ok) return { ok: false, error: grant.reason }
    }

    // Run rails (#74/#82/#83): a blind search loop — consecutive similar
    // GUI searches (q= navigations, typed search box queries) with
    // nothing in between — is refused before it executes, like the vision
    // budget. Any other tool call clears the cap.
    if (searchLoopRail !== null) {
      const searchLoopGate = await searchLoopRail.gate(call)
      if (!searchLoopGate.ok) return { ok: false, error: searchLoopGate.reason }
    }

    try {
      interrupts.throwIfStopped()
      // The tool span (#30): one span per gated execution, tool name in
      // detail, so "navigate cost 4.1s p95" is answerable. Confirmation
      // waits above are user time and stay out of it; a call that never
      // reaches execute records nothing. Recorded even when the tool
      // fails — the time was spent either way.
      const tracer = config.diagnostics?.tracer
      const toolStart = tracer?.now()
      let result: unknown
      try {
        // The sub-span turn scope (#32): emissions inside the tool (browser
        // controller internals) key to this turn while it is open. Absent
        // channel — the call runs untouched.
        const subspans = config.diagnostics?.browserSubspans
        result =
          subspans !== undefined && turnId !== undefined
            ? await subspans.runInTurn(turnId, () => tool.execute(call, toolContext))
            : await tool.execute(call, toolContext)
      } finally {
        if (tracer && toolStart !== undefined) {
          recordSpan(tracer, turnId, tracer.now() - toolStart, call.name)
        }
      }
      interrupts.throwIfStopped()
      return { ok: true, result }
    } catch (err) {
      // Stop is never a tool failure: the interrupts seam decides whether
      // this run is over, and raises its own error if it is — the executor
      // never names an abort error type, so a worker's cancel propagates
      // exactly like a Run's Stop instead of becoming a failed result.
      interrupts.throwIfStopped()
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

  async function* run(
    turn: { readonly calls: readonly ToolCall[] },
    turnId?: string,
  ): AsyncGenerator<UnstampedEvent, ToolRoundOutcome> {
    const results: ToolRoundResult[] = []
    // Finalization's one bookkeeping Tool Round (#117/AC3): every result
    // it produces must teach the model that the Answer round is next —
    // refusals carry it directly; successful bookkeeping results carry
    // the epoch's owed directive as a Notice.
    effortEpoch.beginToolRound()
    // The sole-call boundary (#99): the whole response is known before any
    // of it executes, so when it carries one, every other call in it —
    // before or after — is a discarded sibling.
    const soleIndex = config.soleCall ? turn.calls.findIndex((call) => config.soleCall!.select(call)) : -1
    let end: RoundEnd = { kind: 'continue' }

    for (const [index, call] of turn.calls.entries()) {
      if (soleIndex !== -1 && index !== soleIndex) continue
      const beforeToolDirective = yield* interrupts.check('acting')
      if (beforeToolDirective) {
        end = { kind: 'steered', directive: beforeToolDirective }
        break
      }
      yield { type: 'tool_call', callId: call.id, name: call.name, args: call.args, at: clock.now() }
      // The deadline gate (#135): expiry is checked before every call
      // begins, so no browser, vision, media, delegation, or user-question
      // action starts past the boundary. An already-executing
      // non-interruptible action settles once — this check runs between
      // calls — but every later acquisition sibling in the response is
      // refused by the closed-tool check below.
      if (capabilities.deadlineGate) effortEpoch.tripDeadline()
      // The caller's own answer (#116): a Run Plan report never reaches a
      // gate or an execution once the pipeline handled it.
      const intercepted = config.intercept?.(call) ?? null
      // Finalization (#117/AC3): acquisition and ask_user calls are refused
      // before any gate or execution — the run's work is over; only
      // bookkeeping remains, and the refusal itself carries the finalize
      // directive.
      const closedTool = intercepted === null && isInFinalization() ? toolsByName.get(call.name) : undefined
      const outcome: ToolResultOutcome =
        intercepted !== null
          ? intercepted
          : closedTool !== undefined && (closedTool.acquisition === true || closedTool.askUser !== undefined)
            ? { ok: false, error: closedToolRefusal }
            : yield* runGatedTool(call, turnId)

      // Observation ledger (#111): the raw outcome as the tool produced
      // it, ahead of the Notices attached below — later checkpoint
      // validation checks excerpts against what the source actually said,
      // not against round-added guidance. The minted identity rides beside
      // the result (#124): Run Context Compaction grounds eligibility on it.
      const classification = classifyToolObservation(call.name)
      const sourceUrl = classification.pageFacing ? config.currentPageUrl?.() : undefined
      const observedRecord = config.observe({
        producer: classification.producer,
        ok: outcome.ok,
        payload: outcome.ok ? outcome.result : outcome.error,
        ...(sourceUrl ? { sourceUrl } : {}),
      })
      // Same-wall Blocker gate (#80): marker lines riding successful
      // results arm it; a successful different-host browser interaction
      // disarms it. Sees the raw outcome — the Notices attached below
      // change nothing it consumes.
      blockerGate.observe(call, outcome)
      // Search-loop rail (#74/#82): observe every processed call (this is
      // what tracks and resets the streak — a failed intervening tool
      // leaves it alone); its advisory verdict is an immediate Notice.
      if (searchLoopRail !== null) notices.owe('search_loop', await searchLoopRail.observe(call, outcome))
      // No-progress rails (#126, ADR 0027): the redundancy nudge and the
      // Approach instructions are immediate Notices too; two exhausted
      // Approaches trip the run into Finalization mid-round — remaining
      // acquisition siblings of this round are then refused by the
      // closed-tool check above, each carrying the finalize directive.
      if (noProgressRail !== null) {
        notices.owe('no_progress', await noProgressRail.observe(call, outcome))
        if (noProgressRail.finalizationDue()) effortEpoch.tripNoProgress()
      }
      // The one delivery site (#154): every Notice this result can carry
      // rides it in precedence order. Useful work is a successful string
      // result the caller did not answer itself, in a round whose work is
      // not already over — judged after the no-Progress trip above, so the
      // tripping result never carries a plan nudge or budget warning.
      const usefulWork = outcome.ok && typeof outcome.result === 'string' && intercepted === null && !isInFinalization()
      const observedOutcome = notices.attach(outcome, { usefulWork })
      results.push({ call, outcome: observedOutcome, observationId: observedRecord?.id ?? null })
      yield {
        type: 'tool_result',
        callId: call.id,
        name: call.name,
        ok: observedOutcome.ok,
        ...(observedOutcome.ok ? { result: observedOutcome.result } : { error: observedOutcome.error }),
        at: clock.now(),
      }
      // The result ended the round: it is the last thing the round emits.
      if (config.terminalResult?.(call, observedOutcome) === true) {
        end = { kind: 'terminal', call, outcome: observedOutcome }
        break
      }
      const afterToolDirective = yield* interrupts.check('acting')
      if (afterToolDirective) {
        end = { kind: 'steered', directive: afterToolDirective }
        break
      }
    }

    // A Finalization Tool Round is spent (#117/AC3) — however it ended,
    // only an Answer is accepted from here. Ahead of the sibling answers
    // and the caller's steering exit on purpose: a Directive during the
    // bookkeeping round must not reopen tool work.
    effortEpoch.completeToolRound()
    // The sole call ran and failed: its discarded siblings still need
    // answers for the following round to be protocol-consistent. A steered
    // round never got that far.
    if (soleIndex !== -1 && end.kind === 'continue' && config.soleCall !== undefined) {
      for (const [index, call] of turn.calls.entries()) {
        if (index === soleIndex) continue
        const error = config.soleCall.notExecuted
        // Discarded siblings never executed, so they recorded no
        // observation (#124): null keeps the alignment honest.
        results.push({ call, outcome: { ok: false, error }, observationId: null })
        yield { type: 'tool_result', callId: call.id, name: call.name, ok: false, error, at: clock.now() }
      }
    }
    return { end, results }
  }

  return {
    run,
    replan() {
      noProgressRail?.reset()
    },
  }
}
