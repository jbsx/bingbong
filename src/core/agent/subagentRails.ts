// Rails enforced in code, not prompt (issue #13): at most 4 concurrent
// subagents of which at most 3 may be browsing agents (#120, ADR 0027 —
// genuinely independent Investigation branches), at most 3 subagent tabs
// beside the main pane, tabs linger 60 s after their agent finishes before
// auto-closing. Vision calls share one pool per run: 30 for the orchestrator
// and 15 for each subagent. Every workhorse runs on a 12-Tool-Round leash
// (#120) and shares its parent Run's active-work deadline rather than
// bringing its own. Delegation shares at most 10 Memory Entries per worker
// (#98), so a delegation prompt stays focused and never sees the whole
// store.

export const MAX_ORCHESTRATOR_VISION_CALLS = 30
export const MAX_SUBAGENT_VISION_CALLS = 15

export const SUBAGENT_LIMITS = {
  maxConcurrentAgents: 4,
  /** At most three Browse Subagents run concurrently (#120/AC1). */
  maxConcurrentBrowseAgents: 3,
  maxSubagentTabs: 3,
  tabLingerMs: 60_000,
  maxVisionCallsPerTask: MAX_SUBAGENT_VISION_CALLS,
  maxDelegatedMemoryEntries: 10,
  /** Each browse worker's independent Tool Round ceiling (#120/AC2). */
  maxToolRoundsPerTask: 12,
} as const

/**
 * The parent Run's shared active-work deadline (#120, ADR 0027): a live
 * predicate the workhorse polls — true once the spawning Run's active-work
 * time has passed its tier deadline. One shape across the whole seam: the
 * pipeline builds it, spawn_agent hands it to the manager, the manager
 * threads it into the workhorse hooks. Workers share the Investigation's
 * deadline rather than bringing their own clock.
 */
export interface SubagentSharedDeadline {
  expired(): boolean
}

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
