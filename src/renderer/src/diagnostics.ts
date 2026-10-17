import { describeFault } from '../../core/trace/fault'

// The renderer's fault seam: a swallowed failure on a page goes here rather
// than nowhere. The stripped branch (kachow) keeps no diagnostics channel
// to main, so a report is a console warning — enough to see a renderer
// seam fail during development, and a no-op cost otherwise.

/** The page a report comes from. */
export type RendererSurface = 'dashboard' | 'feed_panel'

let surface: RendererSurface | null = null

/**
 * One renderer fault. `seam` is the dotted tail — the full site is
 * `renderer.<surface>.<seam>`, the shape `voice.stt.transcribe` already
 * reads as on the main side.
 */
export function reportRendererFault(seam: string, error: unknown): void {
  if (surface === null) return
  try {
    const { message } = describeFault(error)
    console.warn(`renderer.${surface}.${seam}: ${message}`)
  // eslint-disable-next-line no-restricted-syntax -- the reporter itself: there is nowhere left to report to
  } catch {
    // Diagnosis must never become the page's problem.
  }
}

/**
 * Installs the page's diagnostics: names the surface and turns the two
 * unhandled-failure events into faults.
 */
export function installRendererDiagnostics(page: RendererSurface): void {
  surface = page
  // Guarded whole: this runs at the page's entry point, before the first
  // render, so an install that threw would take the page down with it.
  try {
    window.addEventListener('error', (event) => {
      // `error` is absent when the failure crossed an origin the page
      // cannot read; the message is all there is, and it is still a fault.
      reportRendererFault('window.error', event.error ?? event.message)
    })
    window.addEventListener('unhandledrejection', (event) => {
      reportRendererFault('window.unhandledrejection', event.reason)
    })
  // eslint-disable-next-line no-restricted-syntax -- the reporter's own install: there is nowhere left to report to
  } catch {
    // The page renders without diagnostics rather than not at all.
  }
}
