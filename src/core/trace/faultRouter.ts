// The fault route (#184, ADR 0031): the boundary rule applied to the
// fault seam. A fault reported with a turn id in hand belongs beside the
// decisions of the Run it happened in; every other fault is something the
// app did outside any Run. The rule itself lives in `traceRoute` — the
// vision seam (#186) routes by the same one — and all this module does is
// separate a report's event from the identities it was reported with.

import type { FaultSink } from './fault'
import type { HostTraceWriter } from './hostTrace'
import type { RunTraceSink } from './runTrace'
import { routeByTurn } from './traceRoute'

/**
 * Builds the sink main installs with {@link setFaultSink}. Either family
 * may be absent — its flag is off — and with both absent the router is a
 * sink that writes nothing, which is a different thing from no sink at
 * all only in that it still costs a call.
 */
export function createFaultRouter(deps: {
  runTrace?: RunTraceSink | null
  hostTrace?: HostTraceWriter | null
  now(): number
}): FaultSink {
  return (report) => {
    // The report carries its ids inline; the record must not, so they are
    // split off here and only the event travels.
    const { kind, site, message, stack, turnId, runId, sessionId } = report
    routeByTurn(deps, { kind, site, message, ...(stack !== undefined ? { stack } : {}) }, { turnId, runId, sessionId })
  }
}
