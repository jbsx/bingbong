import type { BrowserController } from '../../core/ports/browser'
import type { MusicAction } from '../../core/music/musicWords'
import type { PickSource } from '../../core/command/decisionRecord'
import { EMPTY_QUEUE, advance, dropCurrent, enqueue, ordinal, pause, playNow, previous, replaceCurrent, replay, setLoop, unpause, type Queue, type Song } from '../../core/music/queue'
import { QUEUED_SHOWN, type NowPlaying } from '../../core/music/nowPlaying'
import { initialDataOf, plainVideos, resultsUrl, watchUrl } from '../../core/music/youtubeSearch'
import { heldThroughChain, songTerms, stayed } from '../../core/music/rememberedSongs'
import { SPOKEN_FAILURES, spokenFailureOf } from '../../core/command/spokenFailure'
import { reportFault } from '../../core/trace/fault'
import { WithheldResourceError, type BrowserCustody } from '../../core/browser/unsettledAction'
import { FRAME_PAUSE_ALL_JS } from '../browser/pageMediaScript'
import { STOPPED_ANSWERS } from '../../core/command/answer'
import { loudnessFactor, matchedLevel } from '../../core/music/loudness'
import { DUCK_SHARE } from '../../core/music/ducking'
import { CONTINUE_SCRIPT, LEVEL_SCRIPT, PAUSE_ALL_SCRIPT, RESULTS_SCRIPT, WATCH_SCRIPT, controlScript, type ControlReach, type ElementOp, type ElementState, type LevelRead, type PausedAll, type WatchStatus } from './youtubeScripts'

// The Player (#343, CONTEXT.md): YouTube in the pane is the player; the
// queue and the verbs live here. `play <words>` fetches the results with
// the pane's session, takes the first plain video off their data and lands
// the pane on its watch page with no page read; `queue <words>` fetches the
// same results, so the song playing is never interrupted. Every other verb is
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
// back the volume it had — or the one a `volume` set meanwhile, by a verb
// here or a Media Op on the card. The duck marks the element with the
// volume it puts back (#459, `DUCK_MARK`): the card reads that, every
// volume set moves it, and the release puts back whatever it holds. The
// pane's duck (#461) lowers every other playing element beside it, and
// may mark the song's element first — the Player keeps a mark it finds.
// The level heard carries into the next song (#460): YouTube opens each
// at its remembered level × the track's loudness factor, so a level a
// Media Op set on the element alone would be lost; the Player matches the
// last song's level to the new track's loudness and puts it on the element.
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
  browser: Pick<BrowserController, 'navigate' | 'land' | 'evaluate' | 'evaluateInFrames'>
  /** A results page's HTML, fetched with the pane's session (its cookies, its consent). */
  fetchResults(url: string): Promise<string>
  /** Waits between reads of a page still building; real time when absent. */
  sleep?(ms: number): Promise<void>
  /** The Remembered Songs (#345); absent remembers nothing, and every `play` searches. */
  songs?: SongMemory
  /** A Learned Term a song that stayed teaches (#345): admitted at once. */
  learn?(term: string): void
  /**
   * The channel of a song that stayed (#456): proposed, admitted only when
   * it recurs — a wrong pick that plays on must not teach itself its
   * channel (a guess, cheapest to reverse; a week of kiosk `learned` hits
   * against wrong picks would settle it).
   */
  propose?(term: string): void
  /**
   * The custody the browser is held in (ADR 0038, #433): a refusal waits on
   * its `settled()` edge rather than asking again. Absent, a refusal is one
   * more failed read.
   */
  custody?: Pick<BrowserCustody<BrowserController>, 'settled'>
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
/** How far into a newly opened song (s) its carried level is put back over YouTube's own (#460). */
const CARRIED_S = 1
/** How near two levels (0–100) are the same: a watch read rounds to a whole one. */
const LEVEL_TOLERANCE = 0.5

/** A level on the element and its track's loudness: what the next song is matched to (#460). */
type HeardLevel = Pick<LevelRead, 'volume' | 'loudnessDb'>

/** The element plays at YouTube's own level — its remembered level × the track's loudness factor — not one set on the element alone (#460). */
const youTubesOwn = (read: Pick<LevelRead, 'volume' | 'playerVolume' | 'loudnessDb'>): boolean =>
  read.playerVolume !== null && Math.abs(read.volume - read.playerVolume * loudnessFactor(read.loudnessDb)) <= LEVEL_TOLERANCE

/** The song plays at YouTube's own level as it opens: on the element, or in a mark the pane's duck put on it at that level (#461). */
const opensAtYouTubesOwn = (status: WatchStatus): boolean =>
  youTubesOwn(status) || (status.restore !== null && youTubesOwn({ ...status, volume: status.restore }))

const floorOf = (volume: number): number => Math.round(volume * DUCK_SHARE)

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
  /** While ducked: the volume the duck puts back, as the element's mark last told it — a fresh element is marked with it. */
  let ducked: { restore: number } | null = null
  /**
   * The level last heard on the Player's song and its track's loudness
   * (#460): what the next song is matched to — however it was set, the
   * Player's verb, a Media Op, or YouTube's own slider.
   */
  let heard: HeardLevel | null = null
  /** A song just opened (#460): the level carried into it, put back over YouTube's own until the song has played a moment. */
  let carrying: { id: string; from: HeardLevel } | null = null
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
  /** A pick that stayed, its channel proposed once it plays through the retry chain's window (#456). */
  let channelDue: { readonly id: string; readonly channel: string } | null = null

  const superseded: PlayerOutcome = { result: 'superseded', answer: '', superseded: true }

  /** How many playing media elements the page's frames paused (#377); a failure to reach them pauses none. */
  async function pauseFrames(): Promise<number> {
    try {
      const counts = (await browser.evaluateInFrames?.<unknown>(FRAME_PAUSE_ALL_JS)) ?? []
      return counts.reduce<number>((sum, count) => sum + (typeof count === 'number' ? count : 0), 0)
    } catch (error) {
      reportFault('music.player.pauseFrames', error)
      return 0
    }
  }

  /** While custody withholds the browser (#433): the wait on its settling, every evaluate meanwhile answered null unasked. */
  let withheld: Promise<void> | null = null

  /** A refused evaluate starts the spell: one fault, then no page is asked until custody settles, and the song is read once on it. */
  function waitOutWithheld(custody: Pick<BrowserCustody<BrowserController>, 'settled'>): void {
    const resume = (): void => {
      withheld = null
      void player.check().catch((error: unknown) => reportFault('music.player.check', error))
    }
    withheld = custody.settled().then(resume, resume)
  }

  async function evaluate<T>(script: string): Promise<T | null> {
    if (withheld !== null) return null
    try {
      return (await browser.evaluate<T>(script)) ?? null
    } catch (error) {
      if (error instanceof WithheldResourceError && deps.custody !== undefined) {
        // Evaluates already in flight are refused too: the spell's first logs it.
        if (withheld === null) {
          reportFault('music.player.evaluate', error)
          waitOutWithheld(deps.custody)
        }
        return null
      }
      reportFault('music.player.evaluate', error)
      return null
    }
  }

  const control = (op: ElementOp, reach: ControlReach = 'page'): Promise<ElementState | null> => evaluate<ElementState>(controlScript(op, reach))

  /** The watch page for this song, once its player holds its video: true; 'elsewhere' off any watch page; false for any other landing. */
  async function landedOn(song: Song, current: () => boolean): Promise<boolean | 'elsewhere' | 'superseded'> {
    for (let read = 0; read < WATCH_READS; read += 1) {
      if (!current()) return 'superseded'
      const status = await evaluate<WatchStatus>(WATCH_SCRIPT)
      if (status !== null) {
        if (!status.watch) return 'elsewhere'
        if ((status.id !== null && status.id !== song.id) || status.error) return false
        if (status.hasVideo) return true
      }
      await sleep(WATCH_READ_MS)
    }
    return false
  }

  /**
   * The watch page, landed with no page read: the Player reads the landing
   * itself, and a collect would run on YouTube's own main thread while it
   * starts the video. A landing off the watch page (a consent wall) is
   * navigated again in full, which dismisses what it can.
   */
  async function goTo(song: Song, current: () => boolean): Promise<boolean | 'elsewhere' | 'superseded'> {
    const url = watchUrl(song.id)
    if (browser.land === undefined) {
      await browser.navigate(url)
      return landedOn(song, current)
    }
    await browser.land(url)
    const landed = await landedOn(song, current)
    if (landed !== 'elsewhere') return landed
    await browser.navigate(url)
    return landedOn(song, current)
  }

  /**
   * The level heard on the song being left, read as the page is left (#460):
   * a Media Op set it on the element alone a moment ago, and the poll may
   * not have read it yet. While ducked, the level the duck puts back. A song
   * whose carried level YouTube has put its own back over, not yet carried
   * again, keeps the level it carries.
   */
  async function readLeaving(leaving: Song | null): Promise<void> {
    if (leaving === null) return
    const read = await evaluate<LevelRead>(LEVEL_SCRIPT)
    if (read === null || read.id !== leaving.id || read.ad) return
    if (carrying?.id === leaving.id && ducked === null && youTubesOwn(read)) return
    // Under a duck, the level its mark puts back — a Media Op's set meanwhile too (#459) — else the one held.
    heard = { volume: read.restore ?? ducked?.restore ?? read.volume, loudnessDb: read.loudnessDb }
  }

  /**
   * The carried level on the song's element (#460): the level heard on the
   * last song, matched to this track's loudness — the duck's floor of it
   * while ducked, the duck then putting it back. Whether the read let it:
   * not off this song's page, nor over an ad.
   */
  async function carry(read: Pick<LevelRead, 'id' | 'ad' | 'volume' | 'loudnessDb'> | null): Promise<boolean> {
    const to = carrying
    if (to === null || read === null || read.id !== to.id || read.ad) return false
    const level = matchedLevel(to.from.volume, to.from.loudnessDb, read.loudnessDb)
    knownVolume = level
    if (ducked === null) {
      if (Math.abs(read.volume - level) > LEVEL_TOLERANCE) await control({ op: 'level', to: level })
      return true
    }
    // Under a duck the element's mark takes the level (#459), marked first if it carries none: heard at the floor, put back on release.
    ducked = { restore: level }
    await control({ op: 'level', to: level, duck: { restore: level, share: DUCK_SHARE } })
    return true
  }

  /** Open a song's watch page, leaving `leaving`; the queue moves on to it only when it landed. */
  async function open(song: Song, current: () => boolean, leaving: Song | null): Promise<'opened' | 'failed' | 'superseded'> {
    let landed: boolean | 'elsewhere' | 'superseded'
    try {
      await readLeaving(leaving)
      carrying = null
      landed = await goTo(song, current)
    } catch (error) {
      reportFault('music.player.open', error)
      return current() ? 'failed' : 'superseded'
    }
    if (landed === true && heard !== null) carrying = { id: song.id, from: heard }
    // A page opened starts at YouTube's remembered volume: the level heard on the last song at once (#460), else
    // down to the duck's floor while ducked (#344). Over an ad, the poll carries it once the song itself plays.
    const carried = landed === true && carrying !== null && (await carry(await evaluate<LevelRead>(LEVEL_SCRIPT)))
    if (landed === true && !carried && ducked !== null) await duckElement()
    return landed === 'superseded' ? 'superseded' : landed === true ? 'opened' : 'failed'
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
        const opened = await open(next, current, was)
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
    const opened = await open(song, current, state.current)
    if (opened === 'superseded') return superseded
    state = then()
    if (opened === 'failed') return failedToOpen(song)
    return { result: `playing: id=${song.id} title=${JSON.stringify(song.title)}`, answer, video: song.id }
  }

  /**
   * The plain videos for these words: fetched with the pane's session, so
   * no page is drawn or read for a search the Player reads off the data —
   * on two cores standing in for the kiosk's i3 that page cost about 1.5 s
   * of every `play` (2026-10-25). A fetch
   * that fails or carries no results data (a consent wall a fresh profile
   * has not passed) is read off the results page in the pane, whose
   * navigate dismisses what it can. An outcome when they show none.
   */
  async function readResults(words: string, current: () => boolean): Promise<readonly Song[] | PlayerOutcome> {
    let fetched: unknown = null
    try {
      fetched = initialDataOf(await deps.fetchResults(resultsUrl(words)))
    } catch (error) {
      reportFault('music.player.fetchResults', error)
    }
    if (!current()) return superseded
    if (fetched !== null) {
      const found = plainVideos(fetched)
      return found.length === 0 ? noVideos(words) : found
    }
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
    if (channelDue?.id === song.id) channelDue = null
    if (deps.songs?.forgetVideo(song.id) === true) return { result: `forgot: id=${song.id}`, answer: `Forgot ${quoted(song.title)}.` }
    return { result: `not remembered: id=${song.id}`, answer: `${quoted(song.title)} wasn't remembered.` }
  }

  /** The poll's read of the watch page (#345): the pick playing past the threshold has stayed — remembered, and its title learned. */
  function hearStay(status: WatchStatus): void {
    hearChannel(status)
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
    if (staying.song.channel !== undefined) channelDue = { id: staying.song.id, channel: staying.song.channel }
  }

  /** A pick that stayed and plays on through the retry chain's window, with no retry in it (#456), proposes its channel. */
  function hearChannel(status: WatchStatus): void {
    const due = channelDue
    if (due === null) return
    if (state.current?.id !== due.id) {
      channelDue = null
      return
    }
    if (status.ad || status.id !== due.id || !heldThroughChain(status.elapsed)) return
    channelDue = null
    deps.propose?.(due.channel)
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
    heardVolume(element)
    // A level the person set (#460): YouTube's own from here, never the carried one put back over it.
    if (op.op === 'volume' || op.op === 'nudge') carrying = null
    muted = element.muted
    state = then(state)
    return { result: `${op.op}: paused=${element.paused} loop=${element.loop} volume=${element.volume} muted=${element.muted}`, answer: answer(element) }
  }

  /** The volume an element answered with, as heard: the one known while not ducked, the one the duck puts back while its mark is on the element. */
  function heardVolume(element: ElementState): void {
    if (ducked === null) knownVolume = element.volume
    else if (element.ducked) ducked = { restore: element.volume }
  }

  /**
   * A volume verb. Under a duck the element's mark takes it (#459) — an
   * element the poll has not marked yet is marked in the same evaluate —
   * so the answer names the level put back, and the element stays at that
   * level's floor.
   */
  function onVolume(op: Extract<ElementOp, { op: 'volume' | 'nudge' }>): Promise<PlayerOutcome> {
    const held = ducked === null ? {} : { duck: { restore: ducked.restore, share: DUCK_SHARE } }
    return onElement({ ...op, ...held }, (element) => `Volume ${element.volume}.`)
  }

  /** The element dropped to the floor and marked with the volume the duck puts back: its own mark's, else the one held here. */
  async function duckElement(): Promise<void> {
    if (ducked === null) return
    const element = await control({ op: 'duck', restore: ducked.restore, share: DUCK_SHARE })
    if (element !== null && element.found) heardVolume(element)
  }

  async function setDuck(on: boolean): Promise<void> {
    if (on === (ducked !== null)) return
    if (!on) {
      const { restore } = ducked!
      ducked = null
      // The mark's volume — what a volume op set meanwhile — or, on an element no duck marked, the one held.
      const element = await control({ op: 'unduck', to: restore })
      if (element !== null && element.found) knownVolume = element.volume
      return
    }
    // Nothing playing: nothing to duck, and no page is touched.
    if (state.current === null) return
    // Unread yet: a nudge of nothing reads the volume as it is.
    const restore = knownVolume ?? (await control({ op: 'nudge', by: 0 }))?.volume ?? null
    if (restore === null) return
    knownVolume = restore
    ducked = { restore }
    await duckElement()
  }

  /** The poll's read of the song playing: its progress for the card, a new page's volume ducked, YouTube's own pause answered. */
  async function readWatch(status: WatchStatus): Promise<void> {
    const song = state.current
    if (song === null || status.id !== song.id || !status.hasVideo || status.ad) return
    progress = { id: song.id, channel: status.channel, elapsed: status.elapsed, duration: status.duration }
    muted = status.muted
    const opening = carrying?.id === song.id
    // YouTube may put its own level back as the song starts (#460): carried again over that, never over a level set since.
    if (opening && opensAtYouTubesOwn(status)) await carry(status)
    else if (ducked === null) {
      // The pane's duck may hold the song while the Player holds none (#461): the level heard is its mark's, never the floor.
      const volume = status.restore ?? status.volume
      knownVolume = volume
      heard = { volume, loudnessDb: status.loudnessDb }
    } else if (!status.ducked || status.volume > floorOf(ducked.restore)) await duckElement()
    if (opening && status.elapsed >= CARRIED_S) carrying = null
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
        return onVolume({ op: 'volume', to: music.to })
      case 'louder':
        return onVolume({ op: 'nudge', by: VOLUME_STEP })
      case 'quieter':
        return onVolume({ op: 'nudge', by: -VOLUME_STEP })
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

  const player: Player = {
    async perform(music, words, current) {
      generation += 1
      try {
        return await performNow(music, words, current)
      } finally {
        publish()
      }
    },

    async pauseAll() {
      // Every frame's media pauses beside the top's (#377), the frames' answers taken within the collect's grace.
      const [stopped, framed] = await Promise.all([evaluate<PausedAll>(PAUSE_ALL_SCRIPT), pauseFrames()])
      if ((stopped?.paused ?? 0) + framed === 0) return false
      if (stopped?.youtube === true) {
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
  return player
}
