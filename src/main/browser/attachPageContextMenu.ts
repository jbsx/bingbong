import { BrowserWindow, clipboard, Menu } from 'electron'
import { pageContextMenuItems, type PageContextMenuAction, type PageContextMenuParams } from '../../core/browser/contextMenu'
import { canStepBack } from './paneNavigation'

// Electron glue for the reconstructed page menu: the pure fold in
// core/browser/contextMenu.ts decides the items — the appliance cut of
// Chromium's default, minus everything that implies surfaces the app does
// not have (tabs, windows, devtools; see ADR 0010 for why page-DOM tools
// stay out) — and this maps each action onto the webContents APIs and
// pops the native menu. One attachment per browse-partition webContents —
// pane, subagent panes, auth popups — so right-click behaves identically
// on every page the appliance renders. App chrome (dashboard, overlay)
// gets no menu: that is deliberate, not an omission.

/**
 * How long past a hold's release a native menu stays held back (#363):
 * Chromium raises `context-menu` over IPC after the right button's
 * release, which can land after the controller's action has returned.
 */
const HOLD_GRACE_MS = 500

/** Per page: the holds taken and not released, and when the last released one stops holding. */
const holds = new WeakMap<Electron.WebContents, { count: number; until: number }>()

/**
 * Hold the native page menu back on this page until the returned release
 * (#363, ADR 0079): the right-click the controller dispatches to open a
 * page's own menu must never pop the appliance's.
 */
export function holdPageContextMenu(contents: Electron.WebContents): () => void {
  const hold = holds.get(contents) ?? { count: 0, until: 0 }
  hold.count += 1
  holds.set(contents, hold)
  let released = false
  return () => {
    if (released) return
    released = true
    hold.count -= 1
    hold.until = Date.now() + HOLD_GRACE_MS
  }
}

/** Whether a dispatched right-click holds the native menu back on this page now. */
function menuHeld(contents: Electron.WebContents): boolean {
  const hold = holds.get(contents)
  return hold !== undefined && (hold.count > 0 || Date.now() < hold.until)
}

/** The params an action may need at execution time. */
interface MenuActionContext {
  linkURL: string
  srcURL: string
  x: number
  y: number
}

export function attachPageContextMenu(contents: Electron.WebContents): void {
  contents.on('context-menu', (_event, params) => {
    if (contents.isDestroyed() || menuHeld(contents)) return
    const menuParams: PageContextMenuParams = {
      linkURL: params.linkURL,
      mediaType: params.mediaType,
      srcURL: params.srcURL,
      selectionText: params.selectionText,
      isEditable: params.isEditable,
      editFlags: {
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
      },
      canGoBack: canStepBack(contents),
      canGoForward: contents.navigationHistory.canGoForward(),
    }
    const entries = pageContextMenuItems(menuParams)
    if (entries.length === 0) return

    const context: MenuActionContext = { linkURL: params.linkURL, srcURL: params.srcURL, x: params.x, y: params.y }
    const template = entries.map((entry) =>
      entry.kind === 'separator'
        ? { type: 'separator' as const }
        : {
            label: entry.label,
            enabled: entry.enabled,
            click: () => runMenuAction(contents, entry.action, context),
          },
    )

    const win = BrowserWindow.fromWebContents(contents)
    Menu.buildFromTemplate(template).popup({ window: win ?? undefined })
  })
}

function runMenuAction(contents: Electron.WebContents, action: PageContextMenuAction, context: MenuActionContext): void {
  if (contents.isDestroyed()) return
  switch (action) {
    case 'back':
      if (canStepBack(contents)) contents.navigationHistory.goBack()
      return
    case 'forward':
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
      return
    case 'reload':
      contents.reload()
      return
    case 'openLink':
      // The honest wording: "Open Link" navigates the page the user is
      // looking at — this browser has no tabs to open into.
      if (context.linkURL !== '') void contents.loadURL(context.linkURL)
      return
    case 'copyLink':
      if (context.linkURL !== '') clipboard.writeText(context.linkURL)
      return
    case 'copy':
      contents.copy()
      return
    case 'cut':
      contents.cut()
      return
    case 'paste':
      contents.paste()
      return
    case 'copyImage':
      contents.copyImageAt(context.x, context.y)
      return
    case 'copyImageUrl':
      if (context.srcURL !== '') clipboard.writeText(context.srcURL)
      return
  }
}
