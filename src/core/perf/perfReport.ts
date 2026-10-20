import type { PerfSpanRecord, StageTally } from './perfTracer'
import type { CommandLogRecord } from '../command/decisionRecord'
import { formatMs, nearestRankPercentile } from '../report/stats.ts'
import { buildDecisionReport, buildReactionReport, formatCommandReport, type DecisionReport, type ReactionReport } from './commandReport.ts'

// The #33 report: per-stage p50/p95/max/count over every span in the log,
// ranked by p95 — optimization targets ranked by percentiles over many
// turns, not one turn's vibes. The self-check recomputes every stored
// `summary` event from its turn's raw spans and flags discrepancies (the
// realistic hazard: a rotated-away file held some of the turn's spans).
// Pure functions over parsed records; the file half lives at the main seam.
// Percentile/ms-formatting live in src/core/report/stats.ts, shared with the
// #39 STT A/B report.

export interface StageStats {
  stage: string
  count: number
  p50: number
  p95: number
  max: number
  totalMs: number
}

export interface SummaryMismatch {
  turnId: string
  /** Human-readable stored-vs-recomputed discrepancies, stages sorted. */
  problems: string[]
}

export interface PerfReport {
  /** p95-descending (ties: total, then name) — the ranking the report prints. */
  stageStats: StageStats[]
  /** Distinct turns that recorded at least one raw span. */
  turnsWithSpans: number
  /** Distinct turns that stored a summary event. */
  turnsWithSummary: number
  /** Turns with raw spans but no summary event (aborted or never closed out). */
  turnsWithoutSummary: number
  mismatches: SummaryMismatch[]
  /** The Reaction per verb (#324), from the `reaction` spans. */
  reaction: ReactionReport
  /** The decision log's shares (#324): readings, Jev's share and latency, Misfires. */
  decisions: DecisionReport
  /** What fired each Endpoint (#357), from the stt spans that say; null when none do. */
  endpoints: EndpointReport | null
}

/** The turn check against the pause cap (#357): how often each fired the Endpoint. */
export interface EndpointReport {
  /** Smart Turn read the Utterance finished at the short pause. */
  turn: number
  /** The pause cap fired; of these, how many the check read unfinished, and how many it failed. */
  cap: number
  capUnfinished: number
  capFailed: number
  /** The 30 s hard cap. */
  max: number
  /** Ms the turn checks took; null when none was asked. */
  turnCheckP50: number | null
  turnCheckP95: number | null
}

export interface ReportContext {
  logsDir: string
  fileCount: number
  skippedLines: number
  /** The decision-*.jsonl files read (#324); absent when the caller read none. */
  decisionFileCount?: number
}

const SUMMARY_STAGE = 'summary'
/** Stored and recomputed sums are floats summed in the same order; anything
 * beyond this is real data loss, not rounding noise. */
const DURATION_TOLERANCE_MS = 1

/** Tallies the stt spans' endedBy (#357); spans logged before the turn check carry none. */
function buildEndpointReport(records: readonly PerfSpanRecord[]): EndpointReport | null {
  const report: EndpointReport = { turn: 0, cap: 0, capUnfinished: 0, capFailed: 0, max: 0, turnCheckP50: null, turnCheckP95: null }
  const checkMs: number[] = []
  let counted = 0
  for (const record of records) {
    const detail = record.detail
    if (record.stage !== 'stt' || detail === undefined) continue
    const endedBy = detail.endedBy
    if (endedBy !== 'turn' && endedBy !== 'cap' && endedBy !== 'max') continue
    counted += 1
    report[endedBy] += 1
    if (endedBy === 'cap' && detail.turnVerdict === 'unfinished') report.capUnfinished += 1
    if (endedBy === 'cap' && detail.turnVerdict === 'failed') report.capFailed += 1
    if (typeof detail.turnScoreMs === 'number') checkMs.push(detail.turnScoreMs)
  }
  if (counted === 0) return null
  const sorted = checkMs.sort((a, b) => a - b)
  if (sorted.length > 0) {
    report.turnCheckP50 = nearestRankPercentile(sorted, 50)
    report.turnCheckP95 = nearestRankPercentile(sorted, 95)
  }
  return report
}

function formatEndpointLine(endpoints: EndpointReport): string {
  const checks = endpoints.turnCheckP50 === null || endpoints.turnCheckP95 === null ? 'no turn checks' : `turn check p50 ${formatMs(endpoints.turnCheckP50)} p95 ${formatMs(endpoints.turnCheckP95)}`
  return (
    `endpoints: smart turn ${endpoints.turn} | pause cap ${endpoints.cap} (${endpoints.capUnfinished} unfinished, ${endpoints.capFailed} failed)` +
    ` | hard cap ${endpoints.max} | ${checks}`
  )
}

/** Defensively reads a summary record's stage tallies; garbage degrades to {}. */
function storedStages(record: PerfSpanRecord): Record<string, StageTally> {
  const stages = record.detail?.stages
  if (stages === undefined || stages === null || typeof stages !== 'object') return {}
  const out: Record<string, StageTally> = {}
  for (const [stage, value] of Object.entries(stages)) {
    if (value === null || typeof value !== 'object') continue
    const v = value as { count?: unknown; durMs?: unknown }
    out[stage] = {
      count: typeof v.count === 'number' && Number.isFinite(v.count) ? v.count : 0,
      durMs: typeof v.durMs === 'number' && Number.isFinite(v.durMs) ? v.durMs : 0,
    }
  }
  return out
}

function diffSummary(record: PerfSpanRecord, raw: Map<string, StageTally> | undefined): SummaryMismatch | null {
  const stored = storedStages(record)
  const recomputedTotal = raw ? [...raw.values()].reduce((sum, t) => sum + t.durMs, 0) : 0
  const problems: string[] = []
  if (Math.abs(record.durMs - recomputedTotal) > DURATION_TOLERANCE_MS) {
    problems.push(`total: stored ${formatMs(record.durMs)}, recomputed ${formatMs(recomputedTotal)} from raw spans`)
  }
  const stageProblems: string[] = []
  for (const [stage, s] of Object.entries(stored)) {
    const r = raw?.get(stage)
    if (r === undefined) {
      stageProblems.push(`stage ${stage}: stored count ${s.count}, ${formatMs(s.durMs)}; no raw spans`)
    } else if (s.count !== r.count || Math.abs(s.durMs - r.durMs) > DURATION_TOLERANCE_MS) {
      stageProblems.push(
        `stage ${stage}: stored count ${s.count}, ${formatMs(s.durMs)}; recomputed count ${r.count}, ${formatMs(r.durMs)}`,
      )
    }
  }
  for (const [stage, t] of raw ?? []) {
    if (!(stage in stored)) {
      stageProblems.push(`stage ${stage}: missing from stored summary; recomputed count ${t.count}, ${formatMs(t.durMs)}`)
    }
  }
  problems.push(...stageProblems.sort())
  return problems.length > 0 ? { turnId: record.turnId, problems } : null
}

export function buildPerfReport(records: readonly PerfSpanRecord[], decisions: readonly CommandLogRecord[] = []): PerfReport {
  const durations = new Map<string, number[]>()
  const turnTallies = new Map<string, Map<string, StageTally>>()
  const summaries: PerfSpanRecord[] = []
  const summaryTurns = new Set<string>()

  for (const record of records) {
    if (record.stage === SUMMARY_STAGE) {
      summaries.push(record)
      summaryTurns.add(record.turnId)
      continue
    }
    // Zero-duration events (llm-retry) ride the same table: their count is
    // the signal — a tripled round-trip — and their 0ms percentiles are
    // honest, per the tracer's stage vocabulary.
    let stages = turnTallies.get(record.turnId)
    if (stages === undefined) {
      stages = new Map()
      turnTallies.set(record.turnId, stages)
    }
    const tally = stages.get(record.stage) ?? { count: 0, durMs: 0 }
    tally.count += 1
    tally.durMs += record.durMs
    stages.set(record.stage, tally)
    const samples = durations.get(record.stage)
    if (samples === undefined) durations.set(record.stage, [record.durMs])
    else samples.push(record.durMs)
  }

  const stageStats = [...durations.entries()]
    .map(([stage, durs]) => {
      const sorted = [...durs].sort((a, b) => a - b)
      return {
        stage,
        count: sorted.length,
        p50: nearestRankPercentile(sorted, 50),
        p95: nearestRankPercentile(sorted, 95),
        max: sorted[sorted.length - 1],
        totalMs: sorted.reduce((sum, d) => sum + d, 0),
      }
    })
    .sort((a, b) => b.p95 - a.p95 || b.totalMs - a.totalMs || a.stage.localeCompare(b.stage))

  const mismatches = summaries
    .map((s) => diffSummary(s, turnTallies.get(s.turnId)))
    .filter((m): m is SummaryMismatch => m !== null)
  const turnsWithoutSummary = [...turnTallies.keys()].filter((id) => !summaryTurns.has(id)).length

  return {
    stageStats,
    turnsWithSpans: turnTallies.size,
    turnsWithSummary: summaryTurns.size,
    turnsWithoutSummary,
    mismatches,
    reaction: buildReactionReport(records),
    decisions: buildDecisionReport(decisions),
    endpoints: buildEndpointReport(records),
  }
}

/** The Command lines (#324) after a blank line, when there are any. */
function appendCommandLines(lines: string[], report: PerfReport, context: ReportContext): void {
  const commandLines = formatCommandReport(report.reaction, report.decisions)
  if (commandLines.length === 0) return
  lines.push('')
  if (context.decisionFileCount !== undefined) lines.push(`decision files ${context.decisionFileCount}`)
  lines.push(...commandLines)
}

export function formatPerfReport(report: PerfReport, context: ReportContext): string {
  const lines: string[] = [`perf report: ${context.logsDir}`]
  if (report.stageStats.length === 0) {
    lines.push(`no perf spans found (files ${context.fileCount}, skipped lines ${context.skippedLines})`)
    appendCommandLines(lines, report, context)
    return lines.join('\n')
  }

  const spans = report.stageStats.reduce((n, s) => n + s.count, 0)
  lines.push(
    `files ${context.fileCount} | turns ${report.turnsWithSpans} (${report.turnsWithSummary} summarized)` +
      ` | spans ${spans} | skipped lines ${context.skippedLines}`,
  )
  lines.push('')

  const headers = ['stage', 'count', 'p50', 'p95', 'max', 'total']
  const rows = report.stageStats.map((s) => [
    s.stage,
    String(s.count),
    formatMs(s.p50),
    formatMs(s.p95),
    formatMs(s.max),
    formatMs(s.totalMs),
  ])
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  lines.push(headers.map((h, i) => (i === 0 ? h.padEnd(widths[0]) : h.padStart(widths[i]))).join('  '))
  for (const row of rows) {
    lines.push(row.map((cell, i) => (i === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[i]))).join('  '))
  }

  lines.push('')
  if (report.turnsWithSummary === 0) {
    lines.push('summary self-check: no summaries in log')
  } else if (report.mismatches.length === 0) {
    lines.push(`summary self-check: ${report.turnsWithSummary}/${report.turnsWithSummary} match`)
  } else {
    const noun = report.mismatches.length === 1 ? 'mismatch' : 'mismatches'
    lines.push(`summary self-check: ${report.mismatches.length} ${noun} of ${report.turnsWithSummary} summaries`)
    for (const mismatch of report.mismatches) {
      for (const problem of mismatch.problems) lines.push(`  ${mismatch.turnId}: ${problem}`)
    }
  }
  if (report.endpoints !== null) lines.push(formatEndpointLine(report.endpoints))
  appendCommandLines(lines, report, context)
  return lines.join('\n')
}
