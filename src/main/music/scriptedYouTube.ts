import type { FakeBrowser } from '../../core/testing/doubles'
import { videoIdOf } from '../../core/music/youtubeSearch'
import type { ElementOp, ElementState, WatchStatus } from './youtubeScripts'

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

/** A plain video result. */
export function videoItem(id: string, title: string): unknown {
  return { videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, navigationEndpoint: { watchEndpoint: { videoId: id } } } }
}

/** A watch page: the song it plays, or how it fails — the player's error, or no watch page at all (a sign-in wall). */
export interface ScriptedWatch {
  readonly title: string
  readonly channel?: string
  readonly fails?: 'error' | 'notWatch'
}

export class ScriptedYouTube {
  /** Search words → the results' data. */
  readonly results = new Map<string, unknown>()
  /** Video id → its watch page. */
  readonly watches = new Map<string, ScriptedWatch>()
  /** Every control the element took, in order. */
  readonly controls: ElementOp[] = []
  readonly fetched: string[] = []
  element = { paused: false, loop: false, volume: 100, muted: false, currentTime: 0, duration: 180 }
  /** The volume YouTube's player remembers: what `setVolume` told it, never the duck's floor. */
  playerVolume = 100
  adShowing = false
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

  /** The address the element was last read on: a new watch page plays from the start, unlooped. */
  private shownUrl: string | null = null

  private evaluate(expression: string): unknown {
    const url = this.browser.state().url ?? ''
    if (url !== this.shownUrl) {
      this.shownUrl = url
      this.element = { ...this.element, paused: false, loop: false, volume: this.playerVolume }
    }
    if (expression.includes('/* YT_RESULTS */')) {
      const data = URL.canParse(url) ? this.results.get(new URL(url).searchParams.get('search_query') ?? '') : undefined
      return data === undefined ? null : JSON.stringify(data)
    }
    if (expression.includes('/* YT_WATCH */')) return this.watchStatus()
    if (expression.includes('/* YT_CONTINUE */')) return this.answerPrompt()
    if (expression.includes('/* YT_CONTROL */')) return this.control(JSON.parse(/\}\)\((.*)\)$/s.exec(expression)![1]!) as ElementOp)
    return undefined
  }

  private watchStatus(): WatchStatus {
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    const ended = this.ended
    this.ended = null
    const element = this.element
    const playing = { elapsed: element.currentTime, duration: element.duration, paused: element.paused, loop: element.loop, volume: element.volume, prompt: this.continuePrompt }
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

  private control(op: ElementOp): ElementState {
    this.controls.push(op)
    const id = this.currentId()
    const watch = id === null ? undefined : this.watches.get(id)
    if (watch === undefined || watch.fails !== undefined) return { found: false, changed: false, title: '', paused: true, loop: false, volume: 0, muted: false }
    let changed = true
    const element = this.element
    switch (op.op) {
      case 'play':
      case 'restart':
        this.element = { ...element, paused: false }
        break
      case 'pause':
        this.element = { ...element, paused: true }
        break
      case 'pauseIfPlaying':
        changed = !element.paused
        this.element = { ...element, paused: true }
        break
      case 'loop':
        this.element = { ...element, loop: op.on }
        break
      case 'volume':
        this.playerVolume = op.to
        this.element = { ...element, volume: op.heard ?? op.to }
        break
      case 'level':
        this.element = { ...element, volume: op.to }
        break
      case 'nudge':
        this.playerVolume = Math.max(0, Math.min(100, element.volume + op.by))
        this.element = { ...element, volume: this.playerVolume }
        break
      case 'mute':
        this.element = { ...element, muted: op.on }
        break
    }
    const { paused, loop, volume, muted } = this.element
    return { found: true, changed, title: watch.title, paused, loop, volume, muted }
  }
}
