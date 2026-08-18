import { systemClock, type Clock } from '../ports/clock'
import type { BrowserController, VisualGroundingController } from '../ports/browser'

// "Agent-initiated" download detection: a download started while an agent
// browser action (click/type/navigate) is in flight — or within a short grace
// window after one, because will-download lands slightly after the
// triggering click resolves. Everything else is a manual download and keeps
// Electron's default save dialog.

export interface AgentActivityTracker {
  run<T>(action: () => Promise<T>): Promise<T>
  isActive(): boolean
}

const DEFAULT_GRACE_MS = 5_000

export function createAgentActivityTracker(options?: { graceMs?: number; clock?: Clock }): AgentActivityTracker {
  const graceMs = options?.graceMs ?? DEFAULT_GRACE_MS
  const clock = options?.clock ?? systemClock
  let activeCount = 0
  let lastActiveAt: number | null = null

  return {
    async run<T>(action: () => Promise<T>): Promise<T> {
      activeCount += 1
      try {
        return await action()
      } finally {
        activeCount -= 1
        lastActiveAt = clock.now()
      }
    },
    isActive() {
      if (activeCount > 0) return true
      return lastActiveAt !== null && clock.now() - lastActiveAt < graceMs
    },
  }
}

/**
 * Wraps the download-capable verbs so their downloads count as
 * agent-initiated. Delegates verb-by-verb (no spread — class-based
 * controllers keep their methods on the prototype).
 */
export function withAgentActivity(
  controller: BrowserController & VisualGroundingController,
  tracker: AgentActivityTracker,
): BrowserController & VisualGroundingController {
  const run = <T>(action: () => Promise<T>): Promise<T> => tracker.run(action)
  return {
    navigate: (url) => run(() => controller.navigate(url)),
    readPage: () => controller.readPage(),
    click: (ref) => run(() => controller.click(ref)),
    type: (ref, text) => run(() => controller.type(ref, text)),
    scroll: (direction) => controller.scroll(direction),
    screenshot: () => controller.screenshot(),
    back: () => controller.back(),
    pressKey: (press, times) => controller.pressKey(press, times),
    mediaState: () => controller.mediaState(),
    state: () => controller.state(),
    describeRef: (ref) => controller.describeRef(ref),
    groundingSnapshot: () => controller.groundingSnapshot(),
    refAtPoint: (point) => controller.refAtPoint(point),
  }
}
