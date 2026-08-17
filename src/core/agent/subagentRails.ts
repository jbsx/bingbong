// Rails enforced in code, not prompt (issue #13): at most 4 concurrent
// subagents, at most 3 subagent tabs beside the main pane, tabs linger 60 s
// after their agent finishes before auto-closing, and at most 10 vision-model
// calls per task. Every limit has a seam test under a scripted storm.

export const MAX_VISION_CALLS_PER_TASK = 10

export const SUBAGENT_LIMITS = {
  maxConcurrentAgents: 4,
  maxSubagentTabs: 3,
  tabLingerMs: 60_000,
  maxVisionCallsPerTask: MAX_VISION_CALLS_PER_TASK,
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
export function createVisionBudget(limit: number = MAX_VISION_CALLS_PER_TASK): VisionBudget {
  let used = 0
  return {
    tryAcquire() {
      if (used >= limit) {
        return { ok: false, reason: `vision call limit (${limit}) reached for this task — use read_page instead` }
      }
      used += 1
      return { ok: true }
    },
    used: () => used,
  }
}
