import type { MenuItemConstructorOptions, WebContents } from 'electron'

// The app's keyboard shortcuts, heard in main on every input surface like
// the panel's and the idle shortcut: the keydown a renderer sees depends on
// which webContents owns focus, and the pane's never reach the dashboard.
//
// Electron's default menu is gone off macOS (appMenuTemplate): its
// accelerators acted on whichever surface held focus — Ctrl+R reloaded the
// dashboard itself, Ctrl+0 undid the pane's zoom Setting, Ctrl+Shift+I
// docked the DevTools into the layout, Ctrl+W and Ctrl+Q quit the appliance.
// What a browser user reaches for lands on the browsing pane instead, from
// whichever surface they press it on.

export type AppShortcut = 'reload' | 'hardReload' | 'back' | 'forward' | 'listen' | 'devTools'

type Chord = Pick<Electron.Input, 'type' | 'key' | 'control' | 'meta' | 'shift' | 'alt'>

export function shortcutOf(input: Chord, platform: NodeJS.Platform): AppShortcut | null {
  if (input.type !== 'keyDown') return null
  const key = input.key.toLowerCase()
  const command = input.control || input.meta
  if (key === 'f5') return input.shift || command ? 'hardReload' : 'reload'
  if (key === 'f12') return 'devTools'
  if (key === 'r' && command && !input.alt) return input.shift ? 'hardReload' : 'reload'
  if (key === ' ' && command && !input.alt) return 'listen'
  if (platform === 'darwin') {
    if (input.meta && !input.shift && !input.alt && key === '[') return 'back'
    if (input.meta && !input.shift && !input.alt && key === ']') return 'forward'
    if (input.meta && input.alt && key === 'i') return 'devTools'
    return null
  }
  if (input.alt && !command && !input.shift && key === 'arrowleft') return 'back'
  if (input.alt && !command && !input.shift && key === 'arrowright') return 'forward'
  if (input.control && input.shift && !input.alt && key === 'i') return 'devTools'
  return null
}

/** The application menu: none off macOS; there, only what Cmd+Q and the clipboard chords need. */
export function appMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] | null {
  return platform === 'darwin' ? [{ role: 'appMenu' }, { role: 'editMenu' }] : null
}

export interface AppShortcutActions {
  reload(ignoringCache: boolean): void
  back(): void
  forward(): void
  listen(): void
  /** The surface the chord was pressed on; absent, the chord is the page's (a packaged build). */
  devTools?(contents: WebContents): void
}

/** Hears the shortcuts on `contents`; the returned release stops hearing. */
export function attachAppShortcuts(contents: WebContents, actions: AppShortcutActions): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    const shortcut = shortcutOf(input, process.platform)
    if (shortcut === null) return
    if (shortcut === 'devTools') {
      if (!actions.devTools) return
      event.preventDefault()
      actions.devTools(contents)
      return
    }
    event.preventDefault()
    if (shortcut === 'reload' || shortcut === 'hardReload') actions.reload(shortcut === 'hardReload')
    else actions[shortcut]()
  }
  contents.on('before-input-event', onBeforeInput)
  return () => {
    if (!contents.isDestroyed()) contents.removeListener('before-input-event', onBeforeInput)
  }
}
