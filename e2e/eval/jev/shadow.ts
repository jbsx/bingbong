// The Decision Model shadow replay (#275, ADR 0068): before any seam acts,
// the saved live captures are walked, each seam's state is rebuilt from the
// tool results the orchestrator actually saw, the Decision Model is asked,
// and its answer is compared with what the model did next. Agreement by
// confidence decile is what moves the starting thresholds.
//
// What the traces can and cannot rebuild (the owner's 2026-09-26 note on
// #275): a navigate's result holds a Page Preview and a Page Read holds the
// page text, but a landing's whole text is only in a Decision Record that
// kept it (#281). So:
//   - passage (#281) — the seam's own questions, one Choice and one Noul per
//     open Asked Item naming the Objective, over the seam's own state. A
//     landing the seam asked about is sampled when its text can be rebuilt —
//     from the record's asked text, its own uncut Page Preview, or a later
//     whole Page Read (or every part of one) of the same page — and the
//     rebuild's state is exactly as long as the one the seam asked over; a
//     whole Page Read the seam would ask about is sampled as itself.
//     The model's pick is every passage holding an excerpt the model itself
//     recorded from that page; none means it recorded nothing there.
//   - result — a navigate whose landing is a Search URL: the options are the
//     candidates the seam's own record kept (#303, a version 12 trace), else
//     the listing's result links, the model's pick is the one its next
//     navigate or click opened; a new search or anything else is no pick.
//   - tier — the command against the Effort Tier the model declared.
// For result, every declared Asked Item is offered; for passage, the items
// no Run-made checkpoint had closed yet.
//
// Everything here is pure; the CLI (`scripts/decision-shadow.ts`) reads the
// files and owns the network.

import { isPageTextFactLine } from '../../../src/core/browser/pageText.ts'
import { parseSearchUrl } from '../../../src/core/browser/urlInput.ts'
import { tierShadowOf } from '../../live/audit.ts'
import { CHECKPOINT_TOOL_NAMES } from '../../../src/core/pipeline/checkpointTools.ts'
import type { EffortTier } from '../../../src/core/pipeline/runPlan.ts'
import { TIER_PICK_QUESTION } from '../../../src/core/pipeline/tierShadow.ts'
import { normalizeMemoryText } from '../../../src/core/session/workingMemory.ts'
import {
  landedOnNothing,
  MAX_PASSAGE_OPTIONS,
  PASSAGE_TOOLS,
  passageBlockIds,
  passageQuestions,
  passageState,
} from './passageQuestions.ts'
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
/** An excerpt passage shorter than this pins no passage: "ID:" is on every catalogue page. A table row quoted whole pins its row however short (#281). */
const MIN_PICK_PASSAGE_CHARS = 12

/** One trace line, as much of it as the replay reads. */
export interface ShadowTraceLine {
  readonly kind: string
  readonly turnId?: string
  readonly agentId?: string
  /** A `decision` record's seam and what it did with the answer (#280 reads the tier seam's). */
  readonly seam?: string
  readonly acted?: string
  /** A `decision` record's state size, and — a passage record written since #281 — the state itself. */
  readonly stateChars?: number
  readonly askedText?: string
  /** A result record's candidates, written since Run Trace version 12 (#303): the links of the whole page the seam asked over. */
  readonly candidates?: unknown
  /** A checkpoint made by the Run (`run`, #276); absent on the model's own. */
  readonly origin?: string
  /** A checkpoint's call arguments: a Run-made one names its Asked Item in the observation. */
  readonly args?: { readonly observation?: unknown; readonly excerpt?: unknown }
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
  /**
   * An accepted record_evidence, the model's or the Run's (`item` names the
   * Asked Item a Run-made one closed); `grounded` is each observation the
   * grader matched it on, by producer and when it was observed.
   */
  | {
      readonly kind: 'checkpoint'
      readonly excerpt: string
      readonly origin: 'model' | 'run'
      readonly item?: string
      readonly grounded: ReadonlyArray<{ readonly producer: string; readonly observedAt: number }>
    }
  /** A Selected Passage ask the Run recorded, before the result of the call it was asked on (#281). */
  | { readonly kind: 'passage_ask'; readonly acted: string; readonly stateChars: number; readonly askedText?: string }
  /**
   * A Result Pick ask the Run recorded, before the result of the search it
   * was asked on (#303): what came of it, and the candidates it was asked
   * over where the record kept them.
   */
  | { readonly kind: 'result_ask'; readonly acted: string; readonly candidates: readonly RecordedCandidate[] }

/** One candidate a result record kept (#303): a link of the listing's whole page. */
interface RecordedCandidate {
  readonly label: string
  readonly href: string
}

/** A result record's candidates as far as they can be read: an entry of no known shape is dropped. */
function recordedCandidates(raw: unknown): RecordedCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { label, href } = entry as Record<string, unknown>
    return typeof href === 'string' && href !== '' ? [{ label: typeof label === 'string' ? label : '', href }] : []
  })
}

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
 * The Asked Item a Run-made checkpoint closed, from its observation: the
 * item's wording alone in traces up to `fix-281`, and the item followed by
 * the passage — `<item>: <passage>` — in `fix-283`'s (#283).
 */
export function runMadeItem(observation: string, excerpt: unknown): string {
  const stated = typeof excerpt === 'string' ? `: ${excerpt}` : null
  return stated !== null && observation.length > stated.length && observation.endsWith(stated) ? observation.slice(0, -stated.length) : observation
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
        const grounded = (line.graded ?? []).flatMap((observation) =>
          observation.matched === true && typeof observation.producer === 'string' && typeof observation.observedAt === 'number'
            ? [{ producer: observation.producer, observedAt: observation.observedAt }]
            : [],
        )
        const origin = line.origin === 'run' ? 'run' : 'model'
        const item = origin === 'run' && typeof line.args?.observation === 'string' ? runMadeItem(line.args.observation, line.args.excerpt) : undefined
        runOf(line.turnId).steps.push({ kind: 'checkpoint', excerpt: line.excerpt, origin, ...(item !== undefined ? { item } : {}), grounded })
      }
      continue
    }
    if (line.kind === 'decision') {
      // A window pass's records ride a page past 255 blocks, which is not replayed (#282).
      if (line.seam === 'passage' && typeof line.acted === 'string' && typeof line.stateChars === 'number' && (line as { windowed?: unknown }).windowed !== true) {
        runOf(line.turnId).steps.push({
          kind: 'passage_ask',
          acted: line.acted,
          stateChars: line.stateChars,
          ...(typeof line.askedText === 'string' ? { askedText: line.askedText } : {}),
        })
      }
      if (line.seam === 'result' && typeof line.acted === 'string') {
        runOf(line.turnId).steps.push({ kind: 'result_ask', acted: line.acted, candidates: recordedCandidates(line.candidates) })
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
  /**
   * A passage sample's picks under the truth before #281's repair — no table
   * row credited below twelve characters, no Page Read credited to its
   * landing — so a bar that passes only under the repair can be refused
   * (Decision 3).
   */
  readonly unrepairedPicks?: readonly string[]
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
  /** A passage sample's page and items (#281): its answers become one row per item. */
  readonly passage?: PassageSampleFacts
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

/**
 * A Page Read's passages: the page text's lines, one block each, as the
 * collector wrote them — untrimmed, since a pre block keeps its indent and
 * the state the seam asked over kept it too. The fact lines a read or a
 * preview ends with, and the lines a Selected Passage carried after a
 * landing (#276), are no passage.
 */
export function pagePassages(pageRead: string): string[] {
  const lines = pageRead.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'page text:')
  if (start === -1) return []
  // The page's text holds no blank line; the Notices a round attached start after one.
  const end = lines.findIndex((line, at) => at > start && line.trim() === '')
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => !isPageTextFactLine(line) && !CARRIED_LINE.test(line))
}

/** The fact line a Page Preview cut short ends with (ADR 0047): the landing does not hold its page's whole text. */
const PREVIEW_CUT_LINE = /^page text: first [\d,]+ of [\d,]+ characters/m
/** What the Run carried after a landing's result (#276): the seam's lines, not the page's. */
const CARRIED_LINE = /^(?:Selected passage for "|Recorded as evidence for "|Session Evidence (?:recorded:|not recorded,) (?:memory-\d+, )?for ")/

/** The fact line of a Page Read cut into parts: `page text: part 2 of 4 — …` (ADR 0047). */
const PART_LINE = /^page text: part (\d+) of (\d+)\b/

/**
 * Which part of how many a Page Read is; null for a whole page — one that
 * carries no part line, as every one-part read did before #290, or one whose
 * line names a single part.
 */
export function pageReadPart(pageRead: string): { readonly part: number; readonly of: number } | null {
  for (const line of pageRead.split('\n')) {
    const match = PART_LINE.exec(line.trim())
    if (match) return Number(match[2]) <= 1 ? null : { part: Number(match[1]), of: Number(match[2]) }
  }
  return null
}

/** The page a result's last snapshot shows, from its `# <title> — <url>` head, as an address ({@link sameAddress}). */
export function pageUrlOf(result: string): string | null {
  const heads = [...result.matchAll(/^# .* — (\S+)$/gm)]
  const url = heads.at(-1)?.[1]
  return url === undefined ? null : sameAddress(url)
}

/** The blocks of a state the seam asked over, as its record kept it (#281): each `P001| ` line, cut as the state cut it. */
export function stateBlocks(state: string): string[] {
  return state
    .split(/\n(?=P\d{3,}\| )/)
    .map((line) => line.replace(/^P\d{3,}\| /, ''))
    .filter((block) => block !== '')
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

/** A block the collector rendered from a table row: its cells joined by ` | ` (ADR 0047). */
const TABLE_ROW = / \| /

/**
 * Which of a page's passages an excerpt holds, as option labels: a passage
 * holding one of the excerpt's long pieces, or a table row the excerpt
 * quotes whole however short (#281) — `ID: | ZAA0037` splits into pieces too
 * short to pin anything, yet the model quoted exactly that row.
 */
function passagesHolding(passages: readonly string[], labels: readonly string[], excerpt: string, rows = true): string[] {
  const wanted = excerptPassages(excerpt)
  const quoted = normalizeMemoryText(excerpt)
  return passages.flatMap((passage, index) => {
    const text = normalizeMemoryText(passage)
    const held = wanted.some((part) => text.includes(part)) || (rows && TABLE_ROW.test(passage) && text.trim() !== '' && quoted.includes(text.trim()))
    return held ? [labels[index]!] : []
  })
}

/** How long after its observation a result is published; the ledger stamps it first. */
const GROUNDING_SLACK_MS = 1_000

/**
 * The read a Page Read observation was made by: the first read_page result
 * published at or after the observation, within the slack.
 */
function readAt(reads: ReadonlyArray<{ at?: number; callId: string }>, observedAt: number): string | undefined {
  return reads.find((read) => read.at !== undefined && read.at >= observedAt && read.at - observedAt <= GROUNDING_SLACK_MS)?.callId
}

type CheckpointStep = Extract<RunStep, { kind: 'checkpoint' }>
/** A Run's passage ask, and the items open when it was asked. */
type PendingAsk = { readonly ask: Extract<RunStep, { kind: 'passage_ask' }>; readonly open: readonly string[] }

/** The page tools a landing comes from (ADR 0069). */
const LANDING_TOOLS: ReadonlySet<string> = new Set(['navigate', 'click'])

/**
 * A landing's text from the Page Reads of the same page after it: the first
 * whole read, or every part of a page read in parts. Null when neither was
 * read; the caller checks the rebuild against what the seam asked over.
 */
function rebuiltFromReads(later: readonly RunStep[], url: string): string[] | null {
  const parts = new Map<number, string[]>()
  let of: number | null = null
  for (const step of later) {
    if (step.kind !== 'result' || step.name !== 'read_page' || !step.ok || pageUrlOf(step.text) !== url) continue
    const part = pageReadPart(step.text)
    if (part === null) return pagePassages(step.text)
    if (of !== null && part.of !== of) continue
    of = part.of
    if (!parts.has(part.part)) parts.set(part.part, pagePassages(step.text))
    if (parts.size === of) return Array.from({ length: of }, (_, index) => parts.get(index + 1) ?? []).flat()
  }
  return null
}

/** One passage sample: the seam's question over one page, per open Asked Item. */
export interface PassageSampleFacts {
  /** A landing the seam asked about, or a whole Page Read. */
  readonly kind: 'landing' | 'page_read'
  readonly url: string
  readonly objective: string
  /** The open Asked Items, in `pick_<n>` order. */
  readonly items: readonly string[]
  /** The page's blocks, as the state holds them: what a chosen label reads as. */
  readonly blocks: readonly string[]
  /** The Run's own ask acted on this page: the model's next move was the seam's, and no pick of its own is comparable. */
  readonly recordedActed: boolean
}

/** What a Run's passage walk could not replay, counted so no reader mistakes a gap for a finding. */
export interface PassageSkips {
  /** A landing the seam asked about whose text no record kept and no later Page Read rebuilt exactly. */
  unrebuilt: number
  /** A page past the one-pass Choice's 255 blocks (#282). */
  windowed: number
}

/**
 * The passage samples of one Run (#281), walked as the seam walks it: only
 * once the Run Plan declared items, never for a Direct Action; never on a
 * search results page, a wall, a Not-found or an Unavailable Page; asking the
 * items no Run-made checkpoint had closed; never asking twice over one page,
 * one set of items and one text.
 */
export function passageSamples(run: ShadowRun, skips: PassageSkips = { unrebuilt: 0, windowed: 0 }): ShadowSample[] {
  if (run.tier === 'direct_action' || run.askedItems.length === 0) return []
  const objective = run.objective || run.command
  const reads = run.steps.flatMap((step) => (step.kind === 'result' && step.name === 'read_page' && step.ok ? [step] : []))
  const checkpoints = run.steps.filter((step): step is CheckpointStep => step.kind === 'checkpoint' && step.origin === 'model')
  const closed = new Set<string>()
  let pending: PendingAsk | null = null
  let lastAsked: string | null = null
  const samples: ShadowSample[] = []
  run.steps.forEach((step, index) => {
    if (step.kind === 'checkpoint' && step.origin === 'run' && step.item !== undefined) closed.add(step.item)
    if (step.kind === 'passage_ask') {
      pending = { ask: step, open: run.askedItems.filter((item) => !closed.has(item)) }
      return
    }
    if (step.kind !== 'result') return
    const asked: PendingAsk | null = pending
    pending = null
    if (!PASSAGE_TOOLS.has(step.name) || !step.ok) return
    const url = pageUrlOf(step.text)
    if (url === null || parseSearchUrl(url) !== null || landedOnNothing({ ok: true, result: step.text })) return
    const items = asked?.open ?? run.askedItems.filter((item) => !closed.has(item))
    if (items.length === 0) return
    let blocks: string[]
    let kind: PassageSampleFacts['kind']
    if (LANDING_TOOLS.has(step.name)) {
      // A landing's text is in no result: only one the seam asked about can
      // be replayed, and only when its rebuild is the state it asked over.
      if (asked === null) return
      // A preview that fits is the whole text (ADR 0047): it carries no cut line.
      const rebuilt =
        asked.ask.askedText !== undefined
          ? stateBlocks(asked.ask.askedText)
          : PREVIEW_CUT_LINE.test(step.text)
            ? rebuiltFromReads(run.steps.slice(index + 1), url)
            : pagePassages(step.text)
      const exact =
        rebuilt !== null &&
        (asked.ask.askedText !== undefined || passageState(passageBlockIds(rebuilt.length), rebuilt).length === asked.ask.stateChars)
      if (!exact) {
        skips.unrebuilt += 1
        return
      }
      blocks = rebuilt
      kind = 'landing'
    } else {
      if (pageReadPart(step.text) !== null) return
      blocks = pagePassages(step.text)
      kind = 'page_read'
    }
    if (blocks.length === 0) return
    if (blocks.length > MAX_PASSAGE_OPTIONS) {
      skips.windowed += 1
      return
    }
    const key = JSON.stringify([url, items, blocks])
    if (key === lastAsked) return
    lastAsked = key
    const labels = passageBlockIds(blocks.length)
    // The model's own checkpoints grounded on this page: on this landing's
    // or read's observation, and for a landing on any read of the same page
    // before the Run left it (#281) — the read showed the landing's text.
    const nextLanding = run.steps.findIndex((later, at) => at > index && later.kind === 'result' && LANDING_TOOLS.has(later.name) && later.ok && pageUrlOf(later.text) !== url)
    const until = nextLanding === -1 ? run.steps.length : nextLanding
    const creditedReads = new Set(
      kind === 'landing'
        ? run.steps.slice(index + 1, until).flatMap((later) => (later.kind === 'result' && later.name === 'read_page' && pageUrlOf(later.text) === url ? [later.callId] : []))
        : [step.callId],
    )
    const grounds =
      (credited: ReadonlySet<string>) =>
      (checkpoint: CheckpointStep): boolean =>
        checkpoint.grounded.some(({ producer, observedAt }) =>
          producer === 'page_read'
            ? credited.has(readAt(reads, observedAt) ?? '')
            : kind === 'landing' && producer === 'action_outcome' && step.at !== undefined && step.at >= observedAt && step.at - observedAt <= GROUNDING_SLACK_MS,
        )
    const picks = [...new Set(checkpoints.filter(grounds(creditedReads)).flatMap((checkpoint) => passagesHolding(blocks, labels, checkpoint.excerpt)))]
    // Before the repair: a landing held only what was recorded off the landing itself.
    const ownRead = new Set(kind === 'landing' ? [] : [step.callId])
    const unrepairedPicks = [...new Set(checkpoints.filter(grounds(ownRead)).flatMap((checkpoint) => passagesHolding(blocks, labels, checkpoint.excerpt, false)))]
    samples.push({
      seam: 'passage',
      capture: run.capture,
      turnId: run.turnId,
      callId: step.callId,
      state: passageState(labels, blocks),
      questions: passageQuestions(objective, items, Object.fromEntries(labels.map((label) => [label, null])), 'passage', true),
      truth: { picks, unrepairedPicks },
      optionsBeforeCut: blocks.length,
      passage: { kind, url, objective, items, blocks, recordedActed: asked?.ask.acted === 'acted' },
    })
  })
  return samples
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
const PASSIVE_TOOLS: ReadonlySet<string> = new Set(['read_page', 'scroll', 'look', ...CHECKPOINT_TOOL_NAMES])

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

/**
 * The options a recorded list offers (#303): each candidate under its
 * position, `c1` to `cn`, as the seam numbered it — never a ref, which a
 * link below the fold has none of. `refs` are the listing's refs to the
 * candidate's address, so a click reads against it.
 */
function recordedResults(candidates: readonly RecordedCandidate[], result: string): ReturnType<typeof listingResults> {
  const shown = snapshotLinks(result)
  return candidates.map((candidate, position) => {
    const address = sameAddress(candidate.href)
    return {
      label: `c${position + 1}`,
      description: candidate.label !== '' ? `${candidate.label} — ${candidate.href}` : candidate.href,
      address,
      refs: shown.filter((link) => sameAddress(link.href) === address).map((link) => link.ref),
    }
  })
}

/**
 * One result sample per navigate that landed on a Search URL with results
 * in its listing. Where the Run asked about the landing and its record
 * kept the candidates (#303, a version 12 trace), they are the options; on
 * an older trace, and on a landing the Run never asked about, the options
 * are rebuilt from the listing's head. A search whose result the Run opened
 * is no sample: the model's next move was the seam's.
 */
export function resultSamples(run: ShadowRun): ShadowSample[] {
  return run.steps.flatMap((step, index) => {
    if (step.kind !== 'result' || step.name !== 'navigate' || !step.ok) return []
    const landing = landingUrl(step.text)
    if (landing === null || parseSearchUrl(landing) === null) return []
    const before = run.steps[index - 1]
    const ask = before?.kind === 'result_ask' ? before : undefined
    if (ask?.acted === 'acted') return []
    const all = ask !== undefined && ask.candidates.length > 0 ? recordedResults(ask.candidates, step.text) : listingResults(step.text, landing)
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

/** The tier Choice the live shadow asks (#278), so the replay's agreement reads against the Run's. */
export const TIER_QUESTIONS: DecisionQuestions = { pick: TIER_PICK_QUESTION }

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

export function shadowSamples(runs: readonly ShadowRun[], skips?: PassageSkips): ShadowSample[] {
  return runs.flatMap((run) => [...tierSamples(run), ...passageSamples(run, skips), ...resultSamples(run)])
}

/**
 * Rows brought up to the truth the traces give now (#281), asking nothing:
 * each passage row takes its sample's picks, both truths, by capture, turn
 * and call. A row whose sample the traces no longer give is kept as it was.
 */
export function retruthRows(rows: readonly ShadowRow[], samples: readonly ShadowSample[]): { rows: ShadowRow[]; refreshed: number } {
  const bySample = new Map(samples.filter((sample) => sample.seam === 'passage').map((sample) => [`${sample.capture}/${sample.turnId}/${sample.callId}`, sample.truth]))
  let refreshed = 0
  const next = rows.map((row) => {
    const truth = row.seam === 'passage' ? bySample.get(`${row.capture}/${row.turnId}/${row.callId}`) : undefined
    if (truth === undefined) return row
    refreshed += 1
    return { ...row, modelPicks: truth.picks, ...(truth.unrepairedPicks !== undefined ? { modelPicksUnrepaired: truth.unrepairedPicks } : {}) }
  })
  return { rows: next, refreshed }
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
  /** A passage row is one Asked Item's pair (#281): the item, its 1-based index, where it was asked and over what. */
  readonly item?: string
  readonly pair?: number
  readonly sampleKind?: PassageSampleFacts['kind']
  readonly objective?: string
  /** The block the Choice chose, cut for reading: what a judge weighs a recorded-nothing act on. */
  readonly passage?: string
  /** The Run's own ask acted on this page, so the model's next move was not its own (#281). */
  readonly notComparable?: true
  /** A passage row's model picks under the unrepaired truth (#281, Decision 3). */
  readonly modelPicksUnrepaired?: readonly string[]
}

/** How much of a chosen block a row keeps for judging. */
const ROW_PASSAGE_MAX_CHARS = 600

/** A sample's rows: one per Asked Item for a passage sample (#281), else the one. */
export function shadowRows(sample: ShadowSample, result: DecisionResult<DecisionQuestions>): ShadowRow[] {
  const facts = sample.passage
  if (facts === undefined) return [shadowRow(sample, result)]
  const base = rowBase(sample, result, 'pick_1')
  const labels = passageBlockIds(facts.blocks.length)
  return facts.items.map((item, index) => {
    const row: ShadowRow = {
      ...base,
      item,
      pair: index + 1,
      sampleKind: facts.kind,
      objective: facts.objective,
      ...(sample.truth.unrepairedPicks !== undefined ? { modelPicksUnrepaired: sample.truth.unrepairedPicks } : {}),
      ...(facts.recordedActed ? { notComparable: true as const } : {}),
    }
    if (result.status === 'unavailable') return { ...row, unavailable: result.reason }
    const pick = result.answers[`pick_${index + 1}`]
    const any = result.answers[`any_${index + 1}`]
    const block = pick?.type === 'choice' ? facts.blocks[labels.indexOf(pick.choice)] : undefined
    return {
      ...row,
      ...(pick?.type === 'choice' ? { choice: pick.choice, confidence: pick.confidence } : {}),
      ...(any?.type === 'noul' ? { noul: any.noul } : {}),
      ...(block !== undefined ? { passage: cut(block, ROW_PASSAGE_MAX_CHARS) } : {}),
    }
  })
}

/** What every row of a sample shares; `pickKey` is the Choice whose options it counts. */
function rowBase(sample: ShadowSample, result: DecisionResult<DecisionQuestions>, pickKey: string): ShadowRow {
  const pick = sample.questions[pickKey]
  return {
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
}

export function shadowRow(sample: ShadowSample, result: DecisionResult<DecisionQuestions>): ShadowRow {
  const base = rowBase(sample, result, 'pick')
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
  onRow?: (rows: readonly ShadowRow[], done: number) => void,
): Promise<ShadowRow[]> {
  const rows: ShadowRow[][] = new Array(samples.length)
  let next = 0
  let done = 0
  const lane = async () => {
    while (next < samples.length) {
      const at = next++
      const sample = samples[at]
      const result = await model.ask({ state: sample.state, questions: sample.questions })
      rows[at] = shadowRows(sample, result)
      done += 1
      onRow?.(rows[at]!, done)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, samples.length)) }, lane))
  return rows.flat()
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
  /** acted ÷ the rows the table was read over (#281): how often the seam would act at this bar. */
  readonly actedShare: number | null
}

/** The bars a threshold table is read at: every decile's lower edge. */
const DECILE_BARS = Array.from({ length: 10 }, (_, decile) => decile / 10)

/** The least agreement a bar must reach, and the fewest scored acts it must rest on (#275, the owner's rule). */
export const THRESHOLD_AGREEMENT = 0.8
export const THRESHOLD_MIN_SCORED = 10

function agrees(row: ShadowRow): boolean {
  return row.choice !== undefined && row.modelPicks.includes(row.choice)
}

function thresholdTable(rows: readonly ShadowRow[], actsAt: (row: ShadowRow, at: number) => boolean): ThresholdRow[] {
  return DECILE_BARS.map((at) => {
    const acted = rows.filter((row) => actsAt(row, at))
    const scored = acted.filter((row) => row.modelPicks.length > 0)
    const agreed = scored.filter(agrees).length
    return {
      at,
      acted: acted.length,
      agreed,
      disagreed: scored.length - agreed,
      recordedNothing: acted.length - scored.length,
      agreement: scored.length === 0 ? null : round(agreed / scored.length),
      actedShare: rows.length === 0 ? null : round(acted.length / rows.length),
    }
  })
}

/** Acting on one primitive's answer alone at a bar. */
const atLeast =
  (value: (row: ShadowRow) => number | undefined) =>
  (row: ShadowRow, at: number): boolean =>
    (value(row) ?? -1) >= at

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

/** The agreement floors of a passage bar, in the order they are tried (#281, Decision 2). */
export const PASSAGE_AGREEMENT_FLOORS: readonly number[] = [0.9, 0.8]

/**
 * The Noul bar a paired table supports (#281, Decision 2): the lowest bar
 * whose acts agree at least 0.9 over at least ten scored acts, and 0.8 where
 * 0.9 is unreachable; the floor it met rides with it. Given the table under
 * the unrepaired truth, a bar must meet the same floor there too — a bar
 * that passes only under the repaired truth is not taken (Decision 3). Null
 * when none does: Decision 7 then keeps the bars in force.
 */
export function choosePassageBar(
  table: readonly ThresholdRow[],
  unrepaired?: readonly ThresholdRow[],
): { readonly at: number; readonly floor: number } | null {
  const meets = (row: ThresholdRow | undefined, floor: number): boolean =>
    row !== undefined && row.agreed + row.disagreed >= THRESHOLD_MIN_SCORED && row.agreement !== null && row.agreement >= floor
  // A floor no bar meets under both truths is unreachable, and the next is tried.
  for (const floor of PASSAGE_AGREEMENT_FLOORS) {
    const reaching = table.find((row) => meets(row, floor) && (unrepaired === undefined || meets(unrepaired.find((other) => other.at === row.at), floor)))
    if (reaching !== undefined) return { at: reaching.at, floor }
  }
  return null
}

/** A judge's verdict on a confident pick the model recorded nothing from (#281, Decision 13). */
export type PassageVerdict = 'right' | 'weak' | 'wrong'

export interface PassageJudgement {
  readonly verdict: PassageVerdict
  readonly note?: string
}

/** A passage row's key in a judgements file: capture, turn, call and pair. */
export function passageRowKey(row: Pick<ShadowRow, 'capture' | 'turnId' | 'callId' | 'pair'>): string {
  return `${row.capture}/${row.turnId}/${row.callId ?? ''}/${row.pair ?? 1}`
}

/** One act at the bars in force on a page the model recorded nothing from, with its verdict when judged. */
export interface RecordedNothingAct {
  readonly key: string
  readonly objective?: string
  readonly item?: string
  readonly passage?: string
  readonly confidence?: number
  readonly noul?: number
  readonly judged?: PassageJudgement
}

export interface SeamSummary {
  /** Rows, despite the name kept for older reports: one per sample, or one per Asked Item's pair for passage (#281). */
  readonly samples: number
  readonly unavailable: Readonly<Record<string, number>>
  /** Over every ask, unavailable ones included: a timeout is the seam's worst cost, not a gap in it. */
  readonly latencyMs: { readonly median: number | null; readonly p95: number | null }
  /** Samples whose options were cut at {@link MAX_OPTIONS}. */
  readonly optionsCut: number
  /** Rows whose Run's own ask acted (#281): the model's next move was the seam's, so they are left out of every table below. */
  readonly notComparable: number
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
    /**
     * Acting as the seam acts (#281): the Choice at the bar in force and the
     * Noul at each decile's bar, both clearing — the table the passage bar is
     * read from, and the Noul bar it supports under Decision 2.
     */
    readonly paired: {
      readonly choiceAt: number
      readonly thresholds: readonly ThresholdRow[]
      /** The same acts scored under the unrepaired truth; absent when no row carries it. */
      readonly unrepaired?: readonly ThresholdRow[]
      readonly chosen: { readonly at: number; readonly floor: number } | null
    }
  }
  /** What the seam would have done at the thresholds in force, both primitives clearing. */
  readonly atThreshold: {
    readonly thresholds: DecisionThresholds
    readonly acted: number
    readonly agreed: number
    readonly disagreed: number
    readonly recordedNothing: number
    /** Every recorded-nothing act, judged where a judgement was given (#281, Decision 13): reported, never gating. */
    readonly recordedNothingActs: readonly RecordedNothingAct[]
    readonly judged: Readonly<Record<PassageVerdict, number>>
  }
}

export function summarizeSeam(
  rows: readonly ShadowRow[],
  thresholds: DecisionThresholds,
  judgements: Readonly<Record<string, PassageJudgement>> = {},
): SeamSummary {
  const unavailable: Record<string, number> = {}
  for (const row of rows) if (row.unavailable !== undefined) unavailable[row.unavailable] = (unavailable[row.unavailable] ?? 0) + 1
  const comparable = rows.filter((row) => row.notComparable !== true)
  const answered = comparable.filter((row) => row.unavailable === undefined)
  const picked = answered.filter((row) => row.modelPicks.length > 0 && row.choice !== undefined)
  const withNoul = answered.filter((row) => row.noul !== undefined)
  const acted = answered.filter(
    (row) => row.confidence !== undefined && row.confidence >= thresholds.choice && (row.noul === undefined || row.noul >= thresholds.noul),
  )
  const actedScored = acted.filter((row) => row.modelPicks.length > 0)
  const choiceTable = thresholdTable(answered, atLeast((row) => row.confidence))
  const noulTable = thresholdTable(withNoul, atLeast((row) => row.noul))
  const pairedActs = (row: ShadowRow, at: number): boolean => (row.confidence ?? -1) >= thresholds.choice && (row.noul ?? -1) >= at
  const pairedTable = thresholdTable(withNoul, pairedActs)
  const unrepairedTable = withNoul.some((row) => row.modelPicksUnrepaired !== undefined)
    ? thresholdTable(
        withNoul.map((row) => ({ ...row, modelPicks: row.modelPicksUnrepaired ?? [] })),
        pairedActs,
      )
    : undefined
  // One ask per sample: a passage sample's pairs share its latency, so only its first pair counts it.
  const latencies = rows.filter((row) => (row.pair ?? 1) === 1).map((row) => row.latencyMs)
  const recordedNothingActs = acted
    .filter((row) => row.modelPicks.length === 0)
    .map((row): RecordedNothingAct => {
      const key = passageRowKey(row)
      const judged = judgements[key]
      return {
        key,
        ...(row.objective !== undefined ? { objective: row.objective } : {}),
        ...(row.item !== undefined ? { item: row.item } : {}),
        ...(row.passage !== undefined ? { passage: row.passage } : {}),
        ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
        ...(row.noul !== undefined ? { noul: row.noul } : {}),
        ...(judged !== undefined ? { judged } : {}),
      }
    })
  const judged: Record<PassageVerdict, number> = { right: 0, weak: 0, wrong: 0 }
  for (const act of recordedNothingActs) if (act.judged !== undefined) judged[act.judged.verdict] += 1
  return {
    samples: rows.length,
    unavailable,
    latencyMs: { median: percentile(latencies, 50), p95: percentile(latencies, 95) },
    optionsCut: rows.filter((row) => row.optionsBeforeCut > row.options).length,
    notComparable: rows.length - comparable.length,
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
            paired: {
              choiceAt: thresholds.choice,
              thresholds: pairedTable,
              ...(unrepairedTable !== undefined ? { unrepaired: unrepairedTable } : {}),
              chosen: choosePassageBar(pairedTable, unrepairedTable),
            },
          },
        }
      : {}),
    atThreshold: {
      thresholds,
      acted: acted.length,
      agreed: actedScored.filter(agrees).length,
      disagreed: actedScored.length - actedScored.filter(agrees).length,
      recordedNothing: acted.length - actedScored.length,
      recordedNothingActs,
      judged,
    },
  }
}

/**
 * One Run's recorded tier shadow (#280): the `decision` record the tier seam
 * wrote before round 1 of a Run with the decision role configured, beside the
 * first tier the Run's model declared — read through the Round Audit's own
 * join (#278), so the replay and the audit cannot disagree about what a
 * pick stands in for. Nothing is asked: the answer is the one the Run got.
 */
export interface RecordedTierRow {
  readonly capture: string
  readonly turnId: string
  /** What the seam did with the answer; the tier seam only ever shadows today. */
  readonly acted: string
  readonly pick: EffortTier | null
  readonly confidence: number | null
  readonly declared: EffortTier | null
  readonly unavailable: string | null
}

/** Every Run's own recorded tier shadow in a capture's trace lines, in the order they were recorded. */
export function recordedTierRows(capture: string, lines: readonly ShadowTraceLine[]): RecordedTierRow[] {
  const byTurn = new Map<string, ShadowTraceLine[]>()
  for (const line of lines) {
    if (line.turnId === undefined) continue
    byTurn.set(line.turnId, [...(byTurn.get(line.turnId) ?? []), line])
  }
  return [...byTurn].flatMap(([turnId, runLines]) => {
    const shadow = tierShadowOf(runLines as unknown as Parameters<typeof tierShadowOf>[0])
    if (shadow === undefined) return []
    const record = runLines.find((line) => line.kind === 'decision' && line.seam === 'tier' && line.agentId === undefined)
    const { pick, confidence, declared, unavailable } = shadow
    return [{ capture, turnId, acted: typeof record?.acted === 'string' ? record.acted : 'shadow', pick, confidence, declared, unavailable }]
  })
}

export interface RecordedTierSummary {
  readonly records: number
  readonly unavailable: number
  /** Records whose seam acted: the declaration that followed was the seam's, so there is no independent pick to agree with. */
  readonly notComparable: number
  /** Answered, not acted, and the model declared a tier. */
  readonly compared: number
  readonly agreed: number
  readonly agreement: number | null
}

export function summarizeRecordedTier(rows: readonly RecordedTierRow[]): RecordedTierSummary {
  // Acted first, as eval:compare classifies a record: a seam that acted leaves no pick of the model's to agree with.
  const comparable = rows.filter((row) => row.acted !== 'acted')
  const answered = comparable.filter((row) => row.pick !== null)
  const compared = answered.filter((row) => row.declared !== null)
  const agreed = compared.filter((row) => row.pick === row.declared).length
  return {
    records: rows.length,
    unavailable: comparable.length - answered.length,
    notComparable: rows.length - comparable.length,
    compared: compared.length,
    agreed,
    agreement: compared.length === 0 ? null : round(agreed / compared.length),
  }
}

/** What the replay cannot see, stated in every report so no reader mistakes a limit for a finding. */
export const SHADOW_LIMITS: readonly string[] = [
  'passage (#281): the seam\'s own questions over its own state, one row per open Asked Item; a landing is replayed only where the Run asked about it and its text is rebuilt exactly — from the record\'s asked text, from its own Page Preview when the preview was not cut, or from a later whole Page Read (or every part of one) of the same page — and a rebuild counts only when its state is as long as the one asked over; a landing no Run asked about has only its Page Preview in the trace and is never sampled; a Page Read in parts is never sampled; a page past 255 blocks is left to #282',
  'passage: the model\'s pick is every passage holding an excerpt of the model\'s own accepted record_evidence grounded on that page — its landing observation, that read, or for a landing any read of the same page before the Run left it; a quoted table row counts however short; the model\'s call names no Asked Item, so a pair agrees when its block holds any excerpt the model recorded there; a page none was grounded on is "picked none"',
  'passage: a row whose Run\'s own ask acted is not comparable and is left out of every table (#281): the model\'s next move was the seam\'s',
  'passage: the Objective asked is the Run Plan\'s last; a Steering replan mid-Run is read as the Run\'s final Objective',
  'result: every declared Asked Item is offered as open',
  'result: the model\'s pick is the result its next navigate or click opened; a new search, a type or anything else is "picked none"; a click after a scroll, Page Read or Look names a newer snapshot\'s ref and is left out; navigate results are cut at 8,000 characters in the trace',
  '"recorded nothing" (the model picked nothing where the seam would act) is its own column, never a disagreement: it is unmeasured from traces',
  'tier: follow-up commands are asked without the Run they follow',
  'recordedTier (#280): asks nothing — the tier seam\'s own records, from Runs with the decision role configured, against the FIRST tier the model declared (as the Round Audit reads it); the asked tier rows read the last; a record whose seam acted is not comparable',
]
