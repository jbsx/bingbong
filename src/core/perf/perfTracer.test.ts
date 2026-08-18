import { describe, expect, it } from 'vitest'
import { createPerfTracer, type PerfClock, type PerfSink, type PerfSpanRecord } from './perfTracer'

// The tracer is #27's one new seam: a factory with injectable sink and clock
// so span-record shape and id minting are testable without disk or timers.
// File rolling and the 7-day purge live in the JSONL sink (jsonlPerfSink).

class MemorySink implements PerfSink {
  readonly records: PerfSpanRecord[] = []

  write(record: PerfSpanRecord): void {
    this.records.push(record)
  }
}

function fakePerfClock(): { clock: PerfClock; state: { monotonicMs: number; wallMs: number } } {
  const state = { monotonicMs: 0, wallMs: 1_700_000_000_000 }
  return { clock: { monotonic: () => state.monotonicMs, wall: () => state.wallMs }, state }
}

describe('createPerfTracer', () => {
  it('records one span per finished stage: turn, stage, duration, wall clock, monotonic clock, detail', () => {
    const sink = new MemorySink()
    const { clock, state } = fakePerfClock()
    const tracer = createPerfTracer({ sink, clock })

    state.monotonicMs = 4_200
    tracer.span('turn-abc', 'stt', 1_234, { speechMs: 256 })

    expect(sink.records).toEqual([
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
    const sink = new MemorySink()
    const { clock } = fakePerfClock()
    const tracer = createPerfTracer({ sink, clock })

    tracer.span('turn-abc', 'wake-to-transcript', 10)

    const record = sink.records[0]
    expect(Object.keys(record).sort()).toEqual(['at', 'durMs', 'stage', 't', 'turnId'])
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  })

  it('mints unique turn ids, stamped with the wall clock at mint time', () => {
    const sink = new MemorySink()
    const { clock, state } = fakePerfClock()
    const tracer = createPerfTracer({ sink, clock })

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
