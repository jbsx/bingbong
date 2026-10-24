import type { CommandLogRecord, CommandReading, MisfireSignal, TaskEnded } from '../command/decisionRecord'
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
const FIRST_SOUND_STAGE = 'tts-first-sound'

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
  /** One row per verb: count-descending, then name. A read that was spoken is its own row, `read (spoken)` (#327). */
  byVerb: ReactionStats[]
  /** The Reaction of Commands fired on a partial (`early`) and at the Endpoint (`endpoint`); a row is null when none was. */
  byFire: { early: ReactionStats | null; endpoint: ReactionStats | null }
  /** The `tts-first-sound` spans (#327): speak call to the first sample handed to the player; null when none. */
  firstSound: ReactionStats | null
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
  /** The calls a host refused (#406), by HTTP status: a 422 is a card over the host's prompt. */
  jevRefused: Record<number, number>
  /** The hosts' own token counts over the answered calls that carry one (#406, ADR 0088); null when none does. */
  jevInputTokens: { p50: number; max: number } | null
  misfires: number
  /** Misfires by the signal that recorded them. */
  misfiresBySignal: Partial<Record<MisfireSignal, number>>
  /** Name Matches (ADR 0077): Slots carried as a name the page showed, or one the user taught. */
  names: { page: number; learned: number }
  /** Early Fire (#326): spoken Commands, how many fired on a partial, the lead over the Endpoint, and the Jev calls made on partials. */
  earlyFire: { spoken: number; fired: number; lead: { p50: number; p95: number } | null; partialCalls: number; spokenJevAsked: number }
  /**
   * Tasks (#328): one per Utterance, its hops' records sharing its id —
   * one per Step of a line read as Steps (#364) — how each ended, how many
   * hops it took, the overruns counted against each hop number, and how
   * many lines split into Steps.
   */
  tasks: { count: number; ended: Partial<Record<TaskEnded, number>>; hops: { p50: number; max: number } | null; overrunsByHop: Record<number, number>; split: number }
  /** `play` searches (#345): how many opened a remembered video, the results page skipped, and how many searched. */
  picks: { remembered: number; searched: number }
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

/**
 * The row a `reaction` span counts in: its verb, `unknown` for one without;
 * a Reaction closed on the first spoken sample is its verb's own row, so a
 * spoken `read` stands beside the `display` one it replaced (#327).
 */
function verbOf(record: PerfSpanRecord): string {
  const verb = record.detail?.verb
  const named = typeof verb === 'string' && verb !== '' ? verb : 'unknown'
  return record.detail?.effect === 'spoken' ? `${named} (spoken)` : named
}

export function buildReactionReport(records: readonly PerfSpanRecord[]): ReactionReport {
  const all: number[] = []
  const early: number[] = []
  const endpoint: number[] = []
  const firstSound: number[] = []
  const byVerb = new Map<string, number[]>()
  for (const record of records) {
    if (record.stage === FIRST_SOUND_STAGE) firstSound.push(record.durMs)
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
    firstSound: firstSound.length === 0 ? null : statsOf(FIRST_SOUND_STAGE, firstSound),
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
    jevRefused: {},
    jevInputTokens: null,
    misfires: 0,
    misfiresBySignal: {},
    names: { page: 0, learned: 0 },
    earlyFire: { spoken: 0, fired: 0, lead: null, partialCalls: 0, spokenJevAsked: 0 },
    tasks: { count: 0, ended: {}, hops: null, overrunsByHop: {}, split: 0 },
    picks: { remembered: 0, searched: 0 },
  }
  const latencies: number[] = []
  const tokens: number[] = []
  const leads: number[] = []
  /** Each Task's hop count, by its id and, in a line read as Steps, its Step. */
  const taskHops = new Map<string, number>()
  /** The lines read as Steps, by their id. */
  const splitLines = new Set<string>()
  for (const record of records) {
    if (record.type === 'misfire') {
      report.misfires += 1
      report.misfiresBySignal[record.signal] = (report.misfiresBySignal[record.signal] ?? 0) + 1
      if (record.signal === 'overrun' && typeof record.hop === 'number') report.tasks.overrunsByHop[record.hop] = (report.tasks.overrunsByHop[record.hop] ?? 0) + 1
      continue
    }
    // A Flag (#421) is the user's word on a Task, no Command: `pnpm bugs:candidates` reads it.
    if (record.type === 'flag' || record.type === 'site_answer') continue
    report.commands += 1
    if (record.task !== undefined) {
      const key = record.task.step === undefined ? record.task.id : `${record.task.id}#${record.task.step}`
      taskHops.set(key, Math.max(taskHops.get(key) ?? 0, record.task.hop + 1))
      if ((record.task.of ?? 1) > 1) splitLines.add(record.task.id)
    }
    if (record.ended !== undefined) report.tasks.ended[record.ended] = (report.tasks.ended[record.ended] ?? 0) + 1
    if (record.reading in report.readings) report.readings[record.reading] += 1
    if (record.slotFrom === 'page' || record.slotFrom === 'learned') report.names[record.slotFrom] += 1
    if (record.pick === 'remembered' || record.pick === 'searched') report.picks[record.pick] += 1
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
      if (record.jev !== undefined && 'httpStatus' in record.jev && typeof record.jev.httpStatus === 'number') report.jevRefused[record.jev.httpStatus] = (report.jevRefused[record.jev.httpStatus] ?? 0) + 1
      if (record.jev !== undefined && 'inputTokens' in record.jev && typeof record.jev.inputTokens === 'number') tokens.push(record.jev.inputTokens)
    }
  }
  report.jevLatency = percentiles(latencies)
  const sortedTokens = [...tokens].sort((a, b) => a - b)
  report.jevInputTokens = sortedTokens.length === 0 ? null : { p50: nearestRankPercentile(sortedTokens, 50), max: sortedTokens.at(-1)! }
  report.earlyFire.lead = percentiles(leads)
  report.tasks.count = taskHops.size
  report.tasks.split = splitLines.size
  const hops = [...taskHops.values()].sort((a, b) => a - b)
  report.tasks.hops = hops.length === 0 ? null : { p50: nearestRankPercentile(hops, 50), max: hops[hops.length - 1]! }
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

/** The refusals by status (#406): ` | jev refused 2 (422 2)`; nothing when none. */
function refusedText(refused: Record<number, number>): string {
  const byStatus = Object.entries(refused).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
  if (byStatus.length === 0) return ''
  const total = byStatus.reduce((sum, [, count]) => sum + count, 0)
  return ` | jev refused ${total} (${byStatus.map(([status, count]) => `${status} ${count}`).join(', ')})`
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
  if (reaction.overall !== null || reaction.firstSound !== null) {
    lines.push('reaction (Endpoint to first effect), by verb:')
    // The speech rows beside it (#327): the speak call to the first spoken sample.
    const stats = [...(reaction.overall ? [reaction.overall] : []), ...reaction.byVerb, ...(reaction.firstSound ? [reaction.firstSound] : [])]
    lines.push(...table(['verb', 'count', 'p50', 'p95', 'max'], stats.map(rowOf)))
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
          (decisions.jevLatency ? `, latency p50 ${formatMs(decisions.jevLatency.p50)} p95 ${formatMs(decisions.jevLatency.p95)}` : '') +
          refusedText(decisions.jevRefused) +
          (decisions.jevInputTokens ? ` | input tokens p50 ${decisions.jevInputTokens.p50} max ${decisions.jevInputTokens.max}` : '')
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
    const { tasks } = decisions
    if (tasks.count > 0) {
      const ended = Object.entries(tasks.ended)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([how, count]) => `${how} ${count}`)
        .join(', ')
      const overruns = Object.entries(tasks.overrunsByHop)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([hop, count]) => `hop ${hop} ${count}`)
        .join(', ')
      lines.push(
        `tasks: ${tasks.count} | ended ${ended || 'none recorded'}` +
          (tasks.hops ? ` | hops p50 ${tasks.hops.p50}, max ${tasks.hops.max}` : '') +
          ` | overruns by hop: ${overruns || 'none'}` +
          (tasks.split > 0 ? ` | lines split into Steps: ${tasks.split}` : ''),
      )
    }
    const { picks } = decisions
    const picked = picks.remembered + picks.searched
    if (picked > 0) lines.push(`songs: ${picked} picks | remembered ${picks.remembered} (${percent(picks.remembered, picked)}), searched ${picks.searched}`)
  }
  return lines
}
