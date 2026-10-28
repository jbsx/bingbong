import { BrowserWindow } from 'electron'
import type { Song } from '../../core/music/queue'
import type { BrowserController } from '../../core/ports/browser'
import type { MediaOpAction } from '../../core/browser/mediaOp'
import type { MediaFacts } from '../../core/browser/snapshot'
import { parseMediaFacts } from '../../core/browser/snapshot'
import { mediaChangesOf } from '../../core/command/mediaOp'
import { mediaOpHead, NO_OBSERVABLE_CHANGE } from '../../core/browser/actionOutcome'
import { APPLY_MEDIA_OP_FN, MEDIA_FACTS_FN } from '../browser/pageMediaScript'
import type { AudioSurface } from './player'

// The audio road's surface (#502): a window never shown, outside the pane,
// holding one bare `<audio>` that plays a song's stream — no video decode,
// no player scripts, no ads, no consent sheet, and the pane free for
// whatever comes next. Its page is shaped as the Player's scripts read a
// watch page (youtubeScripts.ts): the element in a `#movie_player`, the song
// named in `window.__bingbongAudio` and by `getVideoData`. Media Ops reach
// the element by kind (ADR 0080), as on any page. The app's `--mute-audio`
// (muteOffScreen.ts) silences it under tests as it does the pane.

/** The page: the element alone, in the holder the Player's scripts look in. */
const PAGE = '<!doctype html><meta charset="utf-8"><title></title><div id="movie_player"><audio preload="auto"></audio></div>'

/** The surface, and what the Appliance Card reads and does on its element while the song plays there (#485). */
export interface AudioRoadSurface extends AudioSurface {
  applianceMedia(): Promise<{ title: string; facts: MediaFacts } | null>
  applianceMediaOp(op: MediaOpAction): Promise<string>
  destroy(): void
}

export function createAudioSurface(): AudioRoadSurface {
  let win: BrowserWindow | null = null
  let ready: Promise<void> | null = null

  /** The window, made on the first song: a road never taken costs nothing. */
  function page(): Promise<BrowserWindow> {
    if (win === null || win.isDestroyed()) {
      win = new BrowserWindow({
        show: false,
        width: 320,
        height: 120,
        webPreferences: {
          partition: 'bingbong-audio',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          // The song plays unpressed, and on while the window is never shown.
          autoplayPolicy: 'no-user-gesture-required',
          backgroundThrottling: false,
        },
      })
      ready = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
    }
    const shown = win
    return ready!.then(() => shown)
  }

  async function evaluate<T>(script: string): Promise<T | undefined> {
    return (await (await page()).webContents.executeJavaScript(script)) as T | undefined
  }

  /** The element by kind, with `op` applied and its facts read before and after; null while no song is on it. */
  function onElement(op: MediaOpAction | null): Promise<{ title: string; before: unknown; after: unknown } | null | undefined> {
    return evaluate(`((op) => {
      /* AUDIO_ROAD_MEDIA */
      const el = document.querySelector('#movie_player audio')
      if (!el || !window.__bingbongAudio) return null
      const title = document.title
      if (op === null) { const facts = ${MEDIA_FACTS_FN}(el); return { title, before: facts, after: facts } }
      return { title, ...${APPLY_MEDIA_OP_FN}(el, op) }
    })(${JSON.stringify(op)})`)
  }

  return {
    evaluate,
    async load(song: Song, stream: string) {
      await evaluate(`((song, stream) => {
        /* AUDIO_ROAD_LOAD */
        window.__bingbongAudio = { id: song.id }
        const holder = document.querySelector('#movie_player')
        holder.getVideoData = () => ({ title: song.title, author: song.channel || '' })
        document.title = song.title
        const audio = holder.querySelector('audio')
        audio.loop = false
        audio.src = stream
        audio.play().catch(() => {})
      })(${JSON.stringify(song)}, ${JSON.stringify(stream)})`)
    },
    async stop() {
      if (win === null || win.isDestroyed()) return
      await evaluate(`(() => {
        /* AUDIO_ROAD_STOP */
        window.__bingbongAudio = null
        document.title = ''
        const audio = document.querySelector('#movie_player audio')
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      })()`)
    },
    async applianceMedia() {
      const read = await onElement(null)
      const facts = read == null ? undefined : parseMediaFacts(read.before)
      return read == null || facts === undefined ? null : { title: read.title, facts }
    },
    async applianceMediaOp(op) {
      const read = await onElement(op)
      if (read == null) throw new Error('no media is playing or started')
      const [before, after] = [parseMediaFacts(read.before), parseMediaFacts(read.after)]
      if (before === undefined || after === undefined) throw new Error("the element's media facts could not be read")
      const changes = mediaChangesOf(before, after)
      return `${mediaOpHead(op.op, 0)}${changes.length > 0 ? changes.join(', ') : NO_OBSERVABLE_CHANGE}`
    },
    destroy() {
      if (win !== null && !win.isDestroyed()) win.destroy()
      win = null
    },
  }
}

/**
 * The runner's browser with the Appliance Card's media on the audio road
 * (#502, #485): while the Player's song plays there, its element is the
 * appliance's media — read and acted on there, as YouTube's player is
 * first in the pane — and the pane's own media otherwise.
 */
export function withAudioRoadMedia<B extends Pick<BrowserController, 'applianceMedia' | 'applianceMediaOp'>>(browser: B, surface: Pick<AudioRoadSurface, 'applianceMedia' | 'applianceMediaOp'>, onRoad: () => boolean): B {
  const paneMedia = (): Promise<{ title: string; facts: MediaFacts } | null> => browser.applianceMedia?.() ?? Promise.resolve(null)
  return new Proxy(browser, {
    get(target, prop, receiver) {
      if (prop === 'applianceMedia') return async () => (onRoad() ? await surface.applianceMedia() : null) ?? (await paneMedia())
      if (prop === 'applianceMediaOp') {
        return async (op: MediaOpAction) => {
          if (onRoad() && (await surface.applianceMedia()) !== null) return surface.applianceMediaOp(op)
          if (target.applianceMediaOp === undefined) throw new Error('no media on this surface')
          return target.applianceMediaOp(op)
        }
      }
      return Reflect.get(target, prop, receiver) as unknown
    },
  })
}
