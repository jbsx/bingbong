// The vision seam a tool records through (#186, ADR 0031). Three callers
// reach the adapter — the model's Look, the pipeline's auto-vision
// Describe, and ground_visual's Locate — and each has a ToolContext in
// hand, so the identities that route the record are already there. This
// is the one place that reads them, so a tool never assembles ids of its
// own and the routing rule stays in the router.

import type { VisionGrant } from '../agent/subagentRails'
import type { VisionReason, VisionTraceIds, VisionTraceReporter } from '../trace/visionTrace'
import type { ToolContext } from './tool'

/** What {@link tracedVisionRequest} needs from the context it runs under. */
export interface VisionTraceSeam {
  trace?: VisionTraceReporter | undefined
  ids?: VisionTraceIds | undefined
  now(): number
}

/** The reporter, the identities and the clock one tool call records with. */
export function visionSeam(context: ToolContext): VisionTraceSeam {
  return {
    trace: context.traceVision,
    ids: context.turnId !== undefined ? { turnId: context.turnId } : {},
    now: () => context.clock.now(),
  }
}

/** The worker stamp a record carries, or nothing on the Run's own call. */
export function visionAgentStamp(context: ToolContext): { agentId?: string } {
  return context.agentId !== undefined ? { agentId: context.agentId } : {}
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
      ...visionAgentStamp(context),
    },
    seam.ids,
  )
}
