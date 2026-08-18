// Always-on turn performance logging (#27): every finished stage of a turn
// becomes one span record — a single JSON line carrying the turn id, the
// stage, the duration, and dual wall-clock/monotonic stamps. Durations are
// measured only against the monotonic clock (immune to clock jumps); the
// wall stamp exists for joining with history/event timestamps. The factory
// takes an injectable sink and clock, so record shape, file rolling, and
// purge are testable without disk or timers (it does not extend the Clock
// port — usage tracking and perf logging stay separate seams).

export interface PerfSpanRecord {
  /** Correlates every span of one turn; minted at utterance end (#27). */
  turnId: string
  /** Stage vocabulary: 'stt', 'wake-to-transcript', … */
  stage: string
  /** Stage duration in ms — a monotonic difference only. */
  durMs: number
  /** Wall-clock epoch ms when the stage finished. */
  at: number
  /** Monotonic ms since the tracer's origin (app start) when the stage finished. */
  t: number
  /** Optional stage payload — STT carries speech ms / total ms / truncated. */
  detail?: Record<string, unknown>
}

export interface PerfSink {
  write(record: PerfSpanRecord): void
}

export interface PerfClock {
  /** Monotonic ms since the tracer's origin; durations come only from here. */
  monotonic(): number
  /** Wall-clock epoch ms, for joining with other logs. */
  wall(): number
}

export interface PerfTracer {
  /** Mints the id of a new turn — unique within a run, wall-stamped across restarts. */
  mintTurnId(): string
  /** Monotonic now — measure stage starts and ends with this. */
  now(): number
  /** Records one finished stage; `at`/`t` are stamped at call time. */
  span(turnId: string, stage: string, durMs: number, detail?: Record<string, unknown>): void
}

function systemPerfClock(): PerfClock {
  const origin = performance.now()
  return {
    monotonic: () => performance.now() - origin,
    wall: () => Date.now(),
  }
}

export function createPerfTracer(deps: { sink: PerfSink; clock?: PerfClock }): PerfTracer {
  const clock = deps.clock ?? systemPerfClock()
  let turnSeq = 0

  return {
    mintTurnId() {
      turnSeq += 1
      // The wall base keeps ids from colliding across restarts; the sequence
      // disambiguates turns minted within the same wall millisecond.
      return `turn-${clock.wall().toString(36)}-${turnSeq.toString(36)}`
    },

    now: () => clock.monotonic(),

    span(turnId, stage, durMs, detail) {
      const record: PerfSpanRecord = { turnId, stage, durMs, at: clock.wall(), t: clock.monotonic() }
      if (detail !== undefined) record.detail = detail
      deps.sink.write(record)
    },
  }
}

// Fallback id source for pipelines running without a tracer (tests, direct
// use): events must carry a turn id everywhere (#28) even when nothing perf-
// logs. Module-scoped so ids never collide between pipelines in one process.
let fallbackTurnSeq = 0

export function nextFallbackTurnId(): string {
  fallbackTurnSeq += 1
  return `turn-local-${fallbackTurnSeq.toString(36)}`
}

/**
 * The adopt-or-mint id source pipelines share (#28): a tracer's mint when
 * one is injected, the local fallback otherwise. Callers layer adoption on
 * top (`turnId ?? mintTurnId()`).
 */
export function createTurnIdSource(tracer?: PerfTracer): () => string {
  return tracer ? () => tracer.mintTurnId() : nextFallbackTurnId
}
