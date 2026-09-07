import { afterEach, describe, expect, it } from 'vitest'

import { setFaultSink, type FaultReport } from '../trace/fault'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import { createReportRunPlanTool } from './runPlanTools'
import { FakeClock, RecordingTts, withoutTurnId } from '../testing/doubles'
import type { PipelineEvent } from './events'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import type { Tool } from './tool'

afterEach(() => setFaultSink(null))

async function collect(
  pipeline: CommandPipeline,
  command: string,
  onEvent?: (event: PipelineEvent) => void,
): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const raw of pipeline.execute(command)) {
    const event = withoutTurnId(raw)
    events.push(event)
    onEvent?.(event)
  }
  return events
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Longer than a bare flush: a Finalization round takes a few hundred turns to be in flight. */
async function settle(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !predicate(); attempt += 1) await flush()
  expect(predicate()).toBe(true)
}

/** A round only the abort signal ends — a provider request still in flight. */
function abortableRound(request: LlmRequest): Promise<AssistantTurn> {
  return new Promise((_resolve, reject) => {
    request.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
  })
}

const ANSWER: AssistantTurn = { kind: 'answer', speak: 'Vendor A.', display: 'Vendor A wins.', resolution: 'partial' }

/**
 * One Run that plans, blocks on a round the active-work deadline aborts,
 * and so enters Finalization at a moment the test chooses. Everything from
 * there on is the Finalization Allowance's: the Report Grace, the
 * bookkeeping round, and the reserved Answer.
 *
 * `laterRounds` answers the rounds after that aborted one, in order —
 * ordinarily the bookkeeping round and then the reserved Answer, but a
 * Steering replan can put a reopened working round among them. Anything
 * not scripted answers on contract.
 */
function harness(options: {
  finalizationAllowanceMs?: number
  reportGraceMs?: number
  laterRounds?: ((request: LlmRequest) => Promise<AssistantTurn>)[]
  subagentReportsSettled?: () => Promise<void>
  onFinalizationCutoff?: () => void
  tools?: Tool[]
} = {}) {
  const clock = new FakeClock()
  const requests: LlmRequest[] = []
  const faults: FaultReport[] = []
  setFaultSink((report) => faults.push(report))
  let graceStarted = false
  let graceEnded = 0
  let cutoffs = 0
  const llm: LlmClient = {
    async complete(request) {
      requests.push({ ...request, toolResults: [...request.toolResults] })
      if (requests.length === 1) {
        return {
          kind: 'tool_calls',
          calls: [{ id: 'p1', name: 'report_run_plan', args: { objective: 'Compare vendors', headline: 'Comparing vendors', effort_tier: 'lookup' } }],
        }
      }
      // The round the deadline aborts: Finalization opens here.
      if (requests.length === 2) return abortableRound(request)
      const scripted = options.laterRounds?.[requests.length - 3]
      return scripted ? scripted(request) : ANSWER
    },
  }
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock,
    tools: [createReportRunPlanTool(), ...(options.tools ?? [])],
    activeWorkDeadlineMs: 1_000,
    ...(options.finalizationAllowanceMs !== undefined ? { finalizationAllowanceMs: options.finalizationAllowanceMs } : {}),
    ...(options.reportGraceMs !== undefined ? { reportGraceMs: options.reportGraceMs } : {}),
    ...(options.subagentReportsSettled
      ? {
          subagentReportsSettled: () => {
            graceStarted = true
            return options.subagentReportsSettled!()
          },
        }
      : {}),
    onReportGraceEnd: () => { graceEnded += 1 },
    onFinalizationCutoff: () => {
      cutoffs += 1
      options.onFinalizationCutoff?.()
    },
  })
  return {
    clock,
    pipeline,
    requests,
    faults,
    graceStarted: () => graceStarted,
    graceEnded: () => graceEnded,
    cutoffs: () => cutoffs,
    /** Runs to the round the deadline aborts, then crosses it. */
    async enterFinalization(): Promise<void> {
      await settle(() => requests.length >= 2)
      clock.advance(1_000)
      await flush()
    },
  }
}

/** The deterministic Answer's display, if the run fell back to it. */
function displayText(events: PipelineEvent[]): string | undefined {
  const display = events.filter((event) => event.type === 'display').at(-1)
  return display?.type === 'display' ? display.text : undefined
}

// The Finalization Allowance (#209, ADR 0038): one elapsed-time budget
// from Finalization entry until the Card, not a fresh request timeout per
// phase. Every test here runs on a fake clock — the guarantees are
// deterministic timing, and none of them needs a paid model round.
describe('the Finalization Allowance in a Run (#209, ADR 0038)', () => {
  it('bounds the bookkeeping round to its share and still reaches the Answer (#209/AC2–AC3)', async () => {
    const h = harness({
      subagentReportsSettled: () => new Promise<void>(() => {}),
      // Bookkeeping never answers; the reserved Answer does.
      laterRounds: [abortableRound],
    })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()

    // Thirty seconds of Report Grace, with a worker that never settles.
    await settle(() => h.graceStarted())
    h.clock.advance(30_000)
    await settle(() => h.requests.length >= 3)
    expect(h.graceEnded()).toBe(1)

    // Ten seconds of bookkeeping, and not a second more: the Answer's
    // twenty are not bookkeeping's to spend.
    h.clock.advance(9_999)
    await flush()
    expect(h.requests).toHaveLength(3)
    h.clock.advance(1)
    const events = await run

    // The bookkeeping opportunity is spent, not retried, and the reserved
    // Answer round ran inside what was left.
    expect(h.requests).toHaveLength(4)
    expect(h.requests[3]).toMatchObject({ answerOnly: true })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'deadline_reached' })
    expect(displayText(events)).toBe('Vendor A wins.')
  })

  it('leaves an early grace’s savings to the Answer rather than to bookkeeping (#209/AC2)', async () => {
    let settleWorkers!: () => void
    const workers = new Promise<void>((resolve) => { settleWorkers = resolve })
    const h = harness({
      subagentReportsSettled: () => workers,
      laterRounds: [abortableRound, abortableRound],
    })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()

    // The workers settle five seconds into the grace.
    await settle(() => h.graceStarted())
    h.clock.advance(5_000)
    settleWorkers()
    await settle(() => h.requests.length >= 3)

    // Bookkeeping still gets its own ten and no more.
    h.clock.advance(10_000)
    await settle(() => h.requests.length >= 4)

    // The reserved Answer inherits everything unspent: the protected
    // twenty seconds plus the twenty-five the grace handed back.
    h.clock.advance(44_999)
    await flush()
    expect(h.requests).toHaveLength(4)
    h.clock.advance(1)
    const events = await run

    // Both Finalization rounds ran out of allowance, so the Card is the
    // frozen deterministic Answer — with its uncertainty, not a provider
    // error and not a budget.
    expect(displayText(events)).toContain('I have not made progress I can show')
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed', finalizationCause: 'deadline_reached' })
  })

  it('shares one bound across every retry inside a round (#209/AC3)', async () => {
    const attempts: number[] = []
    const h = harness({
      subagentReportsSettled: async () => {},
      laterRounds: [
        // A client that retries an empty reply: four-second attempts, all
        // inside the one bookkeeping share rather than one timeout each.
        async (request) => {
          for (let attempt = 1; attempt <= 5; attempt += 1) {
            attempts.push(attempt)
            request.onRetryAttempt?.(attempt, 5)
            await new Promise<void>((resolve, reject) => {
              const cancel = h.clock.setTimer(4_000, resolve)
              request.signal?.addEventListener('abort', () => {
                cancel()
                reject(new Error('The operation was aborted'))
              })
            })
          }
          return ANSWER
        },
      ],
    })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()
    await settle(() => h.requests.length >= 3)

    h.clock.advance(4_000)
    await settle(() => attempts.length >= 2)
    h.clock.advance(4_000)
    await settle(() => attempts.length >= 3)
    // Two seconds later the round's ten are gone, mid-third-attempt.
    h.clock.advance(2_000)
    const events = await run

    expect(attempts).toEqual([1, 2, 3])
    // The run advanced to its reserved Answer rather than starting a
    // fourth attempt on a fresh client timeout.
    expect(h.requests).toHaveLength(4)
    expect(h.requests[3]).toMatchObject({ answerOnly: true })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('skips an opportunity with nothing left instead of starting another timeout (#209/AC3)', async () => {
    // A scaled allowance the cutoff runs out inside: sixty milliseconds,
    // and the pane's action holds the bookkeeping round past it.
    const h = harness({
      finalizationAllowanceMs: 60,
      subagentReportsSettled: async () => {},
      laterRounds: [abortableRound],
    })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()
    await settle(() => h.requests.length >= 3)

    // Bookkeeping's ten milliseconds run out; so, at forty, does
    // everything but the Answer's protected twenty.
    h.clock.advance(10)
    await settle(() => h.requests.length >= 4)
    expect(h.requests[3]).toMatchObject({ answerOnly: true })
    const events = await run
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('skips the reserved Answer round outright when nothing is left for it (#209/AC3)', async () => {
    // Thirty seconds of grace, then a bookkeeping round whose own tool
    // call runs the rest of the allowance out. The reserved Answer round
    // is never started: there is no time to start it in.
    let releaseTool: (() => void) | null = null
    const slow: Tool = {
      name: 'slow_note',
      execute: () =>
        new Promise<string>((resolve) => {
          releaseTool = () => resolve('noted')
        }),
    }
    const h = harness({
      tools: [slow],
      subagentReportsSettled: () => new Promise<void>(() => {}),
      laterRounds: [async () => ({ kind: 'tool_calls', calls: [{ id: 'n1', name: 'slow_note', args: {} }] })],
    })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()
    await settle(() => h.graceStarted())
    h.clock.advance(30_000)
    await settle(() => releaseTool !== null)

    // The bookkeeping round's tool holds the run for the whole remaining
    // allowance — the cutoff fires inside it, and the Answer's protected
    // share is gone by the time it returns.
    h.clock.advance(30_000)
    await flush()
    expect(h.cutoffs()).toBe(1)
    releaseTool!()
    const events = await run

    // No fourth request: the exhausted opportunity was skipped, not
    // started on a fresh client timeout. The Card is the frozen
    // deterministic Answer, with its uncertainty.
    expect(h.requests).toHaveLength(3)
    expect(displayText(events)).toContain('I have not made progress I can show')
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed', finalizationCause: 'deadline_reached' })
    expect(h.faults.map((fault) => fault.site)).toContain(
      'pipeline.createCommandPipeline.reservedAnswerAllowanceSpent',
    )
  })

  it('keeps the entry cause and files the allowance failure separately (#209/AC7)', async () => {
    const h = harness({
      subagentReportsSettled: async () => {},
      laterRounds: [abortableRound, abortableRound],
    })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()
    await settle(() => h.requests.length >= 3)
    h.clock.advance(10_000)
    await settle(() => h.requests.length >= 4)
    h.clock.advance(50_000)
    const events = await run

    // The Run still stopped for the deadline it crossed; the rounds it
    // then lost are diagnostics beside that cause, never in place of it.
    expect(events.at(-1)).toMatchObject({ type: 'done', finalizationCause: 'deadline_reached' })
    expect(h.faults.map((fault) => fault.site)).toContain(
      'pipeline.createCommandPipeline.reservedAnswerAllowanceSpent',
    )
  })

  // Explicit user Pause suspends the allowance and everything inside it
  // (#209/AC4). Resume does not mint a new one.
  describe('Pause', () => {
    it('suspends the Report Grace for as long as the user holds it', async () => {
      const h = harness({ subagentReportsSettled: () => new Promise<void>(() => {}) })
      const statuses: string[] = []
      const run = collect(h.pipeline, 'compare vendors', (event) => {
        if (event.type === 'status') statuses.push(event.status)
      })
      await h.enterFinalization()
      await settle(() => h.graceStarted())

      // Ten seconds in, the user pauses for ten minutes.
      h.clock.advance(10_000)
      h.pipeline.pause()
      await settle(() => statuses.at(-1) === 'paused')
      h.clock.advance(600_000)
      await flush()
      // The grace did not elapse while the user held it: no bookkeeping
      // round has been asked for.
      expect(h.requests).toHaveLength(2)

      h.pipeline.resume()
      await settle(() => statuses.at(-1) !== 'paused')
      // And it picks up with the twenty seconds it had left, not a new
      // thirty and not none.
      h.clock.advance(19_999)
      await flush()
      expect(h.requests).toHaveLength(2)
      h.clock.advance(1)
      const events = await run
      expect(h.requests.length).toBeGreaterThanOrEqual(3)
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    })

    it('suspends a Finalization round already in flight', async () => {
      const h = harness({
        subagentReportsSettled: async () => {},
        laterRounds: [abortableRound],
      })
      const run = collect(h.pipeline, 'compare vendors')
      await h.enterFinalization()
      await settle(() => h.requests.length >= 3)

      // The bookkeeping round is in flight when the user pauses.
      h.clock.advance(5_000)
      h.pipeline.pause()
      h.clock.advance(600_000)
      await flush()
      // Its five remaining seconds were not spent on the user's time.
      expect(h.requests).toHaveLength(3)

      h.pipeline.resume()
      await flush()
      h.clock.advance(4_999)
      await flush()
      expect(h.requests).toHaveLength(3)
      h.clock.advance(1)
      const events = await run
      expect(h.requests).toHaveLength(4)
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    })

    it('suspends the reserved Answer round too', async () => {
      const note: Tool = { name: 'note', execute: async () => 'noted' }
      const h = harness({
        tools: [note],
        subagentReportsSettled: async () => {},
        laterRounds: [
          // Bookkeeping spends its round on a checkpoint-shaped call, so
          // the round after it is the reserved Answer.
          async () => ({ kind: 'tool_calls', calls: [{ id: 'n1', name: 'note', args: {} }] }),
          abortableRound,
        ],
      })
      const run = collect(h.pipeline, 'compare vendors')
      await h.enterFinalization()
      await settle(() => h.requests.length >= 4)
      expect(h.requests[3]).toMatchObject({ answerOnly: true })

      // The reserved round has the whole sixty seconds (nothing was spent
      // on the grace). Pause a third of the way through it.
      h.clock.advance(20_000)
      h.pipeline.pause()
      h.clock.advance(600_000)
      await flush()
      expect(h.requests).toHaveLength(4)

      h.pipeline.resume()
      await flush()
      h.clock.advance(39_999)
      await flush()
      expect(h.requests).toHaveLength(4)
      // Its last millisecond, and the Card is the deterministic Answer.
      h.clock.advance(1)
      const events = await run
      expect(displayText(events)).toContain('I have not made progress I can show')
    })
  })

  it('drops the allowance when a Steering replan reopens acquisition (#209/AC4)', async () => {
    let graces = 0
    const h = harness({
      // The reopened round runs into the re-armed tier deadline too, so
      // the Run finalizes a second time.
      laterRounds: [abortableRound],
      subagentReportsSettled: () => {
        graces += 1
        return new Promise<void>(() => {})
      },
    })
    const statuses: string[] = []
    const run = collect(h.pipeline, 'compare vendors', (event) => {
      if (event.type === 'status') statuses.push(event.status)
    })
    await h.enterFinalization()
    await settle(() => graces === 1)

    // Ten seconds into the first grace, the user corrects the objective.
    h.clock.advance(10_000)
    h.pipeline.pause()
    await settle(() => statuses.at(-1) === 'paused')
    h.pipeline.resume('check vendor B instead')
    await settle(() => h.requests.length >= 3)

    // The replan reopened acquisition, so nothing of the spent allowance
    // survives into it: the reopened round is a working one, and no
    // leftover timer fires against it.
    expect(h.requests[2]).toMatchObject({ steering: 'check vendor B instead' })
    expect(h.requests[2]?.answerOnly).toBeUndefined()
    h.clock.advance(999)
    await flush()
    expect(h.requests).toHaveLength(3)

    // The fresh tier deadline puts the Run back into Finalization, and
    // that entry mints its own full grace rather than inheriting a spent
    // one: thirty more seconds before the bookkeeping round.
    h.clock.advance(1)
    await settle(() => graces === 2)
    h.clock.advance(29_999)
    await flush()
    expect(h.requests).toHaveLength(3)
    h.clock.advance(1)
    const events = await run
    expect(h.requests.length).toBeGreaterThanOrEqual(4)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  // Stop takes precedence over the allowance and everything in it
  // (#209/AC4): it must not be held by a worker that never answers.
  it('ends the Report Grace at once on a Stop, even with an unresponsive worker (#209/AC4)', async () => {
    const h = harness({ subagentReportsSettled: () => new Promise<void>(() => {}) })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()
    await settle(() => h.graceStarted())

    // No worker will ever settle and no clock time passes: the Stop alone
    // has to end the wait.
    h.pipeline.abort()
    const events = await run

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
    // No bookkeeping round follows a Stop.
    expect(h.requests).toHaveLength(2)
  })

  // A non-interruptible action cannot postpone the Card (#209/AC6). At the
  // cutoff the Run lets go of what it is waiting on — the resource stays
  // withheld, which is the prerequisite's boundary, not this one's.
  it('lets go of an outstanding action at the cutoff and publishes anyway (#209/AC6)', async () => {
    let cutoffAt: number | null = null
    const h = harness({
      subagentReportsSettled: () => new Promise<void>(() => {}),
      laterRounds: [abortableRound, abortableRound],
    })
    const run = collect(h.pipeline, 'compare vendors')
    // The cutoff's own timestamp, read from the harness's clock.
    const readCutoff = (): void => { cutoffAt = h.clock.now() }
    await h.enterFinalization()
    const enteredAt = h.clock.now()
    await settle(() => h.graceStarted())
    expect(h.cutoffs()).toBe(0)

    h.clock.advance(30_000)
    await settle(() => h.requests.length >= 3)
    h.clock.advance(9_999)
    await flush()
    expect(h.cutoffs()).toBe(0)
    h.clock.advance(1)
    readCutoff()
    await flush()

    // Forty seconds after entry — everything but the Answer's protected
    // twenty — the Run stopped waiting on the pane.
    expect(h.cutoffs()).toBe(1)
    expect(cutoffAt! - enteredAt).toBe(40_000)

    h.clock.advance(20_000)
    const events = await run
    // Once only: the cutoff is a boundary, not a retry.
    expect(h.cutoffs()).toBe(1)
    expect(displayText(events)).toContain('I have not made progress I can show')
  })

  it('does not let a late settlement rewrite the Answer (#209/AC6)', async () => {
    let settleWorkers!: () => void
    const workers = new Promise<void>((resolve) => { settleWorkers = resolve })
    const h = harness({
      subagentReportsSettled: () => workers,
      laterRounds: [abortableRound, abortableRound],
    })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()
    await settle(() => h.graceStarted())
    h.clock.advance(30_000)
    await settle(() => h.requests.length >= 3)
    h.clock.advance(30_000)
    const events = await run

    const answer = displayText(events)
    const rounds = h.requests.length
    const eventCount = events.length

    // The action settles after the Card is out. Nothing about the run's
    // output moves: no round, no event, no word of the Answer.
    settleWorkers()
    await flush()
    await flush()
    expect(h.requests).toHaveLength(rounds)
    expect(events).toHaveLength(eventCount)
    expect(displayText(events)).toBe(answer)
  })

  it('publishes the Card before it speaks (#209/AC7)', async () => {
    const h = harness({ subagentReportsSettled: async () => {} })
    const run = collect(h.pipeline, 'compare vendors')
    await h.enterFinalization()
    const events = await run
    const display = events.findIndex((event) => event.type === 'display')
    const speak = events.findIndex((event) => event.type === 'speak')
    expect(display).toBeGreaterThanOrEqual(0)
    expect(speak).toBeGreaterThan(display)
  })
})
