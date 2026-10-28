import type { FakeBrowser } from '../../core/testing/doubles'
import { videoIdOf } from '../../core/music/youtubeSearch'
import { loudnessFactor } from '../../core/music/loudness'
import type { ElementOp, ElementState, LevelRead, PausedAll, StartRead, WatchStatus } from './youtubeScripts'

// A scripted YouTube for the tests (#343): it answers the Player's tagged
// scripts the way the real pages would — the results' `ytInitialData` for a
// search, the watch page's status and its video — off the address the
// FakeBrowser last navigated to. Test support only.

/** A results page's data with these items in its first section. */
export function resultsData(...items: unknown[]): unknown {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } },
      },
    },
  }
}

/** A plain video result, and the channel that posted it when given. */
export function videoItem(id: string, title: string, channel?: string): unknown {
  return { videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, navigationEndpoint: { watchEndpoint: { videoId: id } }, ...(channel !== undefined ? { ownerText: { runs: [{ text: channel }] } } : {}) } }
}

/** A watch page: the song it plays, or how it fails — the player's error, or no watch page at all (a sign-in wall). */
export interface ScriptedWatch {
  readonly title: string
  readonly channel?: string
  readonly fails?: 'error' | 'notWatch'
}

/**
 * How a new watch page's element starts (#488): by itself; only once
 * pressed; playing {@link STALLS_AT_S} and pausing until pressed;
 * never, its press refused with `NotAllowedError`; or, `reopen`, holding
 * no data however pressed until its page is loaded again, then by itself.
 */
export type ScriptedStart = 'itself' | 'press' | 'stalls' | 'refuses' | 'reopen'

/** Where a stalling element pauses by itself (s): a moment of play, as on a fresh profile under Xvfb (#488). */
export const STALLS_AT_S = 0.6
/** How far the element's time moves between two start reads while it plays (s): the Player's read interval. */
export const START_STEP_S = 0.25

export class ScriptedYouTube {
  /** Search words → the results' data. */
  readonly results = new Map<string, unknown>()
  /** Video id → its watch page. */
  readonly watches = new Map<string, ScriptedWatch>()
  /** Every control the element took, in order. */
  readonly controls: ElementOp[] = []
  readonly fetched: string[] = []
  /** The watch page's video element; `duration` null while it does not know its length, as the watch script reports it. */
  element: { paused: boolean; loop: boolean; volume: number; muted: boolean; currentTime: number; duration: number | null } = { paused: false, loop: false, volume: 100, muted: false, currentTime: 0, duration: 180 }
  /** The page's own media elements beside YouTube's player — any site's (#376). */
  pageMedia: { paused: boolean }[] = []
  /** How often an idle `stop` paused what plays on the page (#376). */
  pauseAlls = 0
  /** The volume YouTube's player remembers: what `setVolume` told it, never the duck's floor. */
  playerVolume = 100
  /** Video id → its response's `loudnessDb` (#460): a page opens at `playerVolume` × its loudness factor; none is a factor of 1. */
  readonly loudness = new Map<string, number>()
  /** The duck's mark on the element (#459): the volume (0–100) it puts back and the floor's share; a new page's element has none. */
  duckMark: { restore: number; share: number } | null = null
  /** The pane's duck (#461), its floor's share while it holds: it reaches a new page's element before the Player does. */
  paneDuck: number | null = null
  adShowing = false
  /** How the next watch page's element starts (#488). */
  starts: ScriptedStart = 'itself'
  /** The element's `readyState`: 4 holds enough to play through. */
  readyState = 4
  /** The last press's refusal, as the element keeps it. */
  private refused: string | null = null
  /** A stalling element was pressed: it plays on. */
  private pressed = false
  /** YouTube's "Continue watching?" prompt is up. */
  continuePrompt = false
  /** How often the prompt was answered Yes. */
  continued = 0
  private ended: { id: string | null; ad: boolean } | null = null

  constructor(private readonly browser: FakeBrowser) {
    browser.evaluator = (expression) => this.evaluate(expression)
  }

  /** The results for these words: these items, in order. */
  search(words: string, ...items: unknown[]): void {
    this.results.set(words, resultsData(...items))
  }

  /** The video playing ends now — an ad's, when `adShowing` is set. */
  endVideo(): void {
    this.ended = { id: this.currentId(), ad: this.adShowing }
    if (!this.adShowing) this.element = { ...this.element, paused: true }
  }

  /** The results page's HTML for a fetched search, as YouTube serves it. */
  fetchResults = async (url: string): Promise<string> => {
    this.fetched.push(url)
    const data = this.results.get(new URL(url).searchParams.get('search_query') ?? '')
    return data === undefined ? '<html>no data</html>' : `<script>var ytInitialData = ${JSON.stringify(data)};</script>`
  }

  private currentId(): string | null {
    return videoIdOf(this.browser.state().url ?? '')
  }

  /** The address the element was last read on, and how many loads in: a new watch page — the same one loaded again too — plays from the start, unlooped. */
  private shownUrl: string | null = null
  private shownLoads = 0
  /** Loads of a `reopen` page: its first holds no data. */
  private reopenLoads = 0

  private evaluate(expression: string): unknown {
    const url = this.browser.state().url ?? ''
    const loads = this.browser.navigations.length
    if (url !== this.shownUrl || loads !== this.shownLoads) {
      this.shownUrl = url
      this.shownLoads = loads
      if (this.starts === 'reopen') {
        this.reopenLoads += 1
        this.readyState = this.reopenLoads === 1 ? 0 : 4
      }
      this.element = { ...this.element, paused: this.starts === 'press' || this.starts === 'refuses', loop: false, currentTime: 0, volume: this.playerVolume * loudnessFactor(this.loudnessDb(this.currentId())) }
      this.refused = null
      this.pressed = false
      this.duckMark = null
      // The pane's duck holds (#461): a new page's element is marked at the level it opened at before the Player reads it.
      if (this.paneDuck !== null) {
        this.duckMark = { restore: this.element.volume, share: this.paneDuck }
        this.element = { ...this.element, volume: Math.round(this.element.volume * this.paneDuck) }
      }
    }
    if (expression.includes('/* YT_RESULTS */')) {
      const data = URL.canParse(url) ? this.results.get(new URL(url).searchParams.get('search_query') ?? '') : undefined
      return data === undefined ? null : JSON.stringify(data)
    }
    if (expression.includes('/* YT_WATCH */')) return this.watchStatus()
    if (expression.includes('/* YT_LEVEL */')) return this.level()
    if (expression.includes('/* YT_START */')) return this.startRead()
    if (expression.includes('/* YT_CONTINUE */')) return this.answerPrompt()
    if (expression.includes('/* PAGE_PAUSE_ALL */')) return this.pauseAll()
    // The op rides at the script's end, `})(<op json>)`; the body holds other IIFEs before it.
    if (expression.includes('/* YT_CONTROL */')) return this.control(JSON.parse(expression.slice(expression.lastIndexOf('})(') + 3, -1)) as ElementOp)
    return undefined
  }

  private loudnessDb(id: string | null): number | null {
    return id === null ? null : (this.loudness.get(id) ?? null)
  }

  private level(): LevelRead | null {
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    if (watch === undefined || watch.fails !== undefined) return null
    return { id, ad: this.adShowing, volume: this.element.volume, loudnessDb: this.loudnessDb(id), playerVolume: this.playerVolume, restore: this.duckMark?.restore ?? null }
  }

  /** The element read for its start (#488): while it plays, its time moves a read's step — a stalling one pausing at its moment. */
  private startRead(): StartRead | null {
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    if (watch === undefined || watch.fails !== undefined) return null
    // Time moves only on an element holding data to play.
    if (!this.element.paused && this.readyState > 2) {
      const time = this.element.currentTime + START_STEP_S
      const stalls = this.starts === 'stalls' && !this.pressed && time >= STALLS_AT_S
      this.element = { ...this.element, currentTime: stalls ? STALLS_AT_S : time, paused: stalls }
    }
    const { paused, currentTime } = this.element
    return { paused, ended: false, ready: this.readyState, time: currentTime, refused: this.refused }
  }

  private watchStatus(): WatchStatus {
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    const ended = this.ended
    this.ended = null
    const element = this.element
    const playing = { elapsed: element.currentTime, duration: element.duration, paused: element.paused, loop: element.loop, volume: element.volume, muted: element.muted, ducked: this.duckMark !== null, restore: this.duckMark?.restore ?? null, prompt: this.continuePrompt, loudnessDb: this.loudnessDb(id), playerVolume: this.playerVolume }
    if (watch?.fails === 'notWatch' || id === null) return { watch: false, id: null, title: 'Sign in', hasVideo: false, error: false, ad: false, ended: null, channel: '', ...playing }
    return { watch: true, id, title: watch?.title ?? '', hasVideo: watch !== undefined, error: watch?.fails === 'error', ad: this.adShowing, ended, channel: watch?.channel ?? '', ...playing }
  }

  private answerPrompt(): boolean {
    if (!this.continuePrompt) return false
    this.continuePrompt = false
    this.continued += 1
    this.element = { ...this.element, paused: false }
    return true
  }

  private pauseAll(): PausedAll {
    this.pauseAlls += 1
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    const youtube = watch !== undefined && watch.fails === undefined && !this.element.paused
    if (youtube) this.element = { ...this.element, paused: true }
    const playing = this.pageMedia.filter((media) => !media.paused).length
    this.pageMedia = this.pageMedia.map(() => ({ paused: true }))
    return { paused: playing + (youtube ? 1 : 0), youtube }
  }

  private control(op: ElementOp): ElementState {
    this.controls.push(op)
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    if (watch === undefined || watch.fails !== undefined) return { found: false, changed: false, title: '', paused: true, loop: false, volume: 0, muted: false, ducked: false }
    let changed = true
    if ((op.op === 'volume' || op.op === 'nudge' || op.op === 'level') && op.duck !== undefined) this.duckMark ??= { restore: Math.max(0, Math.min(100, op.duck.restore)), share: op.duck.share }
    const element = this.element
    switch (op.op) {
      case 'play':
        // A press (#488): refused, the element stays paused and keeps the reason.
        this.pressed = true
        this.refused = this.starts === 'refuses' ? 'NotAllowedError' : null
        this.element = { ...element, paused: this.starts === 'refuses' }
        break
      case 'restart':
        this.element = { ...element, paused: false }
        break
      case 'pause':
        this.element = { ...element, paused: true }
        break
      case 'loop':
        this.element = { ...element, loop: op.on }
        break
      case 'volume':
        this.playerVolume = op.to
        this.setHeard(Math.round(op.to))
        break
      case 'level':
        this.setHeard(op.to)
        break
      case 'duck': {
        const mark = (this.duckMark ??= { restore: Math.max(0, Math.min(100, op.restore)), share: op.share })
        this.element = { ...element, volume: Math.round(mark.restore * mark.share) }
        break
      }
      case 'unduck':
        this.element = { ...element, volume: this.duckMark?.restore ?? op.to }
        this.duckMark = null
        break
      case 'nudge':
        this.playerVolume = Math.max(0, Math.min(100, Math.round(this.heard() + op.by)))
        this.setHeard(this.playerVolume)
        break
      case 'mute':
        this.element = { ...element, muted: op.on }
        break
      case 'read':
        changed = false
        break
    }
    const { paused, loop, muted } = this.element
    return { found: true, changed, title: watch.title, paused, loop, volume: this.heard(), muted, ducked: this.duckMark !== null }
  }

  /** The volume heard once no duck holds the element (#459): the mark's, else the element's own. */
  heard(): number {
    return this.duckMark?.restore ?? this.element.volume
  }

  /** A volume set on the element as the page scripts set it (#459): under a duck the mark takes it, the element left at its floor — a Media Op's own set, too. */
  setHeard(to: number): void {
    // Clamped, not rounded: a level carried into a new song is set unrounded (#460), as the page sets it.
    const level = Math.max(0, Math.min(100, to))
    if (this.duckMark === null) {
      this.element = { ...this.element, volume: level }
      return
    }
    this.duckMark.restore = level
    this.element = { ...this.element, volume: Math.round(level * this.duckMark.share) }
  }
}
