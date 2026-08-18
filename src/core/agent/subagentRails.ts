// Rails enforced in code, not prompt (issue #13): at most 4 concurrent
// subagents, at most 3 subagent tabs beside the main pane, tabs linger 60 s
// after their agent finishes before auto-closing. Vision calls share one pool
// per run: 30 for the orchestrator and 15 for each subagent.

export const MAX_ORCHESTRATOR_VISION_CALLS = 30
export const MAX_SUBAGENT_VISION_CALLS = 15

export const SUBAGENT_LIMITS = {
  maxConcurrentAgents: 4,
  maxSubagentTabs: 3,
  tabLingerMs: 60_000,
  maxVisionCallsPerTask: MAX_SUBAGENT_VISION_CALLS,
} as const

export type VisionGrant = { ok: true } | { ok: false; reason: string }

export interface VisionBudget {
  tryAcquire(): VisionGrant
  used(): number
}

/**
 * Per-task budget for vision-model calls (screenshot→glm-4.5v grounding).
 * `tryAcquire` grants until the limit, then refuses with a reason worded for
 * a tool result — the model sees it and must fall back to DOM grounding.
 * Refusals never consume budget.
 */
export function createVisionBudget(limit: number): VisionBudget {
  let used = 0
  return {
    tryAcquire() {
      if (used >= limit) {
        return { ok: false, reason: `vision call limit (${limit}) reached for this run` }
      }
      used += 1
      return { ok: true }
    },
    used: () => used,
  }
}
