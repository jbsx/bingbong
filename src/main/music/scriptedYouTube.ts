import { FakeBrowser } from '../../core/testing/doubles'
import { videoIdOf, watchUrl } from '../../core/music/youtubeSearch'
import { loudnessFactor } from '../../core/music/loudness'
import type { MediaOpAction } from '../../core/browser/mediaOp'
import type { AudioStream } from './ytDlp'
import { SEEK_SETTLE_MS, type ElementOp, type ElementState, type LevelRead, type PausedAll, type StartRead, type WatchStatus } from './youtubeScripts'

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
  /** The audio road's bare element (#502): it opens at full volume, its stream naming no loudness and no player remembering a level. */
  bare = false
  /** The element gave up on the stream it was handed (#516): the audio road's refused address. */
  streamFailed = false
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
  /**
   * The next watch page's player boots this long (s, #550), as a slow host's
   * does: its element unpaused, `readyState` 0, its source set and loading, a
   * press changing nothing; then it plays by itself. Null for none.
   */
  bootsForS: number | null = null
  /** How far the element's time moves between two start reads (s): more on a slow host, whose single reads stall for seconds (#550). */
  startStepS = START_STEP_S
  /** The boot on this page, in start reads left. */
  private booting = 0
  /** The facts of the element's load (#550): what `networkState` and `currentSrc` say. */
  loadFacts: { networkState: number; hasSrc: boolean; buffered: number } = { networkState: 2, hasSrc: true, buffered: 0 }
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
  /** The page's own player leaves its element paused after a seek of it playing (#505, the kept run at 6588a8b1). */
  pausesOnSeek = false
  /** The Seek Mark on the element (#505): how long ago (ms) the playing element seeked; null with none. */
  seekMark: { ageMs: number } | null = null
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

  /** Every page from here on opens with its song already paused in its last half second (#538). */
  opensAtEnd = false

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
      this.element = { ...this.element, paused: this.starts === 'press' || this.starts === 'refuses', loop: false, currentTime: 0, volume: this.bare ? 100 : this.playerVolume * loudnessFactor(this.loudnessDb(this.currentId())) }
      this.refused = null
      this.pressed = false
      this.duckMark = null
      // A song at its end as soon as it is read, the end rule's pause on it: seeked there during its start (#538).
      if (this.opensAtEnd && this.element.duration !== null) this.element = { ...this.element, paused: true, currentTime: this.element.duration - 0.5 }
      // The pre-roll (#497): the element plays the ad first, at its length, the page's ad marker on.
      const pod = this.preRollS === null ? [] : typeof this.preRollS === 'number' ? [this.preRollS] : [...this.preRollS]
      this.ad = pod.length === 0 ? null : { lengthS: pod[0]!, next: pod.slice(1), song: this.ad?.song ?? this.element.duration, between: false }
      this.preRollS = null
      if (this.bootsForS !== null) {
        this.booting = Math.round(this.bootsForS / START_STEP_S)
        this.bootsForS = null
      }
      if (this.booting > 0) {
        this.readyState = 0
        this.element = { ...this.element, paused: false }
      }
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
    return id === null || this.bare ? null : (this.loudness.get(id) ?? null)
  }

  /** The level YouTube's player remembers, as a read hears it: none on the bare element. */
  private remembered(): number | null {
    return this.bare ? null : this.playerVolume
  }

  private level(): LevelRead | null {
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    if (watch === undefined || watch.fails !== undefined) return null
    return { id, ad: this.adShowing, volume: this.element.volume, loudnessDb: this.loudnessDb(id), playerVolume: this.remembered(), restore: this.duckMark?.restore ?? null }
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
    if (this.booting > 0 && (this.booting -= 1) === 0) this.readyState = 4
    // Time moves only on an element holding data to play.
    if (!this.element.paused && this.readyState > 2) {
      const time = this.element.currentTime + this.startStepS
      const stalls = this.starts === 'stalls' && !this.pressed && time >= STALLS_AT_S
      this.element = { ...this.element, currentTime: stalls ? STALLS_AT_S : time, paused: stalls }
      // An ad ran out: the pod's next is up, its marker off for this one read, or the song plays (`adEnds`).
      if (this.ad !== null && !this.ad.between && time >= this.ad.lengthS) this.adEnds()
    }
    if (this.streamFailed) return { paused: true, ended: false, ready: 0, time: 0, duration: null, refused: null, ad: false, skippable: false, failed: true, networkState: 3, hasSrc: true, buffered: 0 }
    const { paused, currentTime, duration } = this.element
    return { paused, ended: false, ready: this.readyState, time: currentTime, duration, refused: this.refused, ad: this.adShowing, skippable: this.skippable(), failed: false, ...this.loadFacts }
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
    const seeked = id === null ? null : this.takeSeeked()
    const playing = { seekAgeMs: seeked, elapsed: element.currentTime, duration: element.duration, paused: element.paused, loop: element.loop, volume: element.volume, muted: element.muted, ducked: this.duckMark !== null, restore: this.duckMark?.restore ?? null, prompt: this.continuePrompt, loudnessDb: this.loudnessDb(id), playerVolume: this.remembered() }
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

  /**
   * The Appliance Card's Media Op on the song's element (#505), as the
   * browser's op script applies it by kind: a seek of a playing element
   * marks it, and a pause or a play takes the mark off. A seek the page
   * pauses after ({@link pausesOnSeek}) leaves it paused.
   */
  mediaOp(op: MediaOpAction): { before: { paused: boolean; currentTime: number }; after: { paused: boolean; currentTime: number } } {
    const element = this.element
    const before = { paused: element.paused, currentTime: element.currentTime }
    const end = element.duration ?? element.currentTime
    switch (op.op) {
      case 'forward': this.element = { ...element, currentTime: Math.min(end, element.currentTime + (op.seconds ?? 0)) }; break
      case 'back': this.element = { ...element, currentTime: Math.max(0, element.currentTime - (op.seconds ?? 0)) }; break
      case 'restart': this.element = { ...element, currentTime: 0, paused: false }; break
      case 'pause': this.element = { ...element, paused: true }; break
      case 'play': this.element = { ...element, paused: false }; break
    }
    this.markSeek(op.op, !before.paused)
    // The op's own read is in the same tick: the page's pause comes after it.
    const after = { paused: this.element.paused, currentTime: this.element.currentTime }
    if (this.pausesOnSeek && this.seekMark !== null) this.element = { ...this.element, paused: true }
    return { before, after }
  }

  /** The Seek Mark as the page scripts keep it (#505). */
  private markSeek(op: string, playing: boolean): void {
    const seek = op === 'forward' || op === 'back' || op === 'restart' || op === 'seek'
    if (seek && playing) this.seekMark = { ageMs: 0 }
    else if (seek || op === 'pause' || op === 'play') this.seekMark = null
  }

  /** The element is in its song's last second, the end rule's. */
  private atEnd(): boolean {
    return this.element.duration !== null && this.element.currentTime >= this.element.duration - 1
  }

  /** The Seek Mark read by the watch script (#505): a seek that left its element paused, read within the settle. */
  private takeSeeked(): number | null {
    const mark = this.seekMark
    if (mark === null) return null
    const seeked = this.element.paused && !this.atEnd() && mark.ageMs <= SEEK_SETTLE_MS ? mark.ageMs : null
    if (this.element.paused || mark.ageMs > SEEK_SETTLE_MS) this.seekMark = null
    return seeked
  }

  private control(op: ElementOp): ElementState {
    this.controls.push(op)
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    if (watch === undefined || watch.fails !== undefined) return { found: false, changed: false, title: '', paused: true, loop: false, volume: 0, muted: false, ducked: false }
    let changed = true
    this.markSeek(op.op, !this.element.paused)
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
    if (this.pausesOnSeek && op.op === 'seek' && this.seekMark !== null) this.element = { ...this.element, paused: true }
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
  youtube.bare = true
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
    /** When each lookup's stream is served (epoch ms), from the wall clock the test gives the Player; null for at once. */
    servedAt: null as (() => number) | null,
    /** When each lookup's address expires (epoch s, #516), each a new address; null for one naming no expiry. */
    expires: null as number | null,
    /** Addresses the element gives up on, as a 403 makes it (#516). */
    refused: new Set<string>(),
    /** What the lookup says of itself (#516). */
    asked: undefined as AudioStream['asked'],
    resolve: async (id: string): Promise<AudioStream> => {
      road.resolved.push(id)
      if (road.fails.has(id)) throw new Error(`yt-dlp: no stream for ${id}`)
      const address = `https://stream.example/${id}${road.expires === null ? '' : `?expire=${road.expires}&try=${road.resolved.length}`}`
      return { stream: address, availableAt: road.servedAt?.() ?? null, ...(road.asked !== undefined ? { asked: road.asked } : {}) }
    },
    surface: {
      evaluate: <T>(script: string) => browser.evaluate<T>(script),
      load: async (song: { id: string }, stream: string): Promise<void> => {
        road.loaded.push({ id: song.id, stream })
        await browser.navigate(watchUrl(song.id))
        youtube.streamFailed = road.refused.has(stream)
      },
      stop: async (): Promise<void> => {
        road.stops += 1
        await browser.navigate('about:blank')
      },
    },
  }
  return road
}
