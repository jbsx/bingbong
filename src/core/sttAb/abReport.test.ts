import { describe, expect, it } from 'vitest'
import { buildAbSummary, formatAbReport } from './abReport'

// The #39 A/B report: transcript pairs and latency distribution for every
// replayed utterance dump, whisper.cpp vs Moonshine Base. Pure functions —
// the script collects rows, this module decides what "compared" means and
// how the verdict-shaped numbers are printed.

function row(file: string, durationSec: number, whisperText: string, whisperMs: number, moonshineText: string, moonshineMs: number) {
  return { file, durationSec, whisperText, whisperMs, moonshineText, moonshineMs }
}

describe('buildAbSummary', () => {
  it('counts normalized matches, both-empty and one-sided misses', () => {
    const summary = buildAbSummary([
      row('a.wav', 2, 'Open YouTube', 6_000, 'open youtube', 200),
      row('b.wav', 2, '', 5_000, '', 150),
      row('c.wav', 2, 'pause', 5_500, 'paws', 140),
      row('d.wav', 2, 'volume up', 5_200, '', 130),
    ])
    expect(summary.files).toBe(4)
    expect(summary.matches).toBe(2) // a (normalized) + b (both empty)
    expect(summary.bothEmpty).toBe(1)
    expect(summary.differ).toBe(2)
    expect(summary.moonshineEmpty).toBe(1)
    expect(summary.whisperEmpty).toBe(0)
  })

  it('summarizes latency per engine with nearest-rank percentiles', () => {
    const summary = buildAbSummary([
      row('a.wav', 2, 'x', 100, 'x', 10),
      row('b.wav', 4, 'x', 300, 'x', 30),
      row('c.wav', 6, 'x', 200, 'x', 20),
    ])
    expect(summary.whisper).toEqual({ count: 3, p50: 200, p95: 300, max: 300 })
    expect(summary.moonshine).toEqual({ count: 3, p50: 20, p95: 30, max: 30 })
  })

  it('normalizes case, punctuation and spacing before matching', () => {
    const summary = buildAbSummary([row('a.wav', 2, 'Play  the latest Linus Tech Tips video!', 1, 'play the latest linus tech tips video', 1)])
    expect(summary.matches).toBe(1)
    expect(summary.differ).toBe(0)
  })
})

describe('formatAbReport', () => {
  const rows = [
    row('utterance-1755612340000-0001.wav', 2.1, 'open youtube', 6_100, 'open youtube', 210),
    row('utterance-1755612340000-0002.wav', 0.8, '', 5_900, 'volume up', 96),
  ]

  it('prints per-file pairs with latencies and a summary block', () => {
    const text = formatAbReport(rows, { dumpsDir: '/home/u/.config/bingbong/audio-dumps' })

    expect(text).toContain('STT A/B — /home/u/.config/bingbong/audio-dumps (2 utterances)')
    expect(text).toContain('utterance-1755612340000-0001.wav')
    expect(text).toMatch(/0001\.wav.*2\.1s.*6100ms.*210ms/)
    expect(text).toContain('transcripts: 1/2 match')
    expect(text).toMatch(/whisper base\.en.*6100ms.*6100ms/)
    expect(text).toMatch(/moonshine base.*210ms/)
  })

  it('truncates long transcripts so the table stays readable', () => {
    const long = 'a'.repeat(80)
    const text = formatAbReport([row('x.wav', 1, long, 1, long, 1)], { dumpsDir: '/d' })
    expect(text).not.toContain(long)
    expect(text).toContain('a'.repeat(37) + '...')
  })

  it('prints full transcripts for differing pairs below the table', () => {
    const text = formatAbReport(
      [row('a.wav', 2, 'play the video', 1, 'play the radio', 1), row('b.wav', 2, 'pause', 1, 'pause', 1)],
      { dumpsDir: '/d' },
    )
    expect(text).toContain('differing transcripts:')
    expect(text).toContain('a.wav (2.0s)')
    expect(text).toContain('  whisper:   play the video')
    expect(text).toContain('  moonshine: play the radio')
    expect(text).not.toContain('b.wav (2.0s)') // matching pair not repeated in the full section
  })

  it('states the empty case instead of an empty table', () => {
    expect(formatAbReport([], { dumpsDir: '/d' })).toContain('(0 utterances)')
  })
})
