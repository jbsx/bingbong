import type { CommandLogRecord, CommandReading, DecisionRecord, JevDetail, JevUnavailable, MisfireSignal, TaskEnded } from '../command/decisionRecord'
import type { PerfSpanRecord } from './perfTracer'
import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The Command half of `pnpm perf:report` (#324, ADR 0076): the Reaction —
// Endpoint to the action's first observable effect, the `reaction` span —
// as p50/p95 per verb, and the decision log beside it: how many Commands
// the Local Match settled, how many asked Jev and what Jev's latency was,
// and how many Misfires the next Command signalled. Early Fire (#326)
// splits the Reaction by whether the Command fired on a partial, and the
// decisions gain its share, its lead over the Endpoint, and the Jev calls
// each spoken Utterance cost (`partialCalls`, written before #477 and
// still read). The asks that fell over to a Fallback Host (#477) stand
// beside the refusals. The Felt Reaction (reliability.md) by Tier and by
// road, and the Appliance Card's own call (#485) in every per-call count.
// Pure functions over parsed records; the files are read at the main seam.

const REACTION_STAGE = 'reaction'
const FIRST_SOUND_STAGE = 'tts-first-sound'
const END_OF_SPEECH_STAGE = 'end-of-speech'

/** A Tier of reliability.md: the Felt Reaction promise a line is held to. */
export type Tier = 'Instant' | 'Quick' | 'Task'

/** How a line was read (#485): the Local Match's exact line, the Appliance Card, the page card, or the best guess. */
export type Road = 'exact' | 'appliance' | 'page' | 'best guess'

const TIERS: readonly Tier[] = ['Instant', 'Quick', 'Task']
const ROADS: readonly Road[] = ['exact', 'appliance', 'page', 'best guess']

/**
 * A decision's Tier (#485), from reliability.md's table: Instant is
 * control, read (scroll), back, stop; Quick is open, search, play; Task is
 * question and Errand. The verbs the table does not name are a guess,
 * cheapest to reverse: `forward`, `press`, `reload`, `app`, `timer`, `help`
 * and `clear` beside back and stop; `resume`, `click`, `type`, `menu` and
 * `capture` beside open; anything else a Task.
 */
export function tierOf(record: Pick<DecisionRecord, 'verb' | 'music'>): Tier {
  switch (record.verb) {
    case 'play':
      return record.music?.kind === 'search' ? 'Quick' : 'Instant'
    case 'media':
    case 'scroll_up':
    case 'scroll_down':
    case 'back':
    case 'forward':
    case 'stop':
    case 'press':
    case 'reload':
    case 'app':
    case 'timer':
    case 'help':
    case 'clear':
      return 'Instant'
    case 'navigate':
    case 'search':
    case 'resume':
    case 'click':
    case 'type':
    case 'menu':
    case 'capture':
      return 'Quick'
    default:
      return 'Task'
  }
}

const answered = (jev: JevDetail | JevUnavailable | undefined): jev is JevDetail => jev !== undefined && !('reason' in jev)

/**
 * A decision's road (#485). The Appliance Card's host failing fires the
 * Local Match's guess (reliability.md rule 3), which reads `local_match`
 * on the record: a best guess here. A dismissal read over an answered page
 * ask is the page's. A record before #485 names no card: its Jev reading
 * is the page card's.
 */
export function roadOf(record: Pick<DecisionRecord, 'reading' | 'card' | 'jevAsked' | 'jev'>): Road {
  if (record.reading === 'best_guess') return 'best guess'
  if (record.card === 'appliance') return record.reading === 'jev' ? 'appliance' : 'best guess'
  if (record.reading === 'jev' || (record.jevAsked && answered(record.jev))) return 'page'
  return record.jevAsked ? 'best guess' : 'exact'
}

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
  /** The Reactions that say when they fired, split there: the read and the ask, then the action's own wait; null when none says. */
  split: { toFire: ReactionStats; afterFire: ReactionStats } | null
  /**
   * The Reaction by how its line was read (#440): `local match` when no
   * ask was made, else the turn's last ask as `jev <model>` when it
   * answered (whatever then fired, a dismissal too) or `unanswered <model>`;
   * a row's `verb` is that reading. Count-descending; a span with
   * no decision record of its turn counts in none.
   */
  byReading: ReactionStats[]
  /**
   * The Felt Reaction (reliability.md, #485): a spoken turn's
   * `end-of-speech` span plus its `reaction` span, joined on the turn id,
   * by Tier and by road; a row's `verb` is the Tier or the road, rows with
   * none left out. One per turn: its first hop 0 record that is no Where
   * or Mark Ask. `noEndOfSpeech` counts the spoken turns with a Reaction
   * and no `end-of-speech` span (an Early Fire has no Endpoint of its
   * own), counted in no row. Null when no turn joined.
   */
  felt: { byTier: ReactionStats[]; byRoad: ReactionStats[]; noEndOfSpeech: number } | null
}

/** One model's calls in one band of the host's input-token count (#440), on one card (#485). */
export interface TokenBandStats {
  /** The Appliance Card's calls apart from every other (#485); a record before it is the page card's. */
  card: 'appliance' | 'page'
  model: string
  /** `< 1.5k`, `1.5–3k`, `3–6k`, `6k+`, or `no count` for calls the host gave no count for. */
  band: string
  count: number
  p50: number
  p95: number
}

export interface DecisionReport {
  /** Commands recorded (decision records). */
  commands: number
  readings: Record<CommandReading, number>
  /** Commands that made a Jev call, answered or not. */
  jevAsked: number
  /** Every Jev call the records name (#485): each asking record's own, and the Appliance Card's ask before a page-card reading. */
  asks: number
  /** Jev calls that answered. */
  jevAnswered: number
  /** Over every Jev call made, the Appliance Card's too (#485); null when none was. */
  jevLatency: { p50: number; p95: number } | null
  /** The calls a host refused (#406), by HTTP status: a 422 is a card over the host's prompt. Over every attempt (#477), the Appliance Card's too (#485): a refusal a fallback then answered counts here too. */
  jevRefused: Record<number, number>
  /** The asks that fell over to a Fallback Host (#477): the live host failed and a second attempt was made; how many a fallback then answered. */
  fellOver: { count: number; answered: number }
  /** The hosts' own token counts over the answered calls that carry one (#406, ADR 0088); null when none does. */
  jevInputTokens: { p50: number; max: number } | null
  /** Every answered call's latency by model, then by token band (#440): models by call count, bands smallest first, `no count` last. */
  jevLatencyByTokens: TokenBandStats[]
  misfires: number
  /** Misfires by the signal that recorded them. */
  misfiresBySignal: Partial<Record<MisfireSignal, number>>
  /** Name Matches (ADR 0077): Slots carried as a name the page showed, or one the user taught. */
  names: { page: number; learned: number }
  /**
   * Early Fire (#326): spoken Commands, how many fired on a partial, the
   * lead over the Endpoint, and the Jev calls made on partials. The calls
   * per spoken Utterance (#485): `spokenJevAsked` counts every spoken call —
   * the Appliance Card's, the page card's, a Where and a Mark Ask's, a
   * hop's — over `utterances`, the spoken records at hop 0 that are no
   * Where or Mark Ask.
   */
  earlyFire: { spoken: number; utterances: number; fired: number; lead: { p50: number; p95: number } | null; partialCalls: number; spokenJevAsked: number }
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

/** Each turn's reading (#440): its last ask by model, `jev` when it answered and `unanswered` when not, else `local match`. */
function readingsByTurn(decisions: readonly CommandLogRecord[]): Map<string, string> {
  const readings = new Map<string, string>()
  for (const record of decisions) {
    if (record.type !== 'decision') continue
    if (record.jevAsked && record.jev !== undefined) readings.set(record.turnId, `${'reason' in record.jev ? 'unanswered' : 'jev'} ${record.jev.model}`)
    else if (!readings.has(record.turnId)) readings.set(record.turnId, 'local match')
  }
  return readings
}

function groupStats(groups: ReadonlyMap<string, number[]>): ReactionStats[] {
  return [...groups.entries()].map(([name, durations]) => statsOf(name, durations)).sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb))
}

function pushTo<K>(groups: Map<K, number[]>, key: K, value: number): void {
  const values = groups.get(key)
  if (values === undefined) groups.set(key, [value])
  else values.push(value)
}

/** Each spoken turn's first hop 0 decision that is no Where or Mark Ask (#485): the one its Tier and road are read from. */
function firstSpokenDecisions(decisions: readonly CommandLogRecord[]): Map<string, DecisionRecord> {
  const first = new Map<string, DecisionRecord>()
  for (const record of decisions) {
    if (record.type !== 'decision' || record.source !== 'spoken' || record.whereAsk === true || record.markAsk === true) continue
    if ((record.task?.hop ?? 0) !== 0 || first.has(record.turnId)) continue
    first.set(record.turnId, record)
  }
  return first
}

/** The Felt Reaction by Tier and by road (#485): `end-of-speech` + `reaction` of the same turn. */
function buildFelt(records: readonly PerfSpanRecord[], decisions: readonly CommandLogRecord[]): ReactionReport['felt'] {
  const turns = firstSpokenDecisions(decisions)
  const endOfSpeech = new Map<string, number>()
  const reactions = new Map<string, number>()
  for (const record of records) {
    if (!turns.has(record.turnId)) continue
    if (record.stage === END_OF_SPEECH_STAGE && !endOfSpeech.has(record.turnId)) endOfSpeech.set(record.turnId, record.durMs)
    if (record.stage === REACTION_STAGE && !reactions.has(record.turnId)) reactions.set(record.turnId, record.durMs)
  }
  const byTier = new Map<Tier, number[]>()
  const byRoad = new Map<Road, number[]>()
  let noEndOfSpeech = 0
  for (const [turnId, reaction] of reactions) {
    const speech = endOfSpeech.get(turnId)
    if (speech === undefined) {
      noEndOfSpeech += 1
      continue
    }
    const decision = turns.get(turnId)!
    pushTo(byTier, tierOf(decision), speech + reaction)
    pushTo(byRoad, roadOf(decision), speech + reaction)
  }
  if (byTier.size === 0) return null
  const rows = <K extends string>(order: readonly K[], groups: Map<K, number[]>): ReactionStats[] => order.flatMap((key) => (groups.has(key) ? [statsOf(key, groups.get(key)!)] : []))
  return { byTier: rows(TIERS, byTier), byRoad: rows(ROADS, byRoad), noEndOfSpeech }
}

export function buildReactionReport(records: readonly PerfSpanRecord[], decisions: readonly CommandLogRecord[] = []): ReactionReport {
  const readings = readingsByTurn(decisions)
  const byReading = new Map<string, number[]>()
  const all: number[] = []
  const early: number[] = []
  const endpoint: number[] = []
  const firstSound: number[] = []
  const byVerb = new Map<string, number[]>()
  const toFire: number[] = []
  const afterFire: number[] = []
  for (const record of records) {
    if (record.stage === FIRST_SOUND_STAGE) firstSound.push(record.durMs)
    if (record.stage !== REACTION_STAGE) continue
    all.push(record.durMs)
    const firedMs = record.detail?.firedMs
    if (typeof firedMs === 'number') {
      toFire.push(firedMs)
      afterFire.push(Math.max(0, record.durMs - firedMs))
    }
    ;(record.detail?.earlyFire === true ? early : endpoint).push(record.durMs)
    pushTo(byVerb, verbOf(record), record.durMs)
    const reading = readings.get(record.turnId)
    if (reading !== undefined) pushTo(byReading, reading, record.durMs)
  }
  return {
    overall: all.length === 0 ? null : statsOf('all', all),
    byVerb: groupStats(byVerb),
    byReading: groupStats(byReading),
    byFire: { early: early.length === 0 ? null : statsOf('early', early), endpoint: endpoint.length === 0 ? null : statsOf('endpoint', endpoint) },
    firstSound: firstSound.length === 0 ? null : statsOf(FIRST_SOUND_STAGE, firstSound),
    split: toFire.length === 0 ? null : { toFire: statsOf('Endpoint to fire', toFire), afterFire: statsOf('fire to effect', afterFire) },
    felt: buildFelt(records, decisions),
  }
}

/**
 * The input-token bands an answered call's latency is read in (#440): the
 * bands #440's audit drew, where Mammoth's p50 doubled past 6k.
 */
export const TOKEN_BANDS: readonly { name: string; below: number }[] = [
  { name: '< 1.5k', below: 1500 },
  { name: '1.5–3k', below: 3000 },
  { name: '3–6k', below: 6000 },
  { name: '6k+', below: Infinity },
]

/** The band of the answered calls the host gave no count for, after every counted one. */
export const NO_COUNT_BAND = TOKEN_BANDS.length

/** The index of the band a token count falls in; `NO_COUNT_BAND` when there is none. */
export function tokenBandOf(tokens: number | undefined): number {
  return tokens === undefined || !Number.isFinite(tokens) ? NO_COUNT_BAND : TOKEN_BANDS.findIndex((band) => tokens < band.below)
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
    asks: 0,
    jevAnswered: 0,
    jevLatency: null,
    jevRefused: {},
    fellOver: { count: 0, answered: 0 },
    jevInputTokens: null,
    jevLatencyByTokens: [],
    misfires: 0,
    misfiresBySignal: {},
    names: { page: 0, learned: 0 },
    earlyFire: { spoken: 0, utterances: 0, fired: 0, lead: null, partialCalls: 0, spokenJevAsked: 0 },
    tasks: { count: 0, ended: {}, hops: null, overrunsByHop: {}, split: 0 },
    picks: { remembered: 0, searched: 0 },
  }
  const latencies: number[] = []
  /** Each card's models' latencies by token band index (`TOKEN_BANDS`), by `<card> <model>`. */
  const byModel = new Map<string, { card: 'appliance' | 'page'; model: string; bands: Map<number, number[]> }>()
  const tokens: number[] = []
  /** One Jev call's latency, refusals, fall-over and tokens (#477, #440), on the card it was asked on (#485). */
  const countCall = (jev: JevDetail | JevUnavailable | undefined, card: 'appliance' | 'page'): void => {
    report.asks += 1
    if (jev !== undefined && Number.isFinite(jev.latencyMs)) latencies.push(jev.latencyMs)
    // A refusal is counted per attempt once the record names them (#477); a record before that names one host's.
    const attempts = jev?.attempts
    const refusals = attempts !== undefined ? attempts.filter((attempt) => attempt.outcome === 'http') : jev !== undefined && 'httpStatus' in jev ? [jev] : []
    for (const refusal of refusals) if (typeof refusal.httpStatus === 'number') report.jevRefused[refusal.httpStatus] = (report.jevRefused[refusal.httpStatus] ?? 0) + 1
    if (attempts !== undefined && attempts.length > 1) {
      report.fellOver.count += 1
      if (attempts[attempts.length - 1]!.outcome === 'answered') report.fellOver.answered += 1
    }
    const counted = jev !== undefined && 'inputTokens' in jev && typeof jev.inputTokens === 'number' ? jev.inputTokens : undefined
    if (counted !== undefined) tokens.push(counted)
    // Only an answer's latency is banded: a refusal or a timeout says nothing of what its card cost.
    if (answered(jev) && Number.isFinite(jev.latencyMs)) {
      const key = `${card} ${jev.model}`
      if (!byModel.has(key)) byModel.set(key, { card, model: jev.model, bands: new Map() })
      pushTo(byModel.get(key)!.bands, tokenBandOf(counted), jev.latencyMs)
    }
  }
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
    // An Errand (#467) is its own record, its steps no Commands of the Decision Model's: the `errand` span counts it.
    if (record.type === 'flag' || record.type === 'site_answer' || record.type === 'errand') continue
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
    // The Appliance Card's ask that sent a page-card reading on is a call of its own (#485), on the record that read the line.
    const appliance = record.appliance !== undefined && record.whereAsk !== true && record.markAsk !== true ? record.appliance : undefined
    if (record.source === 'spoken') {
      report.earlyFire.spoken += 1
      if ((record.task?.hop ?? 0) === 0 && record.whereAsk !== true && record.markAsk !== true) report.earlyFire.utterances += 1
      if (record.jevAsked) report.earlyFire.spokenJevAsked += 1
      if (appliance !== undefined) report.earlyFire.spokenJevAsked += 1
      if (typeof record.partialCalls === 'number') report.earlyFire.partialCalls += record.partialCalls
      if (record.earlyFire !== undefined) {
        report.earlyFire.fired += 1
        if (typeof record.earlyFire.leadMs === 'number') leads.push(record.earlyFire.leadMs)
      }
    }
    if (appliance !== undefined) countCall(appliance.jev, 'appliance')
    if (record.jevAsked) {
      report.jevAsked += 1
      if (record.reading === 'jev') report.jevAnswered += 1
      countCall(record.jev, record.card === 'appliance' ? 'appliance' : 'page')
    }
  }
  report.jevLatency = percentiles(latencies)
  // The page card's rows first (#485), then the Appliance Card's; within a card, models by call count.
  report.jevLatencyByTokens = [...byModel.values()]
    .map(({ card, model, bands }) => ({ card, model, bands, calls: [...bands.values()].reduce((n, values) => n + values.length, 0) }))
    .sort((a, b) => (a.card === b.card ? 0 : a.card === 'page' ? -1 : 1) || b.calls - a.calls || a.model.localeCompare(b.model))
    .flatMap(({ card, model, bands }) =>
      [...bands.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([band, values]) => ({ card, model, band: TOKEN_BANDS[band]?.name ?? 'no count', count: values.length, ...percentiles(values)! })),
    )
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

/** The asks that fell over to a Fallback Host (#477), always printed beside the refusals: ` | fell over 3 (answered by a fallback 2)`, ` | fell over 0` when none did. */
function fellOverText(fell: { count: number; answered: number }): string {
  return fell.count === 0 ? ' | fell over 0' : ` | fell over ${fell.count} (answered by a fallback ${fell.answered})`
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
    if (reaction.split !== null) {
      // The read and the ask before the action fires, apart from the action's own wait.
      lines.push('', 'reaction split:')
      lines.push(...table(['part', 'count', 'p50', 'p95', 'max'], [reaction.split.toFire, reaction.split.afterFire].map(rowOf)))
    }
    if (reaction.byReading.length > 0) {
      lines.push('', 'reaction by reading:')
      lines.push(...table(['reading', 'count', 'p50', 'p95', 'max'], reaction.byReading.map(rowOf)))
    }
  }
  if (reaction.felt !== null) {
    // The Felt Reaction (reliability.md, #485): the promises are set on it, by Tier, and the road each line took.
    const feltRow = (s: ReactionStats): string[] => [s.verb, String(s.count), formatMs(s.p50), formatMs(s.p95)]
    if (lines.length > 0) lines.push('')
    lines.push(`felt reaction (end of speech to first effect), spoken turns${reaction.felt.noEndOfSpeech > 0 ? `, ${reaction.felt.noEndOfSpeech} without an end-of-speech span left out` : ''}:`)
    lines.push(...table(['tier', 'n', 'p50', 'p95'], reaction.felt.byTier.map(feltRow)), '')
    lines.push(...table(['road', 'n', 'p50', 'p95'], reaction.felt.byRoad.map(feltRow)))
  }
  if (decisions.commands > 0 || decisions.misfires > 0) {
    if (lines.length > 0) lines.push('')
    if (decisions.jevLatencyByTokens.length > 0) {
      lines.push('jev latency by input tokens:')
      lines.push(
        ...table(
          ['model', 'card', 'tokens', 'count', 'p50', 'p95'],
          decisions.jevLatencyByTokens.map((s) => [s.model, s.card, s.band, String(s.count), formatMs(s.p50), formatMs(s.p95)]),
        ),
        '',
      )
    }
    const { readings } = decisions
    const jev =
      decisions.jevAsked === 0
        ? 'jev asked 0'
        : `jev asked ${decisions.jevAsked} (${percent(decisions.jevAsked, decisions.commands)}), answered ${decisions.jevAnswered}` +
          (decisions.jevLatency ? `, latency p50 ${formatMs(decisions.jevLatency.p50)} p95 ${formatMs(decisions.jevLatency.p95)}` : '') +
          refusedText(decisions.jevRefused) +
          fellOverText(decisions.fellOver) +
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
    if (decisions.asks > 0) {
      // Every refused attempt over every ask (#485), the Appliance Card's included.
      const refused = Object.values(decisions.jevRefused).reduce((sum, count) => sum + count, 0)
      lines.push(`refusals per 100 asks: ${((refused / decisions.asks) * 100).toFixed(1)} (${refused} refused attempts over ${decisions.asks} asks)`)
    }
    const early = decisions.earlyFire
    if (early.spoken > 0) {
      const calls = (early.spokenJevAsked + early.partialCalls) / Math.max(1, early.utterances)
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
