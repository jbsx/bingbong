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
      const types = window.__bingbongMediaTypes
      const codec = (types && types.codecOf(el)) || 'unknown'
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
        codec,
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

/**
 * The media-types watch (#425, 2026-10-26): what codec a piece of media
 * plays is named nowhere on the element (its tracks, its playback quality
 * and its decoded-frame counts do not say), but a page that streams asks
 * Media Source for it by name: `addSourceBuffer('video/webm;
 * codecs="vp09.00.51.08"')`, and `changeType` when it switches. Run in the
 * page's main world before its first script (the browse partition's frame
 * preload hands it over with the codec refusal), it keeps each Media
 * Source's buffers' types and which element plays the Source, so the
 * playback script can answer `codecOf(el)`: the codecs joined by ' / ', or
 * the `<source>` type's own codecs for plain media; null when neither names
 * one. By kind: every page, every site; no player is named.
 */
export const MEDIA_TYPES_SCRIPT = String.raw`(() => {
  if (window.__bingbongMediaTypes !== undefined) return
  const codecsOf = (type) => {
    const match = typeof type === 'string' ? /codecs\s*=\s*"?([^";]*)"?/i.exec(type) : null
    return match ? match[1].split(',').map((codec) => codec.trim()).filter((codec) => codec !== '') : []
  }
  const buffers = new WeakMap()
  const sourceOfUrl = new Map()
  const MS = window.MediaSource
  if (MS && MS.prototype && typeof MS.prototype.addSourceBuffer === 'function') {
    const addSourceBuffer = MS.prototype.addSourceBuffer
    MS.prototype.addSourceBuffer = function (type) {
      const buffer = addSourceBuffer.call(this, type)
      let list = buffers.get(this)
      if (list === undefined) buffers.set(this, (list = []))
      list.push({ buffer, type })
      return buffer
    }
    const SB = window.SourceBuffer
    if (SB && SB.prototype && typeof SB.prototype.changeType === 'function') {
      const changeType = SB.prototype.changeType
      SB.prototype.changeType = function (type) {
        const result = changeType.call(this, type)
        for (const source of sourceOfUrl.values()) {
          for (const entry of buffers.get(source) || []) if (entry.buffer === this) entry.type = type
        }
        return result
      }
    }
    const createObjectURL = URL.createObjectURL
    URL.createObjectURL = function (object) {
      const url = createObjectURL.call(URL, object)
      if (object instanceof MS) sourceOfUrl.set(url, object)
      return url
    }
  }
  const codecOf = (el) => {
    const source = MS && el.srcObject instanceof MS ? el.srcObject : sourceOfUrl.get(el.currentSrc || el.src)
    if (source !== undefined) {
      const codecs = (buffers.get(source) || []).flatMap((entry) => codecsOf(entry.type))
      if (codecs.length > 0) return codecs.join(' / ')
    }
    for (const child of el.querySelectorAll('source')) {
      if (child.src !== el.currentSrc) continue
      const codecs = codecsOf(child.type)
      if (codecs.length > 0) return codecs.join(' / ')
    }
    return null
  }
  Object.defineProperty(window, '__bingbongMediaTypes', { value: { codecOf }, configurable: false, enumerable: false, writable: false })
})()`
