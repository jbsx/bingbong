import { screen, type BrowserWindow } from 'electron'
import { fullscreenFit } from '../../core/app/fullscreenFit'

/**
 * Holds a fullscreen window on its display (see fullscreenFit). Checked at
 * once and on every move and resize — a window built fullscreen fires no
 * enter-full-screen, and the platform repositions it after the first
 * correction.
 */
export function holdFullscreenFit(win: BrowserWindow): void {
  const fit = (): void => {
    if (win.isDestroyed() || !win.isFullScreen()) return
    const content = win.getContentBounds()
    const target = fullscreenFit(content, screen.getDisplayMatching(content).bounds)
    if (target) win.setContentBounds(target)
  }
  fit()
  win.on('move', fit)
  win.on('resize', fit)
  win.on('ready-to-show', fit)
}
