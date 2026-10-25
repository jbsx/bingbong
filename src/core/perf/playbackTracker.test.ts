import { describe, expect, it } from 'vitest'
import type { PlaybackRecord } from './appTelemetry'
import { createPlaybackTracker, type PlaybackView } from './playbackTracker'

// One Playback Record per piece of media (kiosk telemetry 2026-10-25): when
// its page closes it, when its document is gone, or when the app quits.

function view(key: string, over: Partial<PlaybackView> = {}): PlaybackView {
  return { key, page: 'https://x.test/watch', kind: 'video', startMs: 900, playedMs: 1_000, stalls: 0, stallMs: 0, droppedFrames: 0, totalFrames: 30, height: 720, ...over }
}

describe('createPlaybackTracker', () => {
  it('writes what the page closed, with its reason, and keeps what is still playing open', () => {
    const written: PlaybackRecord[] = []
    const tracker = createPlaybackTracker((record) => written.push(record))
    tracker.observe({ items: [view('a'), view('b')], closed: [] })
    tracker.observe({ items: [view('b', { playedMs: 6_000 })], closed: [view('a', { closed: 'ended', playedMs: 4_000 })] })

    expect(written).toEqual([{ page: 'https://x.test/watch', kind: 'video', startMs: 900, playedMs: 4_000, stalls: 0, stallMs: 0, droppedFrames: 0, totalFrames: 30, height: 720, closed: 'ended' }])
  })

  it('closes what went with its document as left, from its last poll; an unread page closes nothing', () => {
    const written: PlaybackRecord[] = []
    const tracker = createPlaybackTracker((record) => written.push(record))
    tracker.observe({ items: [view('a', { stalls: 2, stallMs: 3_000 })], closed: [] })
    tracker.observe(null)
    expect(written).toEqual([])
    tracker.observe({ items: [view('c')], closed: [] })

    expect(written).toMatchObject([{ stalls: 2, stallMs: 3_000, closed: 'left' }])
  })

  it('closes everything open as left when the app quits', () => {
    const written: PlaybackRecord[] = []
    const tracker = createPlaybackTracker((record) => written.push(record))
    tracker.observe({ items: [view('a')], closed: [] })
    tracker.flush()
    tracker.flush()

    expect(written.map((record) => record.closed)).toEqual(['left'])
  })
})
