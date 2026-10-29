import type { ShownLine } from './shownSpeech'

/** How long a line stays up (#513): the Peek Card's 15 s (#470), or until the next line. */
export const LINE_OVERLAY_MS = 15_000

/** The line on the Line Overlay and when it was shown. */
export interface OverlayLine extends ShownLine {
  readonly at: number
}

/** The Line Overlay's fold (#513): the last `line` event, the next one taking its place. */
export function lineAfter(last: OverlayLine | null, event: { type: string; text?: string; failure?: boolean; at: number }): OverlayLine | null {
  if (event.type !== 'line' || event.text === undefined) return last
  return { text: event.text, failure: event.failure === true, at: event.at }
}

/** Milliseconds the line has left up at `now`; 0 once it is gone. */
export function lineShownFor(line: OverlayLine | null, now: number): number {
  if (line === null) return 0
  return Math.max(0, line.at + LINE_OVERLAY_MS - now)
}

export type LineOverlaySurface = 'none' | 'pane' | 'idle' | 'dashboard'

/**
 * Where the Line Overlay draws (#513), as the Wait Card does (#507): its
 * own view over the pane, the Idle Screen, or the dashboard's own layer
 * over Settings and the Weight page.
 */
export function lineOverlaySurface(up: boolean, idle: boolean, view: 'dashboard' | 'settings' | 'weight'): LineOverlaySurface {
  if (!up) return 'none'
  if (idle) return 'idle'
  return view === 'dashboard' ? 'pane' : 'dashboard'
}
