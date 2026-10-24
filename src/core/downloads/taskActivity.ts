import { systemClock, type Clock } from '../ports/clock'

// Which downloads are a Task's (#423): one that starts while a Task is
// under way in the command seam — whatever verb started it, Enter on a
// link and a reload included — or within a short tail after it, because
// will-download lands a little after the action that caused it; or one on
// a navigation a Task started, which a slow server answered after the
// tail. On the desktop every other download is the user's own, and keeps
// Electron's OS Save dialog; on the kiosk, which has no mouse to answer
// that dialog, every download is routed.

export interface TaskActivityTracker {
  /** Runs a Task (a line given to the command seam, or a partial it may fire on), active until it settles. */
  run<T>(task: () => Promise<T>): Promise<T>
  isActive(): boolean
  /** The pane began a navigation to this address: remembered when a Task is active. */
  navigationStarted(url: string): void
  /** Whether a download's addresses (its redirect chain) include a navigation a Task started. */
  startedByTask(urls: readonly string[]): boolean
}

const DEFAULT_TAIL_MS = 5_000

/** How long a navigation a Task started is remembered for a download its server answers late: a guess, no measure reaches it; a routed download that came later would settle it. */
const NAVIGATION_MEMORY_MS = 120_000

export function createTaskActivityTracker(options?: { tailMs?: number; clock?: Clock }): TaskActivityTracker {
  const tailMs = options?.tailMs ?? DEFAULT_TAIL_MS
  const clock = options?.clock ?? systemClock
  let activeCount = 0
  let lastActiveAt: number | null = null
  const started = new Map<string, number>()

  const isActive = (): boolean => activeCount > 0 || (lastActiveAt !== null && clock.now() - lastActiveAt < tailMs)

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      activeCount += 1
      try {
        return await task()
      } finally {
        activeCount -= 1
        lastActiveAt = clock.now()
      }
    },
    isActive,
    navigationStarted(url) {
      const now = clock.now()
      for (const [known, at] of started) if (now - at >= NAVIGATION_MEMORY_MS) started.delete(known)
      if (isActive()) started.set(url, now)
    },
    startedByTask(urls) {
      const now = clock.now()
      return urls.some((url) => {
        const at = started.get(url)
        return at !== undefined && now - at < NAVIGATION_MEMORY_MS
      })
    },
  }
}

/** Whether a download is saved to the downloads folder and announced, rather than handed to the OS Save dialog. */
export function routesDownload(download: { readonly kiosk: boolean; readonly byTask: boolean }): boolean {
  return download.kiosk || download.byTask
}
