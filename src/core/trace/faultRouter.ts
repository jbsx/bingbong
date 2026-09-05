// The fault route (#184, ADR 0031): the boundary rule, made executable.
// A fault reported with a turn id in hand belongs beside the decisions of
// the Run it happened in, so it goes to the Run Trace; every other fault
// is something the app did outside any Run, so it goes to the Host Trace
// and names the Active Session instead.
//
// The rule is identity, never which flag happens to be on. A turn-scoped
// fault with the Run Trace off is dropped rather than smuggled into the
// Host Trace: a Host Trace that quietly held Run-scoped records would be
// a file nobody could read at face value, and the developer who wants
// that fault is one flag away from having it.

import type { FaultReport, FaultSink } from './fault'
import type { HostTraceWriter } from './hostTrace'
import { RUN_TRACE_VERSION, type FaultRunTraceRecord, type RunTraceSink } from './runTrace'

/** One reported fault as the Run Trace records it. */
function faultRecord(report: FaultReport, turnId: string, at: number): FaultRunTraceRecord {
  return { ...report, v: RUN_TRACE_VERSION, at, turnId }
}

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
    const turnId = report.turnId
    if (turnId !== undefined) {
      deps.runTrace?.write(faultRecord(report, turnId, deps.now()))
      return
    }
    // No turn: the Host Trace writer stamps the clock and the Active
    // Session itself, which is the only Session a fault reported outside
    // a Run can honestly name — so the report's own ids, if it somehow
    // carries any, do not travel with it here.
    const { kind, site, message, stack } = report
    deps.hostTrace?.(() => ({ kind, site, message, ...(stack !== undefined ? { stack } : {}) }))
  }
}
