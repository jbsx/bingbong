import { nearestRankPercentile } from '../../src/core/report/stats.ts'
import type { EffortTier } from '../../src/core/pipeline/runPlan.ts'
import { decisionSeamsLabel } from '../live/launchRouting.ts'
import { buildPool, canonicalJson, POOL_SIZE, type CaptureProvenance, type CapturePool } from './acceptance.ts'
import type { EvalReport, ScenarioResult } from './evaluator'
import { aggregateDecisions, type DecisionAggregate, type ScenarioMetrics } from './metrics.ts'
import type { RoleRouting } from './routing'
import { evalScenarios, type EvalScenario } from './scenarios.ts'

// `pnpm eval:compare` (#279): two pools of release-evaluator captures from
// one commit, compared on the corpus both cover, and printed in the order
// of the #274 gate. `eval:accept` cannot do this — it compares a candidate
// with the pool pinned at the pre-#114 commit and refuses any other
// baseline — and the Decision Model experiment's arms are two candidates of
// the same commit that differ in one thing: whether the decision role is
// configured. So each side is validated exactly as `eval:accept` validates
// one (buildPool: three finalized captures, one commit, the real-model
// witness, one routing contract, one corpus order), and across the sides
// only the decision role and the seam list may differ.
//
// Every statistic is nearest-rank over the pooled observations — Runs for
// time and rounds, scenarios for successes, Decision Records for latency —
// never an average of pass percentiles. A Run's tier is the one the corpus
// of record declares for it (e2e/eval/scenarios.ts), never the tier the
// model declared: the tier seam (#278) is one of the things under test, so
// letting it move Runs between populations would let the treatment choose
// its own comparison.
//
// The on arm is the side whose captures configure the decision role; with
// both or neither configured the numbers are printed and no gate verdict is.
// Agreement is printed as a row saying where it comes from, because a
// Decision Record carries no model pick (the coordinator's #279 decision).
//
// Runtime imports carry `.ts`: the script runs this under Node's type
// stripping, like eval:accept.

export const COMPARE_KIND = 'bingbong.eval.compare'
export const COMPARE_VERSION = 1

/** The tiers a comparison reports, in the gate's order. */
const TIERS: readonly EffortTier[] = ['direct_action', 'lookup', 'investigation']
/** The tiers #274's gate judges; Investigation is reported, never gated. */
const GATED_TIERS: ReadonlySet<EffortTier> = new Set(['direct_action', 'lookup'])

export type Arm = 'a' | 'b'

/** Nearest-rank over a population; null medians when it is empty. */
export interface PooledStat {
  /** Observations in the population. */
  n: number
  /** Observations without a value (a Run with no command-to-Answer time), left out of the stats. */
  missing: number
  median: number | null
  p95: number | null
}

export interface ArmWitness {
  /** The directory the captures were read from. */
  source: string
  captures: CaptureProvenance[]
  /** The decision role as the captures recorded it, or `not recorded` for captures taken before #279. */
  decision: RoleRouting | 'not recorded'
  /** The forwarded seam list, null when unset, or `not recorded` before #279. */
  decisionSeams: string | null | 'not recorded'
  scenarioObservations: number
  comparedObservations: number
}

export interface GateLine {
  name: string
  gated: boolean
  /** Null when the line is reported only, or no on arm could be told apart. */
  passed: boolean | null
  detail: string
}

export interface Comparison {
  kind: typeof COMPARE_KIND
  compareVersion: typeof COMPARE_VERSION
  comparedAt: string
  commit: string
  sharedCorpus: { size: number; scenarioIds: string[]; aOnly: string[]; bOnly: string[] }
  arms: Record<Arm, ArmWitness>
  /** The side with the decision role configured, or null when that does not tell them apart. */
  onArm: Arm | null
  /** Command-to-Answer milliseconds per Run, per corpus-declared tier and over the gated tiers together. */
  commandToAnswerMs: { perTier: Record<EffortTier, Record<Arm, PooledStat>>; gated: Record<Arm, PooledStat> }
  /**
   * Scenario successes per corpus-declared tier and over the gated tiers
   * together. A scenario counts under its initial tier while each of its
   * Runs is timed under its own; every follow-up in the corpus declares its
   * initial tier today, so the two populations coincide.
   */
  successes: { perTier: Record<EffortTier, Record<Arm, { succeeded: number; scenarios: number }>>; gated: Record<Arm, { succeeded: number; scenarios: number }> }
  /**
   * Runs whose Answer was the deterministic fallback: over the gated tiers'
   * Runs, which the veto judges ("on Direct Action and Lookup" scopes both of
   * gate 2's clauses, as Investigation is never gated), and over every
   * compared Run, reported.
   */
  deterministicAnswers: { gated: Record<Arm, { count: number; runs: number }>; all: Record<Arm, { count: number; runs: number }> }
  /** LLM rounds per Run, per corpus-declared tier. */
  roundsPerRun: Record<EffortTier, Record<Arm, PooledStat>>
  /** Decision Records pooled over each side's compared Runs; null when its captures predate #279. */
  decisions: Record<Arm, (DecisionAggregate & { runs: number }) | null>
  /** Where agreement comes from — it is not derivable from an eval capture. */
  agreement: string
  /** The #274 gate, in its order. */
  gate: GateLine[]
}

/** The agreement row, worded as the #279 decision set it. */
export const AGREEMENT_NOTE =
  'not derivable from an eval capture (a Decision Record carries no model pick); passage and result agreement come from pnpm decision:shadow over retained traces, tier agreement from the Round Audit join (#278). The live 3+3 capture retains Run Traces, so the replay over its jev-off arm gives agreement on the live corpus; the eval arm gives none.'

/** One Run as a comparison reads it: its metrics and the tier the corpus declares for it. */
interface TieredRun {
  tier: EffortTier
  metrics: ScenarioMetrics
}

function statOf(values: readonly (number | null)[]): PooledStat {
  const present = values.filter((value): value is number => value !== null).sort((left, right) => left - right)
  return {
    n: values.length,
    missing: values.length - present.length,
    median: present.length === 0 ? null : nearestRankPercentile(present, 50),
    p95: present.length === 0 ? null : nearestRankPercentile(present, 95),
  }
}

/** The tier the corpus declares for each Run of a scenario, in run order. */
function declaredRunTiers(scenario: EvalScenario): EffortTier[] {
  const effort = scenario.expectedEffort
  return scenario.followUp === undefined ? [effort.tier] : [effort.tier, effort.followUpTier ?? effort.tier]
}

/** The routing a side holds fixed against the other: every role but the decision role. */
function agentRouting(routing: EvalReport['routing']): string {
  return canonicalJson({ orchestrator: routing.orchestrator, subagent: routing.subagent, vision: routing.vision })
}

function sharedCorpusOf(a: CapturePool, b: CapturePool): Comparison['sharedCorpus'] {
  const aIds = new Set(a.scenarioIds)
  const bIds = new Set(b.scenarioIds)
  const scenarioIds = a.scenarioIds.filter((id) => bIds.has(id))
  if (scenarioIds.length === 0) throw new Error('the two pools share no scenarios — a comparison needs a corpus both sides observed')
  if (scenarioIds.join('\n') !== b.scenarioIds.filter((id) => aIds.has(id)).join('\n')) {
    throw new Error('the shared scenarios appear in a different order on the two sides — the pools are not the same corpus lineage')
  }
  return { size: scenarioIds.length, scenarioIds, aOnly: a.scenarioIds.filter((id) => !bIds.has(id)), bOnly: b.scenarioIds.filter((id) => !aIds.has(id)) }
}

function decisionOf(reports: readonly EvalReport[]): ArmWitness['decision'] {
  return reports[0]!.routing.decision ?? 'not recorded'
}

function decisionSeamsOf(reports: readonly EvalReport[]): ArmWitness['decisionSeams'] {
  const seams = reports[0]!.modelWitness.decisionSeams
  return seams === undefined ? 'not recorded' : seams
}

/**
 * Compare two pools (#279). Throws — broken input, for the script to
 * surface — on unequal pool sizes, anything buildPool refuses on either
 * side, two commits, a difference in anything but the decision role and the
 * seam list, or a corpus the two sides do not share.
 */
export function comparePools(
  a: { source: string; reports: readonly EvalReport[] },
  b: { source: string; reports: readonly EvalReport[] },
  comparedAt: Date = new Date(),
): Comparison {
  if (a.reports.length !== b.reports.length || a.reports.length !== POOL_SIZE) {
    throw new Error(
      `the pools hold ${a.reports.length} and ${b.reports.length} capture(s) — a comparison needs ${POOL_SIZE} on each side, from one commit`,
    )
  }
  const poolA = buildPool('a', a.reports)
  const poolB = buildPool('b', b.reports)
  const commitA = poolA.captures[0]!.commit
  const commitB = poolB.captures[0]!.commit
  if (commitA !== commitB) {
    throw new Error(`the pools come from two commits (a ${commitA.slice(0, 7)}, b ${commitB.slice(0, 7)}) — both arms must be captured from one commit`)
  }
  if (agentRouting(poolA.routing) !== agentRouting(poolB.routing)) {
    throw new Error('the pools differ in orchestrator, subagent or vision routing — only the decision role and the seam list may differ between arms')
  }
  if (poolA.reasoningEffort !== poolB.reasoningEffort) {
    throw new Error(`the pools ran at different reasoning-effort contracts (a ${poolA.reasoningEffort}, b ${poolB.reasoningEffort}) — only the decision role and the seam list may differ between arms`)
  }
  const shared = sharedCorpusOf(poolA, poolB)
  const corpus = new Map(evalScenarios().map((scenario) => [scenario.id, scenario]))
  const outside = shared.scenarioIds.find((id) => !corpus.has(id))
  if (outside !== undefined) throw new Error(`the corpus of record does not define ${outside} — a Run's tier comes from e2e/eval/scenarios.ts`)

  const sharedIds = new Set(shared.scenarioIds)
  const scenariosOf = (pool: CapturePool): ScenarioResult[] => pool.scenarios.filter((scenario) => sharedIds.has(scenario.id))
  const runsOf = (scenarios: readonly ScenarioResult[]): TieredRun[] =>
    scenarios.flatMap((scenario) => {
      const tiers = declaredRunTiers(corpus.get(scenario.id)!)
      // An artifact without per-run telemetry reads as one combined Run.
      const runs = scenario.runs.length > 0 ? scenario.runs : [scenario.metrics]
      return runs.map((metrics, index) => ({ tier: tiers[index] ?? tiers[tiers.length - 1]!, metrics }))
    })
  const scenarios: Record<Arm, ScenarioResult[]> = { a: scenariosOf(poolA), b: scenariosOf(poolB) }
  const runs: Record<Arm, TieredRun[]> = { a: runsOf(scenarios.a), b: runsOf(scenarios.b) }
  const scenarioTier = (scenario: ScenarioResult): EffortTier => corpus.get(scenario.id)!.expectedEffort.tier

  const perArm = <T>(pick: (arm: Arm) => T): Record<Arm, T> => ({ a: pick('a'), b: pick('b') })
  const perTier = <T>(pick: (tier: EffortTier) => T): Record<EffortTier, T> =>
    Object.fromEntries(TIERS.map((tier) => [tier, pick(tier)])) as Record<EffortTier, T>
  const successCount = (list: readonly ScenarioResult[]) => ({ succeeded: list.filter((scenario) => scenario.success).length, scenarios: list.length })

  const commandToAnswerMs: Comparison['commandToAnswerMs'] = {
    perTier: perTier((tier) => perArm((arm) => statOf(runs[arm].filter((run) => run.tier === tier).map((run) => run.metrics.elapsedMs)))),
    gated: perArm((arm) => statOf(runs[arm].filter((run) => GATED_TIERS.has(run.tier)).map((run) => run.metrics.elapsedMs))),
  }
  const successes: Comparison['successes'] = {
    perTier: perTier((tier) => perArm((arm) => successCount(scenarios[arm].filter((scenario) => scenarioTier(scenario) === tier)))),
    gated: perArm((arm) => successCount(scenarios[arm].filter((scenario) => GATED_TIERS.has(scenarioTier(scenario))))),
  }
  const fallbackCount = (list: readonly TieredRun[]) => ({ count: list.filter((run) => run.metrics.deterministicAnswer).length, runs: list.length })
  const deterministicAnswers: Comparison['deterministicAnswers'] = {
    gated: perArm((arm) => fallbackCount(runs[arm].filter((run) => GATED_TIERS.has(run.tier)))),
    all: perArm((arm) => fallbackCount(runs[arm])),
  }
  const roundsPerRun = perTier((tier) => perArm((arm) => statOf(runs[arm].filter((run) => run.tier === tier).map((run) => run.metrics.llmRounds))))
  const decisions = perArm((arm) => {
    const measured = runs[arm].map((run) => run.metrics)
    return measured.some((metrics) => metrics.decisions !== undefined) ? { ...aggregateDecisions(measured), runs: measured.length } : null
  })

  const configured = perArm((arm) => {
    const decision = decisionOf(arm === 'a' ? a.reports : b.reports)
    return decision !== 'not recorded' && decision.configured
  })
  const onArm: Arm | null = configured.a === configured.b ? null : configured.a ? 'a' : 'b'

  return {
    kind: COMPARE_KIND,
    compareVersion: COMPARE_VERSION,
    comparedAt: comparedAt.toISOString(),
    commit: commitA,
    sharedCorpus: shared,
    arms: perArm((arm) => {
      const input = arm === 'a' ? a : b
      const pool = arm === 'a' ? poolA : poolB
      return {
        source: input.source,
        captures: pool.captures,
        decision: decisionOf(input.reports),
        decisionSeams: decisionSeamsOf(input.reports),
        scenarioObservations: pool.scenarios.length,
        comparedObservations: scenarios[arm].length,
      }
    }),
    onArm,
    commandToAnswerMs,
    successes,
    deterministicAnswers,
    roundsPerRun,
    decisions,
    agreement: AGREEMENT_NOTE,
    gate: gateLines({ onArm, commandToAnswerMs, successes, deterministicAnswers }),
  }
}

/** The #274 gate in its order: time, the correctness veto, then what is reported. */
function gateLines(input: Pick<Comparison, 'onArm' | 'commandToAnswerMs' | 'successes' | 'deterministicAnswers'>): GateLine[] {
  const { onArm } = input
  const off: Arm | null = onArm === null ? null : onArm === 'a' ? 'b' : 'a'
  const judged = (test: (on: Arm, off: Arm) => boolean): boolean | null => (onArm === null || off === null ? null : test(onArm, off))
  const sides = (describe: (arm: Arm) => string): string => (onArm === null ? `a ${describe('a')}, b ${describe('b')}` : `on (${onArm}) ${describe(onArm)}, off (${off}) ${describe(off!)}`)
  const time = input.commandToAnswerMs.gated
  const wins = input.successes.gated
  const fallbacks = input.deterministicAnswers.gated
  const allFallbacks = input.deterministicAnswers.all
  const ms = (stat: PooledStat): string => (stat.median === null ? 'none' : `${stat.median} ms`)
  return [
    {
      name: 'time: pooled median command-to-Answer, Direct Action and Lookup Runs, strictly lower on than off',
      gated: true,
      passed: judged((on, offArm) => time[on].median !== null && time[offArm].median !== null && time[on].median! < time[offArm].median!),
      detail: sides((arm) => `${ms(time[arm])} over ${time[arm].n - time[arm].missing} timed Run(s)`),
    },
    {
      name: 'correctness veto: Direct Action and Lookup scenario successes not fewer on than off',
      gated: true,
      passed: judged((on, offArm) => wins[on].succeeded >= wins[offArm].succeeded),
      detail: sides((arm) => `${wins[arm].succeeded}/${wins[arm].scenarios}`),
    },
    {
      name: 'correctness veto: deterministicAnswer count on DA+Lookup Runs not higher on than off',
      gated: true,
      passed: judged((on, offArm) => fallbacks[on].count <= fallbacks[offArm].count),
      detail: `${sides((arm) => `${fallbacks[arm].count} of ${fallbacks[arm].runs} Run(s)`)}; over every Run (reported) ${sides((arm) => `${allFallbacks[arm].count} of ${allFallbacks[arm].runs}`)}`,
    },
    { name: 'reported: rounds per Run per tier', gated: false, passed: null, detail: 'see the rounds table' },
    { name: 'reported: Decision Records per Run', gated: false, passed: null, detail: 'see the Decision Records table' },
    { name: 'reported: agreement', gated: false, passed: null, detail: AGREEMENT_NOTE },
  ]
}

const TIER_LABELS: Record<EffortTier, string> = { direct_action: 'Direct Action', lookup: 'Lookup', investigation: 'Investigation' }

function statCell(stat: PooledStat, unit: string): string {
  if (stat.median === null) return `— (${stat.n} Run(s), none measured)`
  return `${stat.median}${unit} / ${stat.p95}${unit} (n ${stat.n - stat.missing}${stat.missing > 0 ? `, ${stat.missing} unmeasured` : ''})`
}

function armLabel(comparison: Comparison, arm: Arm): string {
  const { decision } = comparison.arms[arm]
  const role = decision === 'not recorded' ? 'decision role not recorded' : decision.configured ? `decision=${decision.model}` : 'decision unconfigured'
  return `${arm}${comparison.onArm === arm ? ' (on)' : comparison.onArm !== null ? ' (off)' : ''}: ${role}`
}

/** The Markdown the script writes and prints: the gate first, then the tables behind it. */
export function formatComparison(comparison: Comparison): string {
  const lines: string[] = []
  lines.push(`# eval:compare — ${comparison.commit.slice(0, 8)}, ${POOL_SIZE} captures per side`)
  lines.push('')
  lines.push(`Compared ${comparison.comparedAt} over the ${comparison.sharedCorpus.size}-scenario shared corpus; nearest-rank over pooled observations, never averaged percentiles; a Run's tier is the corpus's declaration, never the model's.`)
  lines.push('')
  for (const arm of ['a', 'b'] as const) {
    const witness = comparison.arms[arm]
    const seams = witness.decisionSeams === 'not recorded' ? 'not recorded' : decisionSeamsLabel(witness.decisionSeams)
    lines.push(`- ${armLabel(comparison, arm)}; seams ${seams}; ${witness.comparedObservations} of ${witness.scenarioObservations} scenario observations compared; from ${witness.source}`)
  }
  if (comparison.onArm === null) lines.push('- no gate verdict: both or neither side configure the decision role, so on and off cannot be told apart')
  const only = [...comparison.sharedCorpus.aOnly.map((id) => `a:${id}`), ...comparison.sharedCorpus.bOnly.map((id) => `b:${id}`)]
  if (only.length > 0) lines.push(`- one side only, never compared: ${only.join(', ')}`)
  lines.push('')
  lines.push('## Gate (#274)')
  lines.push('')
  for (const line of comparison.gate) {
    const verdict = !line.gated ? 'REPORTED' : line.passed === null ? 'NO VERDICT' : line.passed ? 'PASS' : 'FAIL'
    lines.push(`- ${verdict} ${line.name} — ${line.detail}`)
  }
  lines.push('')
  lines.push('## Command-to-Answer per tier (median / p95)')
  lines.push('')
  lines.push(`| tier | ${armLabel(comparison, 'a')} | ${armLabel(comparison, 'b')} |`)
  lines.push('| --- | --- | --- |')
  for (const tier of TIERS) lines.push(`| ${TIER_LABELS[tier]}${GATED_TIERS.has(tier) ? '' : ' (reported)'} | ${statCell(comparison.commandToAnswerMs.perTier[tier].a, ' ms')} | ${statCell(comparison.commandToAnswerMs.perTier[tier].b, ' ms')} |`)
  lines.push(`| Direct Action + Lookup (gated) | ${statCell(comparison.commandToAnswerMs.gated.a, ' ms')} | ${statCell(comparison.commandToAnswerMs.gated.b, ' ms')} |`)
  lines.push('')
  lines.push('## Scenario successes per tier')
  lines.push('')
  lines.push('| tier | a | b |')
  lines.push('| --- | --- | --- |')
  for (const tier of TIERS) lines.push(`| ${TIER_LABELS[tier]} | ${comparison.successes.perTier[tier].a.succeeded}/${comparison.successes.perTier[tier].a.scenarios} | ${comparison.successes.perTier[tier].b.succeeded}/${comparison.successes.perTier[tier].b.scenarios} |`)
  const fallbacks = comparison.deterministicAnswers
  lines.push(`| deterministicAnswer Runs, DA+Lookup (gated) | ${fallbacks.gated.a.count}/${fallbacks.gated.a.runs} | ${fallbacks.gated.b.count}/${fallbacks.gated.b.runs} |`)
  lines.push(`| deterministicAnswer Runs, every tier (reported) | ${fallbacks.all.a.count}/${fallbacks.all.a.runs} | ${fallbacks.all.b.count}/${fallbacks.all.b.runs} |`)
  lines.push('')
  lines.push('## Rounds per Run per tier (median / p95)')
  lines.push('')
  lines.push('| tier | a | b |')
  lines.push('| --- | --- | --- |')
  for (const tier of TIERS) lines.push(`| ${TIER_LABELS[tier]} | ${statCell(comparison.roundsPerRun[tier].a, '')} | ${statCell(comparison.roundsPerRun[tier].b, '')} |`)
  lines.push('')
  lines.push('## Decision Records')
  lines.push('')
  lines.push('| side | seam | records | per Run | acted | under threshold | unavailable | shadow | latency p50 / p95 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const arm of ['a', 'b'] as const) {
    const decisions = comparison.decisions[arm]
    if (decisions === null) {
      lines.push(`| ${arm} | — | not recorded (captures before #279) | | | | | | |`)
      continue
    }
    const row = (seam: string, population: { records: number; byActed: DecisionAggregate['byActed']; latencyMs: DecisionAggregate['latencyMs'] }): string =>
      `| ${arm} | ${seam} | ${population.records} | ${decisions.runs === 0 ? '—' : (population.records / decisions.runs).toFixed(2)} | ${population.byActed.acted} | ${population.byActed.under_threshold} | ${population.byActed.unavailable} | ${population.byActed.shadow} | ${population.latencyMs === null ? '—' : `${population.latencyMs.median} / ${population.latencyMs.p95} ms`} |`
    lines.push(row('all', decisions))
    for (const [seam, population] of Object.entries(decisions.bySeam)) lines.push(row(seam, population))
  }
  lines.push('')
  lines.push(`Agreement: ${comparison.agreement}`)
  return `${lines.join('\n')}\n`
}
