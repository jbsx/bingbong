import type { BrowserPane } from './createBrowserPane'
import type { SubagentRuntime } from '../agent/createSubagentRuntime'

// Browser State cleanup (#96): the one reusable discard attached to every
// Session end reason. It drops the Session's browsing work — the visible
// page, navigation history, media state, page-local state, and the
// transient subagent surfaces — while the persistent Browser Profile
// (cookies, authentication, consent choices, site storage, preferences)
// survives untouched and the browser runtime stays reusable for the next
// Session. Nothing here recreates or clears the profile.

/**
 * Order: in-flight browsing agents stop initiating work first, then their
 * transient tabs close without the linger, then the visible pane resets.
 * Cancellation is not awaited — closing a tab destroys its webContents,
 * aborting whatever it had in flight, so only the (already-ended) Session's
 * own orchestrator could re-navigate the main pane afterwards.
 */
export function resetBrowserState(pane: BrowserPane, subagents: SubagentRuntime): void {
  subagents.cancelAll()
  subagents.closeAllTabs()
  pane.reset()
}
