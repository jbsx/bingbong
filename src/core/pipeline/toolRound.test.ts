import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { UnstampedEvent } from './events'
import type { RiskVerdict, Tool, ToolAdmission } from './tool'
import type { RunDecisions } from './decisions'
import type { Directive, RunInterrupts } from './interrupts'
import type { SettledPageState } from './progressFingerprints'
import { FakeClock } from '../testing/doubles'
import { createEffortEpoch, finalizationToolRefusal } from './effortEpoch'
import { createNotices } from './notices'
import { createObservationLedger, type ObservationInput } from '../session/observationLedger'
import { BOOKKEEPING_ONLY_NOTICE, createToolRoundExecutor, type ToolRoundCapabilities, type ToolRoundConfig, type ToolRoundOutcome } from './toolRound'
import { composedAddressRewriteLine } from './composedAddressRail'
import { shownTextsOf, unseenPhraseRewriteLine } from './unseenPhraseRail'
import { engineRewriteLine } from './engineRewriteRail'
import { runEngineOf, userWordsOf, WEB_ENGINES } from './webEngine'
import { SEARCH_LOOP_REFUSE_AFTER } from './searchLoopRail'
import type { ToolTraceEvent, VisionTraceIds, VisionTraceReporter } from '../trace/visionTrace'
import { createSessionEvidence } from '../session/sessionEvidence'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { HELD_PAGE_INSTRUCTION } from './heldPage'

// Issue #157: the Tool Round executor's own invariants — the order its
// gated seams run in, and the four ways a round can end. Everything here is
// plain values and a scripted tool catalog: no LLM, no browser, no pipeline.
// What each test pins is a decision the Run loop used to make in comments
// (ADR 0010, ADR 0027), so a reordering here has to fail a test.

function call(name: string, args: Record<string, unknown> = {}, id = `${name}-${JSON.stringify(args)}`): ToolCall {
  return { id, name, args }
}

const ALL_RAILS: ToolRoundCapabilities = { searchLoopRail: true, verificationRail: true, noProgressRail: true, composedAddressRail: true, unseenPhraseRail: true, engineRewriteRail: true, perCallGate: true }

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
  /** The harness's own Observation ledger: what the executor's sight seam reads by default. */
  readonly ledger: ReturnType<typeof createObservationLedger>
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
    /** The visible tab's whole link hrefs (#258): what the Composed Address rail offers from a page. */
    linkHrefs?: ToolRoundConfig['linkHrefs']
    activeWorkDeadlineMs?: number
    /** Whether the Run has anything new to record (#256): what the epoch words its next round by. */
    somethingToRecord?: () => boolean
    visionCalls?: number
    /** The vision seam (#186): what the round's Vision Budget records through. */
    traceVision?: VisionTraceReporter
    /** The turn and Subagent the tool context names — what the seam's records are routed and stamped by. */
    turnId?: string
    agentId?: string
    intercept?: ToolRoundConfig['intercept']
    terminalResult?: ToolRoundConfig['terminalResult']
    soleCall?: ToolRoundConfig['soleCall']
    currentHost?: () => string | null
    /** The verification rail's Session seams (#212). */
    verification?: ToolRoundConfig['verification']
    /** The visible tab's URL (#111, #240). */
    currentPageUrl?: () => string | null
    /** The Session Evidence held from one page (#240). */
    heldObservations?: ToolRoundConfig['heldObservations']
    /** The Unseen Phrase rail's sight (#267): by default the harness ledger's own records, as the Run's is. */
    shownTexts?: ToolRoundConfig['shownTexts']
    /** Snapshot ref facts (#82, #267): how a typed search is told from other typing. */
    describeRef?: ToolRoundConfig['describeRef']
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
    ...(options.somethingToRecord !== undefined ? { somethingToRecord: options.somethingToRecord } : {}),
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
    toolContext: {
      clock,
      ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
      ...(options.traceVision ? { traceVision: options.traceVision } : {}),
    },
    decisions,
    interrupts,
    capabilities: options.capabilities ?? ALL_RAILS,
    ...(options.intercept ? { intercept: options.intercept } : {}),
    ...(options.terminalResult ? { terminalResult: options.terminalResult } : {}),
    ...(options.soleCall ? { soleCall: options.soleCall } : {}),
    ...(options.currentHost ? { currentHost: options.currentHost } : {}),
    ...(options.settledPageState ? { settledPageState: options.settledPageState } : {}),
    ...(options.linkHrefs ? { linkHrefs: options.linkHrefs } : {}),
    ...(options.visionCalls !== undefined ? { visionCalls: options.visionCalls } : {}),
    ...(options.verification ? { verification: options.verification } : {}),
    ...(options.currentPageUrl ? { currentPageUrl: options.currentPageUrl } : {}),
    ...(options.heldObservations ? { heldObservations: options.heldObservations } : {}),
    shownTexts: options.shownTexts ?? (() => shownTextsOf(ledger.snapshot())),
    runEngine: () => runEngineOf(userWordsOf(ledger.snapshot())),
    ...(options.describeRef ? { describeRef: options.describeRef } : {}),
  })
  return {
    ledger,
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
  options: {
    result?: string | (() => string)
    assessRisk?: RiskVerdict
    acquisition?: boolean
    checkpoint?: boolean
    usesVision?: boolean
    admit?: (args: ToolCall['args']) => ToolAdmission | Promise<ToolAdmission>
    /** The tool throws this message instead of returning a result. */
    fails?: string
  } = {},
): Tool {
  return {
    name,
    ...(options.acquisition ? { acquisition: true } : {}),
    ...(options.checkpoint ? { checkpoint: true } : {}),
    ...(options.usesVision ? { usesVision: true } : {}),
    ...(options.admit
      ? {
          admit: (args: ToolCall['args']): ToolAdmission | Promise<ToolAdmission> => {
            trace.push(`admit:${name}`)
            return options.admit!(args)
          },
        }
      : {}),
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
      if (options.fails !== undefined) throw new Error(options.fails)
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
    const capabilities: ToolRoundCapabilities = { searchLoopRail: true, verificationRail: true, noProgressRail: false, composedAddressRail: true, unseenPhraseRail: true, engineRewriteRail: true, perCallGate: true }

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
      capabilities: { searchLoopRail: true, verificationRail: true, noProgressRail: false, composedAddressRail: true, unseenPhraseRail: true, engineRewriteRail: true, perCallGate: true },
    })

    const { outcome } = await h.round(calls)

    expect(resultOf(outcome.results[2]!.outcome)).toMatch(/nothing opened between them/)
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

    // The round the door opened during is not the bookkeeping round (#200,
    // ADR 0036): it ends finalizing, and the round after it is the one the
    // model can checkpoint in. The cause is what the trip decided.
    expect(h.epoch.phase).toEqual({ kind: 'finalizing', cause: 'no_progress' })
    expect(resultOf(outcome.results[4]!.outcome)).toMatch(/second Approach has made no progress/)
    // The sibling after the trip never executed: it met the closed-tool
    // refusal, which carries the Finalize Instruction itself.
    expect(errorOf(outcome.results[5]!.outcome)).toBe(finalizationToolRefusal('no_progress'))
    // One reason per round (#201): the tripping call's rail sentence and
    // every sibling refused after it name the same stop — no sibling
    // claims a spent work budget the run never spent.
    expect(resultOf(outcome.results[4]!.outcome)).not.toContain('work budget is exhausted')
    expect(errorOf(outcome.results[5]!.outcome)).not.toContain('work budget is exhausted')
    expect(errorOf(outcome.results[5]!.outcome)).toContain('made no progress')
    expect(trace.filter((entry) => entry === 'execute:navigate')).toHaveLength(5)
  })

  it('words the refusal for the round that comes next: the bookkeeping round, or the Answer (#256, ADR 0056)', async () => {
    const tripRound = async (somethingToRecord: boolean): Promise<string> => {
      const calls = ['a', 'b', 'c', 'd', 'e'].map((slug) => call('navigate', { url: `https://example.com/${slug}` }))
      const h = harness([scripted('navigate', [], { acquisition: true })], { settledPageState: () => STUCK, somethingToRecord: () => somethingToRecord })
      const { outcome } = await h.round([...calls, call('navigate', { url: 'https://example.com/late' })])
      expect(h.epoch.phase).toEqual({ kind: 'finalizing', cause: 'no_progress' })
      return errorOf(outcome.results[5]!.outcome)
    }

    expect(await tripRound(true)).toBe(finalizationToolRefusal('no_progress'))
    const skipped = await tripRound(false)
    expect(skipped).toBe(finalizationToolRefusal('no_progress', undefined, 'skipped'))
    expect(skipped).toMatch(/no bookkeeping round follows/)
  })

  it('refuses the acquisition siblings after the Blocker trip, on the same wall (#202, ADR 0037)', async () => {
    const trace: string[] = []
    const tools = [
      scripted('read_page', trace, { result: 'BLOCKER:challenge www.reddit.com\nThis page is a Blocker.', acquisition: true }),
      scripted('click', trace, { acquisition: true }),
      scripted('type', trace, { acquisition: true }),
    ]
    const h = harness(tools, {
      currentHost: () => 'www.reddit.com',
      capabilities: { searchLoopRail: true, verificationRail: true, noProgressRail: false, composedAddressRail: true, unseenPhraseRail: true, engineRewriteRail: true, perCallGate: true },
      trace,
    })

    // Round one: the read arms the gate and the click is refused —
    // recoverable, so the round is only the first of the two the trip
    // needs.
    const first = await h.round([call('read_page'), call('click', { ref: 3 })])
    expect(h.epoch.phase).toEqual({ kind: 'working' })
    expect(errorOf(first.outcome.results[1]!.outcome)).not.toMatch(/^Not executed — /)

    // Round two: the same wall again. The first refusal trips.
    const { outcome } = await h.round([call('click', { ref: 3 }), call('type', { text: 'x' })])

    expect(h.epoch.phase).toEqual({
      kind: 'finalizing',
      cause: 'blocker',
      detail: { signal: 'challenge', host: 'www.reddit.com' },
    })
    const tripping = errorOf(outcome.results[0]!.outcome)
    // The tripping refusal is under the eval's runtime-refusal prefix, and
    // names host, flavor, and the Finalize Instruction.
    expect(tripping).toMatch(/^Not executed — /)
    expect(tripping).toContain('www.reddit.com is walled for this run (Blocker: challenge)')
    expect(tripping).toContain('The run kept interacting with www.reddit.com after it was walled')
    expect(tripping).toMatch(/Finalize now/)
    // The sibling after the trip met the closed-tool refusal, and one
    // round reads one reason (#201): it names the same wall.
    const sibling = errorOf(outcome.results[1]!.outcome)
    expect(sibling).toBe(finalizationToolRefusal('blocker', { signal: 'challenge', host: 'www.reddit.com' }))
    expect(sibling).toContain('www.reddit.com')
    expect(sibling).not.toContain('work budget is exhausted')
    expect(sibling).not.toContain('made no progress')
    // Only the wall-detecting read ever executed.
    expect(trace.filter((entry) => entry.startsWith('execute:'))).toEqual(['execute:read_page'])
  })

  it('counts a round of rejected Evidence Checkpoints once — the trip needs a rejection per round (#197)', async () => {
    const trace: string[] = []
    const rejecting: Tool = {
      name: 'record_candidate',
      async execute(callArg) {
        trace.push(`execute:${callArg.name}`)
        throw new Error('record_candidate rejected (malformed): the call is malformed')
      },
    }
    const h = harness([scripted('navigate', trace, { acquisition: true }), rejecting], {
      settledPageState: () => STUCK,
      trace,
    })
    const candidates = (n: number): ToolCall[] =>
      Array.from({ length: n }, (_, index) => call('record_candidate', { subject: `option ${index}` }))

    // The Progress baseline, then four candidates rejected in one round:
    // one no-progress action, not two exhausted Approaches — the run keeps
    // working, and none of the rejections carries an Approach instruction.
    const first = await h.round([call('navigate', { url: 'https://example.com/a' }), ...candidates(4)])
    expect(h.epoch.phase).toEqual({ kind: 'working' })
    for (const result of first.outcome.results.slice(1)) {
      expect(errorOf(result.outcome)).not.toMatch(/approach/i)
    }
    // A rejection per round is what the accounting counts: the second
    // round's exhausts the first Approach, the third's starts the second,
    // and the fourth's trips Finalization. (The rail's instructions ride
    // the next successful result, never the rejection itself — the phase
    // is the mechanical record here.)
    await h.round(candidates(1))
    expect(h.epoch.phase).toEqual({ kind: 'working' })
    await h.round(candidates(1))
    expect(h.epoch.phase).toEqual({ kind: 'working' })
    await h.round(candidates(1))
    expect(h.epoch.phase).toEqual({ kind: 'finalizing', cause: 'no_progress' })
    expect(trace.filter((entry) => entry === 'execute:record_candidate')).toHaveLength(7)
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
    expect(errorOf(outcome.results[1]!.outcome)).toBe(finalizationToolRefusal('deadline_reached'))
    // Finalizing, not Answer-only: a crossing during tool execution gets
    // the same bookkeeping round a crossing during the model call does
    // (#200, ADR 0036).
    expect(h.epoch.phase).toEqual({ kind: 'finalizing', cause: 'deadline_reached', detail: { arm: 'deadline', reason: 'no_rail' } })
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

  // #164: the terminal end is the caller's structural signal, not the
  // model's view of the result. A Notice riding the result belongs in the
  // round (the model reads it); it must never reach the caller welded to
  // the payload the caller routes onward.
  it('carries the raw result on the terminal end while the round still shows the model its Notices', async () => {
    const seen: ToolResultOutcome[] = []
    const h = harness([scripted('new_session', [], { result: 'reset done' })], {
      soleCall: sessionReset,
      terminalResult: (candidate, outcome) => {
        seen.push(outcome)
        return outcome.ok && candidate.name === 'new_session'
      },
    })
    h.notices.owe('run_plan', 'Change your approach.')

    const { events, outcome } = await h.round([call('new_session', {}, 'c2')])

    // The predicate judges the tool's own result, undisturbed.
    expect(seen.map(resultOf)).toEqual(['reset done'])
    expect(outcome.end).toMatchObject({ kind: 'terminal', outcome: { ok: true, result: 'reset done' } })
    // The model-facing views keep the Notice.
    expect(resultOf(outcome.results[0]!.outcome)).toEqual('reset done\n\nChange your approach.')
    expect(events.filter((event) => event.type === 'tool_result')).toMatchObject([
      { result: 'reset done\n\nChange your approach.' },
    ])
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
  /** A Finalization round already entered: beginning it latches Answer-only. */
  function finalizing(options: Parameters<typeof harness>[1]): Harness {
    const h = harness([scripted('spin', [])], options)
    h.epoch.enterFinalization('budget_exhausted')
    return h
  }
  const spent = { kind: 'answer_only', cause: 'budget_exhausted', detail: { arm: 'budget', reason: 'no_rail' } }

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

// The Look's Vision Budget record (#186, ADR 0031). The round spends the
// budget for a `usesVision` tool, so the round records it — the tool only
// ever sees the refusal as a failed call.
describe('the Composed Address rail runs per call (#239, ADR 0050; #255, ADR 0055)', () => {
  const RESULT_HREF = 'https://www.nasa.gov/voyager/golden-record/'

  /** A navigate whose composed slugs under /dead/ land on a Not-found Page, and whose q= searches list one result. */
  function navigateTool(trace: string[]): Tool {
    return {
      name: 'navigate',
      acquisition: true,
      async execute(callArg: ToolCall): Promise<unknown> {
        const url = String(callArg.args.url)
        trace.push(`execute:navigate:${url}`)
        if (url.includes('/dead/')) return `navigated: url=${url} title="Page Not Found - NASA"\nNOT-FOUND:404 www.nasa.gov\nThis address names nothing on nasa.gov.`
        if (url.includes('?q=')) return `navigated: url=${url} title="Search"\n# Search — ${url}\n[1] link "Golden Record" href=${JSON.stringify(RESULT_HREF)}`
        return `navigated: url=${url} title="NASA"\n# NASA — ${url}`
      },
    }
  }
  const executed = (trace: readonly string[]): string[] => trace.filter((entry) => entry.startsWith('execute:'))

  it('rewrites a same-round sibling composed address after the round’s first landing into a search of the site, told first, and trips no Finalization', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace })

    const first = await h.round([
      call('navigate', { url: 'https://www.jpl.nasa.gov/dead/voyager-2013-09' }, 'n1'),
      call('navigate', { url: 'https://science.nasa.gov/voyager-golden-record' }, 'n2'),
    ])

    const search = 'https://duckduckgo.com/?q=voyager%20golden%20record%20site%3Anasa.gov'
    expect(executed(trace)).toEqual(['execute:navigate:https://www.jpl.nasa.gov/dead/voyager-2013-09', `execute:navigate:${search}`])
    const rewritten = first.outcome.results[1]!
    // The model's call keeps its id and the address it wrote; what it reads opens with the rewrite.
    expect(rewritten.call).toEqual(call('navigate', { url: 'https://science.nasa.gov/voyager-golden-record' }, 'n2'))
    expect(resultOf(rewritten.outcome).split('\n').slice(0, 2)).toEqual([
      composedAddressRewriteLine({ site: 'nasa.gov', from: 'https://science.nasa.gov/voyager-golden-record', query: 'voyager golden record site:nasa.gov', url: search, call: rewritten.call }),
      `navigated: url=${search} title="Search"`,
    ])
    // The trace's stamp rides the published result, from the round's own field.
    const published = first.events.filter((event) => event.type === 'tool_result')
    expect(published[1]).toMatchObject({ callId: 'n2', rewritten: { site: 'nasa.gov', query: 'voyager golden record site:nasa.gov' } })
    expect(published[0]).not.toHaveProperty('rewritten')
    expect(h.epoch.phase.kind).toBe('working')
  })

  it('is a search to the Search Loop rail: it continues a streak, is refused at the cap, and opening a shown result escapes', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, noProgressRail: false } })
    await h.round([call('navigate', { url: 'https://www.nasa.gov/dead/voyager' }, 'dead')])
    for (let index = 1; index < SEARCH_LOOP_REFUSE_AFTER; index += 1) {
      await h.round([call('navigate', { url: 'https://duckduckgo.com/?q=voyager+record' }, `s${index}`)])
    }

    const atCap = await h.round([call('navigate', { url: 'https://www.nasa.gov/voyager-record' }, 'r1')])
    const past = await h.round([call('navigate', { url: 'https://www.nasa.gov/voyager/record' }, 'r2')])
    await h.round([call('navigate', { url: RESULT_HREF }, 'open')])
    const escaped = await h.round([call('navigate', { url: 'https://www.nasa.gov/voyager/records' }, 'r3')])

    expect(atCap.outcome.results[0]!.outcome.ok).toBe(true)
    const refused = errorOf(past.outcome.results[0]!.outcome)
    expect(refused.split('\n')[0]).toMatch(/^Rewritten — nasa\.gov already answered not found/)
    expect(refused).toContain('Search loop limit')
    expect(escaped.outcome.results[0]!.outcome.ok).toBe(true)
    // On the Run Engine (#270), and the shown result is no composed address.
    expect(executed(trace).slice(-3)).toEqual([
      'execute:navigate:https://duckduckgo.com/?q=voyager%20record%20site%3Anasa.gov',
      `execute:navigate:${RESULT_HREF}`,
      'execute:navigate:https://duckduckgo.com/?q=voyager%20records%20site%3Anasa.gov',
    ])
  })

  it('offers a result link whole from the caller’s link refs, where the printed href was cut (#258)', async () => {
    const long = `https://science.nasa.gov/missions/voyager-program/${'nasa-voyager-status-update-on-voyager-1-location-'.repeat(4)}`
    const printed = `${long.slice(0, 199)}…`
    /** A navigate whose q= search prints one long result cut at the cap, as the snapshot does. */
    const searchTool = (trace: string[]): Tool => ({
      name: 'navigate',
      acquisition: true,
      async execute(callArg: ToolCall): Promise<unknown> {
        const url = String(callArg.args.url)
        trace.push(`execute:navigate:${url}`)
        if (url.includes('/dead/')) return `navigated: url=${url} title="Page Not Found - NASA"\nNOT-FOUND:404 www.nasa.gov\nThis address names nothing on nasa.gov.`
        if (url.includes('?q=')) return `navigated: url=${url} title="Search"\n# Search — ${url}\n[1] link "Status update" href=${JSON.stringify(printed)}`
        return `navigated: url=${url} title="NASA"\n# NASA — ${url}`
      },
    })
    const script = async (h: Harness) => {
      await h.round([call('navigate', { url: 'https://duckduckgo.com/?q=voyager+status' }, 's')])
      await h.round([call('navigate', { url: 'https://www.jpl.nasa.gov/dead/voyager-2013-09' }, 'dead')])
      await h.round([call('navigate', { url: long }, 'open')])
    }

    // With the seam, the whole address the result carried is no composed address.
    const withRefs: string[] = []
    let reads = 0
    await script(
      harness([searchTool(withRefs)], {
        trace: withRefs,
        linkHrefs: async () => {
          reads += 1
          return [long]
        },
      }),
    )
    expect(executed(withRefs).at(-1)).toBe(`execute:navigate:${long}`)
    // Read once per successful page-facing call.
    expect(reads).toBe(3)

    // Without it the rail reads the printed text, where the link was cut, and the navigate is rewritten.
    const printedOnly: string[] = []
    await script(harness([searchTool(printedOnly)], { trace: printedOnly }))
    expect(executed(printedOnly).at(-1)).toMatch(/^execute:navigate:https:\/\/duckduckgo\.com\/\?q=.*site%3Anasa\.gov$/)

    // A seam that throws or cannot read the page hands nothing, and the text stands in.
    const unread: string[] = []
    await script(harness([searchTool(unread)], { trace: unread, linkHrefs: async () => null }))
    expect(executed(unread).at(-1)).toMatch(/^execute:navigate:https:\/\/duckduckgo\.com/)
    const throwing: string[] = []
    await script(
      harness([searchTool(throwing)], {
        trace: throwing,
        linkHrefs: async () => {
          throw new Error('registry died')
        },
      }),
    )
    expect(executed(throwing).at(-1)).toMatch(/^execute:navigate:https:\/\/duckduckgo\.com/)
  })

  it('starts a new executor — a new Run — at zero', async () => {
    const trace: string[] = []
    const spent = harness([navigateTool(trace)], { trace })
    await spent.round([call('navigate', { url: 'https://www.jpl.nasa.gov/dead/a' }, 'n1')])
    await spent.round([call('navigate', { url: 'https://www.jpl.nasa.gov/dead/b' }, 'n2')])

    const fresh = harness([navigateTool(trace)], { trace })
    await fresh.round([call('navigate', { url: 'https://www.jpl.nasa.gov/dead/b' }, 'n3')])

    expect(executed(trace)).toEqual([
      'execute:navigate:https://www.jpl.nasa.gov/dead/a',
      'execute:navigate:https://duckduckgo.com/?q=dead%20b%20site%3Anasa.gov',
      'execute:navigate:https://www.jpl.nasa.gov/dead/b',
    ])
  })

  it('is off without the capability', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, composedAddressRail: false } })

    await h.round([
      call('navigate', { url: 'https://www.jpl.nasa.gov/dead/a' }, 'n1'),
      call('navigate', { url: 'https://www.jpl.nasa.gov/dead/b' }, 'n2'),
    ])

    expect(trace.filter((entry) => entry.startsWith('execute:'))).toHaveLength(2)
  })
})

describe('vision budget records', () => {
  function reporter(): { traceVision: VisionTraceReporter; reported: ToolTraceEvent[] } {
    const reported: ToolTraceEvent[] = []
    return { traceVision: (event) => reported.push(event), reported }
  }

  it('records the grant the round spent on a Look', async () => {
    const { traceVision, reported } = reporter()
    const h = harness([scripted('look', [], { usesVision: true })], { traceVision, visionCalls: 2 })
    await h.round([{ id: 'c1', name: 'look', args: {} }])
    expect(reported).toEqual([{ kind: 'vision_budget', reason: 'look', granted: true }])
  })

  it('records the refusal that stopped a Look, with the reason the model was given', async () => {
    const { traceVision, reported } = reporter()
    const h = harness([scripted('look', [], { usesVision: true })], { traceVision, visionCalls: 1 })
    await h.round([
      { id: 'c1', name: 'look', args: {} },
      { id: 'c2', name: 'look', args: {} },
    ])
    expect(reported).toEqual([
      { kind: 'vision_budget', reason: 'look', granted: true },
      { kind: 'vision_budget', reason: 'look', granted: false, refusal: expect.stringMatching(/vision call limit/) },
    ])
  })
})

// The Search Observation record (#243, ADR 0049). The rail decides what it
// observed; the round records it through the tool context's seam, beside the
// call's result, so the Round Audit reads the rail instead of replaying it.
describe('search observation records', () => {
  function reporter(): { traceVision: VisionTraceReporter; reported: { event: ToolTraceEvent; ids: VisionTraceIds | undefined }[] } {
    const reported: { event: ToolTraceEvent; ids: VisionTraceIds | undefined }[] = []
    return { traceVision: (event, ids) => reported.push({ event, ids }), reported }
  }
  const SEARCH = 'https://duckduckgo.com/?q=harrison+longitude+watch'

  it('records one observation for a search, joined by the call id and stamped with the turn, and none for a read', async () => {
    const { traceVision, reported } = reporter()
    const h = harness([scripted('navigate', []), scripted('read_page', [])], { traceVision, turnId: 'turn-1' })
    await h.round([call('navigate', { url: SEARCH }, 'c1'), call('read_page', {}, 'c2')])
    expect(reported).toEqual([
      {
        event: { kind: 'search_observation', callId: 'c1', name: 'navigate', query: 'harrison longitude watch', signature: 'url', streak: 1 },
        ids: { turnId: 'turn-1' },
      },
    ])
  })

  it('stamps a Browse Subagent’s observation with its agent id', async () => {
    const { traceVision, reported } = reporter()
    const h = harness([scripted('navigate', [])], { traceVision, turnId: 'turn-1', agentId: 'agent-3' })
    await h.round([call('navigate', { url: SEARCH }, 'c1'), call('navigate', { url: `${SEARCH}+catalogue` }, 'c2')])
    expect(reported.map(({ event }) => event)).toEqual([
      { kind: 'search_observation', callId: 'c1', name: 'navigate', query: 'harrison longitude watch', signature: 'url', streak: 1, agentId: 'agent-3' },
      { kind: 'search_observation', callId: 'c2', name: 'navigate', query: 'harrison longitude watch catalogue', signature: 'url', streak: 2, agentId: 'agent-3' },
    ])
  })

  it('records nothing when the tool context names no turn — the record is the Run Trace’s, never the Host Trace’s', async () => {
    const { traceVision, reported } = reporter()
    const h = harness([scripted('navigate', [])], { traceVision })
    await h.round([call('navigate', { url: SEARCH }, 'c1')])
    expect(reported).toEqual([])
  })

  it('records nothing without the search-loop rail', async () => {
    const { traceVision, reported } = reporter()
    const h = harness([scripted('navigate', [])], { traceVision, turnId: 'turn-1', capabilities: { ...ALL_RAILS, searchLoopRail: false } })
    await h.round([call('navigate', { url: SEARCH }, 'c1')])
    expect(reported).toEqual([])
  })
})

describe('the Unseen Phrase rewrite (#267, ADR 0064)', () => {
  const RESULT_HREF = 'https://science.nasa.gov/mission/voyager/interstellar'
  /** A navigate whose pages print a phrase, whose q= searches list one result, and whose /timeout/ addresses fail naming another. */
  function navigateTool(trace: string[]): Tool {
    return {
      name: 'navigate',
      acquisition: true,
      async execute(callArg: ToolCall): Promise<unknown> {
        const url = String(callArg.args.url)
        trace.push(`execute:navigate:${url}`)
        if (url.includes('/timeout/')) throw new Error('navigate failed: "Voyager 1 Enters Interstellar Space" timed out loading')
        if (url.includes('?q=')) return `navigated: url=${url} title="Search"\n# Search — ${url}\n[1] link "Interstellar" href=${JSON.stringify(RESULT_HREF)}`
        if (url.includes('/dead/')) return `navigated: url=${url} title="Page Not Found - NASA"\nNOT-FOUND:404 www.nasa.gov\nThis address names nothing on nasa.gov.`
        return `navigated: url=${url} title="Voyager"\n# Voyager — ${url}\npage text:\nNASA confirmed on September 12 that Voyager 1 Has Left the Solar System.`
      },
    }
  }
  const executed = (trace: readonly string[]): string[] => trace.filter((entry) => entry.startsWith('execute:'))
  const SEEN = 'https://duckduckgo.com/?q=%22Has+Left+the+Solar+System%22+NASA'
  const UNSEEN = 'https://duckduckgo.com/?q=%22Has+Not+Yet+Left+the+Solar+System%22+NASA+June+2013'
  const UNQUOTED = 'https://duckduckgo.com/?q=Has+Not+Yet+Left+the+Solar+System+NASA+June+2013'

  it('runs a search quoting a shown phrase unchanged, and one quoting an unseen phrase unquoted: the rewritten call is what executes and the rails observe, told first, stamped on the event', async () => {
    const trace: string[] = []
    const observations: ToolTraceEvent[] = []
    const h = harness([navigateTool(trace)], { trace, turnId: 'turn-1', traceVision: (event) => observations.push(event) })
    await h.round([call('navigate', { url: 'https://science.nasa.gov/voyager' }, 'open')])

    const round = await h.round([call('navigate', { url: SEEN }, 'seen'), call('navigate', { url: UNSEEN }, 'unseen')])

    expect(executed(trace)).toEqual(['execute:navigate:https://science.nasa.gov/voyager', `execute:navigate:${SEEN}`, `execute:navigate:${UNQUOTED}`])
    const [seen, unseen] = round.outcome.results
    expect(seen!.outcome.ok).toBe(true)
    expect(resultOf(seen!.outcome)).not.toMatch(/^Rewritten/)
    // The model's call keeps its id and the terms it wrote; what it reads opens with the head, then the search's own outcome.
    expect(unseen!.call).toEqual(call('navigate', { url: UNSEEN }, 'unseen'))
    const rewrite = { phrases: ['Has Not Yet Left the Solar System'], query: 'Has Not Yet Left the Solar System NASA June 2013', call: call('navigate', { url: UNQUOTED }, 'unseen') }
    expect(resultOf(unseen!.outcome).split('\n').slice(0, 2)).toEqual([unseenPhraseRewriteLine(rewrite), `navigated: url=${UNQUOTED} title="Search"`])
    // The ledger holds the raw outcome: the head never enters it.
    expect(String(h.observed.at(-1)!.payload)).not.toMatch(/^Rewritten/)
    // The stamp rides the published result from the round's own field.
    const published = round.events.filter((event) => event.type === 'tool_result')
    expect(published[1]).toMatchObject({ callId: 'unseen', unquoted: { phrases: ['Has Not Yet Left the Solar System'], query: 'Has Not Yet Left the Solar System NASA June 2013' } })
    expect(published[0]).not.toHaveProperty('unquoted')
    expect(published[1]).not.toHaveProperty('rewritten')
    // The Search Loop rail observed the search that ran: its query is the unquoted one.
    const searches = observations.filter((event) => event.kind === 'search_observation') as { callId: string; query: string }[]
    expect(searches.map((event) => [event.callId, event.query])).toEqual([
      ['seen', '"Has Left the Solar System" NASA'],
      ['unseen', 'Has Not Yet Left the Solar System NASA June 2013'],
    ])
    expect(h.epoch.phase.kind).toBe('working')
  })

  it('counts a failed outcome’s text as shown, and a phrase seen after a rewrite keeps its quotes next time', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace })
    const first = await h.round([call('navigate', { url: 'https://duckduckgo.com/?q=%22Enters+Interstellar+Space%22' }, 's1')])
    expect(first.events.filter((event) => event.type === 'tool_result')[0]).toMatchObject({ unquoted: { phrases: ['Enters Interstellar Space'] } })

    await h.round([call('navigate', { url: 'https://science.nasa.gov/timeout/voyager' }, 'fail')])
    const second = await h.round([call('navigate', { url: 'https://duckduckgo.com/?q=%22Enters+Interstellar+Space%22' }, 's2')])

    expect(second.events.filter((event) => event.type === 'tool_result')[0]).not.toHaveProperty('unquoted')
    expect(executed(trace).at(-1)).toBe('execute:navigate:https://duckduckgo.com/?q=%22Enters+Interstellar+Space%22')
  })

  it('judges a Composed Address rewritten into a search as that search, and puts the address line ahead of the head when both fire', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, noProgressRail: false } })
    await h.round([call('navigate', { url: 'https://www.nasa.gov/dead/voyager' }, 'dead')])
    // The site's allowance is spent: a composed address runs as a site search, whose terms carry no span — so no head.
    const composed = await h.round([call('navigate', { url: 'https://www.nasa.gov/voyager-record' }, 'r1')])
    const published = composed.events.filter((event) => event.type === 'tool_result')[0]!
    expect(published).toMatchObject({ rewritten: { site: 'nasa.gov', query: 'voyager record site:nasa.gov' } })
    expect(published).not.toHaveProperty('unquoted')
    expect(executed(trace).at(-1)).toBe('execute:navigate:https://duckduckgo.com/?q=voyager%20record%20site%3Anasa.gov')
  })

  it('rewrites a typed search into a search box the same way, keeping its submit newline, and never other typing', async () => {
    const trace: string[] = []
    const typeTool: Tool = {
      name: 'type',
      acquisition: true,
      async execute(callArg: ToolCall): Promise<unknown> {
        trace.push(`execute:type:${JSON.stringify(callArg.args.text)}`)
        return `typed into [${callArg.args.ref}]`
      },
    }
    const h = harness([typeTool], {
      trace,
      capabilities: { ...ALL_RAILS, noProgressRail: false },
      describeRef: async (ref) => (ref === 1 ? { ref: 1, kind: 'input', role: 'searchbox', label: 'Search', inputType: 'search' } : { ref: 2, kind: 'input', role: 'textbox', label: 'Name', inputType: 'text' }) as never,
    })

    const round = await h.round([call('type', { ref: 1, text: '"Kurth plasma" Voyager\n' }, 't1'), call('type', { ref: 2, text: '"Kurth plasma"\n' }, 't2')])

    expect(executed(trace)).toEqual(['execute:type:"Kurth plasma Voyager\\n"', 'execute:type:"\\"Kurth plasma\\"\\n"'])
    const published = round.events.filter((event) => event.type === 'tool_result')
    expect(published[0]).toMatchObject({ unquoted: { phrases: ['Kurth plasma'], query: 'Kurth plasma Voyager' } })
    expect(published[1]).not.toHaveProperty('unquoted')
  })

  it('runs nothing of the rail when its flag is off', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, unseenPhraseRail: false } })
    const round = await h.round([call('navigate', { url: UNSEEN }, 'unseen')])
    expect(executed(trace)).toEqual([`execute:navigate:${UNSEEN}`])
    expect(round.events.filter((event) => event.type === 'tool_result')[0]).not.toHaveProperty('unquoted')
  })
})

describe('the Engine Rewrite (#270, ADR 0067)', () => {
  function navigateTool(trace: string[]): Tool {
    return {
      name: 'navigate',
      acquisition: true,
      async execute(callArg: ToolCall): Promise<unknown> {
        const url = String(callArg.args.url)
        trace.push(`execute:navigate:${url}`)
        if (url.includes('/dead/')) return `navigated: url=${url} title="Page Not Found - NASA"\nNOT-FOUND:404 www.nasa.gov\nThis address names nothing on nasa.gov.`
        return `navigated: url=${url} title="Search"\n# Search — ${url}\n[1] link "Voyager" href="https://science.nasa.gov/voyager"`
      },
    }
  }
  const executed = (trace: readonly string[]): string[] => trace.filter((entry) => entry.startsWith('execute:'))
  const results = (round: { events: UnstampedEvent[] }) => round.events.filter((event) => event.type === 'tool_result')
  const GOOGLE = 'https://www.google.com/search?q=voyager+heliopause&hl=en'
  const ON_DDG = 'https://duckduckgo.com/?q=voyager%20heliopause'

  it('runs a Google search as the Run Engine’s: the rewritten call executes and the rails observe it, told first, stamped on the event', async () => {
    const trace: string[] = []
    const observations: ToolTraceEvent[] = []
    const h = harness([navigateTool(trace)], { trace, turnId: 'turn-1', traceVision: (event) => observations.push(event) })

    const round = await h.round([call('navigate', { url: GOOGLE }, 'g')])

    expect(executed(trace)).toEqual([`execute:navigate:${ON_DDG}`])
    const [result] = round.outcome.results
    expect(result!.call).toEqual(call('navigate', { url: GOOGLE }, 'g'))
    const rewrite = { from: WEB_ENGINES[0]!, to: WEB_ENGINES[2]!, query: 'voyager heliopause', call: call('navigate', { url: ON_DDG }, 'g') }
    expect(resultOf(result!.outcome).split('\n').slice(0, 2)).toEqual([engineRewriteLine(rewrite), `navigated: url=${ON_DDG} title="Search"`])
    // The ledger holds the raw outcome: the line never enters it.
    expect(String(h.observed.at(-1)!.payload)).not.toMatch(/^Rewritten/)
    expect(results(round)[0]).toMatchObject({ callId: 'g', engineRewrite: { from: 'google', to: 'duckduckgo', query: 'voyager heliopause' } })
    expect(results(round)[0]).not.toHaveProperty('rewritten')
    expect(results(round)[0]).not.toHaveProperty('unquoted')
    const searches = observations.filter((event) => event.kind === 'search_observation') as { callId: string; query: string }[]
    expect(searches.map((event) => [event.callId, event.query])).toEqual([['g', 'voyager heliopause']])
  })

  it('leaves a DuckDuckGo search and a site’s own search alone', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, noProgressRail: false } })
    const round = await h.round([call('navigate', { url: 'https://html.duckduckgo.com/html/?q=voyager' }, 'd'), call('navigate', { url: 'https://www.rmg.co.uk/search?q=longitude' }, 's')])
    expect(executed(trace)).toEqual(['execute:navigate:https://html.duckduckgo.com/html/?q=voyager', 'execute:navigate:https://www.rmg.co.uk/search?q=longitude'])
    for (const published of results(round)) expect(published).not.toHaveProperty('engineRewrite')
  })

  it('honours an engine the user named in the command: its search runs as written and plain terms move onto it', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, noProgressRail: false } })
    h.ledger.record({ producer: 'command', ok: true, payload: 'search google for the Voyager heliopause crossing' })

    const round = await h.round([call('navigate', { url: GOOGLE }, 'g'), call('navigate', { url: 'voyager heliopause' }, 'plain')])

    expect(executed(trace)).toEqual([`execute:navigate:${GOOGLE}`, 'execute:navigate:https://www.google.com/search?q=voyager+heliopause'])
    expect(results(round)[0]).not.toHaveProperty('engineRewrite')
    expect(results(round)[1]).toMatchObject({ engineRewrite: { from: 'duckduckgo', to: 'google' } })
  })

  it('honours an engine a Steering directive named, from the next search on', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, noProgressRail: false } })
    h.ledger.record({ producer: 'command', ok: true, payload: 'when did Voyager 1 cross the heliopause' })
    const before = await h.round([call('navigate', { url: 'https://www.bing.com/search?q=voyager' }, 'b1')])
    h.ledger.record({ producer: 'steering', ok: true, payload: 'use bing for this' })
    const after = await h.round([call('navigate', { url: 'https://www.bing.com/search?q=voyager' }, 'b2')])

    expect(results(before)[0]).toMatchObject({ engineRewrite: { from: 'bing', to: 'duckduckgo' } })
    expect(results(after)[0]).not.toHaveProperty('engineRewrite')
    expect(executed(trace)).toEqual(['execute:navigate:https://duckduckgo.com/?q=voyager', 'execute:navigate:https://www.bing.com/search?q=voyager'])
  })

  it('composes the Composed Address rewrite on the Run Engine the user named', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, noProgressRail: false } })
    h.ledger.record({ producer: 'command', ok: true, payload: 'find it on Bing' })
    // No search has run: the rewrite composes on the Run Engine, not on an engine the Run last searched with.
    await h.round([call('navigate', { url: 'https://www.nasa.gov/dead/voyager' }, 'dead')])

    const round = await h.round([call('navigate', { url: 'https://www.nasa.gov/voyager-record' }, 'r1')])

    expect(results(round)[0]).toMatchObject({ rewritten: { site: 'nasa.gov', query: 'voyager record site:nasa.gov' } })
    expect(results(round)[0]).not.toHaveProperty('engineRewrite')
    expect(executed(trace).at(-1)).toBe('execute:navigate:https://www.bing.com/search?q=voyager+record+site%3Anasa.gov')
  })

  it('judges an Unseen Phrase on the rewritten search, and two rewrites on one call read as two lines, engine first', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, noProgressRail: false } })

    const round = await h.round([call('navigate', { url: 'https://www.google.com/search?q=%22Has+Not+Yet+Left%22+voyager' }, 'both')])

    expect(executed(trace)).toEqual(['execute:navigate:https://duckduckgo.com/?q=Has+Not+Yet+Left+voyager'])
    expect(results(round)[0]).toMatchObject({
      engineRewrite: { from: 'google', to: 'duckduckgo', query: '"Has Not Yet Left" voyager' },
      unquoted: { phrases: ['Has Not Yet Left'], query: 'Has Not Yet Left voyager' },
    })
    const lines = resultOf(round.outcome.results[0]!.outcome).split('\n')
    expect(lines[0]).toMatch(/^Rewritten — this run searches on DuckDuckGo, so the Google search ran there/)
    expect(lines[1]).toMatch(/^Rewritten — "Has Not Yet Left" appears in nothing this run was shown/)
    expect(lines[2]).toBe('navigated: url=https://duckduckgo.com/?q=Has+Not+Yet+Left+voyager title="Search"')
  })

  it('runs nothing of the rail when its flag is off', async () => {
    const trace: string[] = []
    const h = harness([navigateTool(trace)], { trace, capabilities: { ...ALL_RAILS, engineRewriteRail: false } })
    const round = await h.round([call('navigate', { url: GOOGLE }, 'g')])
    expect(executed(trace)).toEqual([`execute:navigate:${GOOGLE}`])
    expect(results(round)[0]).not.toHaveProperty('engineRewrite')
  })
})

describe('the verification gate sits ahead of the Vision Budget (#212, ADR 0041)', () => {
  const capabilities: ToolRoundCapabilities = {
    searchLoopRail: false,
    verificationRail: true,
    noProgressRail: false,
    composedAddressRail: false,
    unseenPhraseRail: false,
    engineRewriteRail: false,
    perCallGate: true,
  }

  it('refuses a spent route without charging the budget for a check it will not make', async () => {
    // One vision call in the budget, and a Session that already watched
    // this route fail with nothing left to settle. If the order were the
    // other way round, the refused call would eat the only grant and a
    // later legitimate Look would be told the budget was gone — a second,
    // wrong reason for a stop.
    const h = harness([scripted('look', [], { usesVision: true })], {
      capabilities,
      visionCalls: 1,
      verification: {
        retainedFailures: () => [
          { route: 'vision', failure: 'timed out', objectiveId: undefined, runId: 'run-1' as never, failedAt: 0 },
        ],
        eligibleCandidates: () => [],
        heldCandidates: () => 2,
      },
    })

    const outcome = await h.round([call('look', {})])
    const error = errorOf(outcome.outcome.results[0]!.outcome)
    expect(error).toContain('already failed for this objective')
    // The budget's own refusal never appears, because the budget was
    // never asked.
    expect(error).not.toMatch(/vision budget|no vision calls/i)
  })

  it('does not spend a route on a call the budget itself refused', async () => {
    // The reverse direction: an exhausted budget refuses the call before
    // the tool runs, and that refusal is ours — so it must not be
    // retained as what the route reported.
    const spent: unknown[] = []
    const h = harness([scripted('look', [], { usesVision: true })], {
      capabilities,
      visionCalls: 0,
      verification: { retainFailure: (failure) => spent.push(failure) },
    })

    const outcome = await h.round([call('look', {})])
    expect(outcome.outcome.results[0]!.outcome.ok).toBe(false)
    expect(spent).toEqual([])
  })
})

// The Baseline's nine spent-route refusals (#236, ADR 0046): a Look whose
// region `look` refused from inside execute counted as an attempted call,
// so the verification rail spent the vision route on our own sentence for
// the rest of the Run. An admission step refuses the arguments ahead of
// the charge and the attempted mark.
describe('an argument refusal is not a Vision Attempt (#236, ADR 0046)', () => {
  const capabilities: ToolRoundCapabilities = {
    searchLoopRail: false,
    verificationRail: true,
    noProgressRail: false,
    composedAddressRail: false,
    unseenPhraseRail: false,
    engineRewriteRail: false,
    perCallGate: true,
  }
  const MALFORMED = `look: 'region' must be "left,top,width,height"`
  const malformed = call('look', { question: 'Which titles are in the top row?', region: 'top' })
  const wellFormed = call('look', { question: 'Which titles are in the top row?', region: '0,0,100,25' })

  /**
   * A Look that refuses a malformed region in admission and — as `look`
   * does, reading its own arguments — in execute too, so a round that
   * skipped admission would see a failed attempt.
   */
  function look(trace: string[], options: { assessRisk?: RiskVerdict } = {}): Tool {
    const admit = (args: ToolCall['args']): ToolAdmission =>
      args.region === 'top' ? { ok: false, reason: MALFORMED } : { ok: true }
    const tool = scripted('look', trace, { usesVision: true, admit, ...options })
    return {
      ...tool,
      async execute(callArg, context) {
        const admission = admit(callArg.args)
        if (!admission.ok) throw new Error(admission.reason)
        return tool.execute(callArg, context)
      },
    }
  }

  it('spends no budget and no route, so the next well-formed Look passes the rail and runs', async () => {
    const trace: string[] = []
    const spent: unknown[] = []
    const reported: ToolTraceEvent[] = []
    // A Vision Budget of one: had the refused call been charged, the
    // well-formed Look would be refused for the budget instead.
    const h = harness([look(trace)], {
      capabilities,
      trace,
      visionCalls: 1,
      traceVision: (event) => reported.push(event),
      verification: { retainFailure: (failure) => spent.push(failure) },
    })

    const { outcome } = await h.round([malformed, wellFormed])

    expect(errorOf(outcome.results[0]!.outcome)).toBe(MALFORMED)
    expect(resultOf(outcome.results[1]!.outcome)).toBe('done')
    expect(trace.filter((entry) => entry.startsWith('execute:'))).toEqual(['execute:look'])
    expect(reported).toEqual([{ kind: 'vision_budget', reason: 'look', granted: true }])
    expect(spent).toEqual([])
  })

  it('runs admission after the risk gate and before the Vision Budget', async () => {
    const trace: string[] = []
    const reported: ToolTraceEvent[] = []
    // No budget at all: a budget charged ahead of admission would answer
    // with its own refusal, and record it.
    const h = harness([look(trace, { assessRisk: { kind: 'confirm', prompt: 'Look at the page?' } })], {
      capabilities,
      trace,
      visionCalls: 0,
      traceVision: (event) => reported.push(event),
    })

    const { outcome } = await h.round([malformed])

    expect(trace.filter((entry) => !entry.startsWith('observe:'))).toEqual([
      'assess:look',
      'confirm:Look at the page?',
      'admit:look',
    ])
    expect(errorOf(outcome.results[0]!.outcome)).toBe(MALFORMED)
    expect(reported).toEqual([])
  })

  it('runs admission after the no-progress rail — a repeat is refused as a repeat, whatever the arguments', async () => {
    const trace: string[] = []
    // Admits the first call and refuses the second — the same call the
    // no-progress rail refuses as the same inspection of unchanged state,
    // so whichever gate runs first is the one that answers.
    let admissions = 0
    const tool = scripted('look', trace, {
      usesVision: true,
      admit: () => (++admissions <= 1 ? { ok: true } : { ok: false, reason: MALFORMED }),
    })
    const h = harness([tool], { capabilities: { ...capabilities, noProgressRail: true }, settledPageState: () => STUCK, trace })

    await h.round([wellFormed])
    const { outcome } = await h.round([wellFormed])

    expect(errorOf(outcome.results[0]!.outcome)).toMatch(/Not executed/)
    expect(trace.filter((entry) => entry === 'admit:look')).toHaveLength(1)
  })

  it('awaits an admission that asks the page — its refusal still executes nothing (#235)', async () => {
    const trace: string[] = []
    const PAST_THE_END = "read_page: part 4 is past the end — this page's text has 3 parts, part=1 to part=3"
    const tool = scripted('read_page', trace, {
      admit: async () => {
        await Promise.resolve()
        return { ok: false, reason: PAST_THE_END }
      },
    })
    const h = harness([tool], { capabilities, trace })

    const { outcome } = await h.round([call('read_page', { part: 4 })])

    expect(errorOf(outcome.results[0]!.outcome)).toBe(PAST_THE_END)
    expect(trace).toContain('admit:read_page')
    expect(trace).not.toContain('execute:read_page')
  })

  it('runs admission after the verification rail — a spent route is refused as spent, whatever the arguments', async () => {
    const trace: string[] = []
    const h = harness([look(trace)], {
      capabilities,
      trace,
      verification: {
        retainedFailures: () => [
          { route: 'vision', failure: 'timed out', objectiveId: undefined, runId: 'run-1' as never, failedAt: 0 },
        ],
        eligibleCandidates: () => [],
        heldCandidates: () => 2,
      },
    })

    const { outcome } = await h.round([malformed])

    expect(errorOf(outcome.results[0]!.outcome)).toContain('already failed for this objective')
    expect(trace).not.toContain('admit:look')
  })
})

describe('the Held Page Notice rides the landing on a page the Session holds, and nothing after it (#240, ADR 0051)', () => {
  const HELD = 'https://rail.example/luggage'
  const OTHER = 'https://rail.example/bikes'
  const HELD_TEXT = 'Standard fare: two cases and one bag.'

  /**
   * A tab the scripted browser moves: a call lands where its `lands`, `url`
   * or `to` argument says, and a call naming none stays on the page. The
   * Session holds one web Observation from HELD unless told otherwise.
   */
  function browsing(options: { held?: readonly string[]; failing?: string; noProgress?: boolean } = {}) {
    const tab = { url: 'https://search.example/?q=luggage' }
    let minted = 0
    const store = createSessionEvidence({ sessionId: 'session-1' as SessionId, now: () => 0, mintId: () => `memory-${++minted}` as MemoryEntryId })
    for (const text of options.held ?? [HELD_TEXT]) {
      store.checkpointObservation({ sourceKind: 'web', text, references: [{ url: HELD }], runId: 'run-0' as RunId })
    }
    const tools = ['navigate', 'click', 'back', 'go_forward', 'read_page', 'scroll', 'look'].map(
      (name): Tool => ({
        name,
        async execute(callArg) {
          const landed = callArg.args.lands ?? callArg.args.url ?? callArg.args.to
          if (typeof landed === 'string') tab.url = landed
          if (options.failing === name) throw new Error(`${name} failed`)
          return `${name} done`
        },
      }),
    )
    const h = harness(tools, {
      capabilities: { ...ALL_RAILS, noProgressRail: options.noProgress === true },
      currentPageUrl: () => tab.url,
      heldObservations: (url) => store.heldObservations(url),
      ...(options.noProgress === true ? { settledPageState: () => STUCK } : {}),
    })
    return { h, store, tab }
  }

  const carries = (outcome: ToolResultOutcome): boolean =>
    outcome.ok && typeof outcome.result === 'string' && outcome.result.includes(HELD_PAGE_INSTRUCTION)

  it('rides navigate, click, back and go_forward landing on a Held Page, once per landing — not the read, scroll or Look after (AC2)', async () => {
    const { h } = browsing()

    const { outcome } = await h.round([
      call('navigate', { url: HELD }),
      call('read_page'),
      call('scroll', { direction: 'down' }),
      call('look', { question: 'where is Premier?' }),
      call('click', { ref: 3 }),
      call('navigate', { url: OTHER }),
      call('back', { to: HELD }),
      call('go_forward', { to: OTHER }),
      call('click', { ref: 4, to: `${HELD}/#premier` }),
    ])

    expect(outcome.results.map((result) => carries(result.outcome))).toEqual([true, false, false, false, false, false, true, false, true])
    expect(resultOf(outcome.results[0]!.outcome)).toBe(
      ['navigate done', '', 'Session Evidence already holds 1 Observation from this page:', `memory-1: ${HELD_TEXT}`, HELD_PAGE_INSTRUCTION].join('\n'),
    )
    // The ledger keeps the raw outcome: a later checkpoint grounds in what the page said.
    expect(h.observed[0]).toEqual({ producer: 'action_outcome', ok: true, payload: 'navigate done', sourceUrl: HELD })
  })

  it('judges the landed URL, not the requested one — a redirect onto a Held Page is a landing on it (AC1)', async () => {
    const { h } = browsing()

    const { outcome } = await h.round([
      call('navigate', { url: 'https://rail.example/old-luggage', lands: HELD }),
      call('navigate', { url: OTHER }),
      call('navigate', { url: HELD, lands: 'https://rail.example/moved' }),
    ])

    expect(outcome.results.map((result) => carries(result.outcome))).toEqual([true, false, false])
  })

  it('tells a Run whose tab already sits on a Held Page on its first result there, and not again on a reload (Decision 2)', async () => {
    const { h, tab } = browsing()
    tab.url = HELD

    const { outcome } = await h.round([call('navigate', { url: HELD }), call('read_page'), call('navigate', { url: `${HELD}#top` })])

    expect(outcome.results.map((result) => carries(result.outcome))).toEqual([true, false, false])
  })

  it('never rides a failed result — the next success on the page carries it — and a page the Session holds nothing from carries nothing (AC2)', async () => {
    const failing = browsing({ failing: 'navigate' })
    const failed = await failing.h.round([call('navigate', { url: HELD }), call('read_page'), call('scroll', { direction: 'down' })])
    expect(failed.outcome.results[0]!.outcome).toEqual({ ok: false, error: 'navigate failed' })
    // The page did load: a failed result is no landing, so the Run is told
    // on its first success there instead, and only then.
    expect(failed.outcome.results.slice(1).map((result) => carries(result.outcome))).toEqual([true, false])

    const empty = browsing({ held: [] })
    const nothing = await empty.h.round([call('navigate', { url: HELD })])
    expect(resultOf(nothing.outcome.results[0]!.outcome)).toBe('navigate done')
  })

  it('rides after a no-progress Notice when one result carries both (AC2)', async () => {
    const { h } = browsing({ noProgress: true })

    // The page state never moves, so the third distinct action exhausts an
    // Approach — and it is the one that lands on the Held Page.
    const { outcome } = await h.round([
      call('navigate', { url: 'https://rail.example/a' }),
      call('navigate', { url: 'https://rail.example/b' }),
      call('navigate', { url: HELD }),
    ])

    const text = resultOf(outcome.results[2]!.outcome)
    expect(text).toContain('Change your Approach')
    expect(text.indexOf('Change your Approach')).toBeLessThan(text.indexOf('Session Evidence already holds'))
    expect(text.endsWith(HELD_PAGE_INSTRUCTION)).toBe(true)
  })

  it('attaches nothing without the Session seam', async () => {
    const tab = { url: 'https://search.example/' }
    const navigate: Tool = {
      name: 'navigate',
      async execute(callArg) {
        tab.url = String(callArg.args.url)
        return 'navigate done'
      },
    }
    const h = harness([navigate], { currentPageUrl: () => tab.url })
    const { outcome } = await h.round([call('navigate', { url: HELD })])
    expect(resultOf(outcome.results[0]!.outcome)).toBe('navigate done')
  })
})

// #254: a checkpoint rides the next action. A round that recorded only
// checkpoints outside Finalization owes the next round one reminder; nothing
// is refused, and the reminder is dropped if the next round has no result
// that can carry it.
describe('the bookkeeping-only Notice rides the round after a round of checkpoints alone (#254)', () => {
  function catalog(options: { checkpointFails?: boolean } = {}): Tool[] {
    const trace: string[] = []
    return [
      scripted('record_evidence', trace, { checkpoint: true, result: 'Session Evidence recorded: memory-1.', ...(options.checkpointFails ? { fails: 'excerpt not found' } : {}) }),
      scripted('record_candidate', trace, { checkpoint: true, result: 'Candidate recorded: candidate-1.' }),
      scripted('navigate', trace, { acquisition: true, result: 'navigated' }),
      scripted('broken', trace, { acquisition: true, fails: 'boom' }),
    ]
  }
  const carries = (outcome: ToolResultOutcome): boolean =>
    (outcome.ok ? String(outcome.result) : outcome.error).includes(BOOKKEEPING_ONLY_NOTICE)

  it('is owed after a round of accepted checkpoints and rides the next action’s result, once', async () => {
    const h = harness(catalog(), { capabilities: { ...ALL_RAILS, noProgressRail: false } })

    const bookkeeping = await h.round([call('record_evidence', {}, 'c1'), call('record_candidate', {}, 'c2')])
    // The round that recorded alone is not told about itself.
    expect(bookkeeping.outcome.results.some((result) => carries(result.outcome))).toBe(false)

    const next = await h.round([call('navigate', { url: 'https://a.example/' }, 'c3')])
    expect(resultOf(next.outcome.results[0]!.outcome)).toBe(`navigated\n\n${BOOKKEEPING_ONLY_NOTICE}`)

    const after = await h.round([call('navigate', { url: 'https://b.example/' }, 'c4')])
    expect(carries(after.outcome.results[0]!.outcome)).toBe(false)
  })

  it('rides the first successful text result of the next round, past a failed one', async () => {
    const h = harness(catalog(), { capabilities: { ...ALL_RAILS, noProgressRail: false } })
    await h.round([call('record_evidence', {}, 'c1')])

    const next = await h.round([call('broken', {}, 'c2'), call('navigate', { url: 'https://a.example/' }, 'c3'), call('navigate', { url: 'https://b.example/' }, 'c4')])

    expect(next.outcome.results.map((result) => carries(result.outcome))).toEqual([false, true, false])
  })

  it('is dropped, never repeated, when the next round has no result to carry it', async () => {
    const h = harness(catalog(), { capabilities: { ...ALL_RAILS, noProgressRail: false } })
    await h.round([call('record_evidence', {}, 'c1')])

    const failed = await h.round([call('broken', {}, 'c2')])
    expect(carries(failed.outcome.results[0]!.outcome)).toBe(false)

    const later = await h.round([call('navigate', { url: 'https://a.example/' }, 'c3')])
    expect(carries(later.outcome.results[0]!.outcome)).toBe(false)
  })

  it('is not owed after a round that carried an action beside its checkpoint', async () => {
    const h = harness(catalog(), { capabilities: { ...ALL_RAILS, noProgressRail: false } })
    await h.round([call('navigate', { url: 'https://a.example/' }, 'c1'), call('record_evidence', {}, 'c2')])

    const next = await h.round([call('navigate', { url: 'https://b.example/' }, 'c3')])
    expect(carries(next.outcome.results[0]!.outcome)).toBe(false)
  })

  it('is not owed after a round whose only checkpoint was rejected — that round already carries the rejection', async () => {
    const h = harness(catalog({ checkpointFails: true }), { capabilities: { ...ALL_RAILS, noProgressRail: false } })
    await h.round([call('record_evidence', {}, 'c1')])

    const next = await h.round([call('navigate', { url: 'https://a.example/' }, 'c2')])
    expect(carries(next.outcome.results[0]!.outcome)).toBe(false)
  })

  it('is not owed after the bookkeeping round in Finalization', async () => {
    const h = harness(catalog(), { capabilities: { ...ALL_RAILS, noProgressRail: false } })
    h.epoch.enterFinalization('budget_exhausted')
    await h.round([call('record_evidence', {}, 'c1')])

    expect(h.notices.attach({ ok: true, result: 'later' }, { usefulWork: true })).toEqual({ ok: true, result: 'later' })
  })

  it('is withdrawn when Finalization is entered before a result carried it', async () => {
    const h = harness(catalog(), { capabilities: { ...ALL_RAILS, noProgressRail: false } })
    await h.round([call('record_evidence', {}, 'c1')])
    h.epoch.enterFinalization('deadline_reached')

    const bookkeeping = await h.round([call('record_evidence', {}, 'c2')])
    expect(carries(bookkeeping.outcome.results[0]!.outcome)).toBe(false)
  })
})
