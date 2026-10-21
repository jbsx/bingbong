// Page-side: the page's media element, one pick shared by the collect
// (#363, the ask's `Playing:` line) and the Player's controls (#362, ADR
// 0079) — the element playing, else the first that started, null for none.
// One rule for both, so a music line acts on the element Jev was shown and
// never on one it was not. A never-started element is no media here.

/**
 * A JS function source `(el) => facts` reading a media element's own facts
 * (#372, ADR 0080) — the `MediaFacts` shape the collect carries on each
 * media ref and a Media Op reads before and after it acts, so the ref
 * line and the op's outcome tell the same facts. An Infinity duration
 * travels as null. Captions are the showing text track's language.
 */
export const MEDIA_FACTS_FN = `((el) => {
  const tracks = el.textTracks ? Array.from(el.textTracks) : []
  const showing = tracks.find((track) => track.mode === 'showing')
  const seekable = el.seekable && el.seekable.length > 0 ? { start: el.seekable.start(0), end: el.seekable.end(el.seekable.length - 1) } : null
  return {
    paused: el.paused,
    ended: el.ended,
    currentTime: el.currentTime,
    duration: Number.isFinite(el.duration) ? el.duration : null,
    volume: el.volume,
    muted: el.muted,
    loop: el.loop,
    rate: el.playbackRate,
    seekable: seekable && Number.isFinite(seekable.start) && Number.isFinite(seekable.end) ? seekable : null,
    tracks: tracks.length,
    captions: showing ? (showing.language || showing.label || 'on') : null,
    buffering: !el.paused && !el.ended && el.readyState < 3,
    failed: el.error !== null
  }
})`

/** A JS expression yielding the page's media element, or null. */
export const PAGE_MEDIA_JS = `(() => {
  const media = Array.from(document.querySelectorAll('video, audio'))
  return media.find((candidate) => !candidate.paused && !candidate.ended) || media.find((candidate) => candidate.currentTime > 0) || null
})()`
