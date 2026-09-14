// The vision seam a tool records through (#186, ADR 0031). Three callers
// reach the adapter — the model's Look, the pipeline's auto-vision
// Describe, and ground_visual's Locate — and each has a ToolContext in
// hand, so the identities that route the record are already there. This
// is the one place that reads them, so a tool never assembles ids of its
// own and the routing rule stays in the router.

//
// The Tool Round records one more verdict through it (#243, ADR 0049): the
// Search Loop rail's Search Observation, routed exactly as a Vision Budget
// grant is, so it joins the Run by its turn and names the worker it was a
// worker's.

import type { VisionGrant } from '../agent/subagentRails'
import type { ToolCall } from '../ports/llm'
import type { VisionReason, VisionTraceSeam } from '../trace/visionTrace'
import type { SearchObservation } from './searchLoopRail'
import type { ToolContext } from './tool'

/**
 * The reporter, the identities, the clock and the worker stamp one tool
 * call records with. The only place a ToolContext is read for the vision
 * seam, so no call site assembles ids of its own.
 */
export function visionSeam(context: ToolContext): VisionTraceSeam {
  return {
    trace: context.traceVision,
    ids: context.turnId !== undefined ? { turnId: context.turnId } : {},
    ...(context.agentId !== undefined ? { agentId: context.agentId } : {}),
    now: () => context.clock.now(),
  }
}

/**
 * Records one Vision Budget decision and returns the grant unchanged. A
 * refusal is the record that matters — a Run that stopped Looking because
 * its budget ran out reads exactly like one that never wanted to Look —
 * but the grant is recorded too, so the spend is countable rather than
 * inferred from the requests that happened to succeed.
 */
export function traceVisionBudget(context: ToolContext, reason: VisionReason, grant: VisionGrant | undefined): void {
  if (grant === undefined) return
  const seam = visionSeam(context)
  seam.trace?.(
    {
      kind: 'vision_budget',
      reason,
      granted: grant.ok,
      ...(grant.ok ? {} : { refusal: grant.reason }),
      ...(seam.agentId !== undefined ? { agentId: seam.agentId } : {}),
    },
    seam.ids,
  )
}

/**
 * Records what the Search Loop rail observed in one call, beside the call's
 * tool result and joined to it by the call id. A call the rail read as
 * inspection or escape has no observation and leaves no record: the trace
 * already holds its name and outcome.
 */
export function traceSearchObservation(context: ToolContext, call: ToolCall, observation: SearchObservation | null): void {
  if (observation === null) return
  const seam = visionSeam(context)
  seam.trace?.(
    {
      kind: 'search_observation',
      callId: call.id,
      name: call.name,
      query: observation.query,
      signature: observation.signature,
      streak: observation.streak,
      ...(seam.agentId !== undefined ? { agentId: seam.agentId } : {}),
    },
    seam.ids,
  )
}
