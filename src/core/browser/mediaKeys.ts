import type { KeyPress } from '../ports/browser'

// Media shortcuts, driven by key injection on the focused page (YouTube's
// shortcuts: k toggles play, arrows nudge volume, Shift+N skips to the next
// video, j/l seek ±10s per press). Deliberately no ad-skip key exists.

/** YouTube's next-track shortcut — shared with the CLI `press` grammar. */
export const NEXT_TRACK_KEY: KeyPress = { key: 'n', shift: true }

export const MEDIA_KEYS = {
  play_pause: { key: 'k' },
  volume_up: { key: 'ArrowUp' },
  volume_down: { key: 'ArrowDown' },
  next: NEXT_TRACK_KEY,
  seek_forward: { key: 'l' },
  seek_back: { key: 'j' },
} as const satisfies Record<string, KeyPress>
