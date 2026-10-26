import { describe, expect, it } from 'vitest'
import { formatLabelScore, formatReplayReport, wordErrors, type ReplayRow } from './replayReport'

// The #35 replay report: one row per replayed utterance dump (file, speech
// duration, endpoint→transcript wall time, transcript) plus the p50/p95/max
// summary over those wall times — the same nearest-rank percentiles and ms
// formatting as perf:report, so offline replay and the live `stt` span rank
// latency identically.

const ROWS: ReplayRow[] = [
  { file: 'beckett.wav', speechMs: 10_000, ms: 212, transcript: 'It is.' },
  { file: 'intent.wav', speechMs: 20_600, ms: 100, transcript: 'Can you go forward please?' },
  { file: 'jfk.wav', speechMs: 11_000, ms: 300, transcript: 'And so my fellow Americans.' },
  { file: 'two.wav', speechMs: 44_400, ms: 200, transcript: 'It was the best of times.' },
]

describe('formatReplayReport', () => {
  it('prints one line per utterance: file, speech, wall time, transcript', () => {
    const out = formatReplayReport(ROWS)
    for (const row of ROWS) {
      expect(out).toContain(row.file)
      expect(out).toContain(row.transcript)
    }
    expect(out).toContain('212ms')
  })

  it('summarizes nearest-rank p50/p95/max over the wall times', () => {
    // sorted wall times [100, 200, 212, 300]: p50 → rank 2 → 200,
    // p95 → rank 4 → 300, max → 300.
    const out = formatReplayReport(ROWS)
    expect(out).toContain('p50 200ms')
    expect(out).toContain('p95 300ms')
    expect(out).toContain('max 300ms')
    expect(out).toContain('4 utterances')
  })

  it('prints the peak RSS per row and over the run when measured (#358)', () => {
    const out = formatReplayReport([
      { ...ROWS[0], peakRssMb: 1210 },
      { ...ROWS[1], peakRssMb: 1388 },
    ])
    expect(out).toMatch(/beckett\.wav .*1210 MB/)
    expect(out).toContain('peak RSS 1388 MB')
    expect(formatReplayReport(ROWS)).not.toContain('RSS')
  })

  it('handles the empty replay without throwing', () => {
    const out = formatReplayReport([])
    expect(out).toContain('0 utterances')
    expect(out).toContain('p50 0ms')
  })
})

describe('wordErrors (#456)', () => {
  it('counts the words substituted, dropped or added, case, punctuation and apostrophes aside', () => {
    expect(wordErrors('loop this song', 'Look this song.')).toBe(1)
    expect(wordErrors("go to elon musk's profile", 'Go to your masks profile')).toBe(2)
    expect(wordErrors('back', '')).toBe(1)
    expect(wordErrors("what's the time", 'Whats the time?')).toBe(0)
  })
})

describe('formatLabelScore (#456)', () => {
  it('scores each labelled dump against what was said, and leaves the rest out', () => {
    const out = formatLabelScore(ROWS, { 'intent.wav': 'can you go forward please', 'jfk.wav': 'and so my fellow americans ask not' })
    expect(out).toContain('intent.wav  0  can you go forward please')
    expect(out).toContain('jfk.wav     2  and so my fellow americans ask not  ← And so my fellow Americans.')
    expect(out).not.toContain('beckett.wav')
    expect(out).toContain('labelled 2 of 4 | word errors 2 of 12 | exact 1 of 2')
  })
})
