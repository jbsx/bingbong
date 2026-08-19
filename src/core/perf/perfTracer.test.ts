import { describe, expect, it } from 'vitest'
import { MAX_PENDING_TURNS } from './perfTracer'
import { fakePerfHarness } from '../testing/doubles'

// The tracer is #27's one new seam: a factory with injectable sink and clock
// so span-record shape and id minting are testable without disk or timers.
// File rolling and the 7-day purge live in the JSONL sink (jsonlPerfSink).
// The harness (in-memory sink + fake clocks) is the shared testing double.

describe('createPerfTracer', () => {
  it('records one span per finished stage: turn, stage, duration, wall clock, monotonic clock, detail', () => {
    const { records, state, tracer } = fakePerfHarness()

    state.monotonicMs = 4_200
    tracer.span('turn-abc', 'stt', 1_234, { speechMs: 256 })

    expect(records).toEqual([
      {
        turnId: 'turn-abc',
        stage: 'stt',
        durMs: 1_234,
        at: 1_700_000_000_000,
        t: 4_200,
        detail: { speechMs: 256 },
      },
    ])
  })

  it('omits the detail field when the stage has none, and stays JSONL-serializable', () => {
    const { records, tracer } = fakePerfHarness()

    tracer.span('turn-abc', 'wake-to-transcript', 10)

    const record = records[0]
    expect(Object.keys(record).sort()).toEqual(['at', 'durMs', 'stage', 't', 'turnId'])
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  })

  it('mints unique turn ids, stamped with the wall clock at mint time', () => {
    const { state, tracer } = fakePerfHarness()

    state.wallMs = 1_700_000_000_000
    const first = tracer.mintTurnId()
    const second = tracer.mintTurnId()
    state.wallMs = 1_700_000_050_000
    const third = tracer.mintTurnId()

    expect(first).toBe(`turn-${(1_700_000_000_000).toString(36)}-1`)
    expect(second).not.toBe(first)
    expect(third).not.toBe(first)
    expect(third).not.toBe(second)
  })
})

// The run-end summary (#30): the tracer tallies every span per turn, and
// `summarize` closes the turn out — one synthetic `summary` record through
// the sink (the report self-checks by recomputing totals from raw spans)
// plus the aggregate returned for the console line. Turns with no spans
// degrade to null: no record, no line.
describe('summarize', () => {
  it('aggregates the turn’s spans per stage in first-recorded order and records a synthetic summary event', () => {
    const { records, state, tracer } = fakePerfHarness()

    tracer.span('turn-1', 'stt', 6_900)
    tracer.span('turn-2', 'stt', 100) // another turn's span stays out
    tracer.span('turn-1', 'llm', 2_000)
    tracer.span('turn-1', 'llm', 1_200)
    tracer.span('turn-1', 'llm-retry', 0, { attempt: 2 })
    tracer.span('turn-1', 'tool', 4_100, { tool: 'navigate' })
    state.monotonicMs = 50_000
    state.wallMs = 1_700_000_050_000

    const summary = tracer.summarize('turn-1')

    expect(summary).toEqual({
      turnId: 'turn-1',
      stages: {
        stt: { count: 1, durMs: 6_900 },
        llm: { count: 2, durMs: 3_200 },
        'llm-retry': { count: 1, durMs: 0 },
        tool: { count: 1, durMs: 4_100 },
      },
      totalMs: 14_200,
    })
    expect(records.at(-1)).toEqual({
      turnId: 'turn-1',
      stage: 'summary',
      durMs: 14_200,
      at: 1_700_000_050_000,
      t: 50_000,
      detail: {
        stages: {
          stt: { count: 1, durMs: 6_900 },
          llm: { count: 2, durMs: 3_200 },
          'llm-retry': { count: 1, durMs: 0 },
          tool: { count: 1, durMs: 4_100 },
        },
      },
    })
    // The other turn's tally is untouched and summarizes on its own.
    expect(tracer.summarize('turn-2')).toEqual({
      turnId: 'turn-2',
      stages: { stt: { count: 1, durMs: 100 } },
      totalMs: 100,
    })
  })

  it('returns null and writes nothing for a turn that recorded no spans', () => {
    const { records, tracer } = fakePerfHarness()

    expect(tracer.summarize('turn-nobody')).toBeNull()
    expect(records).toEqual([])
  })

  it('clears the tally on summarize — a second close-out is a no-op', () => {
    const { records, tracer } = fakePerfHarness()

    tracer.span('turn-1', 'tts', 1_400)
    expect(tracer.summarize('turn-1')).not.toBeNull()
    expect(tracer.summarize('turn-1')).toBeNull()
    expect(records.filter((record) => record.stage === 'summary')).toHaveLength(1)
  })

  it('never counts its own summary event — spans after close-out start a fresh tally', () => {
    const { tracer } = fakePerfHarness()

    tracer.span('turn-1', 'stt', 100)
    tracer.summarize('turn-1')
    tracer.span('turn-1', 'llm', 200)

    expect(tracer.summarize('turn-1')).toEqual({
      turnId: 'turn-1',
      stages: { llm: { count: 1, durMs: 200 } },
      totalMs: 200,
    })
  })

  it('drops the oldest pending tally past the cap — spans whose turn never ends cannot leak memory', () => {
    const { tracer } = fakePerfHarness()

    tracer.span('turn-orphan', 'stt', 100)
    for (let n = 0; n < MAX_PENDING_TURNS; n += 1) tracer.span(`turn-${n}`, 'stt', 1)

    expect(tracer.summarize('turn-orphan')).toBeNull()
    expect(tracer.summarize(`turn-${MAX_PENDING_TURNS - 1}`)).not.toBeNull()
  })
})
