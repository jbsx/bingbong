import { describeFault } from '../../core/trace/fault'
import type { SessionAdoptionPayload } from '../../core/session/ipcChannels'
import type { SessionEvidencePayload } from '../../core/session/evidenceIpcChannels'
import type { EvidenceViewState } from '../../core/session/evidenceView'
import type { FeedPanelState } from '../../core/panel/feedPanelState'
import {
  evidenceRenderedEvent,
  sameFeedPanelView,
  RENDERER_FAULT_SITE_PREFIX,
  type FeedClearCause,
  type FeedPanelView,
  type RendererReport,
  type RendererSurface,
} from '../../core/trace/rendererTrace'

// The renderer's half of the diagnostics channel (#187, ADR 0031). Each
// page installs it once at its entry point, before React mounts, and
// every seam that has something to report calls one of the functions
// below — the record's shape and the page's own identity are decided
// here rather than at the call sites, so no seam can invent a field or
// misname the surface it is reporting from.
//
// The surface is a module-level binding, installed once at the page edge,
// for the same reason core's fault reporter is (ADR 0031): a diagnostic
// threaded as a dependency has to reach every seam that might fail, and
// the seams most worth hearing from — a `window.onerror`, a swallowed
// catch — are exactly the ones nobody would remember to wire. With
// nothing installed every call below does nothing, which is what makes
// this module safe to call from anywhere on the page.

let surface: RendererSurface | null = null

/**
 * Sends one report. Guarded whole: a page that cannot report a
 * diagnostic must still be a page, and the failure to report is by
 * definition the one failure there is nowhere left to report to.
 */
function send(event: RendererReport): void {
  if (surface === null) return
  try {
    window.bingbong.diagnostics.report(event)
  // eslint-disable-next-line no-restricted-syntax -- the reporter itself: reporting here would re-enter the send that failed
  } catch {
    // Diagnosis must never become the page's problem.
  }
}

/**
 * One renderer fault. `seam` is the dotted tail — the full site is
 * `renderer.<surface>.<seam>`, which is the prefix main requires and the
 * shape `voice.stt.transcribe` already reads as on the main side.
 */
export function reportRendererFault(seam: string, error: unknown): void {
  if (surface === null) return
  send({ kind: 'fault', site: `${RENDERER_FAULT_SITE_PREFIX}${surface}.${seam}`, ...describeFault(error) })
}

/** One Feed wipe: how many entries went, and what took them. */
export function reportFeedCleared(cause: FeedClearCause, entries: number): void {
  if (surface === null) return
  send({ kind: 'feed_cleared', surface, cause, entries })
}

// The last panel view reported by this page — a broadcast that changes
// neither the open state nor the mode is not news.
let lastPanelView: FeedPanelView | null = null

/** One Feed Panel open/close or mode change, as this page saw it. */
export function reportFeedPanelView(state: FeedPanelState): void {
  if (surface === null) return
  const view: FeedPanelView = { open: state.open, mode: state.mode }
  if (sameFeedPanelView(lastPanelView, view)) return
  lastPanelView = view
  send({ kind: 'feed_panel', surface, ...view })
}

/**
 * The page's first sight of the panel, from its mount pull. Silent once
 * anything has been reported: the pull can resolve after a broadcast has
 * already landed, and a stale answer arriving late would otherwise read
 * as the panel having changed back.
 */
export function reportFirstFeedPanelView(state: FeedPanelState): void {
  if (lastPanelView !== null) return
  reportFeedPanelView(state)
}

/** One authoritative evidence read: what main answered, what the view kept. */
export function reportEvidenceRendered(payload: SessionEvidencePayload | null, view: EvidenceViewState): void {
  if (surface === null) return
  send(evidenceRenderedEvent({ surface, payload, view }))
}

/** One re-adoption answer (ADR 0017) — including the one that adopted nothing. */
function reportSessionReadopt(source: 'page_load' | 'resend', identity: SessionAdoptionPayload | null): void {
  if (surface === null) return
  if (identity === null) {
    send({ kind: 'session_readopt', surface, source, adopted: false })
    return
  }
  send({
    kind: 'session_readopt',
    surface,
    source,
    adopted: true,
    adoptedSessionId: identity.sessionId,
    adoptedGeneration: identity.generation,
  })
}

/**
 * Installs the page's diagnostics: names the surface, turns the two
 * unhandled-failure events into faults, and records what re-adoption
 * answered this page.
 *
 * Re-adoption is watched here rather than in `useSessionAdoption`
 * because the record is about the page, not about a hook: both
 * Session-bearing hooks adopt through that one hook, and a record per
 * subscriber would say the same thing two or three times per page load.
 */
export function installRendererDiagnostics(page: RendererSurface): void {
  surface = page
  // Guarded whole, and for the reason the whole module exists: this runs
  // at the page's entry point, before the first render, so an install
  // that threw would take the page down with it. Diagnostics that can
  // break the page they diagnose are worse than none.
  try {
    window.addEventListener('error', (event) => {
      // `error` is absent when the failure crossed an origin the page
      // cannot read; the message is all there is, and it is still a fault.
      reportRendererFault('window.error', event.error ?? event.message)
    })
    window.addEventListener('unhandledrejection', (event) => {
      reportRendererFault('window.unhandledrejection', event.reason)
    })
    void window.bingbong.session
      .current()
      .then((identity) => reportSessionReadopt('page_load', identity))
      .catch((error: unknown) => reportRendererFault('session.current', error))
    window.bingbong.session.onReadopt((identity) => reportSessionReadopt('resend', identity))
  // eslint-disable-next-line no-restricted-syntax -- the reporter's own install: there is nowhere left to report to
  } catch {
    // The page renders without diagnostics rather than not at all.
  }
}
