import type { WebContents } from 'electron'

// Web zoom (#53): the configured percent is (re)applied at attach and on
// every committed navigation, so each page load starts readable — manual
// wheel-zoom survives until then. In-page navigations (pushState, anchors)
// deliberately keep the current zoom: they are not page loads. Chromium
// also remembers zoom per host, so cross-site navigations need the
// explicit re-apply.

/** Applies the configured zoom; the getter is read live, so a settings
 * save takes effect on the next load without a subscription. */
export function applyPaneZoom(wc: WebContents, getZoomPercent?: () => number): void {
  if (getZoomPercent && !wc.isDestroyed()) wc.setZoomFactor(getZoomPercent() / 100)
}
