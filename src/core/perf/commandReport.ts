import type { CommandLogRecord, CommandReading, MisfireSignal } from '../command/decisionRecord'
import type { PerfSpanRecord } from './perfTracer'
import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The Command half of `pnpm perf:report` (#324, ADR 0076): the Reaction —
// Endpoint to the action's first observable effect, the `reaction` span —
// as p50/p95 per verb, and the decision log beside it: how many Commands
// the Local Match settled, how many asked Jev and what Jev's latency was,
// and how many Misfires the next Command signalled. Early Fire (#326)
// splits the Reaction by whether the Command fired on a partial, and the
// decisions gain its share, its lead over the Endpoint, and the Jev calls
// each spoken Utterance cost. Pure functions over parsed records; the
// files are read at the main seam.

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
  /** The Reaction of Commands fired on a partial (`early`) and at the Endpoint (`endpoint`); a row is null when none was. */
  byFire: { early: ReactionStats | null; endpoint: ReactionStats | null }
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
  misfiresBySignal: Partial<Record<MisfireSignal, number>>
  /** Name Matches (ADR 0077): Slots carried as a name the page showed, or one the user taught. */
  names: { page: number; learned: number }
  /** Early Fire (#326): spoken Commands, how many fired on a partial, the lead over the Endpoint, and the Jev calls made on partials. */
  earlyFire: { spoken: number; fired: number; lead: { p50: number; p95: number } | null; partialCalls: number; spokenJevAsked: number }
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
  const early: number[] = []
  const endpoint: number[] = []
  const byVerb = new Map<string, number[]>()
  for (const record of records) {
    if (record.stage !== REACTION_STAGE) continue
    all.push(record.durMs)
    ;(record.detail?.earlyFire === true ? early : endpoint).push(record.durMs)
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
    byFire: { early: early.length === 0 ? null : statsOf('early', early), endpoint: endpoint.length === 0 ? null : statsOf('endpoint', endpoint) },
  }
}

function percentiles(values: readonly number[]): { p50: number; p95: number } | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: nearestRankPercentile(sorted, 50), p95: nearestRankPercentile(sorted, 95) }
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
    names: { page: 0, learned: 0 },
    earlyFire: { spoken: 0, fired: 0, lead: null, partialCalls: 0, spokenJevAsked: 0 },
  }
  const latencies: number[] = []
  const leads: number[] = []
  for (const record of records) {
    if (record.type === 'misfire') {
      report.misfires += 1
      report.misfiresBySignal[record.signal] = (report.misfiresBySignal[record.signal] ?? 0) + 1
      continue
    }
    report.commands += 1
    if (record.reading in report.readings) report.readings[record.reading] += 1
    if (record.slotFrom === 'page' || record.slotFrom === 'learned') report.names[record.slotFrom] += 1
    if (record.source === 'spoken') {
      report.earlyFire.spoken += 1
      if (record.jevAsked) report.earlyFire.spokenJevAsked += 1
      if (typeof record.partialCalls === 'number') report.earlyFire.partialCalls += record.partialCalls
      if (record.earlyFire !== undefined) {
        report.earlyFire.fired += 1
        if (typeof record.earlyFire.leadMs === 'number') leads.push(record.earlyFire.leadMs)
      }
    }
    if (record.jevAsked) {
      report.jevAsked += 1
      if (record.reading === 'jev') report.jevAnswered += 1
      if (record.jev !== undefined && Number.isFinite(record.jev.latencyMs)) latencies.push(record.jev.latencyMs)
    }
  }
  report.jevLatency = percentiles(latencies)
  report.earlyFire.lead = percentiles(leads)
  return report
}

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  const line = (cells: string[]): string => cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[i]))).join('  ')
  return [line(headers), ...rows.map(line)]
}

/** One table row of Reaction stats. */
function rowOf(s: ReactionStats): string[] {
  return [s.verb, String(s.count), formatMs(s.p50), formatMs(s.p95), formatMs(s.max)]
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
    const rows = [reaction.overall, ...reaction.byVerb].map(rowOf)
    lines.push(...table(['verb', 'count', 'p50', 'p95', 'max'], rows))
    const fired = [reaction.byFire.early, reaction.byFire.endpoint].filter((row): row is ReactionStats => row !== null)
    if (reaction.byFire.early !== null) {
      lines.push('', 'reaction by Early Fire:')
      lines.push(...table(['fired', 'count', 'p50', 'p95', 'max'], fired.map(rowOf)))
    }
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
    const names = decisions.names.page + decisions.names.learned
    lines.push(
      `decisions: ${decisions.commands} commands | ${jev}` +
        ` | local match ${readings.local_match}, jev ${readings.jev}, best guess ${readings.best_guess}` +
        ` | misfires ${decisions.misfires}${signals ? ` (${signals})` : ''}` +
        ` | names matched ${names}${names > 0 ? ` (page ${decisions.names.page}, learned ${decisions.names.learned})` : ''}`,
    )
    const early = decisions.earlyFire
    if (early.spoken > 0) {
      const calls = (early.spokenJevAsked + early.partialCalls) / early.spoken
      lines.push(
        `early fire: ${early.fired} of ${early.spoken} spoken (${percent(early.fired, early.spoken)})` +
          (early.lead ? `, lead p50 ${formatMs(early.lead.p50)} p95 ${formatMs(early.lead.p95)}` : '') +
          ` | jev calls per spoken utterance ${calls.toFixed(2)} (${early.partialCalls} on partials)`,
      )
    }
  }
  return lines
}
