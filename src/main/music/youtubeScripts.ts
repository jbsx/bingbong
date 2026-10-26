// The scripts the Player (#343) evaluates in the pane: each one CDP
// evaluate, tagged so a scripted page in the tests can tell them apart.
// They drive the watch page's `#movie_player video` directly — never
// YouTube's chrome, its queue, its Autoplay toggle or its Loop menu. A
// control Jev chose for a song on the page reaches the page's own media
// where YouTube's player is absent (#362, ADR 0079) — the element the ask
// showed, picked as the collect picks it. A `skip`'s own pause reaches
// YouTube's player alone (ADR 0076). A `stop` with nothing in flight pauses
// every playing media element on the page, YouTube's player among them, by
// kind and in the top frame only (#376).

import { DUCK_FLOOR_FN, DUCK_MARK, HEARD_VOLUME_FN, PAGE_MEDIA_JS, PAUSE_PLAYING_JS, SET_HEARD_VOLUME_FN } from '../browser/pageMediaScript'

/** What the results script yields: the page's `ytInitialData` as JSON, or null when it carries none. */
export const RESULTS_SCRIPT = `(() => {
  /* YT_RESULTS */
  const data = window.ytInitialData
  return data === undefined || data === null ? null : JSON.stringify({ contents: data.contents })
})()`

/** The watch page as the watch script reads it. */
export interface WatchStatus {
  /** The address is a watch page. */
  readonly watch: boolean
  /** The video its address names. */
  readonly id: string | null
  readonly title: string
  /** `#movie_player` holds its video element. */
  readonly hasVideo: boolean
  /** The player shows its error (unavailable, removed, sign-in to watch). */
  readonly error: boolean
  /** An ad plays in the element now. */
  readonly ad: boolean
  /** An end heard since the last read: whose, and whether it was an ad's. */
  readonly ended: { readonly id: string | null; readonly ad: boolean } | null
  /** The channel, as the player names it; '' when it does not (#344). */
  readonly channel: string
  /** The element's playing time and length (s); the length null while unknown. The time is how long a pick has stayed (#345). */
  readonly elapsed: number
  readonly duration: number | null
  readonly paused: boolean
  readonly loop: boolean
  /** 0–100, the element's own: the floor while ducked. */
  readonly volume: number
  readonly muted: boolean
  /** The element carries a duck's mark (#459); a fresh element after a landing does not. */
  readonly ducked: boolean
  /** The level, 0–100, the mark puts back, unrounded; null with no mark — the Player's, or the pane's (#461). */
  readonly restore: number | null
  /** YouTube's own idle prompt, "Video paused. Continue watching?", is up (#344). */
  readonly prompt: boolean
  /** The track's `loudnessDb` from the player's response; null when it carries none (#460). */
  readonly loudnessDb: number | null
  /** YouTube's remembered level, 0–100, as its player gives it; null when it gives none (#460). */
  readonly playerVolume: number | null
}

/** Reads the player response's `loudnessDb` and the player's remembered level: `loudnessOf(player)`, `playerVolumeOf(player)`, null when there is none. */
const LOUDNESS_READER = `const loudnessOf = (player) => {
    const response = player && typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null
    const db = response && response.playerConfig && response.playerConfig.audioConfig ? response.playerConfig.audioConfig.loudnessDb : null
    return typeof db === 'number' && isFinite(db) ? db : null
  }
  const playerVolumeOf = (player) => {
    const level = player && typeof player.getVolume === 'function' ? player.getVolume() : null
    return typeof level === 'number' && isFinite(level) ? level : null
  }`

/** The watch page's element level as the Player carries it into the next song (#460): unrounded, beside the track's loudness and YouTube's own level. */
export type LevelRead = Pick<WatchStatus, 'id' | 'ad' | 'volume' | 'loudnessDb' | 'playerVolume'> & {
  /** The level, 0–100, a duck's mark on the element puts back (#459); null with no mark. */
  readonly restore: number | null
}

/**
 * Reads `#movie_player video`'s level, unrounded, with its track's
 * loudness; null off a watch page's player. Apart from the watch script,
 * which takes the end it heard: a page left on a `skip` keeps its own.
 */
export const LEVEL_SCRIPT = `(() => {
  /* YT_LEVEL */
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  if (!video) return null
  ${LOUDNESS_READER}
  const mark = video.${DUCK_MARK}
  return { id: new URLSearchParams(location.search).get('v'), ad: player.classList.contains('ad-showing'), volume: video.volume * 100, loudnessDb: loudnessOf(player), playerVolume: playerVolumeOf(player), restore: mark ? mark.restore * 100 : null }
})()`

/** Finds YouTube's "Continue watching?" dialog on the screen: `continuePrompt()`, null when it is not up. */
const PROMPT_FINDER = `const continuePrompt = () => Array.from(document.querySelectorAll('yt-confirm-dialog-renderer')).find((dialog) => dialog.getClientRects().length > 0 && /continue watching/i.test(dialog.textContent || '')) || null`

/** How long before a song's end it is paused (s): `timeupdate` comes about every quarter second. */
const END_LEAD_S = 1

/**
 * Reads the watch page, and hears its video's end. Listeners on the
 * window, in the capture phase, note each end and whether `#movie_player`
 * carried `ad-showing` then — an ad plays in the same element, and its end
 * is not the song's. A song that is not looping is paused in its last half
 * second: at its real end YouTube loads an ad into the element and then
 * Autoplays another video (seen live, 2026-10-19), and holding the `ended`
 * event alone does not stop it. The Player opens the next queued song, or
 * leaves the page paused there (owner's ruling 4). Installed once per
 * document; each song's end is noted once, and each read takes it.
 */
export const WATCH_SCRIPT = `(() => {
  /* YT_WATCH */
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  const videoId = () => new URLSearchParams(location.search).get('v')
  if (!window.__bingbongPlayer) {
    const state = { ended: null, endedId: null }
    window.__bingbongPlayer = state
    const hear = (event, nearEnd) => {
      const target = event.target
      if (!(target instanceof HTMLMediaElement)) return
      const owner = target.closest('#movie_player')
      if (!owner) return
      const ad = owner.classList.contains('ad-showing')
      if (nearEnd) {
        // The song's last half second, unlooped: paused here, before YouTube's own end — it would load an ad and Autoplay another video.
        if (ad || target.loop || !isFinite(target.duration) || target.currentTime < target.duration - ${END_LEAD_S}) return
        // Through the player's own pause as well: its state, not the element's, is what moves on at the end.
        if (typeof owner.pauseVideo === 'function') owner.pauseVideo()
        target.pause()
      }
      const id = videoId()
      if (!ad && state.endedId === id) return
      state.ended = { id, ad }
      if (!ad) state.endedId = id
      if (!ad && !nearEnd) event.stopImmediatePropagation()
    }
    window.addEventListener('timeupdate', (event) => hear(event, true), true)
    window.addEventListener('ended', (event) => hear(event, false), true)
    // A song opened again (restart, previous) can end again.
    window.addEventListener('seeked', (event) => {
      if (event.target instanceof HTMLMediaElement && event.target.currentTime < event.target.duration - ${END_LEAD_S}) state.endedId = null
    }, true)
  }
  const ended = window.__bingbongPlayer.ended
  window.__bingbongPlayer.ended = null
  const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null
  const errorNode = player ? player.querySelector('.ytp-error') : null
  ${PROMPT_FINDER}
  ${LOUDNESS_READER}
  return {
    watch: location.pathname === '/watch',
    id: videoId(),
    title: (data && data.title) || document.title.replace(/ - YouTube$/, ''),
    hasVideo: video !== null,
    error: errorNode !== null && errorNode.getClientRects().length > 0,
    ad: player ? player.classList.contains('ad-showing') : false,
    ended,
    channel: (data && data.author) || '',
    elapsed: video ? video.currentTime : 0,
    duration: video && isFinite(video.duration) ? video.duration : null,
    paused: video ? video.paused : true,
    loop: video ? video.loop : false,
    volume: video ? Math.round(video.volume * 100) : 0,
    muted: video ? video.muted : false,
    ducked: video ? Boolean(video.${DUCK_MARK}) : false,
    restore: video && video.${DUCK_MARK} ? video.${DUCK_MARK}.restore * 100 : null,
    prompt: continuePrompt() !== null,
    loudnessDb: loudnessOf(player),
    playerVolume: playerVolumeOf(player),
  }
})()`

/**
 * Answers YouTube's own idle prompt (#344): after hours of play it pauses
 * the video with "Video paused. Continue watching?" — its Yes is clicked,
 * and the video played in case the click alone does not. Whether the
 * prompt was there to answer.
 */
export const CONTINUE_SCRIPT = `(() => {
  /* YT_CONTINUE */
  ${PROMPT_FINDER}
  const prompt = continuePrompt()
  if (prompt === null) return false
  const yes = prompt.querySelector('#confirm-button button, #confirm-button')
  if (yes) yes.click()
  const video = document.querySelector('#movie_player video')
  if (video && video.paused) video.play().catch(() => {})
  return true
})()`

/** A duck the Player holds (#459): the volume it puts back, 0–100, and the floor's share of it. */
export interface DuckHeld {
  readonly restore: number
  readonly share: number
}

/** What a control does to the element. */
export type ElementOp =
  | { readonly op: 'play' }
  | { readonly op: 'pause' }
  | { readonly op: 'loop'; readonly on: boolean }
  | { readonly op: 'restart' }
  /** Volume to this, 0–100 — under a duck, the volume put back (#459); `duck` marks an element no duck has marked yet first. */
  | { readonly op: 'volume'; readonly to: number; readonly duck?: DuckHeld }
  /**
   * The duck (#344, #459): the element marked with the volume it puts back
   * — its own mark's if it has one, else `restore` (0–100) — and dropped to
   * `share` of it. YouTube's remembered volume is left as it is.
   */
  | { readonly op: 'duck'; readonly restore: number; readonly share: number }
  /**
   * The element's volume alone, 0–100, YouTube's remembered volume left as
   * it is: the level carried into a new song (#460). Under a duck the mark
   * takes it (#459), `duck` marking an element no duck has marked yet.
   */
  | { readonly op: 'level'; readonly to: number; readonly duck?: DuckHeld }
  /** The duck let go: the mark's volume put back on the element, else `to` (0–100) on an element no duck marked. */
  | { readonly op: 'unduck'; readonly to: number }
  /** Volume by this much, -100–100, from the volume heard (#459); `duck` as for `volume`. */
  | { readonly op: 'nudge'; readonly by: number; readonly duck?: DuckHeld }
  | { readonly op: 'mute'; readonly on: boolean }
  /** The element as it is, nothing changed (#362): what `show` names when the Player holds no song. */
  | { readonly op: 'read' }

/** The element after a control, or `found` false when the page has no player video. */
export interface ElementState {
  readonly found: boolean
  /** The control changed something (a `read` changes nothing). */
  readonly changed: boolean
  readonly title: string
  readonly paused: boolean
  readonly loop: boolean
  /** 0–100, as heard once no duck holds it (#459): under a duck, the volume put back. */
  readonly volume: number
  readonly muted: boolean
  /** A duck's mark is on the element (#459). */
  readonly ducked: boolean
}

/** How far a control reaches: YouTube's player alone, or the page's own media too (#362). */
export type ControlReach = 'youtube' | 'page'

/**
 * One control on `#movie_player video` — YouTube's player first, else with
 * `reach` 'page' the page's own media element as the collect picks it
 * (#362): the one playing, else the first that started; the element the
 * ask showed Jev, never another. 'youtube' is for what the user did not
 * ask of the page — a `skip`'s pause (ADR 0076). Volume and mute are set
 * on the element and told to YouTube's player too, so its own slider and
 * its remembered volume agree.
 */
export function controlScript(op: ElementOp, reach: ControlReach = 'page'): string {
  return `((op) => {
  /* YT_CONTROL */
  const player = document.querySelector('#movie_player')
  const video = (player ? player.querySelector('video') : null) || ${reach === 'page' ? PAGE_MEDIA_JS : 'null'}
  if (!video) return { found: false, changed: false, title: '', paused: true, loop: false, volume: 0, muted: false, ducked: false }
  let changed = op.op !== 'read'
  const heard = ${HEARD_VOLUME_FN}
  const setHeard = ${SET_HEARD_VOLUME_FN}
  // YouTube's player is told first, as it sets the element itself; then the element, at its floor under a duck (#459).
  const setVolume = (to) => {
    const level = Math.max(0, Math.min(100, Math.round(to)))
    if (player && typeof player.setVolume === 'function') player.setVolume(level)
    setHeard(video, level / 100)
  }
  // A volume under a duck the poll has not marked on this element yet: marked first, so the level set is the one put back.
  if (op.duck && !video.${DUCK_MARK}) video.${DUCK_MARK} = { restore: Math.max(0, Math.min(100, op.duck.restore)) / 100, share: op.duck.share }
  switch (op.op) {
    case 'play': video.play().catch(() => {}); break
    case 'pause': video.pause(); break
    case 'loop': video.loop = op.on; break
    case 'restart': video.currentTime = 0; video.play().catch(() => {}); break
    case 'volume': setVolume(op.to); break
    case 'level': setHeard(video, Math.max(0, Math.min(100, op.to)) / 100); break
    case 'duck': {
      const mark = video.${DUCK_MARK} || (video.${DUCK_MARK} = { restore: Math.max(0, Math.min(100, op.restore)) / 100, share: op.share })
      video.volume = ${DUCK_FLOOR_FN}(mark)
      break
    }
    case 'unduck': {
      const mark = video.${DUCK_MARK}
      delete video.${DUCK_MARK}
      video.volume = mark ? mark.restore : Math.max(0, Math.min(100, op.to)) / 100
      break
    }
    case 'nudge': setVolume(heard(video) * 100 + op.by); break
    case 'mute':
      video.muted = op.on
      if (player && typeof player.mute === 'function' && typeof player.unMute === 'function') op.on ? player.mute() : player.unMute()
      break
  }
  const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null
  return {
    found: true,
    changed,
    title: ((data && data.title) || video.getAttribute('title') || video.getAttribute('aria-label') || document.title.replace(/ - YouTube$/, '')).trim(),
    paused: op.op === 'play' || op.op === 'restart' ? false : video.paused,
    loop: video.loop,
    volume: Math.round(heard(video) * 100),
    muted: video.muted,
    ducked: Boolean(video.${DUCK_MARK}),
  }
})(${JSON.stringify(op)})`
}

/** What the pause-all script did: how many elements it paused, and whether YouTube's player was one of them. */
export interface PausedAll {
  readonly paused: number
  readonly youtube: boolean
}

/**
 * A `stop` with nothing in flight (#376, ADR 0076): every `video` and
 * `audio` in the page's top frame that plays is paused — YouTube's player
 * among them, a muted hero loop beside the real clip too, since `stop`
 * means silence — and whether YouTube's player was one, so the Queue
 * holds its song paused. The page's frames are paused beside it, each in
 * its own context (FRAME_PAUSE_ALL_JS, #377).
 */
export const PAUSE_ALL_SCRIPT = `(() => {
  /* PAGE_PAUSE_ALL */
  const player = document.querySelector('#movie_player')
  const own = player ? player.querySelector('video') : null
  const paused = ${PAUSE_PLAYING_JS}
  return { paused: paused.length, youtube: own !== null && paused.includes(own) }
})()`
