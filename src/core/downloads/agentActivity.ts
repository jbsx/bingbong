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
    readPage: (part) => controller.readPage(part),
    pageReadParts: () => controller.pageReadParts(),
    click: (ref) => run(() => controller.click(ref)),
    openMenu: (ref) => run(() => controller.openMenu(ref)),
    mediaOp: (ref, op) => run(() => controller.mediaOp(ref, op)),
    type: (ref, text, options) => run(() => controller.type(ref, text, options)),
    scroll: (direction, extent) => controller.scroll(direction, extent),
    scrollRegion: (ref, direction, extent) => controller.scrollRegion(ref, direction, extent),
    showText: (block) => controller.showText(block),
    clickText: (text) => run(() => controller.clickText(text)),
    screenshot: (options) => controller.screenshot(options),
    ...(controller.markedScreenshot !== undefined ? { markedScreenshot: (refs: readonly number[]) => controller.markedScreenshot!(refs) } : {}),
    back: () => controller.back(),
    forward: () => controller.forward(),
    reload: () => controller.reload(),
    stop: () => controller.stop(),
    pressKey: (press, times) => controller.pressKey(press, times),
    mediaState: () => controller.mediaState(),
    evaluate: (expression) => controller.evaluate(expression),
    ...(controller.evaluateInFrames !== undefined ? { evaluateInFrames: <T,>(expression: string) => controller.evaluateInFrames!<T>(expression) } : {}),
    state: () => controller.state(),
    pageFacts: () => controller.pageFacts(),
    settledState: () => controller.settledState(),
    describeRef: (ref) => controller.describeRef(ref),
    linkHrefs: () => controller.linkHrefs(),
    pageLinks: () => controller.pageLinks(),
    collectPage: () => controller.collectPage(),
    clearFocused: () => controller.clearFocused(),
    groundingSnapshot: () => controller.groundingSnapshot(),
    refAtPoint: (point) => controller.refAtPoint(point),
    showRef: (ref) => controller.showRef(ref),
  }
}
