// Everything attached to a window lets go when it closes (#450). Each
// attach used to add its own `closed` listener, and a window with a pane,
// a feed panel and the rest passed Node's ten-listener warning at boot:
// "MaxListenersExceededWarning: 11 closed listeners added to
// [BrowserWindow]". One listener per window runs every disposal, in the
// order they were added, however many surfaces attach.

type Closable = Pick<Electron.BrowserWindow, 'once'>

const disposals = new WeakMap<Closable, Array<() => void>>()

/** Runs `dispose` once when `win` closes; the window carries one `closed` listener for all of them. */
export function onWindowClosed(win: Closable, dispose: () => void): void {
  const pending = disposals.get(win)
  if (pending !== undefined) {
    pending.push(dispose)
    return
  }
  const list = [dispose]
  disposals.set(win, list)
  win.once('closed', () => {
    disposals.delete(win)
    for (const run of list) run()
  })
}
