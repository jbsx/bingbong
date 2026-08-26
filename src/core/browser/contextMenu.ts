// The reconstructed page context menu: Electron cannot show Chromium's
// native menu, so the app rebuilds the appliance cut of the default one
// item by item — navigation verbs, honest link items (no new-tab fiction
// for a browser without tabs), clipboard verbs for selections and
// editables, image copies. Deliberately absent: Save As, Print, Cast,
// Translate, View Source, Inspect, and "Search Google for…" — they imply
// surfaces the appliance does not have or open devtools over a page an
// agent is driving (the same stability the mechanical Blocker gate,
// ADR 0010, depends on). Pure: main glue maps each action onto the
// webContents APIs; nothing here touches Electron.

export type PageContextMenuAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'openLink'
  | 'copyLink'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'copyImage'
  | 'copyImageUrl'

export interface PageContextMenuItem {
  kind: 'item'
  action: PageContextMenuAction
  label: string
  enabled: boolean
}

export interface PageContextMenuSeparator {
  kind: 'separator'
}

export type PageContextMenuEntry = PageContextMenuItem | PageContextMenuSeparator

/**
 * The params slice the menu needs — a structural subset of Electron's
 * context-menu params plus the pane's navigation state (Back/Forward are
 * pane facts, not page facts, so the caller injects them).
 */
export interface PageContextMenuParams {
  /** The href under the pointer, '' when none. */
  linkURL?: string
  mediaType?: 'none' | 'image' | 'video' | 'audio' | 'canvas' | 'file' | 'plugin'
  /** The media element's source address. */
  srcURL?: string
  selectionText?: string
  isEditable?: boolean
  editFlags?: { canCut?: boolean; canCopy?: boolean; canPaste?: boolean }
  canGoBack?: boolean
  canGoForward?: boolean
}

const separator: PageContextMenuSeparator = { kind: 'separator' }

export function pageContextMenuItems(params: PageContextMenuParams): PageContextMenuEntry[] {
  const items: PageContextMenuEntry[] = []

  if (typeof params.linkURL === 'string' && params.linkURL !== '') {
    items.push({ kind: 'item', action: 'openLink', label: 'Open Link', enabled: true })
    items.push({ kind: 'item', action: 'copyLink', label: 'Copy Link Address', enabled: true })
    items.push(separator)
  }

  const flags = params.editFlags ?? {}
  if (params.isEditable) {
    items.push({ kind: 'item', action: 'cut', label: 'Cut', enabled: flags.canCut === true })
    items.push({ kind: 'item', action: 'copy', label: 'Copy', enabled: flags.canCopy === true })
    items.push({ kind: 'item', action: 'paste', label: 'Paste', enabled: flags.canPaste === true })
    items.push(separator)
  } else if (typeof params.selectionText === 'string' && params.selectionText.trim() !== '') {
    items.push({ kind: 'item', action: 'copy', label: 'Copy', enabled: flags.canCopy !== false })
    items.push(separator)
  }

  items.push({ kind: 'item', action: 'back', label: 'Back', enabled: params.canGoBack === true })
  items.push({ kind: 'item', action: 'forward', label: 'Forward', enabled: params.canGoForward === true })
  items.push({ kind: 'item', action: 'reload', label: 'Reload', enabled: true })

  if (params.mediaType === 'image' && typeof params.srcURL === 'string' && params.srcURL !== '') {
    items.push(separator)
    items.push({ kind: 'item', action: 'copyImage', label: 'Copy Image', enabled: true })
    items.push({ kind: 'item', action: 'copyImageUrl', label: 'Copy Image Address', enabled: true })
  }

  // The separators above always trail a non-empty section, so the list
  // never starts, ends, or doubles on one.
  while (items[items.length - 1]?.kind === 'separator') items.pop()

  return items
}
