import { describe, expect, it } from 'vitest'
import { formatReplayReport, type ReplayRow } from './replayReport'

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

  it('handles the empty replay without throwing', () => {
    const out = formatReplayReport([])
    expect(out).toContain('0 utterances')
    expect(out).toContain('p50 0ms')
  })
})
