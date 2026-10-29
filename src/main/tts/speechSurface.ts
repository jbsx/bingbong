import { BrowserWindow } from 'electron'
import type { SpeechSurface } from './createChromiumPlayer'
import { SPEECH_PAGE } from './speechPageScript'

// Where the app's own voice plays when it plays through Chromium (#490): a
// window never shown, outside the pane, holding only the speech page
// (speechPageScript.ts). Never the pane's web contents: the pane's media
// collector, the pane duck (#461), Now Playing and the Media Ops must never
// see the app's voice as page media. Another window serves the echo
// canceller as well as the mic's own (the #490 spike: −68 → −98 dBFS in
// another window, −61 → −97 in the mic's), so the voice stays out of the
// dashboard too. Its own partition keeps the pane's cookies and blockers
// away from it. The app's `--mute-audio` (muteOffScreen.ts) silences it
// under tests as it does the pane, and the Sound Mute's hold on every web
// contents (attachSoundMute.ts) reaches it.

export interface SpeechWindowSurface extends SpeechSurface {
  /** Make the window now, so the first line pays no window start; only once the app is ready. */
  prefetch(): void
  /** Close the window, and make none again until the next prefetch: a hidden window left behind keeps the app from quitting. */
  destroy(): void
}

export function createSpeechSurface(): SpeechWindowSurface {
  let win: BrowserWindow | null = null
  let ready: Promise<void> | null = null
  let closed = false

  /** The window, made on first use; every call is chained on its load, so they reach the page in the order made. */
  function page(): Promise<BrowserWindow> {
    if (closed) return Promise.reject(new Error('the speech window is closed'))
    if (win === null || win.isDestroyed()) {
      win = new BrowserWindow({
        show: false,
        width: 120,
        height: 60,
        webPreferences: {
          partition: 'bingbong-speech',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          // The voice plays unpressed, and on while the window is never shown.
          autoplayPolicy: 'no-user-gesture-required',
          backgroundThrottling: false,
        },
      })
      ready = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPEECH_PAGE)}`)
    }
    const shown = win
    return ready!.then(() => shown)
  }

  function call<T>(script: string): Promise<T> {
    return page().then((shown) => shown.webContents.executeJavaScript(script) as Promise<T>)
  }

  /** A call whose answer nobody waits on: a failure shows in `done`, which every stream is awaited by. */
  function send(script: string): void {
    call(script).catch(() => {})
  }

  return {
    open(id, silent) {
      send(`window.__speech.open(${id}, ${silent})`)
      return {
        first: call<boolean>(`window.__speech.first(${id})`),
        done: call<void>(`window.__speech.done(${id})`),
      }
    },
    write(id, format, pcm) {
      const b64 = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
      send(`window.__speech.write(${id}, ${format.sampleRate}, ${format.channels}, ${format.bitsPerSample}, '${b64}')`)
    },
    end(id) {
      send(`window.__speech.end(${id})`)
    },
    gain(id, value) {
      send(`window.__speech.gain(${id}, ${value})`)
    },
    stop(id) {
      send(`window.__speech.stop(${id})`)
    },
    prefetch() {
      closed = false
      void page().catch(() => {})
    },
    destroy() {
      closed = true
      if (win !== null && !win.isDestroyed()) win.destroy()
      win = null
    },
  }
}
