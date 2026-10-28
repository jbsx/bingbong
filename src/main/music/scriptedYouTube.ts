import { FakeBrowser } from '../../core/testing/doubles'
import { videoIdOf, watchUrl } from '../../core/music/youtubeSearch'
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
 * never, its press refused with `NotAllowedError`; `reopen`, holding
 * no data however pressed until its page is loaded again, then by itself;
 * or, `sheet` (#492), under a consent sheet that draws on the
 * {@link SHEET_DRAWS_AT}th read of the page, the page signalling it as it
 * draws (#496), and holds the element unfed however pressed, until it is
 * cleared — then by itself, and no page of the profile shows it again.
 */
export type ScriptedStart = 'itself' | 'press' | 'stalls' | 'refuses' | 'reopen' | 'sheet'

/** Which read of the page first finds the sheet drawn (#492): a sheet draws after the landing settled. */
export const SHEET_DRAWS_AT = 3
/** The browser's dismissal line for the sheet. */
export const SHEET_DISMISSAL = 'dismissed consent dialog: clicked [5] "Reject the use of cookies and other data for the purposes d…"'

/** Where a stalling element pauses by itself (s): a moment of play, as on a fresh profile under Xvfb (#488). */
export const STALLS_AT_S = 0.6
/** How far the element's time moves between two start reads while it plays (s): the Player's read interval. */
export const START_STEP_S = 0.25

export class ScriptedYouTube {
  /** Search words → the results' data. */
  readonly results = new Map<string, unknown>()
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
  /**
   * A pre-roll ad the next watch page plays in its element before the song
   * (#497), its length (s) — or a pod of them, the marker off for one read
   * between two; null for none. Its time moves on the start's reads, and at
   * its end the song plays from 0 by itself.
   */
  preRollS: number | readonly number[] | null = null
  /** The second of an ad from which the engine offers to skip it (#497), its Skip button up; null for an ad never skippable. */
  skippableAtS: number | null = null
  /** How often the engine's Skip button was pressed over an ad (#497). */
  adsSkipped = 0
  /** The pre-roll playing now, the pod's ads after it, the song's length the element reports once they end, and whether the marker is off between two. */
  private ad: { lengthS: number; next: number[]; song: number | null; between: boolean } | null = null
  /** How the next watch page's element starts (#488). */
  starts: ScriptedStart = 'itself'
  /** The element's `readyState`: 4 holds enough to play through. */
  readyState = 4
  /** The last press's refusal, as the element keeps it. */
  private refused: string | null = null
  /** A stalling element was pressed: it plays on. */
  private pressed = false
  /** The consent sheet over this page (#492), how often the page was read under it, and whether it has drawn; null with none. */
  private sheet: { reads: number; drawn: boolean } | null = null
  /** The sheet was cleared once: the profile has consented. */
  private consented = false
  /** How often the browser's clear cleared the sheet. */
  sheetsCleared = 0
  /** How many timer turns a clear of the drawn sheet takes (#492), the browser's collect and Jev's ask: past every read of a start whose waits take none. */
  sheetClearTurns = 0
  /** YouTube's own player starts the song as the sheet leaves, whatever paused it before (#489, the kept runs at d9e84eec). */
  sheetStartsOnClear = false
  /** YouTube's "Continue watching?" prompt is up. */
  continuePrompt = false
  /** How often the prompt was answered Yes. */
  continued = 0
  private ended: { id: string | null; ad: boolean } | null = null

  constructor(
    private readonly browser: FakeBrowser,
    /** Video id → its watch page; the audio road's stand-in shares the pane's (#502). */
    readonly watches: Map<string, ScriptedWatch> = new Map(),
  ) {
    browser.evaluator = (expression) => this.evaluate(expression)
    browser.consentClear = () => this.clearSheet()
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

  /** The browser's consent clear (#492): the sheet, once drawn, is cleared — after {@link sheetClearTurns} timer turns — and the element fed. */
  private async clearSheet(): Promise<string | null> {
    this.onPage()
    if (this.sheet === null || !this.sheet.drawn) return null
    for (let turn = 0; turn < this.sheetClearTurns; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    this.sheet = null
    this.consented = true
    this.sheetsCleared += 1
    this.readyState = 4
    if (this.sheetStartsOnClear) this.element = { ...this.element, paused: false }
    return SHEET_DISMISSAL
  }

  private evaluate(expression: string): unknown {
    this.onPage()
    const sheet = this.sheet
    if (sheet !== null && !sheet.drawn && ++sheet.reads >= SHEET_DRAWS_AT) {
      sheet.drawn = true
      // The page's own watch tells of it as it draws (#496), just after the read that drew it.
      queueMicrotask(() => this.browser.drawConsent({ playing: false, showing: 1 }))
    }
    return this.answer(expression)
  }

  /** A page loaded since the last look starts afresh. */
  private onPage(): void {
    const url = this.browser.state().url ?? ''
    const loads = this.browser.navigations.length
    if (url !== this.shownUrl || loads !== this.shownLoads) {
      this.shownUrl = url
      this.shownLoads = loads
      if (this.starts === 'reopen') {
        this.reopenLoads += 1
        this.readyState = this.reopenLoads === 1 ? 0 : 4
      }
      if (this.starts === 'sheet') {
        this.sheet = this.consented ? null : { reads: 0, drawn: false }
        this.readyState = this.consented ? 4 : 0
      }
      this.element = { ...this.element, paused: this.starts === 'press' || this.starts === 'refuses', loop: false, currentTime: 0, volume: this.playerVolume * loudnessFactor(this.loudnessDb(this.currentId())) }
      this.refused = null
      this.pressed = false
      this.duckMark = null
      // The pre-roll (#497): the element plays the ad first, at its length, the page's ad marker on.
      const pod = this.preRollS === null ? [] : typeof this.preRollS === 'number' ? [this.preRollS] : [...this.preRollS]
      this.ad = pod.length === 0 ? null : { lengthS: pod[0]!, next: pod.slice(1), song: this.ad?.song ?? this.element.duration, between: false }
      this.preRollS = null
      // A new page's element holds no ad but its own pre-roll: the last page's marker is gone with it.
      this.adShowing = this.ad !== null
      if (this.ad !== null) this.element = { ...this.element, paused: false, duration: this.ad.lengthS }
      // The pane's duck holds (#461): a new page's element is marked at the level it opened at before the Player reads it.
      if (this.paneDuck !== null) {
        this.duckMark = { restore: this.element.volume, share: this.paneDuck }
        this.element = { ...this.element, volume: Math.round(this.element.volume * this.paneDuck) }
      }
    }
  }

  private answer(expression: string): unknown {
    const url = this.browser.state().url ?? ''
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
    // Between two ads of a pod: the next one starts from 0, the marker on again.
    if (this.ad !== null && this.ad.between) {
      this.ad = { ...this.ad, between: false }
      this.adShowing = true
      this.element = { ...this.element, currentTime: 0, duration: this.ad.lengthS }
    }
    // Time moves only on an element holding data to play.
    if (!this.element.paused && this.readyState > 2) {
      const time = this.element.currentTime + START_STEP_S
      const stalls = this.starts === 'stalls' && !this.pressed && time >= STALLS_AT_S
      this.element = { ...this.element, currentTime: stalls ? STALLS_AT_S : time, paused: stalls }
      // An ad ran out: the pod's next is up, its marker off for this one read, or the song plays (`adEnds`).
      if (this.ad !== null && !this.ad.between && time >= this.ad.lengthS) this.adEnds()
    }
    const { paused, currentTime, duration } = this.element
    return { paused, ended: false, ready: this.readyState, time: currentTime, duration, refused: this.refused, ad: this.adShowing, skippable: this.skippable() }
  }

  /** The ad ends — run out, or skipped: the pod's next one is up for its first read, else the song plays in the same element from 0 by itself, the marker off. */
  private adEnds(): void {
    this.adShowing = false
    if (this.ad === null) return
    if (this.ad.next.length > 0) {
      const [lengthS, ...next] = this.ad.next
      this.ad = { ...this.ad, lengthS: lengthS!, next, between: true }
      this.adShowing = false
      this.element = { ...this.element, currentTime: 0 }
      return
    }
    this.element = { ...this.element, currentTime: 0, duration: this.ad.song, paused: false }
    this.ad = null
    this.adShowing = false
  }

  /** The engine offers to skip the ad playing (#497): its Skip button is up from {@link skippableAtS}. */
  private skippable(): boolean {
    return this.adShowing && this.skippableAtS !== null && this.element.currentTime >= this.skippableAtS
  }

  private watchStatus(): WatchStatus {
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    const ended = this.ended
    this.ended = null
    const element = this.element
    const playing = { elapsed: element.currentTime, duration: element.duration, paused: element.paused, loop: element.loop, volume: element.volume, muted: element.muted, ducked: this.duckMark !== null, restore: this.duckMark?.restore ?? null, prompt: this.continuePrompt, loudnessDb: this.loudnessDb(id), playerVolume: this.playerVolume }
    if (watch?.fails === 'notWatch' || id === null) return { watch: false, id: null, title: 'Sign in', hasVideo: false, error: false, ad: false, skippable: false, ended: null, channel: '', ...playing }
    return { watch: true, id, title: watch?.title ?? '', hasVideo: watch !== undefined, error: watch?.fails === 'error', ad: this.adShowing, skippable: this.skippable(), ended, channel: watch?.channel ?? '', ...playing }
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
      case 'seek': {
        const end = element.duration === null ? Infinity : Math.max(0, element.duration - 1)
        this.element = { ...element, currentTime: Math.max(0, Math.min(end, element.currentTime + op.by)) }
        break
      }
      case 'skip-ad':
        changed = this.skippable()
        if (changed) {
          this.adsSkipped += 1
          this.adEnds()
        }
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

/**
 * A scripted audio road (#502): the bare stream's element answers the
 * Player's scripts as a watch page's does — the real surface's page names
 * its song the way the scripts read a watch page — so a ScriptedYouTube on
 * its own FakeBrowser stands in for it, sharing the pane's watch pages.
 * `fails` says which lookups fail.
 */
export function scriptedAudio(watches: Map<string, ScriptedWatch>) {
  const browser = new FakeBrowser()
  const youtube = new ScriptedYouTube(browser, watches)
  const road = {
    browser,
    youtube,
    /** Every video id looked up, in order. */
    resolved: [] as string[],
    /** Every stream loaded: the song's id and the stream's address. */
    loaded: [] as { id: string; stream: string }[],
    stops: 0,
    /** A lookup that fails, by video id; every other resolves to a stream named after it. */
    fails: new Set<string>(),
    resolve: async (id: string): Promise<string> => {
      road.resolved.push(id)
      if (road.fails.has(id)) throw new Error(`yt-dlp: no stream for ${id}`)
      return `https://stream.example/${id}`
    },
    surface: {
      evaluate: <T>(script: string) => browser.evaluate<T>(script),
      load: async (song: { id: string }, stream: string): Promise<void> => {
        road.loaded.push({ id: song.id, stream })
        await browser.navigate(watchUrl(song.id))
      },
      stop: async (): Promise<void> => {
        road.stops += 1
        await browser.navigate('about:blank')
      },
    },
  }
  return road
}
