import type { Clock } from '../ports/clock'

// The pane out of sight (ADR 0079, amendment 2026-10-25): hidden at rest,
// so Chromium stops decoding and painting a page no one sees; parked one
// pixel on screen while it may be read, so a page loaded out of sight
// builds itself in full before a Task reads it. Shown when the dashboard
// shows it. By kind: no page and no machine is special-cased.

/** What the pane's view is: shown where the dashboard put it, parked a pixel on screen, or set not visible at its real size. */
export type PaneVisibility = 'shown' | 'parked' | 'hidden'

/** How long a new pane is shown parked once it is in its window: a view never shown lays out at 0×0 even hidden at its real size. One frame and some. */
export const FIRST_FRAME_MS = 50

export interface PaneVisibilityRule {
  current(): PaneVisibility
  /** The pane is in its window: its one parked frame starts now. */
  hosted(): void
  /** Whether the dashboard shows the pane (a rect with an area) or something takes its place. */
  inSight(shown: boolean): void
  /** The ear opened (the wake word, Hot Listen, push-to-talk) or closed. */
  ear(open: boolean): void
  /** The Idle Prompt opened or closed: a line typed there may read the page. */
  prompt(open: boolean): void
  /** Runs a Task (a line given to the command seam, or a partial it may fire on): the pane is parked until it settles. */
  task<T>(run: () => Promise<T>): Promise<T>
}

export function createPaneVisibility(deps: { clock: Clock; onChange(visibility: PaneVisibility): void }): PaneVisibilityRule {
  let firstFrame = true
  let shown = false
  let earOpen = false
  let promptOpen = false
  let tasks = 0
  let visibility: PaneVisibility = 'parked'

  /** While the pane may be read, from the ear's opening until the Task has ended and the ear has closed. */
  const mayBeRead = (): boolean => earOpen || promptOpen || tasks > 0

  function settle(): void {
    const next: PaneVisibility = shown ? 'shown' : firstFrame || mayBeRead() ? 'parked' : 'hidden'
    if (next === visibility) return
    visibility = next
    deps.onChange(next)
  }

  return {
    current: () => visibility,
    hosted() {
      deps.clock.setTimer(FIRST_FRAME_MS, () => {
        firstFrame = false
        settle()
      })
    },
    inSight(inSight) {
      shown = inSight
      settle()
    },
    ear(open) {
      earOpen = open
      settle()
    },
    prompt(open) {
      promptOpen = open
      settle()
    },
    async task(run) {
      tasks += 1
      settle()
      try {
        return await run()
      } finally {
        tasks -= 1
        settle()
      }
    },
  }
}
