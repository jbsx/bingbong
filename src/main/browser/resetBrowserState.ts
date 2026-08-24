import type { BrowserPane } from './createBrowserPane'
import type { SubagentRuntime } from '../agent/createSubagentRuntime'

// Session-end cleanup (#96, deepened by #97): the one reusable discard
// attached to every Session end reason. It retires the Session's subagents —
// cancelling in-flight work, discarding pending reports, closing their
// transient tabs and panes without the linger — then drops the visible
// browsing state (page, navigation history, media state, page-local state),
// while the persistent Browser Profile (cookies, authentication, consent
// choices, site storage, preferences) survives untouched and every runtime
// stays reusable for the next Session. Nothing here recreates or clears the
// profile.

/**
 * Order: in-flight browsing agents stop initiating work and their reports
 * are discarded first, then their transient tabs close (dropping the
 * records — the ended Session owns them outright), then the visible pane
 * resets. Cancellation is not awaited — closing a tab destroys its
 * webContents, aborting whatever it had in flight, so only the (already
 * ended) Session's own orchestrator could re-navigate the main pane
 * afterwards.
 */
export function resetBrowserState(pane: BrowserPane, subagents: SubagentRuntime): void {
  subagents.retire()
  pane.reset()
}
