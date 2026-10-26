// Page-side: the page's media element, one pick shared by the collect
// (#363, the ask's `Playing:` line) and the Player's controls (#362, ADR
// 0079) — the element playing, else the first that started, null for none.
// One rule for both, so a music line acts on the element Jev was shown and
// never on one it was not. A never-started element is no media here.
// An idle `stop` takes no pick: it pauses every element playing (#376).

/** Every media element, by kind, of the document a script runs in: the top's, or a frame's when run there (#377). */
const MEDIA_SELECTOR = "'video, audio'"

/**
 * The Duck Mark (#459, CONTEXT.md Ducking): the property a duck leaves on
 * the element it lowered, `{ restore, share }` — the volume (0–1) the duck
 * puts back and the floor's share of it. While it is there the element
 * plays at the floor, and the volume the person is reckoned to hear is
 * the one put back: what the card shows, what a volume op moves from and
 * sets, and what the release puts back. Read and written by kind, on any
 * element, so the collect, a Media Op and the Player's controls agree.
 */
export const DUCK_MARK = '__bingbongDuck'

/** A JS function source `(el) => 0–1`: the element's volume as heard once no duck holds it — the level a duck puts back, else its own. */
export const HEARD_VOLUME_FN = `((el) => el.${DUCK_MARK} ? el.${DUCK_MARK}.restore : el.volume)`

/** A JS function source `(el, level)` setting a 0–1 volume: under a duck, the level put back, the element left at that level's floor. */
export const SET_HEARD_VOLUME_FN = `((el, level) => {
  const duck = el.${DUCK_MARK}
  if (!duck) { el.volume = level; return }
  duck.restore = level
  el.volume = Math.round(level * 100 * duck.share) / 100
})`

/**
 * A JS function source `(el) => facts` reading a media element's own facts
 * (#372, ADR 0080) — the `MediaFacts` shape the collect carries on each
 * media ref and a Media Op reads before and after it acts, so the ref
 * line and the op's outcome tell the same facts. An Infinity duration
 * travels as null. Captions are the showing text track's language; a
 * track hidden with none showing is told apart (#389), as it says nothing.
 * The volume is the one heard once no duck holds it (#459), never the floor.
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
    volume: ${HEARD_VOLUME_FN}(el),
    muted: el.muted,
    loop: el.loop,
    rate: el.playbackRate,
    seekable: seekable && Number.isFinite(seekable.start) && Number.isFinite(seekable.end) ? seekable : null,
    tracks: tracks.length,
    captions: showing ? (showing.language || showing.label || 'on') : null,
    hiddenTrack: !showing && tracks.some((track) => track.mode === 'hidden'),
    buffering: !el.paused && !el.ended && el.readyState < 3,
    failed: el.error !== null
  }
})`

/**
 * The duck held on a document (#461): the floor's share while the pane is
 * ducked, absent when it is not. Its listeners read it when a media event
 * comes, so a document ducked once keeps them, and a release ends them.
 */
export const DUCK_HOLD = '__bingbongDuckHold'

/**
 * A JS expression ducking every media element playing in its document
 * (#461, CONTEXT.md Ducking), by kind, on any site: each is marked with
 * its own level and dropped to `share` of it. A muted or paused element is
 * left alone, and one already marked keeps its mark — the Player's song
 * the Player marked, or one a frame's earlier duck reached. While the hold
 * stands, an element that starts playing drops to its floor too, and a
 * marked one the page raises goes back to its floor, the level put back
 * kept. Yields how many it lowered.
 */
export function duckAllScript(share: number): string {
  return `(() => {
  /* DUCK_ALL */
  const floorOf = (mark) => Math.round(mark.restore * 100 * mark.share) / 100
  const floor = (el) => { el.volume = floorOf(el.${DUCK_MARK}) }
  const lower = (el) => {
    const hold = window.${DUCK_HOLD}
    if (!hold || el.${DUCK_MARK} || el.paused || el.ended || el.muted) return false
    el.${DUCK_MARK} = { restore: el.volume, share: hold.share }
    floor(el)
    return true
  }
  if (!window.__bingbongDuckHeard) {
    window.__bingbongDuckHeard = true
    const media = (event) => event.target instanceof HTMLMediaElement ? event.target : null
    for (const type of ['play', 'playing']) window.addEventListener(type, (event) => { const el = media(event); if (el) lower(el) }, true)
    window.addEventListener('volumechange', (event) => {
      const el = media(event)
      if (!el || !window.${DUCK_HOLD} || !el.${DUCK_MARK}) return
      if (el.volume > floorOf(el.${DUCK_MARK}) + 0.005) floor(el)
    }, true)
  }
  window.${DUCK_HOLD} = { share: ${share} }
  return Array.from(document.querySelectorAll(${MEDIA_SELECTOR})).filter(lower).length
})()`
}

/** A JS expression letting go of the duck in its document (#461): the hold ended, every marked element given back the level its mark holds. Yields how many. */
export const UNDUCK_ALL_JS = `(() => {
  /* UNDUCK_ALL */
  window.${DUCK_HOLD} = null
  let restored = 0
  for (const el of document.querySelectorAll(${MEDIA_SELECTOR})) {
    const mark = el.${DUCK_MARK}
    if (!mark) continue
    delete el.${DUCK_MARK}
    el.volume = mark.restore
    restored += 1
  }
  return restored
})()`

/** A JS expression yielding the page's media element, or null. */
export const PAGE_MEDIA_JS = `(() => {
  const media = Array.from(document.querySelectorAll(${MEDIA_SELECTOR}))
  return media.find((candidate) => !candidate.paused && !candidate.ended) || media.find((candidate) => candidate.currentTime > 0) || null
})()`

/** A JS expression pausing every media element playing in its document (#376), yielding those it paused. */
export const PAUSE_PLAYING_JS = `(() => {
  const playing = Array.from(document.querySelectorAll(${MEDIA_SELECTOR})).filter((media) => !media.paused)
  for (const media of playing) media.pause()
  return playing
})()`

/** The same in one of the page's frames (#377): how many it paused, a count crossing the frame boundary where elements cannot. */
export const FRAME_PAUSE_ALL_JS = `(() => {
  /* FRAME_PAUSE_ALL */
  return ${PAUSE_PLAYING_JS}.length
})()`
