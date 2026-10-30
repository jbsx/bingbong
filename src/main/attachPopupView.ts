import { BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'node:path'
import { isPaneRect } from '../core/browser/paneState'
import { toPaneBounds } from '../core/browser/paneGeometry'
import { WEIGHT_IPC } from '../core/scale/ipcChannels'
import { MUSIC_IPC } from '../core/music/ipcChannels'
import { resolvePreloadPath } from './preloadPath'
import { onWindowClosed } from './onWindowClosed'

// A pop-up over the browsing pane: renderer DOM cannot composite above the
// pane's WebContentsView, and the feed overlay's view has one rect — the
// edge tab's, the Peek Card's or the panel's — so a pop-up drawn in it took
// the tab away while it showed. Each pop-up has its own transparent view,
// stacked above the pane and the feed overlay, sized by the slot the
// dashboard reports, and 0×0 whenever the dashboard says the pop-up is not
// over the pane. The Weigh-in pop-up (#350) sits in the Peek Card's place;
// the Wait Card (#507) at the pane's top.

export interface PopupView {
  /** Re-adds the view last so it sits above the pane and the feed overlay. */
  bringToTop(): void
  /** The pop-up page's webContents, or null once destroyed. */
  contents(): Electron.WebContents | null
}

/** Each pop-up's page and the channel its slot's rect comes in on. */
const POPUPS = {
  weighIn: { page: 'weighin.html', rect: WEIGHT_IPC.popupRect },
  waitCard: { page: 'waitcard.html', rect: MUSIC_IPC.waitCardRect },
} as const

export function attachPopupViewToWindow(
  win: BrowserWindow,
  popup: keyof typeof POPUPS,
  deps: {
    preloadDir: string
    /** A pop-up only read (#507): the surfaces focus goes back to — whichever had it last, else the first — when a click lands on the pop-up. */
    focusBackTo?: readonly Electron.WebContents[]
  },
): PopupView {
  const { page, rect: rectChannel } = POPUPS[popup]
  const view = new WebContentsView({
    webPreferences: {
      preload: resolvePreloadPath(deps.preloadDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  view.setBackgroundColor('#00000000')
  view.setBounds(toPaneBounds({ x: 0, y: 0, width: 0, height: 0 }))
  win.contentView.addChildView(view)

  const wc = view.webContents
  if (process.env.ELECTRON_RENDERER_URL) {
    void wc.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  } else {
    void wc.loadFile(join(__dirname, `../renderer/${page}`))
  }

  if (deps.focusBackTo !== undefined && deps.focusBackTo.length > 0) {
    let last = deps.focusBackTo[0]!
    // The one focused last; the first named until any is.
    for (const surface of deps.focusBackTo) surface.on('focus', () => (last = surface))
    // Handed back a tick on: inside the event, the click's own focusing would follow and win.
    wc.on('focus', () => {
      setTimeout(() => {
        if (!last.isDestroyed()) last.focus()
      }, 0)
    })
  }

  const onRect = (event: Electron.IpcMainEvent, payload: unknown): void => {
    if (event.sender !== win.webContents) return
    const rect = (payload as { rect?: unknown } | null | undefined)?.rect
    if (isPaneRect(rect) && !wc.isDestroyed()) view.setBounds(toPaneBounds(rect))
  }
  ipcMain.on(rectChannel, onRect)
  onWindowClosed(win, () => {
    ipcMain.removeListener(rectChannel, onRect)
    if (!wc.isDestroyed()) wc.close()
  })

  return {
    bringToTop() {
      if (win.isDestroyed()) return
      win.contentView.removeChildView(view)
      win.contentView.addChildView(view)
    },
    contents: () => (wc.isDestroyed() ? null : wc),
  }
}
