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
}

/**
 * Reads the watch page, and hears its video's end: a listener on the
 * window, in the capture phase, notes each `ended` and whether
 * `#movie_player` carried `ad-showing` then — an ad plays in the same
 * element. A song's end (not an ad's) is held from YouTube's own handlers,
 * so its Autoplay never wanders on: the Player opens the next queued song,
 * or leaves the page paused at the end (owner's ruling 4). Installed once
 * per document; each read takes the end it heard.
 */
export const WATCH_SCRIPT = `(() => {
  /* YT_WATCH */
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  const videoId = () => new URLSearchParams(location.search).get('v')
  if (!window.__bingbongPlayer) {
    window.__bingbongPlayer = { ended: null }
    window.addEventListener('ended', (event) => {
      const target = event.target
      if (!(target instanceof HTMLMediaElement)) return
      const owner = target.closest('#movie_player')
      if (!owner) return
      const ad = owner.classList.contains('ad-showing')
      window.__bingbongPlayer.ended = { id: videoId(), ad }
      if (!ad) event.stopImmediatePropagation()
    }, true)
  }
  const ended = window.__bingbongPlayer.ended
  window.__bingbongPlayer.ended = null
  const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null
  const errorNode = player ? player.querySelector('.ytp-error') : null
  return {
    watch: location.pathname === '/watch',
    id: videoId(),
    title: (data && data.title) || document.title.replace(/ - YouTube$/, ''),
    hasVideo: video !== null,
    error: errorNode !== null && errorNode.getClientRects().length > 0,
    ad: player ? player.classList.contains('ad-showing') : false,
    ended,
  }
})()`

/** What a control does to the element. */
export type ElementOp =
  | { readonly op: 'play' }
  | { readonly op: 'pause' }
  /** Pause only a video that is playing: `stop` with nothing in flight (owner's ruling 2). */
  | { readonly op: 'pauseIfPlaying' }
  | { readonly op: 'loop'; readonly on: boolean }
  | { readonly op: 'restart' }
  /** Volume to this, 0–100. */
  | { readonly op: 'volume'; readonly to: number }
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
 * One control on `#movie_player video` (falling back to the page's one
 * video). Volume and mute are set on the element and told to the player
 * too, so YouTube's own slider and its remembered volume agree.
 */
export function controlScript(op: ElementOp): string {
  return `((op) => {
  /* YT_CONTROL */
  const player = document.querySelector('#movie_player')
  const video = (player && player.querySelector('video')) || document.querySelector('video')
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
    case 'volume': setVolume(op.to); break
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
