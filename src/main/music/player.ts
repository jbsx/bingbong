import type { BrowserController, ConsentCleared, ConsentDrawn } from '../../core/ports/browser'
import type { MusicAction } from '../../core/music/musicWords'
import type { PickedSong } from '../../core/command/jevReading'
import type { PickSource } from '../../core/command/decisionRecord'
import { cantBePlayedLine, quoted } from '../../core/music/songLines'
import { EMPTY_QUEUE, advance, dropCurrent, enqueue, ordinal, pause, playNow, previous, replaceCurrent, replay, setLoop, unpause, type Queue, type Song } from '../../core/music/queue'
import { QUEUED_SHOWN, adWait, type AdShowing, type NowPlaying } from '../../core/music/nowPlaying'
import { isSeek, type MediaOpAction } from '../../core/browser/mediaOp'
import { describeMediaOp, seekAmount } from '../../core/command/mediaOp'
import { initialDataOf, plainVideos, resultsUrl, videoIdOf, watchUrl } from '../../core/music/youtubeSearch'
import { heldThroughChain, songTerms, stayed } from '../../core/music/rememberedSongs'
import { SPOKEN_FAILURES, spokenFailureOf } from '../../core/command/spokenFailure'
import { reportFault } from '../../core/trace/fault'
import { WithheldResourceError, type BrowserCustody } from '../../core/browser/unsettledAction'
import { FRAME_PAUSE_ALL_JS } from '../browser/pageMediaScript'
import { CONSENT_PLAYED_MS } from '../browser/collectPageScript'
import { STOPPED_ANSWERS } from '../../core/command/answer'
import { ROAD_LOUDNESS_DB, YOUTUBE_DEFAULT_LEVEL, loudnessFactor, matchedLevel } from '../../core/music/loudness'
import { DUCK_SHARE } from '../../core/music/ducking'
import { waitedFor, type SongWait } from '../../core/music/songWait'
import type { AudioStream, LookupRecord } from './ytDlp'
import { createStreamMemory, type RememberedStream } from '../../core/music/streamMemory'
import { CONTINUE_SCRIPT, END_LEAD_S, HELD_RESUME_SCRIPT, LEVEL_SCRIPT, PAUSE_ALL_SCRIPT, RESULTS_SCRIPT, START_SCRIPT, WATCH_SCRIPT, controlScript, type ControlReach, type ElementOp, type ElementState, type HeldResumed, type LevelRead, type PausedAll, type StartRead, type WatchStatus } from './youtubeScripts'

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
//
// A song opened is not yet playing (#488): on a fresh profile YouTube's
// video may sit paused at 0 s, or play a moment and stop. The Player reads
// the element's own playback after every open, presses play on it once
// when it has not started, and says Playing only when it plays; else the
// Command fails in words and the Queue holds the song, paused.

/** What a Player verb came to: the tool result line, its Answer, and the video it opened or queued. */
export interface PlayerOutcome {
  readonly result: string
  /** The Answer (#333); empty when superseded. */
  readonly answer: string
  readonly failure?: true
  readonly video?: string
  /** The song opened but its element never played (#488): a failure that is the start's, not the song's. */
  readonly unstarted?: true
  /** A later Command came while it ran: nothing more was opened, and it answers nothing. */
  readonly superseded?: true
  /** For a search (#345): the video came from the Remembered Songs, or from YouTube's results. */
  readonly pick?: PickSource
  /** With the audio road taken (#502), the song opened on the watch page — a video, or the road's fallback — so the dashboard shows it. */
  readonly shown?: true
}

/**
 * Where the audio road plays (#502): a surface outside the pane holding one
 * bare media element, which answers the Player's scripts as a watch page's
 * player does. `load` puts a song's stream on it; `stop` empties it.
 */
export interface AudioSurface {
  evaluate<T>(script: string): Promise<T | undefined>
  load(song: Song, stream: string): Promise<void>
  stop(): Promise<void>
}

/** The audio road (#502): its surface, and the lookup of a video's audio stream, which rejects on any failure or its time running out. */
export interface AudioRoad {
  readonly surface: AudioSurface
  /** The stream, and when YouTube serves it: the element is handed it only then. */
  resolve(id: string): Promise<AudioStream>
  /**
   * Whether a song takes the road now: the `audioOnlyMusic` setting, read at
   * each song, so it applies live. Absent, always. Off with a song on the
   * road, that song plays on and the next opens on the watch page.
   */
  on?(): boolean
}

/**
 * A wait the Player's song is in before it plays (#502), for the Command
 * waiting on it to narrate (ui.md 2): its stream looked up on the audio
 * road, the time YouTube serves it once the lookup said (#507), or its
 * watch page opened because the road could not play it.
 */
export type PlayerWait = SongWait

/** Where the Player's song plays (#502): the watch page in the pane, or the audio road. */
export type Road = 'page' | 'audio'

/** How a song opened came to play (#488): what the perf log keeps of each start. */
export interface PlayerStart {
  readonly video: string
  /** The element played, its time moving past a moment's play. */
  readonly started: boolean
  /** It was pressed once, not having started by itself. */
  readonly pressed: boolean
  /** This try is on the page opened again, the first one's press having not started it. */
  readonly reopened: boolean
  /** The press's `play()` rejection name (`NotAllowedError`, `AbortError`); null when none was refused. */
  readonly refused: string | null
  /** The element as last read (null for none): what tells a refused press from one the page paused again. */
  readonly element: Pick<StartRead, 'paused' | 'ended' | 'ready' | 'time'> | null
  /** From the landing to the start, or to giving up on it (ms). */
  readonly ms: number
  /** Where it played (#502): the watch page in the pane, or the audio road. */
  readonly road: Road
  /** How long the audio road's lookup of its stream took (#502) (ms); null on the watch page. */
  readonly lookup: number | null
  /** How long its stream waited after the lookup to be served (#502) (ms), the margin in it; past the bound, the wait it would have had; null on the watch page. */
  readonly served: number | null
  /** Its address was remembered from an earlier play (#516): no lookup ran. */
  readonly remembered: boolean
  /** How its lookup went (#516): the client that answered, yt-dlp's steps, the first ask's failure; null with no lookup run. */
  readonly asked: LookupRecord | null
  /** On the watch page because the audio road could not play it (#502): the lookup failed or ran out, or the stream would not start. */
  readonly fallback: boolean
  /** Opened by the Queue moving on (an end, a failed landing), with no Command waiting on it. */
  readonly background: boolean
  /** From the landing to the consent wall cleared over the page before this was recorded (#492) (ms); null when none was. */
  readonly consent: number | null
  /** How long an ad in the element held the start (#497) (ms), by the engine's own fact; null when none played. */
  readonly ad: number | null
}

/** A consent wall the browser cleared for the Player (#492, #496): what the perf log keeps of each. */
export interface PlayerConsent {
  /** The song's video; null for a wall over media on a page the Player did not open. */
  readonly video: string | null
  /** From the Player's landing to the clear (ms); null for a page the Player did not open. */
  readonly ms: number | null
  /** The song's start was already recorded: the wall drew over a song that had started, or given up on. */
  readonly afterStart: boolean
  /** The browser's dismissal line. */
  readonly line: string
  /** From the draw the page signalled, or the landing's look, to the click (ms). */
  readonly drawToClickMs: number
  /** From the click to the sheet gone, or to the wait's bound (ms). */
  readonly goneMs: number
  /** The sheet was seen gone inside the bound. */
  readonly gone: boolean
  /** Media the page marked playing as the wall drew (#496); 0 when none was, or none was asked for. */
  readonly held: number
  /** Of those, the ones found paused after the clear and played once. */
  readonly resumed: number
}

/** Why a wall the page told of is cleared, or not (#496): over the Player's song, by kind over media playing, or left to the next collect. */
export type ConsentToldRoad = 'ours' | 'kind' | 'nothing-playing' | 'own-pause'

/** A wall the page told of as it drew (#496), and what the Player did with it: what the perf log's `consent-told` keeps. */
export interface PlayerConsentTold extends ConsentDrawn {
  readonly road: ConsentToldRoad
  /** When the clear runs: at once, after the clear in flight, once custody settles; null for none. */
  readonly at: 'now' | 'queued' | 'withheld' | null
}

/** A seek that left the playing song paused (#505), as the poll read it: what the perf log's `media-seek` keeps. */
export interface PlayerSeekResume {
  readonly video: string
  /** How long before the read the element seeked (ms), by the page's clock. */
  readonly seekAgeMs: number
  /** Played once; else what held it: a pause the person asked for after the seek, one the Player made, the song's end. */
  readonly resumed: boolean
  readonly held: 'person' | 'own' | 'end' | null
}

/** A page the Player opened, watched for a consent wall (#492). */
interface ConsentWatch {
  readonly song: Song
  /** The landing, on the clock. */
  readonly from: number
  /** When a wall was cleared over it, on the clock; null while none was. */
  at: number | null
  /** The look or clear in flight. */
  looking: Promise<unknown> | null
  /** The song's start already took the clear's fresh bound. */
  honoured: boolean
  /** The song's start was decided: a wall cleared now came after it. */
  started: boolean
  /** A pause ended the watch (#489): a clear already out when it came lets the page start the song, and the page is held paused. */
  paused: boolean
}

/** From the landing to the clear (ms); null while none was. */
function clearedMs(watch: ConsentWatch): number | null {
  return watch.at === null ? null : Math.round(watch.at - watch.from)
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
  /**
   * The search's pick a correction acts on (#498): its title, its words and
   * whether it is the Queue's song; held while it opens, after the line
   * opening it was cut off, and while it plays. Null with none, or once
   * another song took its place.
   */
  picked?(): PickedSong | null
  /** What the Idle Screen's card shows (#344); null when the Player holds no song. */
  nowPlaying(): NowPlaying | null
  /** Hears every change to {@link nowPlaying}; the returned function stops it. */
  onChange(listener: (nowPlaying: NowPlaying | null) => void): () => void
  /** Hears a queued video opening on the watch page in the background (#502), with no Command to show it: the dashboard is to wake over it. The returned function stops it. */
  onShown(listener: () => void): () => void
  /** Hears a queued song that could not open in the background (#538), passed over with no Command to say so: once per song, on either road, whether or not the queue goes on. The returned function stops it. */
  onPassedOver(listener: (song: Song) => void): () => void
  /** Ducks the music (on) or puts its volume back (off) (#344). Resolves when the element has it. */
  duck(on: boolean): Promise<void>
  /**
   * A seek while an ad plays in the song's element (#497), by the engine's
   * own fact: held, and put on the song once the ad ends — one op, never
   * pressed again — its outcome naming the ad. Null when no ad holds the
   * song's element: the seek is the browser's, on the element as it is.
   */
  seekOverAd(action: MediaOpAction): Promise<PlayerOutcome | null>
  /** Where the song plays, or last played (#502): what the Appliance Card's media reads and its ops reach. */
  road(): Road
  /**
   * The stream last handed to the audio road was refused or cut (#516): its
   * address is forgotten, so no repeat play is handed it again. True when
   * that address came from memory: the fault is the address's, not a yt-dlp's
   * that failed.
   */
  streamRefused(): boolean
  /** The audio road is taken now (#502), its setting read as this is: a song not read as a video opens there, and leaves the pane alone. */
  readonly audioRoad: boolean
  /** Hears each wait a song opened for a Command is in before it plays (#502): the lookup, the fallback. The returned function stops it. */
  onWait(listener: (wait: PlayerWait) => void): () => void
  /**
   * Hears every wait a song is in before it sounds (#507) — a Command's,
   * and a queued song's starting into silence — and its end (`null`):
   * what the Wait Card shows. The returned function stops it.
   */
  onSongWait(listener: (wait: SongWait | null) => void): () => void
}

export interface PlayerDeps {
  browser: Pick<BrowserController, 'navigate' | 'land' | 'evaluate' | 'evaluateInFrames' | 'clearConsent' | 'onConsentDrawn' | 'state'>
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
  /** Hears every song's start, or its failing to (#488): the perf log's `media-start`. */
  onStart?(start: PlayerStart): void
  /** Hears every consent wall cleared over a page the Player opened (#492): the perf log's `media-consent`. */
  onConsent?(consent: PlayerConsent): void
  /** Hears every wall the page told of as it drew (#496): the perf log's `consent-told`. */
  onConsentTold?(told: PlayerConsentTold): void
  /** Hears every seek the poll read as having left the playing song paused (#505): the perf log's `media-seek`. */
  onSeekResume?(seek: PlayerSeekResume): void
  /** Monotonic ms, for a start's duration; `performance.now()` when absent. */
  now?(): number
  /** Wall-clock ms, for when the audio road's stream is served (#502); `Date.now()` when absent. */
  wallNow?(): number
  /** The audio road (#502), taken while its `on` says so; absent, every song opens on the watch page as before. */
  audio?: AudioRoad
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
  /** Jev read the words as a video (#502): its corrections open on the watch page too. */
  readonly video: boolean
  staying: boolean
}

/** How long a watch page may take to build its player before the landing is taken as failed. */
const WATCH_READS = 20
const WATCH_READ_MS = 250
/** How long the results page may take to carry its data. */
const RESULTS_READS = 8
const RESULTS_READ_MS = 250
/** How often a song just opened is read for its start (#488). */
const START_READ_MS = 250
/**
 * The longest the audio road waits for its stream to be served (#502) before
 * the song takes the watch page: about twice the longest wait measured
 * (2026-10-29, dev, live: 4.0 s and 4.8 s after the lookup; 2.5–2.9 s over
 * 18 probes the night before) — a guess past that; the `media-start`
 * `served` of the road's songs settles it, a wait past it logged too.
 */
const SERVED_WAIT_MS = 10_000
/** Past `available_at` before the element is handed the stream: the margin the measured arm played 54 of 54 with (2026-10-28), `available_at` being whole seconds. */
const SERVED_MARGIN_MS = 250
/**
 * How long a song just opened may take to play by itself before it is
 * pressed (#488): measured — in #486's kept runs at 919f058f (fresh profile,
 * Xvfb), the latest of the songs that started by themselves was playing
 * 2.2 s after the landing, read every 400 ms.
 */
const SELF_START_MS = 2_500
/** How long a pressed song may take to play before it is taken as unstarted: a guess, the self-start bound again; #488's perf `media-start` records settle it. */
const PRESSED_START_MS = 2_500
/**
 * How long a page just opened is watched for a consent wall (#492):
 * measured — over 56 kept runs on 2026-10-28 (fresh profile, Xvfb) YouTube's
 * consent sheet drew 2.1–4.5 s or 8.5–11.9 s after the watch landing, once
 * 15.3 s, each after the landing's own clear had run; the bound is about
 * twice the latest. It is looked for once at the landing; after that the
 * page signals a wall as it draws (#496).
 */
const CONSENT_WATCH_MS = 30_000
/** How far the element's time must move to be a start (s): one that plays 0.5–1.3 s and stops is not (#488, the kept runs at 919f058f). */
const PLAYED_S = 1.5
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

/** The song is in its end's lead (END_LEAD_S): the end rule's to pause, never a resume's. */
const atEnd = (status: Pick<WatchStatus, 'elapsed' | 'duration'>): boolean => status.duration !== null && status.elapsed >= status.duration - END_LEAD_S

/** An Answer for a song the audio road could not play (#502): "Playing “X” on its watch page." */
const onItsWatchPage = (answer: string): string => `${answer.replace(/\.$/, '')} on its watch page.`

const NONE_HELD: HeldResumed = { held: 0, played: 0 }

const isSongs = (read: readonly Song[] | PlayerOutcome): read is readonly Song[] => Array.isArray(read)

export function createPlayer(deps: PlayerDeps): Player {
  const { browser } = deps
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = deps.now ?? (() => performance.now())
  const wallNow = deps.wallNow ?? (() => Date.now())
  let state: Queue = EMPTY_QUEUE
  /** Bumped by every verb and every background open: an open a later one overtook stops where it stands. */
  let generation = 0
  let background: Promise<void> = Promise.resolve()
  let checking = false
  /** The song that ran out with nothing queued, still shown on the card until something else plays (#344). */
  let ended: Song | null = null
  /** The pane has left the ended song's page: the poll stops reading it (#473) until a verb opens something. */
  let endedLeft = false
  /** The Player's own verb paused the song (#473): what tells YouTube's idle pause, answered through "Continue watching?", from ours — the Queue's flag follows the element now, whoever paused it. */
  let ownPause = false
  /** What the poll last read of the song playing: its channel and progress. */
  let progress: { id: string; channel: string; elapsed: number; duration: number | null } | null = null
  /** When the song held last moved, and the element's time then: what lets the Idle Screen's card go however the song stopped. */
  let sounded: { id: string; at: number; time: number | null } | null = null
  /** An ad playing in the song's element (#497), as its start or the poll last read it; null while the song itself plays. */
  let adOver: { id: string; ad: AdShowing } | null = null
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
  /** The consent watch on the page the Player opened last (#492); a page opened after it ends it. */
  let consentWatch: ConsentWatch | null = null
  /** Where the song plays (#502): every read and control of it goes there. */
  let road: Road = 'page'
  // Every wall the page signals as it draws (#496), heard for the Player's life: the browser's own clear is on the Player's road.
  browser.onConsentDrawn?.((drawn) => consentDrawn(drawn))
  const listeners = new Set<(nowPlaying: NowPlaying | null) => void>()
  const shownListeners = new Set<() => void>()
  const passedOverListeners = new Set<(song: Song) => void>()
  const waitListeners = new Set<(wait: PlayerWait) => void>()
  const cardListeners = new Set<(wait: SongWait | null) => void>()
  /** The wait the Wait Card shows (#507), and the open it is for: only that open ends it — never one a later Command overtook. */
  let waiting: { wait: SongWait; owner: () => boolean } | null = null
  /** While a wait is up, its owner read every quarter second: a stop or a later line ends it then, not when its lookup returns (#507). */
  let ownerWatch: ReturnType<typeof setInterval> | null = null
  const closeWait = (): void => {
    waiting = null
    if (ownerWatch !== null) clearInterval(ownerWatch)
    ownerWatch = null
    for (const listener of [...cardListeners]) listener(null)
  }
  /**
   * A wait told (#502, #507): a Command's song is narrated to the Command;
   * every song's goes to the Wait Card, a queued one's too — it opens in
   * the background only once the song before it ended or failed, so it
   * starts into silence (ruling 4 on #507). Each kind of one song's wait
   * keeps the wait's start, so its seconds are the whole wait's.
   */
  const waitFor = (kind: SongWait['kind'], song: Song, owner: () => boolean, background: boolean, until = 0): void => {
    // The words' wait, then the pick's (#507): one open's wait for one song keeps one start.
    const held = waiting !== null && waiting.owner === owner ? waitedFor(waiting.wait.song) : undefined
    const since = waiting !== null && (held === null || held === song.id) ? waiting.wait.since : wallNow()
    const named = { id: song.id, title: song.title, ...(song.channel !== undefined ? { channel: song.channel } : {}) }
    tellWait(kind === 'served' ? { kind, song: named, since, until } : { kind, song: named, since }, owner, background)
  }
  const tellWait = (wait: SongWait, owner: () => boolean, background: boolean): void => {
    waiting = { wait, owner }
    ownerWatch ??= setInterval(() => {
      if (waiting !== null && !waiting.owner()) closeWait()
    }, 250)
    if (!background) for (const listener of [...waitListeners]) listener(wait)
    for (const listener of [...cardListeners]) listener(wait)
  }
  /** The open `owner` made is over — its song sounds, or it failed or gave way: its wait, if still the one shown, ends. */
  const waitEnded = (owner: () => boolean): void => {
    if (waiting === null || waiting.owner !== owner) return
    closeWait()
  }
  /** The audio road is taken now (#502): wired, and its setting on. */
  const roadOn = (): boolean => deps.audio !== undefined && (deps.audio.on?.() ?? true)
  /** The last lookup on the audio road (#502): its song, how long it took and how long its stream then waited to be served, for that song's `media-start`; a remembered address stands in for one (#516). */
  let lookedUp: { id: string; ms: number; served: number; stream: RememberedStream; remembered: boolean; asked: LookupRecord | null } | null = null
  /** The addresses of streams that played (#516): a repeat play skips its lookup. */
  const addresses = createStreamMemory()
  /** The stream last handed to the audio road's element (#516), which plays on through the next song's lookup; what a stream's fault is about. */
  let onSurface: { id: string; remembered: boolean } | null = null
  /** The song the road could not play, opened on its watch page instead (#502); null once another opens on its own road. */
  let fellBack: string | null = null
  let published = 'null'

  function nowPlaying(): NowPlaying | null {
    const song = state.current ?? ended
    if (song === null) return null
    const read = progress !== null && progress.id === song.id ? progress : null
    const ad = state.current !== null && adOver !== null && adOver.id === song.id ? adOver.ad : null
    return {
      id: song.id,
      title: song.title,
      // The element's own channel once read, else the one the search result named (#502): the artist is on screen from the start, on either road.
      channel: read?.channel || song.channel || '',
      elapsedS: Math.floor(read?.elapsed ?? 0),
      durationS: read === null || read.duration === null ? null : Math.round(read.duration),
      paused: state.current !== null && state.paused,
      loop: state.current !== null && state.loop,
      muted,
      ended: state.current === null,
      queued: state.upNext.slice(0, QUEUED_SHOWN).map((song) => song.title),
      ...(ad !== null ? { ad } : {}),
      soundedAt: sounded?.id === song.id ? sounded.at : wallNow(),
    }
  }

  /**
   * An ad in the song's element, read off it (#497) — its seconds and
   * length, whole — or none: Now Playing says it, and the card hears it.
   */
  function showAd(song: Song, read: Pick<StartRead, 'time' | 'duration' | 'skippable'> | null): void {
    adOver = read === null ? null : { id: song.id, ad: { elapsedS: Math.floor(read.time), durationS: read.duration === null ? null : Math.round(read.duration), skippable: read.skippable } }
    publish()
  }

  /** A seek asked while an ad held the song's element (#497): put on that song once the ad ends. */
  let heldSeek: { readonly id: string; readonly action: MediaOpAction } | null = null

  /**
   * The ad over the song playing now, read off its element (#497), Now
   * Playing told; null when none plays, or the song is on the audio road,
   * which has no ads.
   */
  async function adOverNow(): Promise<{ song: Song; ad: AdShowing } | null> {
    const song = state.current
    if (song === null || road !== 'page') return null
    const read = await evaluate<StartRead>(START_SCRIPT)
    if (read === null || !read.ad) return null
    showAd(song, read)
    return adOver === null ? null : { song, ad: adOver.ad }
  }

  /**
   * The held seek put on the song (#497), once its element plays the song
   * itself: as far as the words said, or the rung's share of the song's own
   * length — never the ad's, which the rung was first read against.
   */
  async function applyHeldSeek(song: Song, at: { elapsed: number; duration: number | null }): Promise<void> {
    if (heldSeek === null || heldSeek.id !== song.id || at.duration === null) return
    const { action } = heldSeek
    heldSeek = null
    if (!isSeek(action.op)) return
    const rung = action.rung ?? 'words'
    const seconds = rung === 'words' ? (action.seconds ?? 0) : seekAmount(rung, action.op, { currentTime: at.elapsed, duration: at.duration, seekable: null }, '').seconds
    await control({ op: 'seek', by: action.op === 'forward' ? seconds : -seconds })
  }

  /** Tells the card what changed, if anything did. */
  function publish(): void {
    if (state.current !== null) ended = null
    const song = state.current ?? ended
    if (song !== null && sounded?.id !== song.id) sounded = { id: song.id, at: wallNow(), time: null }
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

  /** A script on the song's surface — the audio road's while the song plays there (#502) — or, `on` 'pane', on the pane whatever plays. */
  async function evaluate<T>(script: string, on: 'song' | 'pane' = 'song'): Promise<T | null> {
    if (on === 'song' && road === 'audio' && deps.audio !== undefined) {
      try {
        return (await deps.audio.surface.evaluate<T>(script)) ?? null
      } catch (error) {
        reportFault('music.player.evaluateAudio', error)
        return null
      }
    }
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
  async function goTo(song: Song, current: () => boolean, at?: number): Promise<boolean | 'elsewhere' | 'superseded'> {
    // A song shown from the audio road (#502) opens where the stream stood.
    const url = at === undefined ? watchUrl(song.id) : `${watchUrl(song.id)}&t=${Math.floor(at)}s`
    if (browser.land === undefined) {
      await browser.navigate(url)
      watchConsent(song)
      return landedOn(song, current)
    }
    await browser.land(url)
    watchConsent(song)
    const landed = await landedOn(song, current)
    if (landed !== 'elsewhere') return landed
    await browser.navigate(url)
    watchConsent(song)
    return landedOn(song, current)
  }

  /**
   * The page just opened, watched for a consent wall (#492) for
   * {@link CONSENT_WATCH_MS}, since a wall can draw after the landing
   * settled — YouTube's sheet over a watch page on a fresh profile holds its
   * song. One look at the landing, for a wall up before the watch began;
   * from then on the page signals a wall as it draws (#496) and the browser's
   * own clear (ADR 0061) runs at once. In the background: the song's start
   * waits on nothing. It ends on the first clear, a pause, or when the
   * Player opens another page.
   */
  function watchConsent(song: Song): void {
    if (browser.clearConsent === undefined) return
    const mine: ConsentWatch = { song, from: now(), at: null, looking: null, honoured: false, started: false, paused: false }
    consentWatch = mine
    void clearWall(mine, null, undefined)
  }

  /** The Player's own pause, on the clock: a wall the page signals after it is not cleared for the media it paused (#496). */
  let pausedAt = -Infinity

  /**
   * A pause the person asked for, `pause` or `stop` alike: it ends the consent watch (#489, #496), since a wall cleared
   * after it lets the page start the song it was told to stop. A clear already out when it came holds the page paused.
   */
  function pausedByPerson(): void {
    if (consentWatch !== null) consentWatch.paused = true
    consentWatch = null
    pausedAt = now()
  }

  /**
   * A consent wall the page signalled as it drew (#496), cleared at once by
   * the browser's own clear, by kind: over the song the Player opened while
   * its watch runs, or over media playing on any page — never for the site,
   * and never over media the Player has just paused (a clear lets a page
   * start what its wall held). A wall over a page with nothing playing is
   * the next Command's collect's, as it always was.
   */
  function consentDrawn(drawn: ConsentDrawn): void {
    const heard = now()
    const watch = consentWatch !== null && heard - consentWatch.from < CONSENT_WATCH_MS ? consentWatch : null
    const ours = watch !== null && videoIdOf(browser.state().url ?? '') === watch.song.id
    // The page counts media paused within CONSENT_PLAYED_MS as playing: the Player's own pause in that window is not a wall's.
    const kind = drawn.playing && heard - drawn.ageMs >= pausedAt + CONSENT_PLAYED_MS
    const way: ConsentToldRoad = ours ? 'ours' : !drawn.playing ? 'nothing-playing' : kind ? 'kind' : 'own-pause'
    const at = way === 'ours' || way === 'kind' ? (clearingWall ? 'queued' : withheld !== null ? 'withheld' : 'now') : null
    deps.onConsentTold?.({ ...drawn, road: way, at })
    if (at === null) return
    void clearWall(ours ? watch : null, heard - drawn.ageMs, drawn)
  }

  /** Custody holds the page (#433): the wall is looked for again once it settles, the look first — the page told its showing once. */
  function lookOnceSettled(watch: ConsentWatch | null, drawnAt: number | null): void {
    const waiting = withheld as Promise<void> | null
    if (waiting !== null) void waiting.then(() => clearWall(watch, drawnAt, undefined))
  }

  /** The browser's clear, one at a time. The page tells each showing once, so one told during a clear is kept and cleared after it. */
  let clearingWall = false
  let toldDuring: { readonly watch: ConsentWatch | null; readonly drawnAt: number | null; readonly drawn: ConsentDrawn | undefined } | null = null

  async function clearWall(watch: ConsentWatch | null, drawnAt: number | null, drawn: ConsentDrawn | undefined): Promise<void> {
    if (browser.clearConsent === undefined) return
    if (clearingWall) {
      toldDuring = { watch, drawnAt, drawn }
      return
    }
    // The pane left the song's page (a Command's navigate, a link): the page is no longer the Player's to clear.
    if (watch !== null && (consentWatch !== watch || videoIdOf(browser.state().url ?? '') !== watch.song.id)) return
    if (withheld !== null) return lookOnceSettled(watch, drawnAt)
    clearingWall = true
    const url = browser.state().url ?? ''
    let cleared: ConsentCleared | null = null
    const from = now()
    try {
      const clearing = browser.clearConsent(drawn === undefined ? undefined : { shown: drawn.showing, playing: drawn.playing, ...(drawn.wall === undefined ? {} : { wall: drawn.wall }) })
      if (watch !== null) watch.looking = clearing.catch(() => null)
      cleared = await clearing
    } catch (error) {
      // A custody hold refuses the clear (#433): one fault for the hold, and the wall looked for again once it settles.
      if (error instanceof WithheldResourceError && deps.custody !== undefined) {
        if (withheld === null) {
          reportFault('music.player.clearConsent', error)
          waitOutWithheld(deps.custody)
        }
        lookOnceSettled(watch, drawnAt)
      } else {
        reportFault('music.player.clearConsent', error)
      }
    } finally {
      clearingWall = false
      if (watch !== null) watch.looking = null
    }
    const told = toldDuring
    toldDuring = null
    // A wall the page told of while this clear ran (a landing's look that ran a beat before it drew) is cleared now.
    if (told !== null) void clearWall(told.watch, told.drawnAt, told.drawn)
    if (cleared === null) return
    if (watch !== null) watch.at = now()
    const { held, played: resumed } = drawn?.playing === true && drawnAt !== null && watch?.paused !== true ? await resumeHeld(drawnAt) : NONE_HELD
    deps.onConsent?.({
      video: watch?.song.id ?? videoIdOf(url),
      ms: watch === null ? null : clearedMs(watch),
      afterStart: watch === null || watch.started,
      line: cleared.line,
      // From the draw the page signalled to the click; a wall up at the landing's look counts from the look.
      drawToClickMs: Math.round(from - (drawnAt ?? from) + cleared.clickMs),
      goneMs: Math.round(cleared.goneMs),
      gone: cleared.gone,
      held,
      resumed,
    })
    if (watch?.paused === true) await holdPaused(watch.song)
  }

  /**
   * The media a wall drew over playing, played once after its clear (#496):
   * a page that pauses its media under its wall may not start it again as
   * the wall leaves (YouTube's sheet over a song playing). Only with no
   * pause of the person's since the draw — a pause the wall did not make is
   * the person's to undo (#492) — and only the elements the page marked
   * playing as it drew, by kind on any site. Nothing new is said.
   */
  async function resumeHeld(drawnAt: number): Promise<HeldResumed> {
    if (pausedAt + CONSENT_PLAYED_MS > drawnAt) return NONE_HELD
    return (await evaluate<HeldResumed>(HELD_RESUME_SCRIPT, 'pane')) ?? NONE_HELD
  }

  /**
   * A page whose wall was cleared after a pause ended its watch (#489, the
   * overlap gate's 1-replace): the clear was out when the pause came, and
   * the page starts its song as the sheet leaves. Held paused for a
   * self-start's bound and a start's play past it — the window in which a
   * song starts by itself — until the Player is asked anything, or the pane
   * leaves the song's page.
   */
  async function holdPaused(song: Song): Promise<void> {
    const mine = generation
    for (let read = 0; read * START_READ_MS < SELF_START_MS + PLAYED_S * 1000; read += 1) {
      if (generation !== mine || withheld !== null || videoIdOf(browser.state().url ?? '') !== song.id) return
      await evaluate<PausedAll>(PAUSE_ALL_SCRIPT, 'pane')
      await sleep(START_READ_MS)
    }
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
    heard = { volume: read.restore ?? ducked?.restore ?? read.volume, loudnessDb: loudnessOn(read.loudnessDb) }
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
    const level = matchedLevel(to.from.volume, to.from.loudnessDb, loudnessOn(read.loudnessDb))
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

  /**
   * A page just opened starts at YouTube's remembered volume: the level heard
   * on the last song at once (#460), else down to the duck's floor while
   * ducked (#344). Over an ad, the poll carries it once the song itself plays.
   */
  async function levelOpened(): Promise<void> {
    const carried = carrying !== null && (await carry(await evaluate<LevelRead>(LEVEL_SCRIPT)))
    if (!carried && ducked !== null) await duckElement()
  }

  /**
   * The song's stream on the audio road (#502): looked up, then loaded on
   * the surface and read until its element holds the song, as a watch page
   * is. A lookup that fails or runs out of time is a failed landing, which
   * the caller takes to the watch page.
   */
  async function streamTo(song: Song, current: () => boolean, background: boolean): Promise<boolean | 'superseded'> {
    const audio = deps.audio!
    let stream: AudioStream
    const kept = addresses.recall(song.id, wallNow())
    if (kept === null) waitFor('lookup', song, current, background)
    // A lookup that fails counts none: the last one's, of this same song perhaps, is not its own.
    lookedUp = null
    const from = now()
    try {
      stream = kept ?? (await audio.resolve(song.id))
    } catch (error) {
      reportFault('music.player.resolve', error)
      return current() ? false : 'superseded'
    }
    const looked = { id: song.id, stream, remembered: kept !== null, asked: stream.asked ?? null }
    const ms = Math.round(now() - from)
    if (!current()) return 'superseded'
    // The stream answers 403 until YouTube serves it: waited out, still the lookup's narrated wait, or the watch page past the bound.
    const servedAt = stream.availableAt === null ? null : stream.availableAt + SERVED_MARGIN_MS
    const servedInMs = servedAt === null ? 0 : Math.max(0, servedAt - wallNow())
    if (servedInMs > SERVED_WAIT_MS) {
      // Its fallback's `media-start` still counts the lookup, with the wait it would have had: what settles the bound.
      lookedUp = { ...looked, ms, served: Math.round(servedInMs) }
      reportFault('music.player.served', new Error(`the stream for ${song.id} is served only in ${Math.round(servedInMs)} ms`))
      return false
    }
    // When it sounds is known now (#507): the Wait Card and the Capsule count down to it — or, served already
    // (the kiosk's lookups run past `available_at`), "Starting" counts from now, never from a time gone.
    if (servedAt !== null) waitFor('served', song, current, background, Math.max(servedAt, wallNow()))
    // Bound on the monotonic clock too: a wall clock stepped back must not stretch the wait.
    const waited = now()
    while (servedAt !== null && wallNow() < servedAt && now() - waited < SERVED_WAIT_MS) {
      await sleep(Math.min(START_READ_MS, servedAt - wallNow()))
      if (!current()) return 'superseded'
    }
    lookedUp = { ...looked, ms, served: Math.round(now() - waited) }
    await leaveRoad('audio')
    onSurface = { id: song.id, remembered: kept !== null }
    await audio.surface.load(song, stream.stream)
    road = 'audio'
    const landed = await landedOn(song, current)
    return landed === 'elsewhere' ? false : landed
  }

  /**
   * The song moves to `to` (#502): what plays on the road it leaves is
   * silenced — the stream emptied, or the pane's song paused, since the
   * pane stays on its page — and the page's consent watch ends.
   */
  async function leaveRoad(to: Road): Promise<void> {
    if (road === to) return
    if (road === 'audio') {
      await deps.audio!.surface.stop()
    } else if (state.current !== null || ended !== null) {
      consentWatch = null
      await evaluate<ElementState>(controlScript({ op: 'pause' }, 'youtube'), 'pane')
    }
    road = to
  }

  /** A track's loudness as read, or on the audio road, whose bare stream names none, a typical track's (#502). */
  const loudnessOn = (db: number | null): number | null => db ?? (road === 'audio' ? ROAD_LOUDNESS_DB : null)

  /** The road a song opens on (#502): the audio road while it is taken, unless Jev read the words as a video. */
  const roadFor = (video: boolean): Road => (roadOn() && !video ? 'audio' : 'page')

  /**
   * A remembered address that did not play (#516), refused after the IP
   * changed perhaps, is forgotten: true when this song's was one, and it
   * has one fresh lookup before the watch page.
   */
  function forgetRefused(song: Song): boolean {
    if (lookedUp === null || lookedUp.id !== song.id || !lookedUp.remembered) return false
    addresses.forget(song.id)
    return true
  }

  /** The watch page opened for a song the audio road could not play (#502, owner's ruling 3): told, and its start marked so. */
  function fallBack(song: Song, current: () => boolean, background = false): void {
    fellBack = song.id
    waitFor('fallback', song, current, background)
  }

  /**
   * Open a song on the road it asks for, leaving `leaving`; the queue moves
   * on to it only when it landed. A failed lookup or landing on the audio
   * road opens the watch page instead (#502, owner's ruling 3) — for a
   * Command; in the `background`, with none waiting, only when the pane is
   * the Player's already: the song before it played on the watch page, and
   * the pane is still there (#538). Otherwise it may hold a page of the
   * person's own, so the song fails there and is passed over.
   */
  async function open(song: Song, current: () => boolean, leaving: Song | null, video = false, background = false): Promise<'opened' | 'failed' | 'superseded'> {
    const on = roadFor(video)
    fellBack = null
    // Read before the try: a stream that will not load has moved the road by then, not the pane.
    const fromPage = road === 'page'
    let first = await openOn(song, current, leaving, on, undefined, background)
    if (first === 'failed' && on === 'audio' && forgetRefused(song)) first = await openOn(song, current, leaving, on, undefined, background)
    if (first !== 'failed' || on !== 'audio') return first
    if (background && !(fromPage && leaving !== null && videoIdOf(browser.state().url ?? '') === leaving.id)) return first
    fallBack(song, current, background)
    return openOn(song, current, leaving, 'page', undefined, background)
  }

  /** Open a song on this road; `at` (s), on the watch page, where it starts. */
  async function openOn(song: Song, current: () => boolean, leaving: Song | null, on: Road, at?: number, background = false): Promise<'opened' | 'failed' | 'superseded'> {
    let landed: boolean | 'elsewhere' | 'superseded'
    try {
      await readLeaving(leaving)
      carrying = null
      if (on === 'audio') landed = await streamTo(song, current, background)
      else {
        if (road !== 'page') await leaveRoad('page')
        landed = await goTo(song, current, at)
      }
    } catch (error) {
      reportFault('music.player.open', error)
      return current() ? 'failed' : 'superseded'
    }
    // A song on the road with none heard before it is carried from YouTube's own default, as a watch page opens (#502).
    const from = heard ?? (road === 'audio' ? { volume: YOUTUBE_DEFAULT_LEVEL, loudnessDb: null } : null)
    if (landed === true && from !== null) carrying = { id: song.id, from }
    if (landed === true) await levelOpened()
    return landed === 'superseded' ? 'superseded' : landed === true ? 'opened' : 'failed'
  }

  /**
   * The element of a song just opened, read until it plays (#488): playing,
   * by kind, is not paused, not ended, holding data (`readyState` > 2), and
   * its time moved {@link PLAYED_S} — a moment of play that stops is no
   * start. Not playing by its bound, it is pressed once with the element's
   * own `play`, and read again to the same bound.
   */
  async function startOf(song: Song, current: () => boolean, background: boolean, reopened: boolean): Promise<PlayerStart | 'superseded'> {
    const from = now()
    let pressed = false
    // A bound passes on the clock, or on the reads' own waits where the clock does not move (a scripted page).
    let phase = { at: from, read: 0, ms: SELF_START_MS }
    const elapsed = (read: number): number => Math.max(now() - phase.at, (read - phase.read) * START_READ_MS)
    /** Where the element's time stood when this run of play began; null while it is not playing. */
    let since: number | null = null
    let last: StartRead | null = null
    /** The ad that held the start (#497): when it was first read, and how long it held it (ms) once the song's own read came. */
    let ad: { at: number; read: number; ms: number | null } | null = null
    const adMs = (read: number): number | null => (ad === null ? null : (ad.ms ?? Math.round(Math.max(now() - ad.at, (read - ad.read) * START_READ_MS))))
    for (let read = 0; ; read += 1) {
      if (!current()) return 'superseded'
      const before = last
      last = await evaluate<StartRead>(START_SCRIPT)
      // Custody withholds the page (#433): the start goes unread, and is taken as it was before #488 — playing.
      if (last === null && withheld !== null) return decided({ video: song.id, started: true, pressed, reopened, refused: null, element: null, ms: Math.round(now() - from), background, ad: adMs(read) })
      // A stream the element gave up on (#516), a 403 among them: no wait or press plays it without a new address.
      if (last !== null && last.failed && road === 'audio') return decided({ video: song.id, started: false, pressed, reopened, refused: last.refused, element: { paused: last.paused, ended: last.ended, ready: last.ready, time: last.time }, ms: Math.round(now() - from), background, ad: adMs(read) })
      // An ad in the element, by the engine's own fact (#497): its time is the ad's, never the song's start. While it plays the
      // bound holds — no press, no reopen — and Now Playing counts it off the element; the line waits through it, narrated.
      // A guess (#497 F2, the gate cannot force an ad): the line runs through the whole ad and says Playing once the song plays.
      // The kiosk's `media-start` records with `ad` settle it; saying "An ad first" at once instead is one line here.
      if (last !== null && last.ad) {
        // A pod of ads ("Sponsored 1 of 2") may drop the marker for a read between them: the hold runs on from the first.
        if (ad === null) ad = { at: now(), read, ms: null }
        else ad.ms = null
        showAd(song, last)
        if (!last.paused && (before === null || last.time > before.time)) phase = { ...phase, at: now(), read }
      } else if (ad !== null && ad.ms === null && last !== null) {
        ad.ms = adMs(read)
        showAd(song, null)
      }
      // Paused in its end's lead, a seek having taken it there during the start (#538): the end rule's pause, inside PLAYED_S. It played and
      // it ended: a press would only be paused again, and a reopen plays it from the top behind a new ad. The poll hears the end from here.
      if (last !== null && !last.ad && last.paused && last.duration !== null && atEnd({ elapsed: last.time, duration: last.duration })) {
        waitEnded(current)
        return decided({ video: song.id, started: true, pressed, reopened, refused: null, element: { paused: last.paused, ended: last.ended, ready: last.ready, time: last.time }, ms: Math.round(now() - from), background, ad: adMs(read) })
      }
      // Unpaused with its time standing still (a stalled decode) is not playing either; `readyState` 3 is HAVE_FUTURE_DATA, data to play on now.
      const playing = last !== null && !last.ad && !last.paused && !last.ended && last.ready > 2 && (before === null || last.time > before.time)
      since = playing ? (since ?? last!.time) : null
      // The song sounds (#507): the Wait Card closes now, not once the start is proved.
      if (playing) waitEnded(current)
      const started = playing && last!.time - since! >= PLAYED_S
      // Playing at the bound, it has a start's play longer to show it is one.
      const due = elapsed(read) >= phase.ms + (playing ? PLAYED_S * 1000 : 0)
      // A wall cleared while it ran: the song plays once the sheet leaves, so it has a self-start's bound again, unpressed (#492).
      if (due && !started && (await clearedSince(song, phase.at))) {
        phase = { at: now(), read, ms: SELF_START_MS }
        await sleep(START_READ_MS)
        if (!current()) return 'superseded'
        continue
      }
      if (started || (due && pressed)) {
        // A seek asked over the ad (#497) lands as the song starts, not a poll later.
        if (started && last !== null) await applyHeldSeek(song, { elapsed: last.time, duration: last.duration })
        const element = last === null ? null : { paused: last.paused, ended: last.ended, ready: last.ready, time: last.time }
        return decided({ video: song.id, started, pressed, reopened, refused: last?.refused ?? null, element, ms: Math.round(now() - from), background, ad: adMs(read) })
      }
      if (due) {
        // The Command may have ended during the read (#489): its pane was paused under it, and a press would start the song.
        if (!current()) return 'superseded'
        await control({ op: 'play' })
        pressed = true
        phase = { at: now(), read, ms: PRESSED_START_MS }
      }
      await sleep(START_READ_MS)
      if (!current()) return 'superseded'
    }
  }

  /**
   * Whether a consent wall was cleared over this song's page since `since`
   * (#492), a look or clear in flight waited out first: a song under a wall
   * plays once it leaves, and a press or a reopen meanwhile would only race
   * the clear.
   */
  async function clearedSince(song: Song, since: number): Promise<boolean> {
    const watch = watchOf(song.id)
    if (watch === null) return false
    if (watch.looking !== null) await watch.looking
    // Each clear buys one fresh bound: a clock that does not move must not buy it again.
    if (watch.at === null || watch.at < since || watch.honoured) return false
    watch.honoured = true
    return true
  }

  /** The consent watch on this video's page; null when the Player opened another since. */
  function watchOf(video: string): ConsentWatch | null {
    return consentWatch !== null && consentWatch.song.id === video ? consentWatch : null
  }

  /** A start, decided: its page's watch told a wall cleared from here on comes after it, and the start recorded. */
  function decided(start: Omit<PlayerStart, 'consent' | 'road' | 'lookup' | 'served' | 'fallback' | 'remembered' | 'asked'>): PlayerStart {
    const watch = watchOf(start.video)
    if (watch !== null) watch.started = true
    // Which road it took (#502), the lookup's time and its stream's wait to be served — on the audio road, or the fallback
    // it stood in for — and whether the watch page stood in for the road.
    const fallback = road === 'page' && fellBack === start.video
    const looked = lookedUp !== null && lookedUp.id === start.video && (road === 'audio' || fallback) ? lookedUp : null
    // An address is remembered once it has played: one that was refused must not come back to hide the next refusal (#516).
    if (looked !== null && !looked.remembered && road === 'audio' && start.started) addresses.keep(start.video, looked.stream)
    return record({ ...start, road, lookup: looked?.ms ?? null, served: looked?.served ?? null, fallback, remembered: looked?.remembered ?? false, asked: looked?.asked ?? null, consent: watch === null ? null : clearedMs(watch) })
  }

  /** A start, as the perf log hears it. */
  function record(start: PlayerStart): PlayerStart {
    deps.onStart?.(start)
    return start
  }

  /**
   * A song just opened, played (#488): read and pressed once; a page whose
   * element a press did not start — on a fresh profile it holds no data,
   * `readyState` 0, the page never feeding it — is opened again once in
   * full, which dismisses what walls it can, and read and pressed once more.
   * Each try is its own `media-start`.
   */
  async function playOn(song: Song, current: () => boolean, background: boolean): Promise<PlayerStart | 'superseded'> {
    const first = await startOf(song, current, background, false)
    if (first === 'superseded' || first.started) return first
    if (!current()) return 'superseded'
    // A remembered address that would not start gets one fresh lookup first (#516), read and pressed as any new stream is; this runs at most once, the fresh one not being remembered.
    if (road === 'audio' && forgetRefused(song)) {
      const again = await openOn(song, current, song, 'audio', undefined, background)
      if (again === 'superseded') return 'superseded'
      if (again === 'opened') return playOn(song, current, background)
    }
    // A stream that would not start is opened again as its watch page (#502, owner's ruling 3), read and pressed once
    // more — for a Command; in the background the pane is not the Player's to take, and the song is held unstarted.
    if (road === 'audio') {
      if (background) return first
      fallBack(song, current)
      const opened = await openOn(song, current, song, 'page')
      if (opened !== 'opened') return opened === 'superseded' ? 'superseded' : first
      return startOf(song, current, background, true)
    }
    try {
      await browser.navigate(watchUrl(song.id))
    } catch (error) {
      reportFault('music.player.reopen', error)
      return current() ? first : 'superseded'
    }
    watchConsent(song)
    const landed = await landedOn(song, current)
    if (landed === 'superseded') return landed
    if (landed !== true) return first
    await levelOpened()
    return startOf(song, current, background, true)
  }

  /** A song the Queue holds whose element never played (#488): held paused, so the card says so and `resume` presses it. */
  function holdUnstarted(): void {
    state = pause(state)
    publish()
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
        if (next === null && was !== null) {
          ended = was
          endedLeft = false
        }
        publish()
        if (next === null || !current()) return
        const opened = await open(next, current, was, next.video === true, true)
        if (opened === 'opened') {
          // A video queued by Jev's reading (#502) opens on the watch page, and is shown as a `play` of one is.
          if (roadOn() && next.video === true) for (const listener of shownListeners) listener()
          const start = await playOn(next, current, true)
          if (start !== 'superseded' && !start.started) holdUnstarted()
          return
        }
        // Overtaken, the song is no longer ours to drop or to say.
        if (opened !== 'failed' || !current()) return
        state = dropCurrent(state)
        publish()
        for (const listener of [...passedOverListeners]) listener(next)
      }
    })
    // The queued song sounds, or none will (#507): the Wait Card closes.
    background = background.finally(() => waitEnded(current))
  }

  /** A song that could not be opened: the Command fails, saying so, and the next queued song plays. */
  function failedToOpen(song: Song): PlayerOutcome {
    state = dropCurrent(state)
    if (state.upNext.length > 0) advanceInBackground()
    return { result: `not a watch page: ${watchUrl(song.id)}`, answer: cantBePlayedLine(song.title), failure: true, video: song.id }
  }

  /**
   * Play this song now — in place of the current one, unless `then` says
   * otherwise (`skip`, `previous`). The Queue moves to `then` once the page
   * opened or failed; one a later Command overtook leaves it as it was.
   */
  async function playSong(song: Song, current: () => boolean, answer: string, then: () => Queue = () => playNow(state, song), video = song.video === true): Promise<PlayerOutcome> {
    // Read once for the song: the road it was asked on is the one its Answer tells it fell back from.
    const taken = roadOn()
    let outcome: PlayerOutcome
    try {
      outcome = await playSongOn(song, current, answer, then, video)
    } finally {
      // The song sounds, or will not (#507): its wait is over, the Wait Card closes.
      waitEnded(current)
    }
    if (!taken || road !== 'page' || outcome.superseded === true || outcome.failure === true) return outcome
    // With the audio road taken, a song on the watch page is one to show (#502): a video, or the road's fallback — which its Answer says (ui.md 2).
    return { ...outcome, shown: true, ...(fellBack === song.id ? { answer: onItsWatchPage(outcome.answer) } : {}) }
  }

  async function playSongOn(song: Song, current: () => boolean, answer: string, then: () => Queue, video: boolean): Promise<PlayerOutcome> {
    const opened = await open(song, current, state.current, video)
    if (opened === 'superseded') return superseded
    state = then()
    if (opened === 'failed') return failedToOpen(song)
    const start = await playOn(song, current, false)
    if (start === 'superseded') return superseded
    if (!start.started) {
      holdUnstarted()
      const tried = [start.pressed ? ' pressed' : '', start.reopened ? ' reopened' : '', start.refused === null ? '' : ` refused=${start.refused}`].join('')
      return { result: `unstarted: id=${song.id} title=${JSON.stringify(song.title)}${tried}`, answer: `${quoted(song.title)} opened but didn't start.`, failure: true, unstarted: true, video: song.id }
    }
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
    const outcome = await playSong(next.song, current, answer, then, next.video)
    if (outcome.superseded === true) return outcome
    if (outcome.failure !== true && pick === opening) opening.staying = true
    return { ...outcome, pick: next.remembered ? 'remembered' : 'searched' }
  }

  /**
   * `play <words>`: the video remembered for the words (#345), else the
   * results page in the pane and its first plain video. A remembered video
   * that no longer opens is forgotten, so the next `play` searches.
   */
  async function searchNow(words: string, current: () => boolean, video: boolean): Promise<PlayerOutcome> {
    pick = null
    const known = deps.songs?.recall(words) ?? null
    if (known !== null) {
      const outcome = await openPick({ words, results: [], index: -1, song: known, remembered: true, video }, current, `Playing ${quoted(known.title)}.`)
      // A song that opened and did not start is still the song (#488): its words stay.
      if (outcome.failure === true && outcome.unstarted !== true) deps.songs?.forgetWords(words)
      return outcome
    }
    // The Receipt (#507 review): a song bound for the audio road waits from the Command firing, named by its words until the search picks it.
    if (roadOn() && !video) tellWait({ kind: 'lookup', song: { title: words }, since: wallNow() }, current, false)
    const songs = await readResults(words, current)
    if (!isSongs(songs)) {
      waitEnded(current)
      return songs
    }
    const song = songs[0]!
    return openPick({ words, results: songs, index: 0, song, remembered: false, video }, current, `Playing ${quoted(song.title)}.`)
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
  async function searchQueued(words: string, place: 'front' | 'end', current: () => boolean, video: boolean): Promise<PlayerOutcome> {
    const known = deps.songs?.recall(words) ?? null
    const found = known ?? (await fetchPick(words, current))
    if (!('id' in found)) return found
    const outcome = await queueSong(video ? { ...found, video: true } : found, place, current)
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

  /** The poll's read of the song playing, begun at `readAt`: its progress for the card, a new page's volume ducked, YouTube's own pause answered. */
  async function readWatch(status: WatchStatus, readAt: number): Promise<void> {
    const song = state.current
    // An ad in the song's element (#497), mid-song too: Now Playing says it until the song itself plays again.
    // Off the song's page, or its element gone, no ad is counted: a count that stands still would read as frozen (ui.md 2).
    if (song !== null) showAd(song, status.id === song.id && status.hasVideo && status.ad ? { time: status.elapsed, duration: status.duration, skippable: status.skippable } : null)
    // The element's time moving, an ad's too, is the song sounding; on another page, or standing still, its mark stands.
    if (song !== null && status.id === song.id && status.hasVideo && (sounded?.id !== song.id || sounded.time !== status.elapsed)) sounded = { id: song.id, at: wallNow(), time: status.elapsed }
    if (song === null || !showsSong(status, song)) return
    await applyHeldSeek(song, status)
    progress = { id: song.id, channel: status.channel, elapsed: status.elapsed, duration: status.duration }
    muted = status.muted
    const opening = carrying?.id === song.id
    // YouTube may put its own level back as the song starts (#460): carried again over that, never over a level set since.
    if (opening && opensAtYouTubesOwn(status)) await carry(status)
    else if (ducked === null) {
      // The pane's duck may hold the song while the Player holds none (#461): the level heard is its mark's, never the floor.
      const volume = status.restore ?? status.volume
      knownVolume = volume
      heard = { volume, loudnessDb: loudnessOn(status.loudnessDb) }
    } else if (!status.ducked || status.volume > floorOf(ducked.restore)) await duckElement()
    if (opening && status.elapsed >= CARRIED_S) carrying = null
    // A pause the Player did not make, with "Continue watching?" up: YouTube's, after hours of play. Yes — asked
    // again every tick it stays up, a page pause adopted meanwhile notwithstanding.
    const continued = status.paused && !ownPause && status.prompt && (await evaluate<boolean>(CONTINUE_SCRIPT)) === true
    const resumed = !continued && (await resumeSeeked(status, readAt))
    adoptElementFlags(continued || resumed ? { ...status, paused: false } : status)
  }

  /**
   * A seek that left the playing song paused (#505), played once, by kind:
   * the Seek Mark says the element was playing as it seeked and reads paused
   * now, within the settle. A pause the person asked for after the seek
   * holds (`pausedAt`, the read's start less the seek's age: a pause in
   * doubt is the person's), as does one the Player made; a song at its end
   * is the end rule's. Nothing is said: the seek's own sentence stays true.
   */
  async function resumeSeeked(status: WatchStatus, readAt: number): Promise<boolean> {
    const { seekAgeMs } = status
    if (seekAgeMs === null || !status.paused) return false
    const held = ownPause ? 'own' : readAt - seekAgeMs <= pausedAt ? 'person' : atEnd(status) ? 'end' : null
    const element = held === null ? await control({ op: 'play' }) : null
    const resumed = element !== null && element.found && !element.paused
    deps.onSeekResume?.({ video: status.id ?? '', seekAgeMs: Math.round(seekAgeMs), resumed, held })
    return resumed
  }

  /** The watch page shows this song's video, no ad in it: the read is of the song. */
  function showsSong(status: WatchStatus, song: Song): boolean {
    return status.id === song.id && status.hasVideo && !status.ad
  }

  /**
   * The element's own `paused` and `loop` are the Queue's (#473): a loop set
   * from YouTube's menu or a Media Op, a pause from the page's controls, show
   * on the card whoever made them. An element that has not played yet — its
   * length unknown, or nothing of it elapsed — is a page still landing (the
   * autoplay gate, buffering): its pause is not adopted, so the card says
   * Starting and not Paused.
   */
  function adoptElementFlags(status: WatchStatus): void {
    if (status.loop !== state.loop) state = setLoop(state, status.loop)
    if (!status.paused) ownPause = false
    const landing = status.duration === null || status.elapsed <= 0
    if (landing || status.paused === state.paused) return
    state = status.paused ? pause(state) : unpause(state)
  }

  /**
   * The song that ended, playing again from the page (#473): looped or
   * resumed there, the element plays on with no Player verb, so it goes back
   * to being the current song and the read continues. Looping, it never
   * reaches the end rule, so it simply plays on; unlooped and still in the
   * end's lead, the rule pauses it again at once, so it has not resumed.
   * Once the pane has left the song's page the poll stops reading it: the
   * watch script would otherwise mind videos the Player never started.
   */
  function resumeEnded(status: WatchStatus): boolean {
    const song = ended
    if (song === null) return false
    if (!status.watch || status.id !== song.id) {
      endedLeft = true
      return false
    }
    if (!showsSong(status, song) || status.paused) return false
    if (!status.loop && atEnd(status)) return false
    state = replay(state, song)
    return true
  }

  /**
   * `show` while the song plays on the audio road (#502): its watch page
   * opens where the stream stood, the stream stopped, and the song plays on
   * there — held paused if it was. The Command's own event wakes the
   * dashboard over it.
   */
  async function showFromAudio(song: Song, current: () => boolean): Promise<PlayerOutcome> {
    const at = (await evaluate<WatchStatus>(WATCH_SCRIPT))?.elapsed
    const wasPaused = state.current === null || state.paused
    const opened = await openOn(song, current, song, 'page', at)
    if (opened === 'superseded') return superseded
    if (opened === 'failed') return { result: `not a watch page: ${watchUrl(song.id)}`, answer: `${quoted(song.title)} can't be shown.`, failure: true, video: song.id }
    if (wasPaused) await control({ op: 'pause' })
    else if ((await playOn(song, current, false)) === 'superseded') return superseded
    return { result: `showing: id=${song.id}`, answer: `Showing ${quoted(song.title)}.`, video: song.id }
  }

  async function performNow(music: MusicAction, words: string | null, current: () => boolean): Promise<PlayerOutcome> {
    switch (music.kind) {
      case 'search':
        return music.place === 'now' ? searchNow(words ?? '', current, music.video === true) : searchQueued(words ?? '', music.place, current, music.video === true)
      case 'correct':
        return correct(music.step, current)
      case 'forget':
        return forget()
      case 'skip': {
        // Over an ad (#497): "skip the ad", or a bare `skip` while the engine's own Skip button is up, skips the ad, the Queue left as it is.
        const over = music.ad === true || adOver?.ad.skippable === true ? await adOverNow() : null
        if (over !== null && over.ad.skippable) {
          const element = await control({ op: 'skip-ad' })
          if (element !== null && element.changed) return { result: 'skip-ad: skipped', answer: 'Skipped the ad.', video: over.song.id }
        }
        if (music.ad === true) {
          if (over === null) return { result: 'skip-ad: no ad', answer: 'No ad is playing.', failure: true }
          return { result: 'skip-ad: not skippable', answer: `${adWait(over.ad)}: it can't be skipped yet.`, failure: true, video: over.song.id }
        }
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
        pausedByPerson()
        return onElement({ op: 'pause' }, () => STOPPED_ANSWERS.paused, (queue) => {
          ownPause = true
          return pause(queue)
        })
      case 'unpause': {
        const again = state.current === null ? ended : null
        if (again !== null) return onElement({ op: 'restart' }, () => `Playing ${quoted(again.title)}.`, (queue) => replay(queue, again))
        return onElement({ op: 'play' }, (element) => (element.title === '' ? 'Playing.' : `Playing ${quoted(element.title)}.`), unpause)
      }
      case 'loop': {
        // A `repeat` at the song's end plays it again from the start, as `play` does (turn-mvqga9a7-v1g): no loop is set.
        const again = music.on && music.again === true && state.current === null ? ended : null
        if (again !== null) return onElement({ op: 'restart' }, () => `Playing ${quoted(again.title)} again.`, (queue) => replay(queue, again))
        return onElement(
          { op: 'loop', on: music.on },
          (element) => (music.on ? `Looping ${quoted(element.title)}.` : 'Loop off.'),
          (queue) => setLoop(queue, music.on),
        )
      }
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
        if (shown !== null && road === 'audio') return showFromAudio(shown, current)
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
      pausedByPerson()
      // Every frame's media pauses beside the top's (#377), the frames' answers taken within the collect's grace.
      // The stream on the audio road pauses beside the pane's media (#502): its element is the song's own.
      const streamPaused = road === 'audio' ? evaluate<PausedAll>(PAUSE_ALL_SCRIPT) : Promise.resolve(null)
      const [panePaused, framed, streamed] = await Promise.all([evaluate<PausedAll>(PAUSE_ALL_SCRIPT, 'pane'), pauseFrames(), streamPaused])
      if ((panePaused?.paused ?? 0) + framed + (streamed?.paused ?? 0) === 0) return false
      if ((road === 'audio' ? streamed : panePaused)?.youtube === true) {
        ownPause = true
        state = pause(state)
        publish()
      }
      return true
    },

    async check() {
      if (checking || (state.current === null && (ended === null || endedLeft))) return
      checking = true
      try {
        const readAt = now()
        const status = await evaluate<WatchStatus>(WATCH_SCRIPT)
        if (status === null) return
        if (state.current === null && !resumeEnded(status)) return
        hearStay(status)
        const end = status.ended
        // An ad plays in the same element: its end is not the song's.
        if (end === null || end.ad || end.id !== state.current?.id) {
          await readWatch(status, readAt)
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
    picked() {
      if (pick === null) return null
      const { song } = pick
      const playing = state.current?.id === song.id
      // Not the Queue's song: held only while it never played, so a pick that played and gave way is no correction's.
      if (!playing && (state.current !== null || ended?.id === song.id || state.played.some((each) => each.id === song.id))) return null
      return { title: song.title, words: pick.words, playing }
    },
    nowPlaying,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onShown(listener) {
      shownListeners.add(listener)
      return () => shownListeners.delete(listener)
    },
    onPassedOver(listener) {
      passedOverListeners.add(listener)
      return () => passedOverListeners.delete(listener)
    },
    duck(on) {
      ducking = ducking.then(() => setDuck(on)).catch((error: unknown) => reportFault('music.player.duck', error))
      return ducking
    },
    async seekOverAd(action) {
      if (!isSeek(action.op)) return null
      const over = await adOverNow()
      if (over === null) return null
      // The latest seek asked over the ad is the one put on the song: one op, as asked last.
      heldSeek = { id: over.song.id, action }
      const seek = describeMediaOp(action)
      return { result: `${action.op} held over an ad: ${seek} once the song plays`, answer: `${adWait(over.ad)}: the song will ${seek} once it plays.`, video: over.song.id }
    },
    road: () => road,
    streamRefused() {
      if (onSurface === null) return false
      addresses.forget(onSurface.id)
      return onSurface.remembered
    },
    get audioRoad() {
      return roadOn()
    },
    onWait(listener) {
      waitListeners.add(listener)
      return () => waitListeners.delete(listener)
    },
    onSongWait(listener) {
      cardListeners.add(listener)
      return () => cardListeners.delete(listener)
    },
  }
  return player
}
