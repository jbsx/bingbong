import type { PerfSpanRecord } from './perfTracer'
import { NO_COUNT_BAND, TOKEN_BANDS, tokenBandOf } from './commandReport.ts'
import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The Planner half of `pnpm perf:report` (#465, ADR 0095): every
// `planner-step` span's latency by model, thinking and the host's
// prompt-token band — the bands the `decision` span got in #440 — and what
// the calls came to; and the `errand` spans (#467), how many, their steps,
// their seconds and how they ended. Only an answered call's latency is
// banded: a timeout says nothing of what its ask cost. Pure functions over
// parsed records.

export interface PlannerLatencyRow {
  readonly model: string
  readonly thinking: boolean
  readonly band: string
  readonly count: number
  readonly p50: number
  readonly p95: number
}

export interface PlannerReport {
  readonly steps: number
  readonly latency: readonly PlannerLatencyRow[]
  /** Outcome → count; an unavailable one also by its reason. */
  readonly outcomes: Readonly<Record<string, number>>
  readonly reasons: Readonly<Record<string, number>>
  readonly errands: {
    readonly count: number
    readonly steps: { readonly p50: number; readonly max: number } | null
    readonly ms: { readonly p50: number; readonly p95: number } | null
    readonly outcomes: Readonly<Record<string, number>>
  }
}

const stringOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const numberOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

function percentile(values: readonly number[], rank: number): number {
  return nearestRankPercentile([...values].sort((a, b) => a - b), rank)
}

const bump = (tally: Record<string, number>, key: string): void => {
  tally[key] = (tally[key] ?? 0) + 1
}

export function buildPlannerReport(records: readonly PerfSpanRecord[]): PlannerReport {
  const groups = new Map<string, { model: string; thinking: boolean; band: number; values: number[] }>()
  const outcomes: Record<string, number> = {}
  const reasons: Record<string, number> = {}
  let steps = 0
  const errandMs: number[] = []
  const errandSteps: number[] = []
  const errandOutcomes: Record<string, number> = {}
  for (const record of records) {
    const detail = record.detail ?? {}
    if (record.stage === 'errand') {
      errandMs.push(record.durMs)
      const count = numberOf(detail.steps)
      if (count !== undefined) errandSteps.push(count)
      bump(errandOutcomes, stringOf(detail.outcome) ?? 'unknown')
      continue
    }
    if (record.stage !== 'planner-step') continue
    steps += 1
    const outcome = stringOf(detail.outcome) ?? 'unknown'
    bump(outcomes, outcome)
    if (outcome === 'unavailable') {
      bump(reasons, stringOf(detail.reason) ?? 'unknown')
      continue
    }
    const model = stringOf(detail.model) ?? 'unknown'
    const thinking = detail.thinking === true
    const band = tokenBandOf(numberOf(detail.promptTokens))
    const key = JSON.stringify([model, thinking, band])
    const group = groups.get(key) ?? { model, thinking, band, values: [] }
    group.values.push(record.durMs)
    groups.set(key, group)
  }
  const latency = [...groups.values()]
    .sort((a, b) => a.model.localeCompare(b.model) || Number(a.thinking) - Number(b.thinking) || a.band - b.band)
    .map((group) => ({
      model: group.model,
      thinking: group.thinking,
      band: group.band === NO_COUNT_BAND ? 'no count' : TOKEN_BANDS[group.band]!.name,
      count: group.values.length,
      p50: percentile(group.values, 50),
      p95: percentile(group.values, 95),
    }))
  return {
    steps,
    latency,
    outcomes,
    reasons,
    errands: {
      count: errandMs.length,
      steps: errandSteps.length === 0 ? null : { p50: percentile(errandSteps, 50), max: Math.max(...errandSteps) },
      ms: errandMs.length === 0 ? null : { p50: percentile(errandMs, 50), p95: percentile(errandMs, 95) },
      outcomes: errandOutcomes,
    },
  }
}

/** `act 2, ask 1`: most first, then by name. */
function tallyText(tally: Readonly<Record<string, number>>): string {
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ')
}

/** The Planner lines after a blank line; none when the logs hold no Planner span. */
export function formatPlannerReport(report: PlannerReport): string[] {
  const lines: string[] = []
  if (report.latency.length > 0) {
    const headers = ['model', 'thinking', 'tokens', 'count', 'p50', 'p95']
    const rows = report.latency.map((row) => [row.model, row.thinking ? 'on' : 'off', row.band, String(row.count), formatMs(row.p50), formatMs(row.p95)])
    const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i]!.length)))
    // The three names read left, the numbers right.
    const line = (cells: string[]): string => cells.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  ')
    lines.push('planner-step latency by model, thinking and prompt tokens:', line(headers), ...rows.map(line))
  }
  if (report.steps > 0) {
    const reasons = Object.keys(report.reasons).length === 0 ? '' : ` (${tallyText(report.reasons)})`
    lines.push(`planner steps: ${report.steps} | ${tallyText(report.outcomes)}${reasons}`)
  }
  const { errands } = report
  if (errands.count > 0) {
    const steps = errands.steps === null ? 'steps unknown' : `steps p50 ${errands.steps.p50} max ${errands.steps.max}`
    const ms = errands.ms === null ? '' : ` | p50 ${formatMs(errands.ms.p50)} p95 ${formatMs(errands.ms.p95)}`
    lines.push(`errands: ${errands.count} | ${steps}${ms} | ${tallyText(errands.outcomes)}`)
  }
  return lines.length === 0 ? [] : ['', ...lines]
}
