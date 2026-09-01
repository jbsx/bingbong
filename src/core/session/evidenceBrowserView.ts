import type { PipelineEvent } from '../pipeline/events'

// The Evidence Browser's selected view (#145): which of the feed panel's two
// tabs — Activity or Evidence — the panel shows. Session-owned and ephemeral:
// main folds it beside the panel layout state, so a selection survives
// docking, undocking, reload, and renderer crash within the Session, while
// every Session boundary (start of a new Session, end of the live one)
// returns it to Activity. It is never persisted — a view preference this
// momentary must not outlive its Session as an application preference.

export type EvidenceBrowserView = 'activity' | 'evidence'

/** Activity is the default: every newly created Session opens on it (#145). */
export const DEFAULT_EVIDENCE_BROWSER_VIEW: EvidenceBrowserView = 'activity'

export function isEvidenceBrowserView(value: unknown): value is EvidenceBrowserView {
  return value === 'activity' || value === 'evidence'
}

/**
 * Folds pipeline events and human selections into the Session-owned view
 * (#145), the same shape as the feed panel state fold. Only Session
 * lifecycle boundaries move it back to Activity; a human selection sticks
 * until the next boundary, whatever happens around it (runs start and end
 * within a Session without touching the selected view).
 */
export function createEvidenceBrowserViewFold(): {
  onEvent(event: PipelineEvent): void
  setView(view: EvidenceBrowserView): void
  state(): EvidenceBrowserView
} {
  let view: EvidenceBrowserView = DEFAULT_EVIDENCE_BROWSER_VIEW

  return {
    onEvent(event) {
      switch (event.type) {
        // A new Session opens on Activity — its default view (#145).
        case 'session_started':
        // Every Session end destroys the selection with the evidence: the
        // ended Session's Evidence Browser must not stay selected over the
        // empty replacement state it leaves behind.
        case 'session_ended':
          view = DEFAULT_EVIDENCE_BROWSER_VIEW
          return
        default:
          return
      }
    },
    setView(next) {
      if (!isEvidenceBrowserView(next)) return
      view = next
    },
    state: () => view,
  }
}
