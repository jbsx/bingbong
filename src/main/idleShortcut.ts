import type { WebContents } from 'electron'

// The idle shortcut, Ctrl/Cmd+Shift+L: the Idle Screen now, without waiting
// out the inactivity timeout — for checking the screen while working on it.
// Heard in main, on every input surface, like the panel's Ctrl/Cmd+Shift+F:
// the keydown a renderer sees depends on which webContents owns focus, and
// the pane's never reach the dashboard. The key is swallowed, so the
// dashboard's own keydown never pings the idle timer awake again.

export function isIdleShortcut(input: Pick<Electron.Input, 'type' | 'key' | 'control' | 'meta' | 'shift' | 'alt'>): boolean {
  return input.type === 'keyDown' && input.key.toLowerCase() === 'l' && (input.control || input.meta) && input.shift && !input.alt
}

/** Hears the shortcut on `contents`; the returned release stops hearing. */
export function attachIdleShortcut(contents: WebContents, onShortcut: () => void): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    if (!isIdleShortcut(input)) return
    event.preventDefault()
    onShortcut()
  }
  contents.on('before-input-event', onBeforeInput)
  return () => {
    if (!contents.isDestroyed()) contents.removeListener('before-input-event', onBeforeInput)
  }
}
