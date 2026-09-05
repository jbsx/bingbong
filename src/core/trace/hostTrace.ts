// The Host Trace (#184, ADR 0031): the second diagnostic file family —
// what the app does outside any Run. The boundary is identity, not
// subject matter: a record written where a Run identity is in hand joins
// the Run Trace; everything else lands here. That keeps each file
// answerable on its own terms — the Run Trace answers "why did this Run
// decide that", the Host Trace answers "what was the app doing" — and it
// is why a host record names the Active Session rather than a turn.
//
// Slice 1 carries only the fault records. The voice pipeline's events
// (#185), the vision adapter's calls and the swallowed catches (#186) and
// the renderer's signals (#187) widen `HostTraceEvent` from here; the
// record shape, the writer and the file family are already theirs.

import type { SessionId } from '../session/sessionIdentity'
import type { FaultEvent } from './fault'

/** The record-shape version every host line carries; bump it when a field's meaning changes. */
export const HOST_TRACE_VERSION = 1

/** One thing the app did outside a Run. Widened by the later slices. */
export type HostTraceEvent = FaultEvent

/** One line of a Host Trace file. */
export type HostTraceRecord = HostTraceEvent & {
  readonly v: number
  /** Wall-clock epoch ms when the record was written. */
  readonly at: number
  /**
   * The Active Session when the record was written, or null when there
   * was none. Explicitly null rather than absent: "the app did this with
   * no Session live" is a diagnosis, not missing data.
   */
  readonly sessionId: SessionId | null
}

export interface HostTraceSink {
  write(record: HostTraceRecord): void
}

/**
 * What the app calls to trace one thing it did outside a Run; absent when
 * nothing is tracing. The event is built lazily, inside the writer's own
 * guard, so assembling a record can no more break the app than writing
 * one can.
 */
export type HostTraceWriter = (event: () => HostTraceEvent) => void

/**
 * Binds a sink to the Active Session lookup. Same guard as the Run
 * writers: building the record, reading the Session and writing all
 * happen inside one try, so a dead logs dir — or a Session handle that
 * has gone away underneath — degrades to a record that was never written,
 * never to a failure in the work that was being recorded.
 */
export function createHostTraceWriter(deps: {
  sink: HostTraceSink
  now(): number
  /** The Active Session at the moment of the record, or null when there is none. */
  activeSessionId(): SessionId | null
}): HostTraceWriter {
  return (event) => {
    try {
      deps.sink.write({ v: HOST_TRACE_VERSION, at: deps.now(), sessionId: deps.activeSessionId(), ...event() })
    } catch {
      // A failed trace must never break the work it is recording.
    }
  }
}
