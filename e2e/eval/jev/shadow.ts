// The Decision Model shadow replay (#275, ADR 0068): before any seam acts,
// the saved live captures are walked, each seam's state is rebuilt from the
// tool results the orchestrator actually saw, the Decision Model is asked,
// and its answer is compared with what the model did next. Agreement by
// confidence decile is what moves the starting thresholds.
//
// What the traces can and cannot rebuild (the owner's 2026-09-26 note on
// #275): a navigate's result holds a Page Preview and a Page Read holds the
// page text, but no record holds a landing's whole text. So:
//   - passage — measured on Page Reads only. The model's pick is the passage
//     holding its next accepted excerpt from that read; no such excerpt
//     means it recorded nothing from the read.
//   - result — a navigate whose landing is a Search URL: the options are the
//     listing's result links, the model's pick is the one its next
//     navigate or click opened; a new search or anything else is no pick.
//   - tier — the command against the Effort Tier the model declared.
// Asked Items are the Run Plan's declared list; which were still open at a
// given read is not recorded, so every declared item is offered.
//
// Everything here is pure; the CLI (`scripts/decision-shadow.ts`) reads the
// files and owns the network.

import { parseSearchUrl } from '../../../src/core/browser/urlInput.ts'
import type { EffortTier } from '../../../src/core/pipeline/runPlan.ts'
import { normalizeMemoryText } from '../../../src/core/session/workingMemory.ts'
import type { DecisionSeam } from '../../../src/core/agent/modelRouting.ts'
import type {
  DecisionModel,
  DecisionQuestions,
  DecisionResult,
  DecisionThresholds,
} from '../../../src/core/ports/decisionModel.ts'

/**
 * The tiers as the tier question's labels; the pipeline's EFFORT_TIERS is not
 * imported at runtime because its module graph does not load under Node's
 * type stripping. A test pins the two equal.
 */
export const SHADOW_TIERS: readonly EffortTier[] = ['direct_action', 'lookup', 'investigation']

/** Choice allows 255 options; the rest of a longer list is cut and the cut counted. */
export const MAX_OPTIONS = 250
/** One passage's text in the state, cut: a Choice points, it never needs the whole paragraph. */
export const PASSAGE_TEXT_MAX_CHARS = 1_200
/** The state as a whole, well inside Jev's 32k-token window. */
export const STATE_MAX_CHARS = 60_000
/** An excerpt passage shorter than this pins no passage: "ID:" is on every catalogue page. */
const MIN_PICK_PASSAGE_CHARS = 12

/** One trace line, as much of it as the replay reads. */
export interface ShadowTraceLine {
  readonly kind: string
  readonly turnId?: string
  readonly agentId?: string
  readonly tool?: string
  readonly outcome?: string
  readonly excerpt?: string
  /** A checkpoint's graded observations: which one grounded it, made by what, when. */
  readonly graded?: ReadonlyArray<{ readonly matched?: boolean; readonly producer?: string; readonly observedAt?: number }>
  readonly event?: {
    readonly type?: string
    readonly at?: number
    readonly name?: string
    readonly callId?: string
    readonly text?: string
    readonly args?: Record<string, unknown>
    readonly result?: unknown
    readonly ok?: boolean
    readonly source?: string
    readonly effortTier?: string
    readonly objective?: string
    readonly askedItems?: readonly string[]
  }
}

type RunStep =
  | { readonly kind: 'call'; readonly name: string; readonly callId: string; readonly args: Record<string, unknown> }
  | { readonly kind: 'result'; readonly name: string; readonly callId: string; readonly ok: boolean; readonly text: string; readonly at?: number }
  /** An accepted record_evidence; `pageReadsAt` is when each Page Read that grounded it was observed. */
  | { readonly kind: 'checkpoint'; readonly excerpt: string; readonly pageReadsAt: readonly number[] }

/** One orchestrator Run as its trace recorded it. */
export interface ShadowRun {
  readonly capture: string
  readonly turnId: string
  readonly command: string
  readonly objective: string
  readonly askedItems: readonly string[]
  /** The tier the model declared; absent when no model Run Plan was recorded. */
  readonly tier?: EffortTier
  readonly steps: readonly RunStep[]
}

/**
 * Group a capture's trace lines into Runs by turn. Only the Run's own steps
 * are kept: a Browse Subagent's rounds carry an `agentId` and answer to its
 * own objective, not the Run's.
 */
export function readShadowRuns(capture: string, lines: readonly ShadowTraceLine[]): ShadowRun[] {
  const runs = new Map<string, { command: string; objective: string; askedItems: readonly string[]; tier?: EffortTier; steps: RunStep[] }>()
  const runOf = (turnId: string) => {
    let run = runs.get(turnId)
    if (!run) {
      run = { command: '', objective: '', askedItems: [], steps: [] }
      runs.set(turnId, run)
    }
    return run
  }
  for (const line of lines) {
    if (line.turnId === undefined || line.agentId !== undefined) continue
    const event = line.event
    if (line.kind === 'evidence_checkpoint') {
      if (line.tool === 'record_evidence' && line.outcome === 'accepted' && typeof line.excerpt === 'string') {
        const pageReadsAt = (line.graded ?? []).flatMap((observation) =>
          observation.matched === true && observation.producer === 'page_read' && typeof observation.observedAt === 'number' ? [observation.observedAt] : [],
        )
        runOf(line.turnId).steps.push({ kind: 'checkpoint', excerpt: line.excerpt, pageReadsAt })
      }
      continue
    }
    if (line.kind !== 'pipeline_event' || event === undefined) continue
    const run = runOf(line.turnId)
    if (event.type === 'command' && typeof event.text === 'string') run.command = event.text
    else if (event.type === 'run_plan' && event.source === 'model') {
      run.objective = event.objective ?? ''
      run.askedItems = event.askedItems ?? []
      const tier = SHADOW_TIERS.find((known) => known === event.effortTier)
      if (tier !== undefined) run.tier = tier
    } else if (event.type === 'tool_call' && event.name && event.callId) {
      run.steps.push({ kind: 'call', name: event.name, callId: event.callId, args: event.args ?? {} })
    } else if (event.type === 'tool_result' && event.name && event.callId) {
      run.steps.push({
        kind: 'result',
        name: event.name,
        callId: event.callId,
        ok: event.ok !== false,
        text: typeof event.result === 'string' ? event.result : '',
        ...(typeof event.at === 'number' ? { at: event.at } : {}),
      })
    }
  }
  return [...runs.entries()]
    .filter(([, run]) => run.command !== '')
    .map(([turnId, run]) => ({ capture, turnId, ...run }))
}

/** What the model did, as the sample's option labels: an empty list is "picked none". */
export interface ShadowTruth {
  readonly picks: readonly string[]
}

export interface ShadowSample {
  readonly seam: DecisionSeam
  readonly capture: string
  readonly turnId: string
  /** The tool call whose result the state was rebuilt from; absent for a tier sample. */
  readonly callId?: string
  readonly state: string
  readonly questions: DecisionQuestions
  readonly truth: ShadowTruth
  /** How many options the listing or page had before the {@link MAX_OPTIONS} cut. */
  readonly optionsBeforeCut: number
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function runHeader(run: ShadowRun): string {
  const items = run.askedItems.length > 0 ? run.askedItems.map((item) => `- ${item}`).join('\n') : '- (none declared)'
  return `Command: ${run.command}\nObjective: ${run.objective || run.command}\nAsked items:\n${items}`
}

function capState(state: string): string {
  return cut(state, STATE_MAX_CHARS)
}

/** A Page Read's passages: the page text's lines, one block each, as the collector wrote them. */
export function pagePassages(pageRead: string): string[] {
  const lines = pageRead.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'page text:')
  if (start === -1) return []
  return lines
    .slice(start + 1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** Where a model joins verbatim passages in an excerpt: the grader's seams (ADR 0054). */
const EXCERPT_SEAMS = /\r?\n|\||\.\.\.|…/

/** The passages an excerpt holds, normalized as the grader normalizes them, the short ones dropped. */
function excerptPassages(excerpt: string): string[] {
  return excerpt
    .split(EXCERPT_SEAMS)
    .map((passage) => normalizeMemoryText(passage).trim())
    .filter((passage) => passage.length >= MIN_PICK_PASSAGE_CHARS)
}

/** Which of a read's passages hold any of an excerpt's passages, as option labels. */
function passagesHolding(passages: readonly string[], excerpt: string): string[] {
  const wanted = excerptPassages(excerpt)
  if (wanted.length === 0) return []
  return passages.flatMap((passage, index) => {
    const text = normalizeMemoryText(passage)
    return wanted.some((part) => text.includes(part)) ? [`p${index + 1}`] : []
  })
}

export const PASSAGE_QUESTIONS = (options: Record<string, string | null>): DecisionQuestions => ({
  pick: {
    type: 'choice',
    instructions: 'Which passage of the page states an answer to one of the asked items?',
    options,
  },
  any: {
    type: 'noul',
    instructions: 'At least one passage of the page states an answer to one of the asked items.',
  },
})

/** One passage sample per Page Read the Run was shown. */
/** How long after its observation a Page Read's result is published; the ledger stamps it first. */
const GROUNDING_SLACK_MS = 1_000

/**
 * The read a Page Read observation was made by: the first read_page result
 * published at or after the observation, within the slack.
 */
function readAt(reads: ReadonlyArray<{ at?: number; callId: string }>, observedAt: number): string | undefined {
  return reads.find((read) => read.at !== undefined && read.at >= observedAt && read.at - observedAt <= GROUNDING_SLACK_MS)?.callId
}

/**
 * One passage sample per Page Read the Run was shown. The model's pick is
 * read off the first accepted checkpoint the grader grounded on that very
 * read — never on a landing, another page, or another read of the same one
 * — as the passages holding its excerpt. A read no checkpoint was grounded
 * on is "picked none".
 */
export function passageSamples(run: ShadowRun): ShadowSample[] {
  const reads = run.steps.flatMap((step) => (step.kind === 'result' && step.name === 'read_page' && step.ok ? [step] : []))
  const checkpoints = run.steps.filter((step): step is Extract<RunStep, { kind: 'checkpoint' }> => step.kind === 'checkpoint')
  return reads.flatMap((step) => {
    const all = pagePassages(step.text)
    if (all.length === 0) return []
    const passages = all.slice(0, MAX_OPTIONS)
    const picks =
      checkpoints
        .filter((checkpoint) => checkpoint.pageReadsAt.some((observedAt) => readAt(reads, observedAt) === step.callId))
        .map((checkpoint) => passagesHolding(passages, checkpoint.excerpt))
        .find((held) => held.length > 0) ?? []
    const title = step.text.split('\n', 1)[0]
    const body = passages.map((passage, at) => `[p${at + 1}] ${cut(passage, PASSAGE_TEXT_MAX_CHARS)}`).join('\n')
    return [
      {
        seam: 'passage' as const,
        capture: run.capture,
        turnId: run.turnId,
        callId: step.callId,
        state: capState(`${runHeader(run)}\n\nPage: ${title}\n${body}`),
        questions: PASSAGE_QUESTIONS(Object.fromEntries(passages.map((_, at) => [`p${at + 1}`, null]))),
        truth: { picks },
        optionsBeforeCut: all.length,
      },
    ]
  })
}

/** The last page a navigate result says it landed on; a rewritten navigate lands somewhere else than it asked. */
export function landingUrl(result: string): string | null {
  const matches = [...result.matchAll(/^navigated: url=(\S+)/gm)]
  return matches.at(-1)?.[1] ?? null
}

interface ListingLink {
  readonly ref: number
  readonly text: string
  readonly href: string
}

const LINK_LINE = /^\[(\d+)\] link(?: "((?:[^"\\]|\\.)*)")? href="([^"]+)"/

/** The last snapshot in a result: its link refs, in order. */
function snapshotLinks(result: string): ListingLink[] {
  const lastSnapshot = result.lastIndexOf('\n# ')
  const snapshot = lastSnapshot === -1 ? result : result.slice(lastSnapshot)
  return snapshot.split('\n').flatMap((line) => {
    const match = LINK_LINE.exec(line.trim())
    return match ? [{ ref: Number(match[1]), text: match[2] ?? '', href: match[3] }] : []
  })
}

/** A link compared as an address: no fragment, no trailing slash. */
export function sameAddress(href: string): string {
  try {
    const url = new URL(href)
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return href.replace(/#.*$/, '').replace(/\/$/, '')
  }
}

/**
 * A listing's result links: every link but the engine's own furniture —
 * another search (its tabs, its pagination, a refinement), the page itself,
 * or a site's home. Links to one address collapse to the first ref, named by
 * the first text shown for it.
 */
export function listingResults(result: string, landing: string): Array<{ label: string; description: string; address: string; refs: number[] }> {
  const here = sameAddress(landing)
  const byAddress = new Map<string, { label: string; description: string; address: string; refs: number[] }>()
  for (const link of snapshotLinks(result)) {
    const address = sameAddress(link.href)
    if (address === here || parseSearchUrl(link.href) !== null) continue
    let path: string
    try {
      path = new URL(link.href).pathname
    } catch {
      continue
    }
    if (path === '/' || path === '') continue
    const known = byAddress.get(address)
    if (known) {
      known.refs.push(link.ref)
      if (known.description === link.href && link.text !== '') known.description = `${link.text} — ${link.href}`
      continue
    }
    byAddress.set(address, {
      label: `r${link.ref}`,
      description: link.text !== '' ? `${link.text} — ${link.href}` : link.href,
      address,
      refs: [link.ref],
    })
  }
  return [...byAddress.values()]
}

/** The steps that only look or record: the model's next move is the first step that is none of these. */
const PASSIVE_TOOLS: ReadonlySet<string> = new Set(['read_page', 'scroll', 'record_evidence', 'record_candidate', 'look'])

/** The passive steps that show a new snapshot, renumbering refs. */
const SNAPSHOT_TOOLS: ReadonlySet<string> = new Set(['read_page', 'scroll', 'look'])

export const RESULT_QUESTIONS = (options: Record<string, string | null>): DecisionQuestions => ({
  pick: {
    type: 'choice',
    instructions: 'Which search result should be opened next to answer the asked items?',
    options,
  },
  any: {
    type: 'noul',
    instructions: 'One of these search results is likely to answer an open asked item.',
  },
})

/** One result sample per navigate that landed on a Search URL with results in its listing. */
export function resultSamples(run: ShadowRun): ShadowSample[] {
  return run.steps.flatMap((step, index) => {
    if (step.kind !== 'result' || step.name !== 'navigate' || !step.ok) return []
    const landing = landingUrl(step.text)
    if (landing === null || parseSearchUrl(landing) === null) return []
    const all = listingResults(step.text, landing)
    if (all.length === 0) return []
    const options = all.slice(0, MAX_OPTIONS)
    const after = run.steps.slice(index + 1)
    const nextAt = after.findIndex((later) => later.kind === 'call' && !PASSIVE_TOOLS.has(later.name))
    const next = nextAt === -1 ? undefined : (after[nextAt] as Extract<RunStep, { kind: 'call' }>)
    // A click after a scroll, a Page Read or a Look names a ref from a newer
    // snapshot than the listing's: which result it opened is unmeasured.
    const reshown = after.slice(0, nextAt === -1 ? 0 : nextAt).some((between) => between.kind === 'call' && SNAPSHOT_TOOLS.has(between.name))
    if (next?.name === 'click' && reshown) return []
    let picks: string[] = []
    if (next?.name === 'click' && typeof next.args.ref === 'number') {
      picks = options.filter((option) => option.refs.includes(next.args.ref as number)).map((option) => option.label)
    } else if (next?.name === 'navigate' && typeof next.args.url === 'string') {
      const opened = sameAddress(next.args.url)
      picks = options.filter((option) => option.address === opened).map((option) => option.label)
    }
    const body = options.map((option) => `[${option.label}] ${cut(option.description, PASSAGE_TEXT_MAX_CHARS)}`).join('\n')
    return [
      {
        seam: 'result' as const,
        capture: run.capture,
        turnId: run.turnId,
        callId: step.callId,
        state: capState(`${runHeader(run)}\n\nSearch: ${parseSearchUrl(landing)?.query ?? landing}\nResults:\n${body}`),
        questions: RESULT_QUESTIONS(Object.fromEntries(options.map((option) => [option.label, null]))),
        truth: { picks },
        optionsBeforeCut: all.length,
      },
    ]
  })
}

export const TIER_QUESTIONS: DecisionQuestions = {
  pick: {
    type: 'choice',
    instructions: 'How much work does this voice command need from a web-browsing assistant?',
    options: {
      direct_action: 'One action on a page or the app; nothing needs to be found out.',
      lookup: 'One fact to find, on one or two pages.',
      investigation: 'Several facts, sources or steps to find and compare.',
    },
  },
}

/** One tier sample per Run whose model declared a tier. */
export function tierSamples(run: ShadowRun): ShadowSample[] {
  if (run.tier === undefined) return []
  return [
    {
      seam: 'tier',
      capture: run.capture,
      turnId: run.turnId,
      state: `Command: ${run.command}`,
      questions: TIER_QUESTIONS,
      truth: { picks: [run.tier] },
      optionsBeforeCut: SHADOW_TIERS.length,
    },
  ]
}

export function shadowSamples(runs: readonly ShadowRun[]): ShadowSample[] {
  return runs.flatMap((run) => [...tierSamples(run), ...passageSamples(run), ...resultSamples(run)])
}

/** One sample's answer, kept without its state. */
export interface ShadowRow {
  readonly seam: DecisionSeam
  readonly capture: string
  readonly turnId: string
  readonly callId?: string
  readonly options: number
  readonly optionsBeforeCut: number
  readonly stateChars: number
  readonly modelPicks: readonly string[]
  readonly latencyMs: number
  /** Absent when the Decision Model was unavailable. */
  readonly choice?: string
  readonly confidence?: number
  readonly noul?: number
  readonly unavailable?: string
}

export function shadowRow(sample: ShadowSample, result: DecisionResult<DecisionQuestions>): ShadowRow {
  const pick = sample.questions.pick
  const base = {
    seam: sample.seam,
    capture: sample.capture,
    turnId: sample.turnId,
    ...(sample.callId !== undefined ? { callId: sample.callId } : {}),
    options: pick?.type === 'choice' ? Object.keys(pick.options).length : 0,
    optionsBeforeCut: sample.optionsBeforeCut,
    stateChars: sample.state.length,
    modelPicks: sample.truth.picks,
    latencyMs: result.latencyMs,
  }
  if (result.status === 'unavailable') return { ...base, unavailable: result.reason }
  const choice = result.answers.pick
  const any = result.answers.any
  return {
    ...base,
    ...(choice?.type === 'choice' ? { choice: choice.choice, confidence: choice.confidence } : {}),
    ...(any?.type === 'noul' ? { noul: any.noul } : {}),
  }
}

/** Ask every sample, a few at a time; the port never rejects, so neither does this. */
export async function askSamples(
  model: DecisionModel,
  samples: readonly ShadowSample[],
  concurrency: number,
  onRow?: (row: ShadowRow, done: number) => void,
): Promise<ShadowRow[]> {
  const rows: ShadowRow[] = new Array(samples.length)
  let next = 0
  let done = 0
  const lane = async () => {
    while (next < samples.length) {
      const at = next++
      const sample = samples[at]
      const result = await model.ask({ state: sample.state, questions: sample.questions })
      rows[at] = shadowRow(sample, result)
      done += 1
      onRow?.(rows[at], done)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, samples.length)) }, lane))
  return rows
}

export interface DecileRow {
  readonly from: number
  readonly to: number
  readonly n: number
  /** For a Choice table, the share the model agreed with; for a Noul table, the share where the model picked something. */
  readonly rate: number | null
}

function deciles(values: ReadonlyArray<{ x: number; hit: boolean }>): DecileRow[] {
  return Array.from({ length: 10 }, (_, decile) => {
    const from = decile / 10
    const to = (decile + 1) / 10
    const inside = values.filter(({ x }) => (decile === 9 ? x >= from && x <= to : x >= from && x < to))
    return { from, to, n: inside.length, rate: inside.length === 0 ? null : round(inside.filter(({ hit }) => hit).length / inside.length) }
  })
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

/**
 * What a seam would do if it acted at one bar on one primitive: every answer
 * at or above it acts, and each act either agrees with the model's pick,
 * disagrees with it, or falls on a step the model picked nothing at. The
 * last is its own column, never a disagreement: from a trace it is
 * unmeasured — the model may have missed what was there or judged it
 * useless — and #274's correctness veto is what settles it.
 */
export interface ThresholdRow {
  readonly at: number
  readonly acted: number
  readonly agreed: number
  readonly disagreed: number
  readonly recordedNothing: number
  /** agreed ÷ (agreed + disagreed); null when no act fell on a model pick. */
  readonly agreement: number | null
}

/** The bars a threshold table is read at: every decile's lower edge. */
const DECILE_BARS = Array.from({ length: 10 }, (_, decile) => decile / 10)

/** The least agreement a bar must reach, and the fewest scored acts it must rest on (#275, the owner's rule). */
export const THRESHOLD_AGREEMENT = 0.8
export const THRESHOLD_MIN_SCORED = 10

function agrees(row: ShadowRow): boolean {
  return row.choice !== undefined && row.modelPicks.includes(row.choice)
}

function thresholdTable(rows: readonly ShadowRow[], value: (row: ShadowRow) => number | undefined): ThresholdRow[] {
  return DECILE_BARS.map((at) => {
    const acted = rows.filter((row) => (value(row) ?? -1) >= at)
    const scored = acted.filter((row) => row.modelPicks.length > 0)
    const agreed = scored.filter(agrees).length
    return {
      at,
      acted: acted.length,
      agreed,
      disagreed: scored.length - agreed,
      recordedNothing: acted.length - scored.length,
      agreement: scored.length === 0 ? null : round(agreed / scored.length),
    }
  })
}

/**
 * The bar a table supports (#275, the owner's rule on the decile table): the
 * lowest bar whose acts agree at least {@link THRESHOLD_AGREEMENT} over at
 * least {@link THRESHOLD_MIN_SCORED} scored acts; failing that, the highest
 * bar that still rests on that many. Null when no bar does.
 */
export function chooseThreshold(table: readonly ThresholdRow[]): number | null {
  const supported = table.filter((row) => row.agreed + row.disagreed >= THRESHOLD_MIN_SCORED)
  const reaching = supported.find((row) => row.agreement !== null && row.agreement >= THRESHOLD_AGREEMENT)
  return reaching?.at ?? supported.at(-1)?.at ?? null
}

export interface SeamSummary {
  readonly samples: number
  readonly unavailable: Readonly<Record<string, number>>
  /** Over every ask, unavailable ones included: a timeout is the seam's worst cost, not a gap in it. */
  readonly latencyMs: { readonly median: number | null; readonly p95: number | null }
  /** Samples whose options were cut at {@link MAX_OPTIONS}. */
  readonly optionsCut: number
  /** Scored samples where more than one option counts as the model's pick (an excerpt spanning passages, a result linked twice). */
  readonly multiPick: number
  /** Choice against what the model picked, over the samples where it picked something. */
  readonly choice: {
    readonly scored: number
    readonly agreement: number | null
    readonly byConfidence: readonly DecileRow[]
    /** Acting on Choice confidence alone, at each decile's bar. */
    readonly thresholds: readonly ThresholdRow[]
    readonly chosen: number | null
  }
  /** Noul against whether the model picked anything; absent for a seam that asks no Noul. */
  readonly noul?: {
    readonly scored: number
    readonly agreementAtHalf: number | null
    readonly byProbability: readonly DecileRow[]
    /** Acting on the Noul alone, at each decile's bar; agreement is the Choice's, over the acts. */
    readonly thresholds: readonly ThresholdRow[]
    readonly chosen: number | null
  }
  /** What the seam would have done at the thresholds in force, both primitives clearing. */
  readonly atThreshold: {
    readonly thresholds: DecisionThresholds
    readonly acted: number
    readonly agreed: number
    readonly disagreed: number
    readonly recordedNothing: number
  }
}

export function summarizeSeam(rows: readonly ShadowRow[], thresholds: DecisionThresholds): SeamSummary {
  const answered = rows.filter((row) => row.unavailable === undefined)
  const unavailable: Record<string, number> = {}
  for (const row of rows) if (row.unavailable !== undefined) unavailable[row.unavailable] = (unavailable[row.unavailable] ?? 0) + 1
  const picked = answered.filter((row) => row.modelPicks.length > 0 && row.choice !== undefined)
  const withNoul = answered.filter((row) => row.noul !== undefined)
  const acted = answered.filter(
    (row) => row.confidence !== undefined && row.confidence >= thresholds.choice && (row.noul === undefined || row.noul >= thresholds.noul),
  )
  const actedScored = acted.filter((row) => row.modelPicks.length > 0)
  const choiceTable = thresholdTable(answered, (row) => row.confidence)
  const noulTable = thresholdTable(withNoul, (row) => row.noul)
  const latencies = rows.map((row) => row.latencyMs)
  return {
    samples: rows.length,
    unavailable,
    latencyMs: { median: percentile(latencies, 50), p95: percentile(latencies, 95) },
    optionsCut: rows.filter((row) => row.optionsBeforeCut > row.options).length,
    multiPick: picked.filter((row) => row.modelPicks.length > 1).length,
    choice: {
      scored: picked.length,
      agreement: picked.length === 0 ? null : round(picked.filter(agrees).length / picked.length),
      byConfidence: deciles(picked.map((row) => ({ x: row.confidence ?? 0, hit: agrees(row) }))),
      thresholds: choiceTable,
      chosen: chooseThreshold(choiceTable),
    },
    ...(withNoul.length > 0
      ? {
          noul: {
            scored: withNoul.length,
            agreementAtHalf: round(withNoul.filter((row) => (row.noul ?? 0) >= 0.5 === row.modelPicks.length > 0).length / withNoul.length),
            byProbability: deciles(withNoul.map((row) => ({ x: row.noul ?? 0, hit: row.modelPicks.length > 0 }))),
            thresholds: noulTable,
            chosen: chooseThreshold(noulTable),
          },
        }
      : {}),
    atThreshold: {
      thresholds,
      acted: acted.length,
      agreed: actedScored.filter(agrees).length,
      disagreed: actedScored.length - actedScored.filter(agrees).length,
      recordedNothing: acted.length - actedScored.length,
    },
  }
}

/** What the replay cannot see, stated in every report so no reader mistakes a limit for a finding. */
export const SHADOW_LIMITS: readonly string[] = [
  'passage: measured on Page Reads only; a navigate landing holds a Page Preview in the trace, never the landing text, so landing agreement comes from #274\'s first capture',
  'passage: the model\'s pick is the passage holding the excerpt of the first accepted record_evidence the grader grounded on that very read (its page_read observation); a read no checkpoint was grounded on is "picked none", and an excerpt spanning several passages makes each a pick (multiPick)',
  'passage and result: every declared Asked Item is offered as open; which were still open at a given step is not recorded',
  'result: the model\'s pick is the result its next navigate or click opened; a new search, a type or anything else is "picked none"; a click after a scroll, Page Read or Look names a newer snapshot\'s ref and is left out; navigate results are cut at 8,000 characters in the trace',
  '"recorded nothing" (the model picked nothing where the seam would act) is its own column, never a disagreement: it is unmeasured from traces',
  'tier: follow-up commands are asked without the Run they follow',
]
