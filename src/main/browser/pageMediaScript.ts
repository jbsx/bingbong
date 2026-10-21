// Page-side: the page's media element, one pick shared by the collect
// (#363, the ask's `Playing:` line) and the Player's controls (#362, ADR
// 0079) — the element playing, else the first that started, null for none.
// One rule for both, so a Capability acts on the element Jev was shown and
// never on one it was not. A never-started element is no media here.

/** A JS expression yielding the page's media element, or null. */
export const PAGE_MEDIA_JS = `(() => {
  const media = Array.from(document.querySelectorAll('video, audio'))
  return media.find((candidate) => !candidate.paused && !candidate.ended) || media.find((candidate) => candidate.currentTime > 0) || null
})()`
