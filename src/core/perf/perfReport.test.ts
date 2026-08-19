import { describe, expect, it } from 'vitest'
import type { PerfSpanRecord, StageTally } from './perfTracer'
import { buildPerfReport, formatPerfReport } from './perfReport'

// The #33 report seam: per-stage p50/p95/max/count over every span in the
// log, ranked by p95, plus the self-check — every stored `summary` event is
// recomputed from the turn's raw spans and any discrepancy flagged. Pure
// functions over parsed records; file reading is tested at the main seam.

function span(turnId: string, stage: string, durMs: number): PerfSpanRecord {
  return { turnId, stage, durMs, at: 1_700_000_000_000, t: 0 }
}

function summary(turnId: string, stages: Record<string, StageTally>, totalMs: number): PerfSpanRecord {
  return { turnId, stage: 'summary', durMs: totalMs, at: 1_700_000_000_000, t: 0, detail: { stages } }
}

describe('buildPerfReport', () => {
  it('aggregates per-stage p50/p95/max/count over many turns', () => {
    const records: PerfSpanRecord[] = []
    const stt = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
    stt.forEach((durMs, i) => records.push(span(`turn-${i + 1}`, 'stt', durMs)))
    records.push(span('turn-1', 'llm', 1500), span('turn-1', 'llm', 2500))
    records.push(span('turn-1', 'llm-retry', 0))

    const report = buildPerfReport(records)

    // Nearest-rank percentiles: p50 of 10 samples is the 5th, p95 the 10th.
    expect(report.stageStats).toEqual([
      { stage: 'llm', count: 2, p50: 1500, p95: 2500, max: 2500, totalMs: 4000 },
      { stage: 'stt', count: 10, p50: 500, p95: 1000, max: 1000, totalMs: 5500 },
      { stage: 'llm-retry', count: 1, p50: 0, p95: 0, max: 0, totalMs: 0 },
    ])
    expect(report.turnsWithSpans).toBe(10)
    expect(report.turnsWithSummary).toBe(0)
    expect(report.turnsWithoutSummary).toBe(10)
  })

  it('never lets a synthetic summary record pose as a stage sample', () => {
    const report = buildPerfReport([
      span('turn-1', 'stt', 100),
      summary('turn-1', { stt: { count: 1, durMs: 100 } }, 100),
    ])

    expect(report.stageStats.map((s) => s.stage)).toEqual(['stt'])
    expect(report.stageStats[0].count).toBe(1)
  })

  it('counts turns with and without a stored summary event', () => {
    const report = buildPerfReport([
      span('turn-1', 'stt', 100),
      summary('turn-1', { stt: { count: 1, durMs: 100 } }, 100),
      span('turn-2', 'stt', 200),
    ])

    expect(report.turnsWithSpans).toBe(2)
    expect(report.turnsWithSummary).toBe(1)
    expect(report.turnsWithoutSummary).toBe(1)
  })

  it('passes a summary that matches the recomputed raw spans', () => {
    const report = buildPerfReport([
      span('turn-1', 'stt', 6900),
      span('turn-1', 'llm', 1600),
      span('turn-1', 'llm', 1600),
      summary('turn-1', { stt: { count: 1, durMs: 6900 }, llm: { count: 2, durMs: 3200 } }, 10100),
    ])

    expect(report.mismatches).toEqual([])
  })

  it('tolerates float-ordering noise up to 1ms between stored and recomputed', () => {
    const report = buildPerfReport([
      span('turn-1', 'llm', 1600.05),
      span('turn-1', 'llm', 1600.05),
      summary('turn-1', { llm: { count: 2, durMs: 3200.4 } }, 3200.4),
    ])

    expect(report.mismatches).toEqual([])
  })

  it('flags a total and stage mismatch when the raw spans disagree with the stored summary', () => {
    // The realistic hazard: a rotated-away file held some of the turn's spans.
    const report = buildPerfReport([
      span('turn-9', 'llm', 1600),
      summary('turn-9', { stt: { count: 1, durMs: 6900 }, llm: { count: 3, durMs: 4800 } }, 11700),
    ])

    expect(report.mismatches).toEqual([
      {
        turnId: 'turn-9',
        problems: [
          'total: stored 11700ms, recomputed 1600ms from raw spans',
          'stage llm: stored count 3, 4800ms; recomputed count 1, 1600ms',
          'stage stt: stored count 1, 6900ms; no raw spans',
        ],
      },
    ])
  })

  it('flags a stage present in raw spans but missing from the stored summary', () => {
    const report = buildPerfReport([
      span('turn-4', 'llm', 1000),
      span('turn-4', 'tool', 8100),
      span('turn-4', 'tool', 700),
      summary('turn-4', { llm: { count: 1, durMs: 1000 } }, 1000),
    ])

    expect(report.mismatches).toEqual([
      {
        turnId: 'turn-4',
        problems: [
          'total: stored 1000ms, recomputed 9800ms from raw spans',
          'stage tool: missing from stored summary; recomputed count 2, 8800ms',
        ],
      },
    ])
  })

  it('flags a count mismatch even when the summed durations agree', () => {
    const report = buildPerfReport([
      span('turn-2', 'llm', 1000),
      span('turn-2', 'llm', 2200),
      summary('turn-2', { llm: { count: 1, durMs: 3200 } }, 3200),
    ])

    expect(report.mismatches).toEqual([
      { turnId: 'turn-2', problems: ['stage llm: stored count 1, 3200ms; recomputed count 2, 3200ms'] },
    ])
  })

  it('degrades a stored summary with unusable stage detail to a full mismatch', () => {
    const report = buildPerfReport([
      span('turn-5', 'stt', 100),
      { turnId: 'turn-5', stage: 'summary', durMs: 100, at: 0, t: 0 }, // no detail.stages
    ])

    expect(report.mismatches).toEqual([
      {
        turnId: 'turn-5',
        problems: [
          'stage stt: missing from stored summary; recomputed count 1, 100ms',
        ],
      },
    ])
  })

  it('returns an empty report for an empty log', () => {
    const report = buildPerfReport([])

    expect(report.stageStats).toEqual([])
    expect(report.turnsWithSpans).toBe(0)
    expect(report.turnsWithSummary).toBe(0)
    expect(report.turnsWithoutSummary).toBe(0)
    expect(report.mismatches).toEqual([])
  })
})

describe('formatPerfReport', () => {
  const CONTEXT = { logsDir: '/home/x/.config/bingbong/logs', fileCount: 2, skippedLines: 1 }

  it('prints a p95-ranked table with counts and a self-check line', () => {
    const text = formatPerfReport(
      buildPerfReport([
        span('turn-1', 'llm', 1500),
        span('turn-1', 'llm', 2500),
        span('turn-2', 'stt', 100),
        span('turn-2', 'stt', 200),
        summary('turn-2', { stt: { count: 2, durMs: 300 } }, 300),
      ]),
      CONTEXT,
    )

    const lines = text.split('\n')
    expect(lines[0]).toBe('perf report: /home/x/.config/bingbong/logs')
    expect(lines[1]).toBe('files 2 | turns 2 (1 summarized) | spans 4 | skipped lines 1')
    expect(lines[2]).toBe('')
    // Header and rows: p95-descending order, right-aligned numeric cells.
    expect(lines[3]).toMatch(/^stage\s+count\s+p50\s+p95\s+max\s+total$/)
    expect(lines[4]).toMatch(/^llm\s+2\s+1500ms\s+2500ms\s+2500ms\s+4000ms$/)
    expect(lines[5]).toMatch(/^stt\s+2\s+100ms\s+200ms\s+200ms\s+300ms$/)
    expect(lines[6]).toBe('')
    expect(lines[7]).toBe('summary self-check: 1/1 match')
    expect(lines).toHaveLength(8)
  })

  it('lists every mismatch problem under the self-check line', () => {
    const text = formatPerfReport(
      buildPerfReport([
        span('turn-1', 'stt', 100),
        summary('turn-1', { stt: { count: 1, durMs: 100 } }, 100),
        span('turn-9', 'llm', 1600),
        summary('turn-9', { llm: { count: 3, durMs: 4800 } }, 4800),
      ]),
      { logsDir: '/tmp/logs', fileCount: 1, skippedLines: 0 },
    )

    const lines = text.split('\n')
    expect(lines).toContain('summary self-check: 1 mismatch of 2 summaries')
    expect(lines[lines.indexOf('summary self-check: 1 mismatch of 2 summaries') + 1]).toBe(
      '  turn-9: total: stored 4800ms, recomputed 1600ms from raw spans',
    )
    expect(lines[lines.length - 1]).toBe(
      '  turn-9: stage llm: stored count 3, 4800ms; recomputed count 1, 1600ms',
    )
  })

  it('says so when no turns ever stored a summary', () => {
    const text = formatPerfReport(buildPerfReport([span('turn-1', 'stt', 100)]), CONTEXT)

    expect(text.split('\n')).toContain('summary self-check: no summaries in log')
  })

  it('prints a friendly line for an empty or missing log', () => {
    const text = formatPerfReport(buildPerfReport([]), {
      logsDir: '/tmp/nope',
      fileCount: 0,
      skippedLines: 0,
    })

    expect(text).toBe('perf report: /tmp/nope\nno perf spans found (files 0, skipped lines 0)')
  })
})
