// The boundary rule, made executable (#184, ADR 0031; shared by #186). A
// record made with a turn id in hand belongs beside the decisions of the
// Run it happened in, so it goes to the Run Trace; a record made without
// one is something the app did outside any Run, so it goes to the Host
// Trace and names the Active Session instead.
//
// The rule is identity, never which flag happens to be on. A turn-scoped
// record with the Run Trace off is dropped rather than smuggled into the
// Host Trace: a Host Trace that quietly held Run-scoped records would be
// a file nobody could read at face value, and the developer who wants
// that record is one flag away from having it.
//
// Two reporters route this way — the fault seam and the vision seam — and
// they share this function rather than each restating the rule, because
// the rule is one decision and a second copy of it is a second place for
// it to drift.

import type { FaultEvent } from './fault'
import type { HostTraceWriter } from './hostTrace'
import { RUN_TRACE_VERSION, type RunTraceSink } from './runTrace'
import type { VisionTraceEvent } from './visionTrace'
import type { RunId, SessionId } from '../session/sessionIdentity'

/**
 * What routes by identity rather than belonging to one family: a
 * swallowed failure (#184) and a vision request or budget decision
 * (#186). Both are things that happen in a Run as readily as outside one,
 * which is exactly why the route decides where they land.
 */
export type RoutedTraceEvent = FaultEvent | VisionTraceEvent

/** The identities a reporter's caller had in hand when it made the record. */
export interface TraceRouteIds {
  /** The turn the record was made in; its presence is what routes to the Run Trace. */
  readonly turnId?: string
  readonly runId?: RunId
  readonly sessionId?: SessionId
}

/** The two families a routed record can land in; either may be absent (its flag is off). */
export interface TraceRouteDeps {
  runTrace?: RunTraceSink | null
  hostTrace?: HostTraceWriter | null
  now(): number
}

/**
 * Routes one record by the identities it was made with. The event must
 * carry no ids of its own: on the host side the writer stamps the clock
 * and the Active Session itself, which is the only Session a record made
 * outside a Run can honestly name, so ids that travelled with the event
 * would contradict it.
 */
export function routeByTurn(deps: TraceRouteDeps, event: RoutedTraceEvent, ids: TraceRouteIds = {}): void {
  const { turnId, runId, sessionId } = ids
  if (turnId !== undefined) {
    deps.runTrace?.write({
      ...event,
      v: RUN_TRACE_VERSION,
      at: deps.now(),
      turnId,
      ...(runId !== undefined ? { runId } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    })
    return
  }
  deps.hostTrace?.(() => event)
}
