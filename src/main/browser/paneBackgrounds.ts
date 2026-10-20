import { nativeTheme } from 'electron'

// Pane backgrounds follow the resolved Appearance (ADR 0020): the
// behind-content canvas must match the theme or every navigation flashes
// the wrong color. CSS cannot reach these native surfaces, so main owns
// them: every pane-ish view (and auth-popup window) registers here,
// paints the current theme's color, and the nativeTheme 'updated'
// broadcast repaints all. Renderers never need telling — themeSource
// drives their engine-level prefers-color-scheme; only these native
// surfaces need the repaint. The colors mirror styles.css's sheet (ADR
// 0078): --surface-solid, the panel tone the pane's viewport paints on the
// ground, light #eceef1 and dark #0b0d11 — keep them in step when the
// token sheet moves.

const PANE_BACKGROUND_LIGHT = '#eceef1'
const PANE_BACKGROUND_DARK = '#0b0d11'

/** The pane's rounded corners (ADR 0078): styles.css's --radius-lg less the frame's 1 px hairline. */
export const PANE_FRAME_RADIUS = 19

interface ThemedSurface {
  apply(color: string): void
  dead(): boolean
}

const tracked = new Set<ThemedSurface>()

export function paneBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? PANE_BACKGROUND_DARK : PANE_BACKGROUND_LIGHT
}

function track(surface: ThemedSurface): void {
  tracked.add(surface)
  surface.apply(paneBackgroundColor())
}

/** Paints the current theme's color now and on every theme change until the view dies. */
export function trackPaneBackground(view: Electron.WebContentsView): void {
  const surface: ThemedSurface = {
    apply: (color) => view.setBackgroundColor(color),
    dead: () => view.webContents.isDestroyed(),
  }
  track(surface)
  view.webContents.once('destroyed', () => tracked.delete(surface))
}

/** Auth popups are plain windows, not views — same contract, window API. */
export function trackWindowBackground(win: Electron.BrowserWindow): void {
  const surface: ThemedSurface = {
    apply: (color) => win.setBackgroundColor(color),
    dead: () => win.isDestroyed(),
  }
  track(surface)
  win.once('closed', () => tracked.delete(surface))
}

nativeTheme.on('updated', () => {
  const color = paneBackgroundColor()
  for (const surface of tracked) {
    if (!surface.dead()) surface.apply(color)
  }
})
