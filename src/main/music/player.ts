import type { BrowserController } from '../../core/ports/browser'
import type { MusicAction } from '../../core/music/musicWords'
import { EMPTY_QUEUE, advance, dropCurrent, enqueue, ordinal, pause, playNow, previous, setLoop, unpause, type Queue, type Song } from '../../core/music/queue'
import { initialDataOf, pickVideo, resultsUrl, watchUrl } from '../../core/music/youtubeSearch'
import { SPOKEN_FAILURES, spokenFailureOf } from '../../core/command/spokenFailure'
import { reportFault } from '../../core/trace/fault'
import { STOPPED_ANSWERS } from '../../core/command/answer'
import { RESULTS_SCRIPT, WATCH_SCRIPT, controlScript, type ElementOp, type ElementState, type WatchStatus } from './youtubeScripts'

// The Player (#343, CONTEXT.md): YouTube in the pane is the player; the
// queue and the verbs live here. `play <words>` navigates the pane to the
// results, takes the first plain video off the page's data and opens its
// watch page; `queue <words>` fetches the same results with the pane's
// session, so the song playing is never interrupted. Every other verb is
// one evaluate on `#movie_player`'s video. The poll (`check`, once a
// second) hears the song's end — the page pauses it in its last second, so
// YouTube's Autoplay never wanders on, and an ad's end in the same element
// is not one — and opens the next queued song; with none queued the Player
// stops there (owner's ruling 4).

/** What a Player verb came to: the tool result line, its Answer, and the video it opened or queued. */
export interface PlayerOutcome {
  readonly result: string
  /** The Answer (#333); empty when superseded. */
  readonly answer: string
  readonly failure?: true
  readonly video?: string
  /** A later Command came while it ran: nothing more was opened, and it answers nothing. */
  readonly superseded?: true
}

export interface Player {
  /** One music line: `words` is a search's Slot. `current` says the Command is still the one in flight. */
  perform(music: MusicAction, words: string | null, current: () => boolean): Promise<PlayerOutcome>
  /** `stop` with nothing in flight (owner's ruling 2): pause a playing video; whether one was. */
  pauseIfPlaying(): Promise<boolean>
  /** The poll: hear the song's end and open the next queued one. */
  check(): Promise<void>
  /** Resolves when the songs opened in the background (an end, a failed landing) have opened. */
  settled(): Promise<void>
  queue(): Queue
}

export interface PlayerDeps {
  browser: Pick<BrowserController, 'navigate' | 'evaluate'>
  /** A results page's HTML, fetched with the pane's session (its cookies, its consent). */
  fetchResults(url: string): Promise<string>
  /** Waits between reads of a page still building; real time when absent. */
  sleep?(ms: number): Promise<void>
}

/** How long a watch page may take to build its player before the landing is taken as failed. */
const WATCH_READS = 20
const WATCH_READ_MS = 250
/** How long the results page may take to carry its data. */
const RESULTS_READS = 8
const RESULTS_READ_MS = 250
/** How much `louder` and `quieter` move the volume. */
const VOLUME_STEP = 10

const quoted = (title: string): string => `“${title}”`

export function createPlayer(deps: PlayerDeps): Player {
  const { browser } = deps
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let state: Queue = EMPTY_QUEUE
  /** Bumped by every verb and every background open: an open a later one overtook stops where it stands. */
  let generation = 0
  let background: Promise<void> = Promise.resolve()
  let checking = false

  const superseded: PlayerOutcome = { result: 'superseded', answer: '', superseded: true }

  async function evaluate<T>(script: string): Promise<T | null> {
    try {
      return (await browser.evaluate<T>(script)) ?? null
    } catch (error) {
      reportFault('music.player.evaluate', error)
      return null
    }
  }

  const control = (op: ElementOp): Promise<ElementState | null> => evaluate<ElementState>(controlScript(op))

  /** The watch page for this song, once its player holds its video: true; false for any other landing. */
  async function landedOn(song: Song, current: () => boolean): Promise<boolean | 'superseded'> {
    for (let read = 0; read < WATCH_READS; read += 1) {
      if (!current()) return 'superseded'
      const status = await evaluate<WatchStatus>(WATCH_SCRIPT)
      if (status !== null) {
        if (!status.watch || (status.id !== null && status.id !== song.id) || status.error) return false
        if (status.hasVideo) return true
      }
      await sleep(WATCH_READ_MS)
    }
    return false
  }

  /** Open a song's watch page; the queue moves on to it only when it landed. */
  async function open(song: Song, current: () => boolean): Promise<'opened' | 'failed' | 'superseded'> {
    try {
      await browser.navigate(watchUrl(song.id))
    } catch (error) {
      reportFault('music.player.open', error)
      return current() ? 'failed' : 'superseded'
    }
    const landed = await landedOn(song, current)
    return landed === 'superseded' ? 'superseded' : landed ? 'opened' : 'failed'
  }

  /** The next queued song opens in the background, a failed one passed over, until one lands or none is left. */
  function advanceInBackground(): void {
    const mine = (generation += 1)
    const current = (): boolean => generation === mine
    background = background.then(async () => {
      for (;;) {
        const { queue, next } = advance(state)
        state = queue
        if (next === null || !current()) return
        const opened = await open(next, current)
        if (opened !== 'failed') return
        state = dropCurrent(state)
      }
    })
  }

  /** A song that could not be opened: the Command fails, saying so, and the next queued song plays. */
  function failedToOpen(song: Song): PlayerOutcome {
    state = dropCurrent(state)
    if (state.upNext.length > 0) advanceInBackground()
    return { result: `not a watch page: ${watchUrl(song.id)}`, answer: `${quoted(song.title)} can't be played.`, failure: true, video: song.id }
  }

  /**
   * Play this song now — in place of the current one, unless `then` says
   * otherwise (`skip`, `previous`). The Queue moves to `then` once the page
   * opened or failed; one a later Command overtook leaves it as it was.
   */
  async function playSong(song: Song, current: () => boolean, answer: string, then: () => Queue = () => playNow(state, song)): Promise<PlayerOutcome> {
    const opened = await open(song, current)
    if (opened === 'superseded') return superseded
    state = then()
    if (opened === 'failed') return failedToOpen(song)
    return { result: `playing: id=${song.id} title=${JSON.stringify(song.title)}`, answer, video: song.id }
  }

  /** `play <words>`: the results page in the pane, its first plain video. */
  async function searchNow(words: string, current: () => boolean): Promise<PlayerOutcome> {
    const line = await browser.navigate(resultsUrl(words))
    if (!current()) return superseded
    const wall = spokenFailureOf({ tool: 'navigate', outcome: { ok: true, result: line } })
    if (wall !== null) return { result: line, answer: SPOKEN_FAILURES[wall], failure: true }
    let data: unknown = null
    for (let read = 0; read < RESULTS_READS && data === null; read += 1) {
      if (read > 0) await sleep(RESULTS_READ_MS)
      if (!current()) return superseded
      data = parsed(await evaluate<string>(RESULTS_SCRIPT))
    }
    if (!current()) return superseded
    if (data === null) return noResults(words)
    const song = pickVideo(data)
    if (song === null) return noVideos(words)
    return playSong(song, current, `Playing ${quoted(song.title)}.`)
  }

  /** The results script's JSON, parsed; null for none, or JSON that does not parse. */
  function parsed(json: string | null): unknown {
    if (json === null) return null
    try {
      return JSON.parse(json) as unknown
    } catch (error) {
      reportFault('music.player.parseResults', error)
      return null
    }
  }

  const noVideos = (words: string): PlayerOutcome => ({ result: `no videos: ${words}`, answer: `No videos found for ${quoted(words)}.`, failure: true })
  /** A results page that carried no results: a consent or sign-in page in its place. */
  const noResults = (words: string): PlayerOutcome => ({ result: `no results data: ${words}`, answer: "YouTube didn't show its results.", failure: true })

  /** `queue <words>` and `play <words> next`: the results fetched, never shown — the song playing plays on. */
  async function searchQueued(words: string, place: 'front' | 'end', current: () => boolean): Promise<PlayerOutcome> {
    let html: string
    try {
      html = await deps.fetchResults(resultsUrl(words))
    } catch (error) {
      reportFault('music.player.fetchResults', error)
      return { result: `search failed: ${String(error)}`, answer: "Couldn't search YouTube.", failure: true }
    }
    if (!current()) return superseded
    const data = initialDataOf(html)
    if (data === null) return noResults(words)
    const song = pickVideo(data)
    if (song === null) return noVideos(words)
    const queued = enqueue(state, song, place)
    if (queued.playsNow) return playSong(song, current, `Playing ${quoted(song.title)}.`)
    state = queued.queue
    return { result: `queued: id=${song.id} position=${queued.position}`, answer: `Queued ${quoted(song.title)} (${ordinal(queued.position)}).`, video: song.id }
  }

  /** One control on the element, answered from what it left; a page with no video fails in words. */
  async function onElement(op: ElementOp, answer: (element: ElementState) => string, then: (queue: Queue) => Queue = (queue) => queue): Promise<PlayerOutcome> {
    const element = await control(op)
    if (element === null || !element.found) return { result: 'no video on the page', answer: 'Nothing is playing.', failure: true }
    state = then(state)
    return { result: `${op.op}: paused=${element.paused} loop=${element.loop} volume=${element.volume} muted=${element.muted}`, answer: answer(element) }
  }

  const volumeAnswer = (element: ElementState): string => `Volume ${element.volume}.`

  return {
    async perform(music, words, current) {
      generation += 1
      switch (music.kind) {
        case 'search':
          return music.place === 'now' ? searchNow(words ?? '', current) : searchQueued(words ?? '', music.place, current)
        case 'skip': {
          const { queue, next } = advance(state)
          if (next === null) {
            await control({ op: 'pause' })
            state = queue
            return { result: 'queue empty', answer: 'Nothing queued.' }
          }
          return playSong(next, current, `Skipped to ${quoted(next.title)}.`, () => advance(state).queue)
        }
        case 'previous': {
          const back = previous(state)
          if (back.song === null) return { result: 'nothing before', answer: 'Nothing before this.' }
          return playSong(back.song, current, `Back to ${quoted(back.song.title)}.`, () => previous(state).queue)
        }
        case 'pause':
          return onElement({ op: 'pause' }, () => STOPPED_ANSWERS.paused, pause)
        case 'unpause':
          return onElement({ op: 'play' }, (element) => (element.title === '' ? 'Playing.' : `Playing ${quoted(element.title)}.`), unpause)
        case 'loop':
          return onElement(
            { op: 'loop', on: music.on },
            (element) => (music.on ? `Looping ${quoted(element.title)}.` : 'Loop off.'),
            (queue) => setLoop(queue, music.on),
          )
        case 'restart':
          return onElement({ op: 'restart' }, () => 'Restarted.', unpause)
        case 'volume':
          return onElement({ op: 'volume', to: music.to }, volumeAnswer)
        case 'louder':
          return onElement({ op: 'nudge', by: VOLUME_STEP }, volumeAnswer)
        case 'quieter':
          return onElement({ op: 'nudge', by: -VOLUME_STEP }, volumeAnswer)
        case 'mute':
          return onElement({ op: 'mute', on: music.on }, () => (music.on ? 'Muted.' : 'Unmuted.'))
      }
    },

    async pauseIfPlaying() {
      const element = await control({ op: 'pauseIfPlaying' })
      if (element === null || !element.found || !element.changed) return false
      state = pause(state)
      return true
    },

    async check() {
      if (checking || state.current === null) return
      checking = true
      try {
        const status = await evaluate<WatchStatus>(WATCH_SCRIPT)
        const ended = status?.ended ?? null
        // An ad plays in the same element: its end is not the song's.
        if (ended === null || ended.ad || ended.id !== state.current?.id) return
        advanceInBackground()
        await background
      } finally {
        checking = false
      }
    },

    settled: () => background,
    queue: () => state,
  }
}
