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

/**
 * The Seek Mark (#505): the property a seek leaves on an element that was
 * playing as it seeked, `{ at }` — the page's `performance.now()` at the seek. A
 * seek that leaves its element paused is resumed once, the Player's poll
 * reading the mark; a `pause` or `play` on the element takes it off, so a
 * pause asked after the seek is never undone. Set by kind by every seek, a
 * Media Op's and the Player's own.
 */
export const SEEK_MARK = '__bingbongSeekedPlaying'

/** A JS function source `(el, op, playing)`: a seek (`forward`, `back`, `restart`, `seek`) marks the element if it was playing, unmarks it if not; a `pause` or `play` unmarks it; other ops leave it be. */
export const MARK_SEEK_FN = `((el, op, playing) => {
  const seek = op === 'forward' || op === 'back' || op === 'restart' || op === 'seek'
  if (seek && playing) el.${SEEK_MARK} = { at: performance.now() }
  else if (seek || op === 'pause' || op === 'play') delete el.${SEEK_MARK}
})`

/** A JS function source `(el) => 0–1`: the element's volume as heard once no duck holds it — the level a duck puts back, else its own. */
export const HEARD_VOLUME_FN = `((el) => el.${DUCK_MARK} ? el.${DUCK_MARK}.restore : el.volume)`

/** A JS function source `(mark) => 0–1`: the floor a duck's mark holds its element at, its share of the level put back, to a whole percent. */
export const DUCK_FLOOR_FN = `((mark) => Math.round(mark.restore * 100 * mark.share) / 100)`

/** A JS function source `(el, level)` setting a 0–1 volume: under a duck, the level put back, the element left at that level's floor. */
export const SET_HEARD_VOLUME_FN = `((el, level) => {
  const duck = el.${DUCK_MARK}
  if (!duck) { el.volume = level; return }
  duck.restore = level
  el.volume = ${DUCK_FLOOR_FN}(duck)
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

/** On an element the duck left alone as muted (#461): lowered should it be unmuted while the duck holds. */
const DUCK_MUTED = '__bingbongDuckMuted'

/** On a document: the duck's listeners are installed. */
const DUCK_HEARD = '__bingbongDuckHeard'

/**
 * A JS expression ducking every media element playing in its document
 * (#461, CONTEXT.md Ducking), by kind, on any site: each is marked with
 * its own level and dropped to `share` of it. A muted or paused element is
 * left alone, and one already marked keeps its mark — the Player's song
 * the Player marked, or one a frame's earlier duck reached. While the hold
 * stands, an element that starts playing drops to its floor too, as does
 * one left alone as muted once it is unmuted, and a marked one the page
 * raises goes back to its floor, the level put back kept. Yields how many
 * it lowered.
 */
export function duckAllScript(share: number): string {
  return `(() => {
  /* DUCK_ALL */
  const floorOf = ${DUCK_FLOOR_FN}
  const floor = (el) => { el.volume = floorOf(el.${DUCK_MARK}) }
  const lower = (el) => {
    const hold = window.${DUCK_HOLD}
    if (!hold || el.${DUCK_MARK} || el.paused || el.ended) return false
    // Muted, it is left alone — and lowered should it be unmuted while the hold stands.
    if (el.muted) { el.${DUCK_MUTED} = true; return false }
    el.${DUCK_MARK} = { restore: el.volume, share: hold.share }
    floor(el)
    return true
  }
  if (!window.${DUCK_HEARD}) {
    window.${DUCK_HEARD} = true
    const media = (event) => event.target instanceof HTMLMediaElement ? event.target : null
    for (const type of ['play', 'playing']) window.addEventListener(type, (event) => { const el = media(event); if (el) lower(el) }, true)
    window.addEventListener('volumechange', (event) => {
      const el = media(event)
      if (!el || !window.${DUCK_HOLD}) return
      if (!el.${DUCK_MARK}) {
        if (el.${DUCK_MUTED} && !el.muted) lower(el)
        return
      }
      if (el.volume > floorOf(el.${DUCK_MARK}) + 0.005) floor(el)
    }, true)
  }
  window.${DUCK_HOLD} = { share: ${share} }
  let lowered = 0
  for (const el of document.querySelectorAll(${MEDIA_SELECTOR})) if (lower(el)) lowered += 1
  return lowered
})()`
}

/** A JS expression letting go of the duck in its document (#461): the hold ended, every marked element given back the level its mark holds. Yields how many. */
export const UNDUCK_ALL_JS = `(() => {
  /* UNDUCK_ALL */
  window.${DUCK_HOLD} = null
  let restored = 0
  for (const el of document.querySelectorAll(${MEDIA_SELECTOR})) {
    delete el.${DUCK_MUTED}
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

/**
 * A JS function source `(el, op) => { before, after }` (#372, ADR 0080): a Media Op applied to one
 * element, its facts read before and after in the same tick. Shared by the op on a ref, the
 * Appliance Card's op on the appliance's element by kind (#485), and that op on the audio road's element (#502).
 */
export const APPLY_MEDIA_OP_FN = `((el, op) => {
  const facts = ${MEDIA_FACTS_FN}
  const before = facts(el)
  // The seeks are offered only with a seekable range (ADR 0080): the bounds are the facts' own.
  const start = before.seekable ? before.seekable.start : 0
  const end = before.seekable ? before.seekable.end : el.currentTime
  const tracks = el.textTracks ? Array.from(el.textTracks) : []
  switch (op.op) {
    case 'play': el.play().catch(() => {}); break
    case 'pause': el.pause(); break
    case 'forward': el.currentTime = Math.min(end, el.currentTime + (op.seconds || 0)); break
    case 'back': el.currentTime = Math.max(start, el.currentTime - (op.seconds || 0)); break
    case 'restart': el.currentTime = start; el.play().catch(() => {}); break
    // Under a duck (#459) the level put back is set, the element left at its floor until the duck lets go.
    case 'volume': ${SET_HEARD_VOLUME_FN}(el, Math.max(0, Math.min(100, Math.round(op.to || 0))) / 100); break
    case 'mute':
    case 'unmute': el.muted = op.op === 'mute'; break
    case 'loop':
    case 'unloop': el.loop = op.op === 'loop'; break
    case 'rate': el.playbackRate = op.to || 1; break
    case 'captions': {
      const track = tracks.find((t) => t.kind === 'subtitles' || t.kind === 'captions') || tracks[0]
      for (const t of tracks) t.mode = t === track ? 'showing' : 'disabled'
      break
    }
    case 'uncaptions': for (const t of tracks) t.mode = 'disabled'; break
  }
  // A seek of a playing element is marked (#505): if it leaves the element paused, the Player plays it once.
  ${MARK_SEEK_FN}(el, op.op, !before.paused)
  // A play() flips the paused flag in the call and a seek lands in the same tick, so the facts read after tell what the op did — a play the policy refuses flips back later, and the next read says so.
  return { before, after: facts(el) }
})`
