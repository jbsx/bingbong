import type { BrowserController } from '../../core/ports/browser'
import type { MusicAction } from '../../core/music/musicWords'
import type { PickSource } from '../../core/command/decisionRecord'
import { EMPTY_QUEUE, advance, dropCurrent, enqueue, ordinal, pause, playNow, previous, replaceCurrent, replay, setLoop, unpause, type Queue, type Song } from '../../core/music/queue'
import { QUEUED_SHOWN, type NowPlaying } from '../../core/music/nowPlaying'
import { initialDataOf, plainVideos, resultsUrl, watchUrl } from '../../core/music/youtubeSearch'
import { songTerms, stayed } from '../../core/music/rememberedSongs'
import { SPOKEN_FAILURES, spokenFailureOf } from '../../core/command/spokenFailure'
import { reportFault } from '../../core/trace/fault'
import { STOPPED_ANSWERS } from '../../core/command/answer'
import { CONTINUE_SCRIPT, PAUSE_ALL_SCRIPT, RESULTS_SCRIPT, WATCH_SCRIPT, controlScript, type ControlReach, type ElementOp, type ElementState, type PausedAll, type WatchStatus } from './youtubeScripts'

// The Player (#343, CONTEXT.md): YouTube in the pane is the player; the
// queue and the verbs live here. `play <words>` navigates the pane to the
// results, takes the first plain video off the page's data and opens its
// watch page; `queue <words>` fetches the same results with the pane's
// session, so the song playing is never interrupted. Every other verb is
// one evaluate on `#movie_player`'s video. The poll (`check`, once a
// second) hears the song's end — the page pauses it in its last second, so
// YouTube's Autoplay never wanders on, and an ad's end in the same element
// is not one — and opens the next queued song; with none queued the Player
// stops there (owner's ruling 4), the song kept on the Idle Screen's card
// as ended (#344).
//
// The poll also feeds Now Playing (#344): the song's channel and progress,
// published to the card whenever what it shows changes. It answers
// YouTube's own "Continue watching?" pause, which the Player never made.
// Ducking (#344) drops the element's volume to a floor while the ear is
// open or a line plays, YouTube's remembered volume left alone, and puts
// back the volume it had — or the one a `volume` verb set meanwhile.
//
// Correction and remembering (#345): the Player keeps the plain videos
// the last `play <words>` read, and `not that one` moves along them. A
// pick the poll hears play past 30 s with no correction, `skip` or
// `forget` is remembered against its words, and its trimmed title joins
// the Learned Terms; the next `play` of those words opens it at once.

/** What a Player verb came to: the tool result line, its Answer, and the video it opened or queued. */
export interface PlayerOutcome {
  readonly result: string
  /** The Answer (#333); empty when superseded. */
  readonly answer: string
  readonly failure?: true
  readonly video?: string
  /** A later Command came while it ran: nothing more was opened, and it answers nothing. */
  readonly superseded?: true
  /** For a search (#345): the video came from the Remembered Songs, or from YouTube's results. */
  readonly pick?: PickSource
}

/** The Remembered Songs (#345) as the Player reads and grows them: a store beside the Learned Terms. */
export interface SongMemory {
  /** The video these words were remembered against; null for none. */
  recall(words: string): Song | null
  remember(words: string, song: Song): void
  forgetWords(words: string): void
  /** Whether any words pointed at this video. */
  forgetVideo(id: string): boolean
}

export interface Player {
  /** One music line: `words` is a search's Slot. `current` says the Command is still the one in flight. */
  perform(music: MusicAction, words: string | null, current: () => boolean): Promise<PlayerOutcome>
  /** `stop` with nothing in flight (owner's ruling 2, #376): pause every playing media element on the page; whether one was. */
  pauseAll(): Promise<boolean>
  /** The poll: hear the song's end and open the next queued one. */
  check(): Promise<void>
  /** Resolves when the songs opened in the background (an end, a failed landing) have opened. */
  settled(): Promise<void>
  queue(): Queue
  /** What the Idle Screen's card shows (#344); null when the Player holds no song. */
  nowPlaying(): NowPlaying | null
  /** Hears every change to {@link nowPlaying}; the returned function stops it. */
  onChange(listener: (nowPlaying: NowPlaying | null) => void): () => void
  /** Ducks the music (on) or puts its volume back (off) (#344). Resolves when the element has it. */
  duck(on: boolean): Promise<void>
}

export interface PlayerDeps {
  browser: Pick<BrowserController, 'navigate' | 'evaluate'>
  /** A results page's HTML, fetched with the pane's session (its cookies, its consent). */
  fetchResults(url: string): Promise<string>
  /** Waits between reads of a page still building; real time when absent. */
  sleep?(ms: number): Promise<void>
  /** The Remembered Songs (#345); absent remembers nothing, and every `play` searches. */
  songs?: SongMemory
  /** A Learned Term a song that stayed teaches (#345): admitted at once. */
  learn?(term: string): void
}

/**
 * The last `play <words>` (#345): its words, the plain videos its search
 * read (none for a remembered pick, until a correction searches), which of
 * them plays, and whether it is still waiting to stay.
 */
interface SearchPick {
  readonly words: string
  readonly results: readonly Song[]
  readonly index: number
  readonly song: Song
  readonly remembered: boolean
  staying: boolean
}

/** How long a watch page may take to build its player before the landing is taken as failed. */
const WATCH_READS = 20
const WATCH_READ_MS = 250
/** How long the results page may take to carry its data. */
const RESULTS_READS = 8
const RESULTS_READ_MS = 250
/** How much `louder` and `quieter` move the volume. */
const VOLUME_STEP = 10
/** The duck's floor, as a share of the volume it puts back: low, never silent, so the song is heard still there (#344). */
const DUCK_SHARE = 0.15

const floorOf = (volume: number): number => Math.round(volume * DUCK_SHARE)
const clampVolume = (volume: number): number => Math.max(0, Math.min(100, Math.round(volume)))

const quoted = (title: string): string => `“${title}”`

const isSongs = (read: readonly Song[] | PlayerOutcome): read is readonly Song[] => Array.isArray(read)

export function createPlayer(deps: PlayerDeps): Player {
  const { browser } = deps
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let state: Queue = EMPTY_QUEUE
  /** Bumped by every verb and every background open: an open a later one overtook stops where it stands. */
  let generation = 0
  let background: Promise<void> = Promise.resolve()
  let checking = false
  /** The song that ran out with nothing queued, still shown on the card until something else plays (#344). */
  let ended: Song | null = null
  /** What the poll last read of the song playing: its channel and progress. */
  let progress: { id: string; channel: string; elapsed: number; duration: number | null } | null = null
  /** The element's volume as last read while not ducked. */
  let knownVolume: number | null = null
  /** Whether the element was muted when last read or set (#365). */
  let muted = false
  /** While ducked: the volume the duck puts back. */
  let ducked: { restore: number } | null = null
  /** The ducks and restores, one after the other. */
  let ducking: Promise<void> = Promise.resolve()
  const listeners = new Set<(nowPlaying: NowPlaying | null) => void>()
  let published = 'null'

  function nowPlaying(): NowPlaying | null {
    const song = state.current ?? ended
    if (song === null) return null
    const read = progress !== null && progress.id === song.id ? progress : null
    return {
      id: song.id,
      title: song.title,
      channel: read?.channel ?? '',
      elapsedS: Math.floor(read?.elapsed ?? 0),
      durationS: read === null || read.duration === null ? null : Math.round(read.duration),
      paused: state.current !== null && state.paused,
      loop: state.current !== null && state.loop,
      muted,
      ended: state.current === null,
      queued: state.upNext.slice(0, QUEUED_SHOWN).map((song) => song.title),
    }
  }

  /** Tells the card what changed, if anything did. */
  function publish(): void {
    if (state.current !== null) ended = null
    const now = nowPlaying()
    const json = JSON.stringify(now)
    if (json === published) return
    published = json
    for (const listener of [...listeners]) listener(now)
  }
  let pick: SearchPick | null = null

  const superseded: PlayerOutcome = { result: 'superseded', answer: '', superseded: true }

  async function evaluate<T>(script: string): Promise<T | null> {
    try {
      return (await browser.evaluate<T>(script)) ?? null
    } catch (error) {
      reportFault('music.player.evaluate', error)
      return null
    }
  }

  const control = (op: ElementOp, reach: ControlReach = 'page'): Promise<ElementState | null> => evaluate<ElementState>(controlScript(op, reach))

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
    // A page opened while ducked starts at YouTube's remembered volume: down to the floor at once (#344).
    if (landed === true && ducked !== null) await control({ op: 'level', to: floorOf(ducked.restore) })
    return landed === 'superseded' ? 'superseded' : landed ? 'opened' : 'failed'
  }

  /** The next queued song opens in the background, a failed one passed over, until one lands or none is left. */
  function advanceInBackground(): void {
    const mine = (generation += 1)
    const current = (): boolean => generation === mine
    background = background.then(async () => {
      for (;;) {
        const was = state.current
        const { queue, next } = advance(state)
        state = queue
        if (next === null && was !== null) ended = was
        publish()
        if (next === null || !current()) return
        const opened = await open(next, current)
        if (opened !== 'failed') return
        state = dropCurrent(state)
        publish()
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

  /** The results page for these words in the pane, and its plain videos; an outcome when it shows none. */
  async function readResults(words: string, current: () => boolean): Promise<readonly Song[] | PlayerOutcome> {
    const line = await browser.navigate(resultsUrl(words))
    if (!current()) return superseded
    const wall = spokenFailureOf({ tool: 'navigate', outcome: { ok: true, result: line } })
    // A results page often lands before its cards are drawn, and reads as empty; its data, not its text, says whether it holds results.
    if (wall !== null && wall !== 'empty') return { result: line, answer: SPOKEN_FAILURES[wall], failure: true }
    let data: unknown = null
    for (let read = 0; read < RESULTS_READS && data === null; read += 1) {
      if (read > 0) await sleep(RESULTS_READ_MS)
      if (!current()) return superseded
      data = parsed(await evaluate<string>(RESULTS_SCRIPT))
    }
    if (!current()) return superseded
    if (data === null) return noResults(words)
    const songs = plainVideos(data)
    return songs.length === 0 ? noVideos(words) : songs
  }

  /**
   * Open a pick (#345): it is the pick at once — a correction may follow
   * before it lands — but waits to stay only once its watch page opened,
   * so a poll heard while it opens, the song before still current, cannot
   * let it go. The outcome says where its video came from.
   */
  async function openPick(next: Omit<SearchPick, 'staying'>, current: () => boolean, answer: string, then?: () => Queue): Promise<PlayerOutcome> {
    const opening: SearchPick = { ...next, staying: false }
    pick = opening
    const outcome = await playSong(next.song, current, answer, then)
    if (outcome.superseded === true) return outcome
    if (outcome.failure !== true && pick === opening) opening.staying = true
    return { ...outcome, pick: next.remembered ? 'remembered' : 'searched' }
  }

  /**
   * `play <words>`: the video remembered for the words (#345), else the
   * results page in the pane and its first plain video. A remembered video
   * that no longer opens is forgotten, so the next `play` searches.
   */
  async function searchNow(words: string, current: () => boolean): Promise<PlayerOutcome> {
    pick = null
    const known = deps.songs?.recall(words) ?? null
    if (known !== null) {
      const outcome = await openPick({ words, results: [], index: -1, song: known, remembered: true }, current, `Playing ${quoted(known.title)}.`)
      if (outcome.failure === true) deps.songs?.forgetWords(words)
      return outcome
    }
    const songs = await readResults(words, current)
    if (!isSongs(songs)) return songs
    const song = songs[0]!
    return openPick({ words, results: songs, index: 0, song, remembered: false }, current, `Playing ${quoted(song.title)}.`)
  }

  /**
   * `not that one` (`step` 1) and `the one before` (-1), #345: the pick's
   * neighbour in its kept results plays in its place, and its words are
   * forgotten. A remembered pick kept no results: they are searched now,
   * the wrong video passed by. Past either end nothing changes, and the
   * song playing may still stay.
   */
  async function correct(step: 1 | -1, current: () => boolean): Promise<PlayerOutcome> {
    const wrong = pick
    if (wrong === null || (state.current !== null && state.current.id !== wrong.song.id)) return { result: 'nothing to correct', answer: 'Nothing to correct.' }
    const noMore: PlayerOutcome = { result: 'no more results', answer: 'No more results.' }
    const first: PlayerOutcome = { result: 'nothing before', answer: 'That was the first result.' }
    if (wrong.remembered ? step < 0 : wrong.results[wrong.index + step] === undefined) return step > 0 ? noMore : first
    wrong.staying = false
    deps.songs?.forgetWords(wrong.words)
    let from: Omit<SearchPick, 'staying'> = wrong
    if (wrong.remembered) {
      const songs = await readResults(wrong.words, current)
      if (!isSongs(songs)) return songs
      from = { ...wrong, results: songs.filter((song) => song.id !== wrong.song.id), index: -1, remembered: false }
    }
    const index = from.index + step
    const song = from.results[index]
    if (song === undefined) {
      pick = { ...from, staying: false }
      return noMore
    }
    return openPick({ ...from, index, song }, current, `Playing ${quoted(song.title)} instead.`, () => replaceCurrent(state, song))
  }

  /** `forget this song` (#345): no words point at the song playing, and it does not stay. */
  function forget(): PlayerOutcome {
    const song = state.current
    if (song === null) return { result: 'nothing playing', answer: 'Nothing is playing.' }
    if (pick?.song.id === song.id) pick.staying = false
    if (deps.songs?.forgetVideo(song.id) === true) return { result: `forgot: id=${song.id}`, answer: `Forgot ${quoted(song.title)}.` }
    return { result: `not remembered: id=${song.id}`, answer: `${quoted(song.title)} wasn't remembered.` }
  }

  /** The poll's read of the watch page (#345): the pick playing past the threshold has stayed — remembered, and its title learned. */
  function hearStay(status: WatchStatus): void {
    const staying = pick
    if (staying === null || !staying.staying) return
    if (state.current?.id !== staying.song.id) {
      staying.staying = false
      return
    }
    if (status.ad || status.id !== staying.song.id || !stayed(status.elapsed)) return
    staying.staying = false
    deps.songs?.remember(staying.words, staying.song)
    for (const term of songTerms(staying.song.title)) deps.learn?.(term)
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
    const known = deps.songs?.recall(words) ?? null
    const found = known ?? (await fetchPick(words, current))
    if (!('id' in found)) return found
    const outcome = await queueSong(found, place, current)
    return outcome.superseded === true ? outcome : { ...outcome, pick: known !== null ? 'remembered' : 'searched' }
  }

  /** The first plain video of the results, fetched with the pane's session; an outcome when there is none. */
  async function fetchPick(words: string, current: () => boolean): Promise<Song | PlayerOutcome> {
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
    return plainVideos(data)[0] ?? noVideos(words)
  }

  /** A queued search's song joins the queue — or plays now, when nothing is. */
  async function queueSong(song: Song, place: 'front' | 'end', current: () => boolean): Promise<PlayerOutcome> {
    const queued = enqueue(state, song, place)
    if (queued.playsNow) return playSong(song, current, `Playing ${quoted(song.title)}.`)
    state = queued.queue
    return { result: `queued: id=${song.id} position=${queued.position}`, answer: `Queued ${quoted(song.title)} (${ordinal(queued.position)}).`, video: song.id }
  }

  /** One control on the element, answered from what it left; a page with no video fails in words. */
  async function onElement(op: ElementOp, answer: (element: ElementState) => string, then: (queue: Queue) => Queue = (queue) => queue): Promise<PlayerOutcome> {
    const element = await control(op)
    if (element === null || !element.found) return { result: 'no video on the page', answer: 'Nothing is playing.', failure: true }
    if (ducked === null) knownVolume = element.volume
    muted = element.muted
    state = then(state)
    return { result: `${op.op}: paused=${element.paused} loop=${element.loop} volume=${element.volume} muted=${element.muted}`, answer: answer(element) }
  }

  const volumeAnswer = (element: ElementState): string => `Volume ${element.volume}.`

  /** A volume verb while ducked: the volume put back afterwards is the one set, the element heard at its floor meanwhile. */
  async function setDuckedVolume(to: number): Promise<PlayerOutcome> {
    const level = clampVolume(to)
    const outcome = await onElement({ op: 'volume', to: level, heard: floorOf(level) }, () => `Volume ${level}.`)
    if (outcome.failure !== true && ducked !== null) ducked = { restore: level }
    return outcome
  }

  async function setDuck(on: boolean): Promise<void> {
    if (on === (ducked !== null)) return
    if (!on) {
      const { restore } = ducked!
      ducked = null
      await control({ op: 'level', to: restore })
      return
    }
    // Nothing playing: nothing to duck, and no page is touched.
    if (state.current === null) return
    // Unread yet: a nudge of nothing reads the volume as it is.
    const restore = knownVolume ?? (await control({ op: 'nudge', by: 0 }))?.volume ?? null
    if (restore === null) return
    knownVolume = restore
    ducked = { restore }
    await control({ op: 'level', to: floorOf(restore) })
  }

  /** The poll's read of the song playing: its progress for the card, a new page's volume ducked, YouTube's own pause answered. */
  async function readWatch(status: WatchStatus): Promise<void> {
    const song = state.current
    if (song === null || status.id !== song.id || !status.hasVideo || status.ad) return
    progress = { id: song.id, channel: status.channel, elapsed: status.elapsed, duration: status.duration }
    muted = status.muted
    if (ducked === null) knownVolume = status.volume
    else if (status.volume > floorOf(ducked.restore)) await control({ op: 'level', to: floorOf(ducked.restore) })
    // A pause the Player did not make, with "Continue watching?" up: YouTube's, after hours of play. Yes.
    if (status.paused && !state.paused && status.prompt) await evaluate<boolean>(CONTINUE_SCRIPT)
  }

  async function performNow(music: MusicAction, words: string | null, current: () => boolean): Promise<PlayerOutcome> {
    switch (music.kind) {
      case 'search':
        return music.place === 'now' ? searchNow(words ?? '', current) : searchQueued(words ?? '', music.place, current)
      case 'correct':
        return correct(music.step, current)
      case 'forget':
        return forget()
      case 'skip': {
        const { next } = advance(state)
        // Nothing queued: a line with nothing to do does nothing (2026-10-21 audit). The song plays on, and
        // the Queue owns skip (#374), so it never falls to YouTube's Autoplay or ends the song.
        if (next === null) return { result: 'queue empty', answer: 'Nothing queued.' }
        if (pick !== null) pick.staying = false
        return playSong(next, current, `Skipped to ${quoted(next.title)}.`, () => advance(state).queue)
      }
      case 'previous': {
        if (pick !== null) pick.staying = false
        const back = previous(state)
        if (back.song === null) return { result: 'nothing before', answer: 'Nothing before this.' }
        return playSong(back.song, current, `Back to ${quoted(back.song.title)}.`, () => previous(state).queue)
      }
      case 'pause':
        return onElement({ op: 'pause' }, () => STOPPED_ANSWERS.paused, pause)
      case 'unpause': {
        const again = state.current === null ? ended : null
        if (again !== null) return onElement({ op: 'restart' }, () => `Playing ${quoted(again.title)}.`, (queue) => replay(queue, again))
        return onElement({ op: 'play' }, (element) => (element.title === '' ? 'Playing.' : `Playing ${quoted(element.title)}.`), unpause)
      }
      case 'loop':
        return onElement(
          { op: 'loop', on: music.on },
          (element) => (music.on ? `Looping ${quoted(element.title)}.` : 'Loop off.'),
          (queue) => setLoop(queue, music.on),
        )
      case 'restart':
        return onElement({ op: 'restart' }, () => 'Restarted.', unpause)
      case 'volume':
        return ducked !== null ? setDuckedVolume(music.to) : onElement({ op: 'volume', to: music.to }, volumeAnswer)
      case 'louder':
        return ducked !== null ? setDuckedVolume(ducked.restore + VOLUME_STEP) : onElement({ op: 'nudge', by: VOLUME_STEP }, volumeAnswer)
      case 'quieter':
        return ducked !== null ? setDuckedVolume(ducked.restore - VOLUME_STEP) : onElement({ op: 'nudge', by: -VOLUME_STEP }, volumeAnswer)
      case 'mute':
        return onElement({ op: 'mute', on: music.on }, () => (music.on ? 'Muted.' : 'Unmuted.'))
      case 'show': {
        // The pane is on the watch page already — a song ended there too: the Command's own event wakes the dashboard over it.
        const shown = state.current ?? ended
        if (shown !== null) return { result: `showing: id=${shown.id}`, answer: `Showing ${quoted(shown.title)}.` }
        // No song held: the page's own video, one the Player never started (#362).
        const element = await control({ op: 'read' })
        if (element === null || !element.found) return { result: 'nothing playing', answer: 'Nothing is playing.', failure: true }
        return { result: "showing: the page's video", answer: element.title === '' ? 'Showing the video.' : `Showing ${quoted(element.title)}.` }
      }
    }
  }

  return {
    async perform(music, words, current) {
      generation += 1
      try {
        return await performNow(music, words, current)
      } finally {
        publish()
      }
    },

    async pauseAll() {
      const stopped = await evaluate<PausedAll>(PAUSE_ALL_SCRIPT)
      if (stopped === null || stopped.paused === 0) return false
      if (stopped.youtube) {
        state = pause(state)
        publish()
      }
      return true
    },

    async check() {
      if (checking || state.current === null) return
      checking = true
      try {
        const status = await evaluate<WatchStatus>(WATCH_SCRIPT)
        if (status !== null) hearStay(status)
        const end = status?.ended ?? null
        // An ad plays in the same element: its end is not the song's.
        if (end === null || end.ad || end.id !== state.current?.id) {
          if (status !== null) await readWatch(status)
          return
        }
        advanceInBackground()
        await background
      } finally {
        checking = false
        publish()
      }
    },

    settled: () => background,
    queue: () => state,
    nowPlaying,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    duck(on) {
      ducking = ducking.then(() => setDuck(on)).catch((error: unknown) => reportFault('music.player.duck', error))
      return ducking
    },
  }
}
