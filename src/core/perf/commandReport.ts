import type { CommandLogRecord, CommandReading } from '../command/decisionRecord'
import type { PerfSpanRecord } from './perfTracer'
import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The Command half of `pnpm perf:report` (#324, ADR 0076): the Reaction —
// Endpoint to the action's first observable effect, the `reaction` span —
// as p50/p95 per verb, and the decision log beside it: how many Commands
// the Local Match settled, how many asked Jev and what Jev's latency was,
// and how many Misfires the next Command signalled. Pure functions over
// parsed records; the files are read at the main seam.

const REACTION_STAGE = 'reaction'

export interface ReactionStats {
  /** The Command's verb, or `all` for the overall row. */
  verb: string
  count: number
  p50: number
  p95: number
  max: number
}

export interface ReactionReport {
  /** Every Reaction, one row; null when the log holds none. */
  overall: ReactionStats | null
  /** One row per verb: count-descending, then name. */
  byVerb: ReactionStats[]
}

export interface DecisionReport {
  /** Commands recorded (decision records). */
  commands: number
  readings: Record<CommandReading, number>
  /** Commands that made a Jev call, answered or not. */
  jevAsked: number
  /** Jev calls that answered. */
  jevAnswered: number
  /** Over every Jev call made; null when none was. */
  jevLatency: { p50: number; p95: number } | null
  misfires: number
  /** Misfires by the signal that recorded them. */
  misfiresBySignal: Record<string, number>
}

function statsOf(verb: string, durations: readonly number[]): ReactionStats {
  const sorted = [...durations].sort((a, b) => a - b)
  return {
    verb,
    count: sorted.length,
    p50: nearestRankPercentile(sorted, 50),
    p95: nearestRankPercentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

/** The verb a `reaction` span recorded; `unknown` for one without. */
function verbOf(record: PerfSpanRecord): string {
  const verb = record.detail?.verb
  return typeof verb === 'string' && verb !== '' ? verb : 'unknown'
}

export function buildReactionReport(records: readonly PerfSpanRecord[]): ReactionReport {
  const all: number[] = []
  const byVerb = new Map<string, number[]>()
  for (const record of records) {
    if (record.stage !== REACTION_STAGE) continue
    all.push(record.durMs)
    const verb = verbOf(record)
    const durations = byVerb.get(verb)
    if (durations === undefined) byVerb.set(verb, [record.durMs])
    else durations.push(record.durMs)
  }
  return {
    overall: all.length === 0 ? null : statsOf('all', all),
    byVerb: [...byVerb.entries()]
      .map(([verb, durations]) => statsOf(verb, durations))
      .sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb)),
  }
}

export function buildDecisionReport(records: readonly CommandLogRecord[]): DecisionReport {
  const report: DecisionReport = {
    commands: 0,
    readings: { local_match: 0, jev: 0, best_guess: 0 },
    jevAsked: 0,
    jevAnswered: 0,
    jevLatency: null,
    misfires: 0,
    misfiresBySignal: {},
  }
  const latencies: number[] = []
  for (const record of records) {
    if (record.type === 'misfire') {
      report.misfires += 1
      report.misfiresBySignal[record.signal] = (report.misfiresBySignal[record.signal] ?? 0) + 1
      continue
    }
    report.commands += 1
    if (record.reading in report.readings) report.readings[record.reading] += 1
    if (record.jevAsked) {
      report.jevAsked += 1
      if (record.reading === 'jev') report.jevAnswered += 1
      if (record.jev !== undefined && Number.isFinite(record.jev.latencyMs)) latencies.push(record.jev.latencyMs)
    }
  }
  if (latencies.length > 0) {
    const sorted = latencies.sort((a, b) => a - b)
    report.jevLatency = { p50: nearestRankPercentile(sorted, 50), p95: nearestRankPercentile(sorted, 95) }
  }
  return report
}

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  const line = (cells: string[]): string => cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[i]))).join('  ')
  return [line(headers), ...rows.map(line)]
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`
}

/**
 * The report's Command lines: the Reaction table by verb, then one
 * decisions line. Empty when the logs hold neither a Reaction nor a
 * decision record.
 */
export function formatCommandReport(reaction: ReactionReport, decisions: DecisionReport): string[] {
  const lines: string[] = []
  if (reaction.overall !== null) {
    lines.push('reaction (Endpoint to first effect), by verb:')
    const rows = [reaction.overall, ...reaction.byVerb].map((s) => [s.verb, String(s.count), formatMs(s.p50), formatMs(s.p95), formatMs(s.max)])
    lines.push(...table(['verb', 'count', 'p50', 'p95', 'max'], rows))
  }
  if (decisions.commands > 0 || decisions.misfires > 0) {
    if (lines.length > 0) lines.push('')
    const { readings } = decisions
    const jev =
      decisions.jevAsked === 0
        ? 'jev asked 0'
        : `jev asked ${decisions.jevAsked} (${percent(decisions.jevAsked, decisions.commands)}), answered ${decisions.jevAnswered}` +
          (decisions.jevLatency ? `, latency p50 ${formatMs(decisions.jevLatency.p50)} p95 ${formatMs(decisions.jevLatency.p95)}` : '')
    const signals = Object.entries(decisions.misfiresBySignal)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([signal, count]) => `${signal} ${count}`)
      .join(', ')
    lines.push(
      `decisions: ${decisions.commands} commands | ${jev}` +
        ` | local match ${readings.local_match}, jev ${readings.jev}, best guess ${readings.best_guess}` +
        ` | misfires ${decisions.misfires}${signals ? ` (${signals})` : ''}`,
    )
  }
  return lines
}
