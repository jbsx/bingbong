// The scripts the Player (#343) evaluates in the pane: each one CDP
// evaluate, tagged so a scripted page in the tests can tell them apart.
// They drive the watch page's `#movie_player video` directly — never
// YouTube's chrome, its queue, its Autoplay toggle or its Loop menu.

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
  /** The element's playing time and length (s); the length null while unknown. */
  readonly elapsed: number
  readonly duration: number | null
  readonly paused: boolean
  readonly loop: boolean
  /** 0–100. */
  readonly volume: number
  /** YouTube's own idle prompt, "Video paused. Continue watching?", is up (#344). */
  readonly prompt: boolean
}

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
    prompt: continuePrompt() !== null,
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

/** What a control does to the element. */
export type ElementOp =
  | { readonly op: 'play' }
  | { readonly op: 'pause' }
  /** Pause only a video that is playing: `stop` with nothing in flight (owner's ruling 2). */
  | { readonly op: 'pauseIfPlaying' }
  | { readonly op: 'loop'; readonly on: boolean }
  | { readonly op: 'restart' }
  /** Volume to this, 0–100 — the element heard at `heard` instead while ducked (#344). */
  | { readonly op: 'volume'; readonly to: number; readonly heard?: number }
  /** The element's volume alone, 0–100, YouTube's remembered volume left as it is: the duck and its restore (#344). */
  | { readonly op: 'level'; readonly to: number }
  /** Volume by this much, -100–100. */
  | { readonly op: 'nudge'; readonly by: number }
  | { readonly op: 'mute'; readonly on: boolean }

/** The element after a control, or `found` false when the page has no player video. */
export interface ElementState {
  readonly found: boolean
  /** The control changed something (`pauseIfPlaying` on a paused video changes nothing). */
  readonly changed: boolean
  readonly title: string
  readonly paused: boolean
  readonly loop: boolean
  /** 0–100. */
  readonly volume: number
  readonly muted: boolean
}

/**
 * One control on `#movie_player video` — YouTube's player alone: a `stop`
 * or a `pause` never reaches another site's video. Volume and mute are set on the element and told to the player
 * too, so YouTube's own slider and its remembered volume agree.
 */
export function controlScript(op: ElementOp): string {
  return `((op) => {
  /* YT_CONTROL */
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  if (!video) return { found: false, changed: false, title: '', paused: true, loop: false, volume: 0, muted: false }
  let changed = true
  const setVolume = (to) => {
    const level = Math.max(0, Math.min(100, Math.round(to)))
    video.volume = level / 100
    if (player && typeof player.setVolume === 'function') player.setVolume(level)
  }
  switch (op.op) {
    case 'play': video.play().catch(() => {}); break
    case 'pause': video.pause(); break
    case 'pauseIfPlaying': changed = !video.paused; if (changed) video.pause(); break
    case 'loop': video.loop = op.on; break
    case 'restart': video.currentTime = 0; video.play().catch(() => {}); break
    case 'volume':
      setVolume(op.to)
      if (op.heard !== undefined) video.volume = op.heard / 100
      break
    case 'level': video.volume = Math.max(0, Math.min(100, op.to)) / 100; break
    case 'nudge': setVolume(video.volume * 100 + op.by); break
    case 'mute':
      video.muted = op.on
      if (player && typeof player.mute === 'function' && typeof player.unMute === 'function') op.on ? player.mute() : player.unMute()
      break
  }
  const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null
  return {
    found: true,
    changed,
    title: (data && data.title) || document.title.replace(/ - YouTube$/, ''),
    paused: op.op === 'play' || op.op === 'restart' ? false : video.paused,
    loop: video.loop,
    volume: Math.round(video.volume * 100),
    muted: video.muted,
  }
})(${JSON.stringify(op)})`
}
