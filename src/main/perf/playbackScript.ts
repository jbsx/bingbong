// The playback script (kiosk telemetry 2026-10-25): installed once per
// document, it hears every audio and video element's own media events in the
// capture phase — they do not bubble — and keeps each one's start, stalls and
// played time; every evaluate after answers what is on the page now and what
// the page closed since the last. By kind, on any page: no site's player is
// named. Media never asked to play is never reported.

/** The script's answer: a PlaybackPoll (src/core/perf/playbackTracker.ts). */
export const PLAYBACK_SCRIPT = String.raw`(() => {
  const now = () => performance.now()
  let s = window.__bingbongPlayback
  if (s === undefined) {
    s = window.__bingbongPlayback = { items: new Map(), closed: [], seq: 0 }
    const fresh = (el, joined) => {
      s.seq += 1
      const playing = joined && !el.paused && el.readyState > 2
      return { key: performance.timeOrigin + '-' + s.seq, loadAt: joined ? null : now(), firstAt: playing ? now() : null, joined: playing, tried: playing, playingSince: playing ? now() : null, waitingSince: null, playedMs: 0, stalls: 0, stallMs: 0 }
    }
    const rec = (el) => {
      let r = s.items.get(el)
      if (r === undefined) s.items.set(el, (r = fresh(el, false)))
      return r
    }
    const settle = (r, t) => {
      if (r.playingSince !== null) r.playedMs += t - r.playingSince
      r.playingSince = null
      if (r.waitingSince !== null) r.stallMs += t - r.waitingSince
      r.waitingSince = null
    }
    s.view = (el, r, closed) => {
      const t = now()
      const played = r.playedMs + (r.playingSince !== null ? t - r.playingSince : 0)
      const stalled = r.stallMs + (r.waitingSince !== null ? t - r.waitingSince : 0)
      const video = el instanceof HTMLVideoElement
      const quality = video && el.getVideoPlaybackQuality ? el.getVideoPlaybackQuality() : null
      return {
        key: r.key,
        page: location.origin + location.pathname,
        kind: video ? 'video' : 'audio',
        startMs: r.firstAt !== null && r.loadAt !== null ? Math.round(r.firstAt - r.loadAt) : null,
        ...(r.joined ? { joined: true } : {}),
        playedMs: Math.round(played),
        stalls: r.stalls,
        stallMs: Math.round(stalled),
        droppedFrames: quality ? quality.droppedVideoFrames : null,
        totalFrames: quality ? quality.totalVideoFrames : null,
        height: video ? el.videoHeight : null,
        ...(closed ? { closed } : {}),
      }
    }
    const on = (type, fn) => document.addEventListener(type, (event) => {
      if (event.target instanceof HTMLMediaElement) fn(event.target, now())
    }, true)
    on('loadstart', (el) => {
      const old = s.items.get(el)
      if (old !== undefined && old.tried) s.closed.push(s.view(el, old, 'changed'))
      s.items.set(el, fresh(el, false))
    })
    on('play', (el) => { rec(el).tried = true })
    on('playing', (el, t) => {
      const r = rec(el)
      r.tried = true
      if (r.firstAt === null) r.firstAt = t
      settle(r, t)
      r.playingSince = t
    })
    on('waiting', (el, t) => {
      const r = rec(el)
      if (r.firstAt === null || r.waitingSince !== null) return
      settle(r, t)
      r.stalls += 1
      r.waitingSince = t
    })
    on('pause', (el, t) => settle(rec(el), t))
    on('ended', (el, t) => {
      const r = rec(el)
      settle(r, t)
      if (r.tried) s.closed.push(s.view(el, r, 'ended'))
      s.items.delete(el)
    })
    // Media already on the page when the script came: playing is joined, its start unseen.
    for (const el of document.querySelectorAll('video, audio')) s.items.set(el, fresh(el, true))
  }
  const items = []
  for (const [el, r] of s.items) {
    if (!el.isConnected) {
      if (r.tried) s.closed.push(s.view(el, r, 'changed'))
      s.items.delete(el)
    } else if (r.tried) items.push(s.view(el, r))
  }
  const closed = s.closed
  s.closed = []
  return { items, closed }
})()`
