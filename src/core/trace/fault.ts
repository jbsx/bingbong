// The fault seam (#184, ADR 0031): the one place a swallowed failure goes
// so that swallowing it stops meaning losing it. Every `catch {}` in the
// app is a decision that the work must survive the failure; none of them
// is a decision that nobody should ever learn the failure happened. The
// later slices (#186) route those catches through here.
//
// This is the one sanctioned module-level global in core, and it is
// justified by the same rule the trace writers are built on: diagnosis
// must never become the work's problem. A reporter threaded as a
// dependency would have to reach every catch block in the codebase — a
// refactor of every seam it touches, for a call that is allowed to do
// nothing. So the sink is installed once, at startup, by main; with no
// sink installed — every unit test, every script, a Kiosk with both flags
// off — `reportFault` is a no-op that touches nothing.

import type { RunId, SessionId } from '../session/sessionIdentity'

/** What a fault record says, whichever family it lands in. */
export interface FaultEvent {
  readonly kind: 'fault'
  /** Where it happened: a stable dotted name, e.g. `voice.stt.transcribe`. */
  readonly site: string
  readonly message: string
  /** The stack when the thrown value carried one. */
  readonly stack?: string
}

/**
 * The identities the caller had in hand. A turn id is what routes a fault
 * to the Run Trace (see {@link createFaultRouter}); the rest only join the
 * record to the other records about the same Run.
 */
export interface FaultIds {
  readonly turnId?: string
  readonly runId?: RunId
  readonly sessionId?: SessionId
}

/** One reported fault as the sink receives it: the event and what named it. */
export type FaultReport = FaultEvent & FaultIds

/** Where reported faults go; installed once by main, absent everywhere else. */
export type FaultSink = (report: FaultReport) => void

let installed: FaultSink | null = null

/**
 * Installs the process-wide sink, or clears it with `null`. Main calls
 * this once at startup, after the trace sinks exist; tests call it to
 * observe a route and must clear it again, since the binding outlives
 * any one test.
 */
export function setFaultSink(sink: FaultSink | null): void {
  installed = sink
}

/** What a thrown value says about itself, whatever kind of value it is. */
function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, ...(error.stack !== undefined ? { stack: error.stack } : {}) }
  }
  return { message: typeof error === 'string' ? error : String(error) }
}

/**
 * Reports one swallowed failure. Safe to call from anywhere, at any time,
 * including from inside a `catch` that is about to return normally: with
 * no sink installed it does nothing, and a sink that throws is swallowed
 * here — reporting a fault must never raise a second one.
 */
export function reportFault(site: string, error: unknown, ids: FaultIds = {}): void {
  const sink = installed
  if (sink === null) return
  try {
    sink({ kind: 'fault', site, ...describe(error), ...ids })
  // eslint-disable-next-line no-restricted-syntax -- the reporter itself
  } catch {
    // A fault report that fails is not the caller's problem — it is the
    // failure this seam exists to keep from spreading.
  }
}
