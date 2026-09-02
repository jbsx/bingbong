import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { UnstampedEvent } from './events'
import type { RiskVerdict, Tool } from './tool'
import type { RunDecisions } from './decisions'
import type { Directive, RunInterrupts } from './interrupts'
import type { SettledPageState } from './progressFingerprints'
import { FakeClock } from '../testing/doubles'
import { createEffortEpoch, finalizationToolRefusal } from './effortEpoch'
import { createNotices } from './notices'
import { createObservationLedger, type ObservationInput } from '../session/observationLedger'
import { createToolRoundExecutor, type ToolRoundCapabilities, type ToolRoundConfig, type ToolRoundOutcome } from './toolRound'

// Issue #157: the Tool Round executor's own invariants — the order its
// nine seams run in, and the four ways a round can end. Everything here is
// plain values and a scripted tool catalog: no LLM, no browser, no pipeline.
// What each test pins is a decision the Run loop used to make in comments
// (ADR 0010, ADR 0027), so a reordering here has to fail a test.

function call(name: string, args: Record<string, unknown> = {}, id = `${name}-${JSON.stringify(args)}`): ToolCall {
  return { id, name, args }
}

const ALL_RAILS: ToolRoundCapabilities = { searchLoopRail: true, noProgressRail: true, deadlineGate: true }

/** A settled page state that never moves — the no-progress rails' worst case. */
const STUCK: SettledPageState = {
  url: 'https://example.com/',
  title: 'Example',
  textDigest: 'Nothing new here.',
  scrollX: 0,
  scrollY: 0,
  dialogOpen: false,
  dialogText: '',
}

interface Harness {
  readonly trace: string[]
  readonly observed: ObservationInput[]
  readonly asked: string[]
  readonly confirmed: string[]
  readonly notices: ReturnType<typeof createNotices>
  readonly epoch: ReturnType<typeof createEffortEpoch>
  readonly clock: FakeClock
  round(calls: readonly ToolCall[]): Promise<{ events: UnstampedEvent[]; outcome: ToolRoundOutcome }>
}

/**
 * One executor over a scripted catalog, with every seam it consumes
 * recorded. `trace` is the shared order log: risk assessments, executions,
 * ledger writes, and the user-facing windows, in the order the round
 * reached them.
 */
function harness(
  tools: readonly Tool[],
  options: {
    capabilities?: ToolRoundCapabilities
    /** Directives the interrupts seam serves, one per `check`, in order. */
    directives?: (Directive | undefined)[]
    /** How the Confirmation window answers. Default: approves. */
    approve?: boolean
    /** What the interrupts seam raises when asked, as Stop does. Undefined: the run is live. */
    stoppedWith?: () => Error | undefined
    settledPageState?: () => SettledPageState | null
    activeWorkDeadlineMs?: number
    visionCalls?: number
    intercept?: ToolRoundConfig['intercept']
    terminalResult?: ToolRoundConfig['terminalResult']
    soleCall?: ToolRoundConfig['soleCall']
    currentHost?: () => string | null
    /** The shared order log — pass the same array the scripted tools write to. */
    trace?: string[]
  } = {},
): Harness {
  const clock = new FakeClock()
  const trace = options.trace ?? []
  const observed: ObservationInput[] = []
  const asked: string[] = []
  const confirmed: string[] = []
  const notices = createNotices()
  const epoch = createEffortEpoch({
    clock,
    ...(options.activeWorkDeadlineMs !== undefined ? { activeWorkDeadlineMs: options.activeWorkDeadlineMs } : {}),
  })
  const ledger = createObservationLedger({ now: () => clock.now(), generation: 0, isCurrentGeneration: () => true })
  const decisions: RunDecisions = {
    async *ask(question) {
      trace.push(`ask:${question}`)
      asked.push(question)
      return { ok: true, result: 'the user said so' }
    },
    async *confirm(prompt) {
      trace.push(`confirm:${prompt}`)
      confirmed.push(prompt)
      return options.approve === false ? { approved: false, outcome: { ok: false, error: 'denied by the user' } } : { approved: true }
    },
  }
  const directives = [...(options.directives ?? [])]
  const stop = (): void => {
    const stopped = options.stoppedWith?.()
    if (stopped !== undefined) throw stopped
  }
  const interrupts: RunInterrupts = {
    async *check() {
      stop()
      return directives.shift()
    },
    async *peek() {
      stop()
      return false
    },
    throwIfStopped: stop,
  }
  const executor = createToolRoundExecutor({
    clock,
    tools,
    effortEpoch: epoch,
    notices,
    observe: (input) => {
      trace.push(`observe:${input.producer}:${input.ok ? 'ok' : 'failed'}`)
      observed.push(input)
      return ledger.record(input)
    },
    toolContext: { clock },
    decisions,
    interrupts,
    capabilities: options.capabilities ?? ALL_RAILS,
    ...(options.intercept ? { intercept: options.intercept } : {}),
    ...(options.terminalResult ? { terminalResult: options.terminalResult } : {}),
    ...(options.soleCall ? { soleCall: options.soleCall } : {}),
    ...(options.currentHost ? { currentHost: options.currentHost } : {}),
    ...(options.settledPageState ? { settledPageState: options.settledPageState } : {}),
    ...(options.visionCalls !== undefined ? { visionCalls: options.visionCalls } : {}),
  })
  return {
    trace,
    observed,
    asked,
    confirmed,
    notices,
    epoch,
    clock,
    async round(calls) {
      const generator = executor.run({ calls }, 'turn-1')
      const events: UnstampedEvent[] = []
      for (;;) {
        const step = await generator.next()
        if (step.done) return { events, outcome: step.value }
        events.push(step.value)
      }
    },
  }
}

/** A scripted tool that records its own execution in the shared trace. */
function scripted(
  name: string,
  trace: string[],
  options: { result?: string | (() => string); assessRisk?: RiskVerdict; acquisition?: boolean; usesVision?: boolean } = {},
): Tool {
  return {
    name,
    ...(options.acquisition ? { acquisition: true } : {}),
    ...(options.usesVision ? { usesVision: true } : {}),
    ...(options.assessRisk
      ? {
          assessRisk: (): RiskVerdict => {
            trace.push(`assess:${name}`)
            return options.assessRisk!
          },
        }
      : {}),
    async execute(callArg: ToolCall): Promise<unknown> {
      trace.push(`execute:${callArg.name}`)
      const result = options.result ?? 'done'
      return typeof result === 'function' ? result() : result
    },
  }
}

function errorOf(outcome: ToolResultOutcome): string {
  return outcome.ok ? `(succeeded: ${String(outcome.result)})` : outcome.error
}

function resultOf(outcome: ToolResultOutcome): string {
  return outcome.ok ? String(outcome.result) : `(failed: ${outcome.error})`
}

describe('gate order (#157/AC2, ADR 0010 + ADR 0027)', () => {
  it('runs the Blocker gate ahead of risk assessment — a refused call never reaches the user', async () => {
    const trace: string[] = []
    const tools = [
      scripted('read_page', trace, { result: 'BLOCKER:login-wall example.com\nSign in to continue.' }),
      scripted('click', trace, { assessRisk: { kind: 'confirm', prompt: 'Click it?' } }),
    ]
    const h = harness(tools, { currentHost: () => 'example.com', trace })

    const { outcome } = await h.round([call('read_page'), call('click', { ref: 3 })])

    // The marker armed the gate on the first result; the second call is
    // refused before its risk is even assessed, so no Confirmation window
    // ever opened for an action this run will not perform.
    expect(errorOf(outcome.results[1]!.outcome)).toMatch(/walled for this run/)
    expect(h.trace).toEqual(['execute:read_page', 'observe:page_read:ok', 'observe:action_outcome:failed'])
    expect(h.confirmed).toEqual([])
  })

  it('runs the no-progress refusal ahead of the Confirmation window', async () => {
    const trace: string[] = []
    const navigate = scripted('navigate', trace, { assessRisk: { kind: 'confirm', prompt: 'Navigate?' } })
    const h = harness([navigate], { settledPageState: () => STUCK, trace })
    const repeat = call('navigate', { url: 'https://example.com/' })

    // Baseline, then the nudged repeat: both are confirmed and run.
    await h.round([repeat])
    await h.round([repeat])
    expect(h.confirmed).toHaveLength(2)

    // The third equivalent attempt against unchanged state is refused
    // pre-execution — the user is never asked to approve it.
    const { outcome } = await h.round([repeat])

    expect(errorOf(outcome.results[0]!.outcome)).toMatch(/Not executed/)
    expect(h.confirmed).toHaveLength(2)
    expect(trace.filter((entry) => entry === 'execute:navigate')).toHaveLength(2)
  })

  it('runs the search-loop gate after the Vision Budget — the budget refusal is the one the model reads', async () => {
    const searches = ['one two three', 'one two four', 'one two five', 'one two six', 'one two seven', 'one two eight']
    const calls = searches.map((query) => call('navigate', { url: `https://s.example/?q=${query.replace(/ /g, '+')}` }))
    // The no-progress rail is off here: this test is about which of the
    // other two gates answers first, and the flags are how that isolation
    // is expressed (#154).
    const capabilities: ToolRoundCapabilities = { searchLoopRail: true, noProgressRail: false, deadlineGate: true }

    // Five similar searches reach the search-loop cap; the sixth is
    // refused by both gates at once. With one vision call left over, the
    // search-loop refusal is what comes back.
    const roomy = harness([scripted('navigate', [], { usesVision: true })], { capabilities, visionCalls: 6 })
    const roomyRound = await roomy.round(calls)
    expect(errorOf(roomyRound.outcome.results[5]!.outcome)).toMatch(/Search loop limit/)

    // With the budget exhausted instead, the Vision Budget answers first:
    // it sits ahead of the search-loop gate.
    const spent = harness([scripted('navigate', [], { usesVision: true })], { capabilities, visionCalls: 5 })
    const spentRound = await spent.round(calls)
    expect(errorOf(spentRound.outcome.results[5]!.outcome)).not.toMatch(/Search loop limit/)
    expect(errorOf(spentRound.outcome.results[5]!.outcome)).toMatch(/vision/i)
  })

  it('pairs gate with observe for the same call: assess, execute, then record', async () => {
    const trace: string[] = []
    const h = harness([scripted('navigate', trace, { assessRisk: { kind: 'allow' } })], {
      settledPageState: () => STUCK,
      trace,
    })

    await h.round([call('navigate', { url: 'https://example.com/' })])

    expect(h.trace).toEqual(['assess:navigate', 'execute:navigate', 'observe:action_outcome:ok'])
  })
})

describe('the rails observe the raw outcome, ahead of Notices (#157/AC2)', () => {
  it('records the ledger payload without the Notices the model reads', async () => {
    const trace: string[] = []
    const h = harness([scripted('spin', trace, { result: 'the raw result' })], { trace })
    h.notices.owe('run_plan', 'Report your Run Plan.')

    const { outcome } = await h.round([call('spin')])

    expect(h.observed).toEqual([{ producer: 'action_outcome', ok: true, payload: 'the raw result' }])
    expect(resultOf(outcome.results[0]!.outcome)).toBe('the raw result\n\nReport your Run Plan.')
  })

  it('lets a rail verdict ride the very result the rail just observed', async () => {
    // Three similar searches reach the search-loop nudge tier: the rail
    // observed this call's raw outcome before Notices attached, so its
    // verdict rides the same result rather than the next one.
    const calls = ['alpha beta gamma', 'alpha beta delta', 'alpha beta epsilon'].map((query) =>
      call('navigate', { url: `https://s.example/?q=${query.replace(/ /g, '+')}` }),
    )
    const h = harness([scripted('navigate', [])], {
      capabilities: { searchLoopRail: true, noProgressRail: false, deadlineGate: true },
    })

    const { outcome } = await h.round(calls)

    expect(resultOf(outcome.results[2]!.outcome)).toMatch(/reword one intent/)
    expect(h.observed[2]).toEqual({ producer: 'action_outcome', ok: true, payload: 'done' })
  })
})

describe('mid-round trips close the round’s remaining siblings (#157/AC2)', () => {
  it('refuses the acquisition siblings after the no-progress trip, with the finalize directive', async () => {
    const trace: string[] = []
    // Five distinct page-facing actions against a page that never moves:
    // the first is the Progress baseline, the next four exhaust two
    // Approaches — the second exhaustion trips Finalization mid-round.
    const calls = ['a', 'b', 'c', 'd', 'e'].map((slug) => call('navigate', { url: `https://example.com/${slug}` }))
    const h = harness([scripted('navigate', trace, { acquisition: true })], { settledPageState: () => STUCK, trace })

    const { outcome } = await h.round([...calls, call('navigate', { url: 'https://example.com/late' })])

    // The round is spent by the time it returns, so the phase already
    // latched Answer-only; the cause is what the trip decided.
    expect(h.epoch.phase).toEqual({ kind: 'answer_only', cause: 'no_progress' })
    expect(resultOf(outcome.results[4]!.outcome)).toMatch(/second Approach has made no progress/)
    // The sibling after the trip never executed: it met the closed-tool
    // refusal, which carries the finalize directive itself.
    expect(errorOf(outcome.results[5]!.outcome)).toBe(finalizationToolRefusal)
    expect(trace.filter((entry) => entry === 'execute:navigate')).toHaveLength(5)
  })

  it('refuses the siblings that begin after the active-work deadline expires', async () => {
    const trace: string[] = []
    // The tool spends the run's whole work budget while it runs — the
    // holder is how it reaches the clock the harness owns.
    const spendBudget = { run: (): void => {} }
    const slow: Tool = {
      name: 'slow',
      acquisition: true,
      async execute(callArg) {
        trace.push(`execute:${callArg.name}`)
        spendBudget.run()
        return 'done'
      },
    }
    const h = harness([slow, scripted('later', trace, { acquisition: true })], { activeWorkDeadlineMs: 1_000, trace })
    spendBudget.run = () => h.clock.advance(5_000)

    const { outcome } = await h.round([call('slow'), call('later')])

    // The in-flight call settled once — the gate runs between calls — but
    // the sibling that begins past the boundary never starts.
    expect(resultOf(outcome.results[0]!.outcome)).toMatch(/^done/)
    expect(errorOf(outcome.results[1]!.outcome)).toBe(finalizationToolRefusal)
    expect(h.epoch.phase).toEqual({ kind: 'answer_only', cause: 'deadline_reached' })
    expect(trace.filter((entry) => entry.startsWith('execute:'))).toEqual(['execute:slow'])
  })
})

describe('Stop reaches through the interrupts seam, never a named error type (#157/AC5)', () => {
  it('propagates the caller’s own stop error out of a tool execution instead of failing the call', async () => {
    class WorkerCancelled extends Error {}
    // The run is live until the tool is in flight — the cancel lands while
    // it runs, and the tool's own throw is what the round catches.
    let cancelled = false
    const stopping: Tool = {
      name: 'spin',
      async execute() {
        cancelled = true
        throw new Error('the tool blew up on its way out')
      },
    }
    // The executor asks the seam rather than recognizing an abort class of
    // its own, so a worker's cancel — not just the Run's Stop — leaves the
    // round instead of becoming a failed tool result.
    const h = harness([stopping], { stoppedWith: () => (cancelled ? new WorkerCancelled('parent cancelled') : undefined) })

    await expect(h.round([call('spin')])).rejects.toBeInstanceOf(WorkerCancelled)
  })
})

describe('how a round ends (#157/AC2)', () => {
  const sessionReset: ToolRoundConfig['soleCall'] = {
    select: (candidate) => candidate.name === 'new_session',
    notExecuted: 'not executed: this response carried a session reset, but it failed',
  }
  const resetIsTerminal: ToolRoundConfig['terminalResult'] = (candidate, outcome) =>
    outcome.ok && candidate.name === 'new_session'

  it('stops at a terminal result — later siblings never execute and answer nothing', async () => {
    const trace: string[] = []
    const h = harness([scripted('new_session', trace), scripted('spin', trace)], {
      soleCall: sessionReset,
      terminalResult: resetIsTerminal,
      trace,
    })

    const { outcome } = await h.round([call('spin', {}, 'c1'), call('new_session', {}, 'c2'), call('spin', {}, 'c3')])

    expect(outcome.end).toMatchObject({ kind: 'terminal', call: { id: 'c2' } })
    expect(outcome.results.map((result) => result.call.id)).toEqual(['c2'])
    expect(trace).toEqual(['execute:new_session', 'observe:action_outcome:ok'])
  })

  it('answers the suppressed siblings with the uniform notice when the terminal call failed', async () => {
    const failing: Tool = {
      name: 'new_session',
      async execute() {
        throw new Error('reset unavailable')
      },
    }
    const h = harness([failing, scripted('spin', [])], { soleCall: sessionReset, terminalResult: resetIsTerminal })

    const { events, outcome } = await h.round([call('spin', {}, 'c1'), call('new_session', {}, 'c2')])

    expect(outcome.end).toEqual({ kind: 'continue' })
    expect(outcome.results.map((result) => [result.call.id, errorOf(result.outcome), result.observationId])).toEqual([
      ['c2', 'reset unavailable', expect.anything()],
      ['c1', 'not executed: this response carried a session reset, but it failed', null],
    ])
    // The suppressed sibling is answered on the feed too, so the round's
    // events and its results stay one story.
    expect(events.filter((event) => event.type === 'tool_result').map((event) => event.callId)).toEqual(['c2', 'c1'])
  })

  it('ends steered when a Directive lands between two calls', async () => {
    const trace: string[] = []
    const h = harness([scripted('spin', trace)], {
      directives: [undefined, undefined, 'find the other one instead'],
      trace,
    })

    const { outcome } = await h.round([call('spin', {}, 'c1'), call('spin', {}, 'c2')])

    // The first call ran; the Directive landed at the check after it, so
    // the second never began.
    expect(outcome.end).toEqual({ kind: 'steered', directive: 'find the other one instead' })
    expect(outcome.results.map((result) => result.call.id)).toEqual(['c1'])
    expect(trace.filter((entry) => entry === 'execute:spin')).toHaveLength(1)
  })

  it('ends steered before the first call when the Directive is already waiting', async () => {
    const trace: string[] = []
    const h = harness([scripted('spin', trace)], { directives: ['stop doing that'], trace })

    const { events, outcome } = await h.round([call('spin', {}, 'c1')])

    expect(outcome.end).toEqual({ kind: 'steered', directive: 'stop doing that' })
    expect(outcome.results).toEqual([])
    expect(events).toEqual([])
    expect(trace).toEqual([])
  })
})

describe('the epoch’s round protocol (#157/AC2)', () => {
  /** A Finalization round already entered: spending it latches Answer-only. */
  function finalizing(options: Parameters<typeof harness>[1]): Harness {
    const h = harness([scripted('spin', [])], options)
    h.epoch.enterFinalization('budget_exhausted')
    return h
  }
  const spent = { kind: 'answer_only', cause: 'budget_exhausted' }

  it('completes a Tool Round that ran to the end', async () => {
    const h = finalizing({})

    await h.round([call('spin', {}, 'c1')])

    expect(h.epoch.phase).toEqual(spent)
  })

  it('completes a Tool Round a Directive ended mid-round', async () => {
    // Ahead of the caller's steering exit on purpose: a Directive during
    // the bookkeeping round must not reopen tool work.
    const h = finalizing({ directives: [undefined, undefined, 'go elsewhere'] })

    const { outcome } = await h.round([call('spin', {}, 'c1'), call('spin', {}, 'c2')])

    expect(outcome.end).toMatchObject({ kind: 'steered' })
    expect(h.epoch.phase).toEqual(spent)
  })

  it('completes a Tool Round a terminal result ended', async () => {
    const h = finalizing({
      soleCall: { select: (candidate) => candidate.name === 'spin', notExecuted: 'not executed' },
      terminalResult: (_candidate, outcome) => outcome.ok,
    })

    const { outcome } = await h.round([call('spin', {}, 'c1')])

    expect(outcome.end).toMatchObject({ kind: 'terminal' })
    expect(h.epoch.phase).toEqual(spent)
  })
})

describe('interception and Notice eligibility (#157/AC1)', () => {
  it('answers an intercepted call without executing it, and never counts it as useful work', async () => {
    const trace: string[] = []
    const h = harness([scripted('report_run_plan', trace), scripted('spin', trace)], {
      trace,
      intercept: (candidate) => (candidate.name === 'report_run_plan' ? { ok: true, result: 'Run Plan noted.' } : null),
    })
    h.notices.owe('run_plan', 'Report your Run Plan.')

    const { outcome } = await h.round([call('report_run_plan', {}, 'c1'), call('spin', {}, 'c2')])

    // The plan acknowledgement carries no plan nudge; the sibling's real
    // work does.
    expect(resultOf(outcome.results[0]!.outcome)).toBe('Run Plan noted.')
    expect(resultOf(outcome.results[1]!.outcome)).toBe('done\n\nReport your Run Plan.')
    expect(trace.filter((entry) => entry.startsWith('execute:'))).toEqual(['execute:spin'])
  })

  it('returns results aligned with the Observation identities they minted', async () => {
    const h = harness([scripted('spin', [])])

    const { outcome } = await h.round([call('spin', {}, 'c1'), call('spin', {}, 'c2')])

    expect(outcome.results).toHaveLength(2)
    for (const result of outcome.results) expect(result.observationId).not.toBeNull()
    expect(outcome.results[0]!.observationId).not.toBe(outcome.results[1]!.observationId)
  })
})
