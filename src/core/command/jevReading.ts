import type { DecisionChoiceAnswer, DecisionChoiceQuestion, DecisionNoulQuestion } from '../ports/decisionModel'
import type { PageLink, PageMedia } from '../browser/snapshot'
import { PRESS_KEYS, describeCommand, normalizeWords, pressKeyOf, targetLabel, verbTakesSlot, type Command, type CommandPage, type CommandRef } from './command'
import { dialogControls, type DismissChoice } from './dismissDialog'
import { isSearchLanding, isTextField, pageAddressOf, resultLinksOf, resultRefsOf, wordsAfterVerb } from './localMatch'
import { isAddressShaped } from './openAddress'
import { isWebEngineSearch, siteOf } from './siteScope'
import { CAPABILITY_DESCRIPTIONS, CAPABILITY_INSTRUCTIONS, capabilityAction, capabilitySearches, isCapability, type Capability } from './capability'

// One Jev call per Command the Local Match cannot settle (#324, ADR 0076).
// The state is the transcript, the page's address and title and its
// numbered refs — label, kind, href, no page text. Jev reads the Command
// as one whole action (#370): one Choice, the action card, whose every
// option is an action — a click, a type or a right-click on a numbered
// ref, an open of a link further down, a verb that needs no ref (an action
// the browser can take, never a word the user said, #353), a Capability
// while the appliance can act itself (ADR 0079) — or `none`. Beside it in
// the same call: the Slot among the transcript's contiguous word spans; on
// a site, where the words point (#340), at a later hop only on a site the
// Task has not searched (#341); at every hop past the first, the Verdict —
// is this page what was asked for — so a Task's end is a sure answer and
// never an action's: the card offers no `done`. Unneeded answers are
// ignored; the top Choice is acted on at any confidence; only `none`
// drops the Utterance. Speed over accuracy: nothing here asks "did you
// mean".

/** A Choice offers at most 255 options; one is `none`. */
const MAX_SPANS = 254

/** The verbs the action card offers as they are: every browser verb that acts on no ref (#370). */
const REFLESS_VERBS = ['navigate', 'search', 'scroll_up', 'scroll_down', 'back', 'forward', 'reload', 'press', 'read', 'clear', 'stop'] as const
type RefLessVerb = (typeof REFLESS_VERBS)[number]

const REFLESS_DESCRIPTIONS: Readonly<Record<RefLessVerb | 'none', string>> = {
  navigate: 'go to a web address the words name: a website, a host or a url',
  search: 'search for the words: on the web, or on this site when they point at something on it',
  scroll_up: 'scroll the page up',
  scroll_down: 'scroll the page down',
  back: 'go back to the previous page',
  forward: 'go forward',
  reload: 'reload the page',
  press: 'press a key: enter, escape, space or an arrow key',
  read: 'read the page aloud or show its contents',
  clear: 'clear the text in the focused field',
  stop: 'stop what the browser is doing',
  none:'not a command for this page: a remark, a question, a name, noise',
}

export interface SlotSpan {
  readonly start: number
  readonly end: number
  readonly words: string
}

/** The transcript's words, each shorn of edge punctuation. */
function wordsOf(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^["'“”‘’(\[]+|["'“”‘’)\].,!?;:]+$/g, ''))
    .filter((word) => word !== '')
}

/**
 * Every contiguous word span of the transcript, start then end ascending,
 * under the Choice cap: when the transcript has more spans than fit, the
 * longest spans are left out first — a Slot is a phrase, and every word
 * stays offered on its own.
 */
export function slotSpans(text: string): SlotSpan[] {
  const words = wordsOf(text)
  const n = words.length
  let longest = n
  const spansUpTo = (length: number): number => {
    let count = 0
    for (let l = 1; l <= length; l += 1) count += n - l + 1
    return count
  }
  while (longest > 1 && spansUpTo(longest) > MAX_SPANS) longest -= 1
  const spans: SlotSpan[] = []
  for (let start = 0; start < n; start += 1) {
    for (let end = start; end < n && end - start < longest; end += 1) {
      if (spans.length >= MAX_SPANS) return spans
      spans.push({ start, end, words: words.slice(start, end + 1).join(' ') })
    }
  }
  return spans
}

/**
 * A ref as Jev is shown it: kind, label, address. A page's one unlabelled
 * media ref is named by what plays (#363) — a player the page draws no
 * label on is otherwise `media ""`, which says nothing of what it is.
 */
function describeRef(ref: CommandRef, page?: CommandPage): string {
  const kind = ref.kind === 'input' && ref.inputType !== null ? `input[${ref.inputType}]` : ref.kind
  const states = ref.states !== undefined && ref.states.length > 0 ? ` ${ref.states.join(' ')}` : ''
  return `${kind} ${JSON.stringify(shownLabel(ref, page))}${ref.href !== null ? ` ${ref.href}` : ''}${states}`
}

/** The label a ref is shown with: its own, or for the page's one unlabelled media ref, the title of what plays. */
function shownLabel(ref: CommandRef, page: CommandPage | undefined): string {
  if (ref.kind !== 'media' || ref.label !== '' || page?.media === undefined) return ref.label
  const unlabelled = page.refs.filter((candidate) => candidate.kind === 'media' && candidate.label === '')
  return unlabelled.length === 1 ? page.media.title : ref.label
}

/**
 * Where a Task stands at a hop past the first (#328, ADR 0076 amendment):
 * which hop this is, the addresses it has been to, the actions it took,
 * and the whole page's links — the result links among them are offered as
 * targets on a search landing, since results start below the fold.
 */
export interface HopContext {
  /** 1 for the first Command after hop 0. */
  readonly hop: number
  readonly visited: readonly string[]
  /** Each action taken so far and what it did ({@link doneLine}). */
  readonly actions: readonly string[]
  readonly links: readonly PageLink[]
  /** The targets a hop that changed nothing set aside (#336): never offered again in this Task. */
  readonly setAside?: readonly SetAside[]
  /** The sites the Task has searched (#341): a hop on one is never offered its Site Scope again. */
  readonly searched?: readonly string[]
  /**
   * The words the Task has searched for or typed (owner's rule
   * 2026-10-19): a page whose address carries them is the results they
   * led to, on any site, whatever its parameter is called.
   */
  readonly terms?: readonly string[]
}

/**
 * Whether a hop stands on a search's results (#342, owner's rule
 * 2026-10-19): an address the Search URL test reads as a search, or one
 * that carries words the Task searched for or typed — YouTube's
 * `search_query`, Amazon's `k`, eBay's `_nkw`, a path — with no list of
 * the names a site gives them.
 */
export function onResults(url: string, hop: HopContext | undefined): boolean {
  if (isSearchLanding(url)) return true
  const terms = (hop?.terms ?? []).map(normalizeWords).filter((term) => term.length >= 2)
  if (terms.length === 0 || !URL.canParse(url)) return false
  const parsed = new URL(url)
  const carried = [...[...parsed.searchParams.values()], ...parsed.pathname.split('/').map(decodedSegment)].map(normalizeWords).filter((value) => value !== '')
  return carried.some((value) => terms.some((term) => value === term || ` ${value} `.includes(` ${term} `)))
}

/** A path segment decoded the lenient way form values are: a stray `%` stays itself, `+` is a space. */
function decodedSegment(segment: string): string {
  return new URLSearchParams(`t=${segment.replace(/&/g, '%26')}`).get('t') ?? segment
}

/**
 * The site a reading may scope a search to (#340, #341): the page's, on a
 * real page that is no Web Engine's web search, and at a hop past the
 * first only while the Task has not searched it — one search per site per
 * Task. Null when there is none.
 */
function scopableSite(url: string, hop: HopContext | undefined): string | null {
  const site = siteOf(url)
  return site !== null && hop?.searched?.includes(site) === true ? null : site
}

/**
 * A target set aside (#336): known by its label and its address — the
 * link's own, or the page's for a control that has none — since a ref's
 * number changes from one hop to the next.
 */
export interface SetAside {
  readonly label: string
  readonly address: string
}

/** Whether two set-aside identities name the same target. */
export function sameAside(a: SetAside, b: SetAside): boolean {
  return a.label === b.label && a.address === b.address
}

/** The set-aside identity of a ref on a page. */
export function setAsideOf(ref: CommandRef, page: CommandPage): SetAside {
  return { label: ref.label, address: pageAddressOf(ref.href ?? page.url) }
}

/**
 * How an action came out, for the next hop's "Done so far" (#336): nothing
 * changed; or the page changed — it opened another address, or stayed on
 * its own — told in facts: the controls that appeared, and whether a
 * pop-up now covers the page. The facts are what the Verdict reads: over
 * the refs alone, a sign-in sheet over a profile and a sign-in bar at the
 * foot of the post itself look the same.
 */
export type DoneResult =
  | { readonly changed: false }
  | { readonly changed: true; readonly opened?: string; readonly target?: TargetChange; readonly appeared?: readonly string[]; readonly covered?: boolean; readonly closed?: boolean; readonly media?: readonly string[] }

/** One state of the acted ref that differs between the two reads (#366), each side as the ref line shows it: `pressed=false`, `value="…"`, `no value`. */
export interface StateFlip {
  readonly from: string
  readonly to: string
}

/** What the action did to its own target (#366): the label it now reads, when it changed its own, and its Ref State flips — none is a fact too — or it is no longer on the page. */
export type TargetChange = { readonly label: string; readonly now?: string; readonly flips: readonly StateFlip[] } | { readonly label: string; readonly gone: true }

/** How many controls that appeared "Done so far" names. */
const NAMED_APPEARANCES = 3

/**
 * The facts of what an action changed, off the page it was read on and the
 * page it left: the labels of the controls that were not there before (a
 * pop-up's first), whether a pop-up covers the page that was clear, and
 * whether the pop-up that covered it closed. Both `covered` and `closed`
 * at once is a line told again: the pop-up the action raised closed before
 * the next action, by the page or a collect's consent dismissal.
 */
/** The labelled refs of the page an action left that the page it was read on did not show, in the order the page shows them. */
export function freshRefs(before: CommandPage, after: CommandPage): CommandRef[] {
  const known = new Set(before.refs.map((ref) => ref.label))
  return after.refs.filter((ref) => ref.label !== '' && !known.has(ref.label))
}

/** A ref's states by name: `pressed=true` is `pressed` → `true`. */
function statesByName(states: readonly string[]): Map<string, string> {
  return new Map(
    states.map((state) => {
      const at = state.indexOf('=')
      return at < 0 ? [state, ''] : [state.slice(0, at), state.slice(at + 1)]
    }),
  )
}

/**
 * States no flip of says what an action did: focus moves to whatever was
 * clicked or typed into, so told, it reads as a change of every target
 * (replay 2026-10-21: the captions Verdict's yes fell from ~0.74 to ~0.53).
 */
const UNTOLD_FLIPS = new Set(['focused'])

/** How the acted ref's Ref State differs between the two reads, in the order the later read gives it. */
function stateFlips(before: readonly string[], after: readonly string[]): StateFlip[] {
  const [was, now] = [statesByName(before), statesByName(after)]
  for (const name of UNTOLD_FLIPS) [was, now].forEach((states) => states.delete(name))
  // A side with no such state: Ref State drops a `false` that is no toggle's, so beside a `true` it is `false`; beside anything else, none.
  const side = (name: string, value: string | undefined, other: string | undefined): string => (value !== undefined ? `${name}=${value}` : other === 'true' ? `${name}=false` : `no ${name}`)
  return [...new Set([...now.keys(), ...was.keys()])]
    .filter((name) => was.get(name) !== now.get(name))
    .map((name) => ({ from: side(name, was.get(name), now.get(name)), to: side(name, now.get(name), was.get(name)) }))
}

/**
 * Of the controls sharing the target's label, the target: the one of its
 * kind and address that kept its number, else the one whose states name
 * the most of its own — a menu that opens renumbers the page, and two
 * "Settings" or a "Code" tab beside a "Code" button share a label.
 */
function sameOfLabel(target: CommandRef, named: readonly CommandRef[]): CommandRef {
  const alike = named.filter((ref) => ref.kind === target.kind && ref.href === target.href)
  const pool = alike.length > 0 ? alike : named
  const kept = pool.find((ref) => ref.ref === target.ref)
  if (kept !== undefined) return kept
  const names = new Set([...statesByName(target.states ?? []).keys()])
  const shared = (ref: CommandRef): number => [...statesByName(ref.states ?? []).keys()].filter((name) => names.has(name)).length
  return pool.reduce((best, ref) => (shared(ref) > shared(best) ? ref : best))
}

/**
 * The acted ref on the page the action left, matched by label (a ref's
 * number changes between hops); else a control that changed its own label
 * — Play to Pause, Follow to Following — known by its place: the same
 * number, kind and address between the same neighbours, under a label the
 * page it was read on did not show. A pop-up's controls renumber the page
 * under it, so the neighbours are what say the place is the same.
 */
function targetAfter(target: CommandRef, before: CommandPage, after: CommandPage): CommandRef | undefined {
  const named = after.refs.filter((ref) => ref.label === target.label)
  if (named.length > 0) return sameOfLabel(target, named)
  const [was, now] = [before.refs.indexOf(target), after.refs.findIndex((ref) => ref.ref === target.ref)]
  const placed = after.refs[now]
  if (placed === undefined || placed.kind !== target.kind || placed.href !== target.href || before.refs.some((ref) => ref.label === placed.label)) return undefined
  const sameNeighbour = (step: number): boolean => before.refs[was + step]?.label === after.refs[now + step]?.label
  const inDialog = (page: CommandPage, ref: number): boolean => page.dialog?.refs.includes(ref) ?? false
  return sameNeighbour(-1) && sameNeighbour(1) && inDialog(after, placed.ref) === inDialog(before, target.ref) ? placed : undefined
}

/** What the action did to its target (#366), when it acted on one: gone, relabelled, or its Ref State. */
function targetChange(before: CommandPage, after: CommandPage, ref: number | null | undefined): TargetChange | undefined {
  const target = ref === null || ref === undefined ? undefined : before.refs.find((one) => one.ref === ref)
  if (target === undefined) return undefined
  const now = targetAfter(target, before, after)
  // A pop-up that opened or closed explains a missing target: the page under a pop-up is not read whole, and a closed one takes its controls with it.
  if (now === undefined) return (before.dialog === undefined) === (after.dialog === undefined) ? { label: target.label, gone: true } : undefined
  // A read drops an empty Ref State: no states is a tree that said nothing of the ref.
  return { label: target.label, ...(now.label !== target.label ? { now: now.label } : {}), flips: stateFlips(target.states ?? [], now.states ?? []) }
}

/** Whether the target changed at all: gone, relabelled or a state flipped. */
function targetMoved(change: TargetChange): boolean {
  return 'gone' in change || change.now !== undefined || change.flips.length > 0
}

export function doneFacts(before: CommandPage, after: CommandPage, result: DoneResult, target?: number | null): DoneResult {
  // A change to the media element is one the DOM does not show (#363): Loop ticked in a right-click menu changes no ref.
  const media = mediaChanges(before.media, after.media)
  // A page another address opened is a new page: what the target did on the old one is no fact of it.
  const change = !result.changed || result.opened === undefined ? targetChange(before, after, target) : undefined
  if (!result.changed) {
    // A page that reads unchanged can still hold a target that changed: a toggle the click signature does not see.
    const moved = change !== undefined && targetMoved(change)
    if (!moved && media.length === 0) return result
    return { changed: true, ...(moved ? { target: change } : {}), ...(media.length > 0 ? { media } : {}) }
  }
  // The target's new label is the target, told as relabelled: not a control that appeared.
  const relabel = change !== undefined && 'now' in change ? change.now : undefined
  const fresh = freshRefs(before, after).filter((ref) => ref.label !== relabel)
  const inDialog = new Set(after.dialog?.refs ?? [])
  const appeared = [...fresh.filter((ref) => inDialog.has(ref.ref)), ...fresh.filter((ref) => !inDialog.has(ref.ref))].slice(0, NAMED_APPEARANCES).map((ref) => ref.label)
  const covered = after.dialog !== undefined && before.dialog === undefined
  const closed = before.dialog !== undefined && after.dialog === undefined
  return { ...result, ...(change !== undefined ? { target: change } : {}), ...(appeared.length > 0 ? { appeared } : {}), ...(covered ? { covered: true } : {}), ...(closed ? { closed: true } : {}), ...(media.length > 0 ? { media } : {}) }
}

/** A media position as a player shows it: `1:02`, `1:02:03`. */
function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** What changed on the media element between two reads (#363), in "Done so far"'s words; none when nothing did. */
function mediaChanges(before: PageMedia | undefined, after: PageMedia | undefined): string[] {
  if (after === undefined) return []
  if (before === undefined) return after.paused ? [] : [`${JSON.stringify(after.title)} started playing`]
  return [
    ...(before.loop !== after.loop ? [`loop turned ${after.loop ? 'on' : 'off'}`] : []),
    ...(before.muted !== after.muted ? [after.muted ? 'muted' : 'unmuted'] : []),
    // Time runs on between the reads; a position behind the one before is a seek back, a restart at 0:00.
    ...(after.currentTime + 1 < before.currentTime ? [`the video went back to ${clockOf(after.currentTime)}`] : []),
    ...(before.paused !== after.paused ? [after.paused ? 'the video paused' : 'the video started playing'] : []),
  ]
}

/**
 * The media line of the state Jev reads (#363, ADR 0079): the element
 * playing — or paused once started — by title, where it is, and its loop
 * and mute, so a Verdict sees a change the refs never show.
 */
function mediaLine(media: PageMedia): string {
  const at = Number.isFinite(media.duration) ? `${clockOf(media.currentTime)} / ${clockOf(media.duration)}` : clockOf(media.currentTime)
  return `${media.paused ? 'Paused' : 'Playing'}: ${JSON.stringify(media.title)} ${at}, loop ${media.loop ? 'on' : 'off'}${media.muted ? ', muted' : ''}`
}

/** An address as "Done so far" names it: no scheme, no www, no trailing slash. */
function shortAddress(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '')
}

/** A label as "Done so far" names it: quoted, cut at 40 characters. */
function shortLabel(label: string): string {
  return JSON.stringify(label.length <= 40 ? label : `${label.slice(0, 39).trimEnd()}…`)
}

/** Labels as a list: `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function listOf(labels: readonly string[]): string {
  const named = labels.map(shortLabel)
  return named.length <= 1 ? (named[0] ?? '') : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
}

/** What the action did to its target (#366): `"Captions" went from pressed=false to pressed=true`, `"Captions" is no longer on the page`, `its state did not change`. */
function targetFacts(change: TargetChange): string {
  if ('gone' in change) return `${JSON.stringify(change.label)} is no longer on the page`
  // Told, not left out: a stale accessibility tree then reads as unchanged rather than as nothing.
  if (!targetMoved(change)) return 'its state did not change'
  const flips = change.flips.map((flip, n) => `${n === 0 ? 'went ' : ''}from ${flip.from} to ${flip.to}`)
  const told = [...(change.now !== undefined ? [`now reads ${JSON.stringify(change.now)}`] : []), ...(flips.length > 0 ? [flips.join(' and ')] : [])]
  // Named whole, as the action names it: cut, it reads as another control (replay 2026-10-21).
  return `${JSON.stringify(change.label)} ${told.join(' and ')}`
}

/** What a changed page came to, in facts: the target's own change first (#366), so the page's reaction never drowns it. */
function changedFacts(result: Extract<DoneResult, { changed: true }>): string {
  const page = pageFacts(result)
  // A change the target or the media element alone shows: the page's own line says only "the page changed", which it adds nothing to.
  const told = [...(result.target !== undefined ? [targetFacts(result.target)] : []), ...(page === 'the page changed' ? [] : [page]), ...(result.media ?? [])]
  return told.length > 0 ? told.join('; ') : page
}

/** What a changed page came to, in facts of the page alone. */
function pageFacts(result: Extract<DoneResult, { changed: true }>): string {
  const appeared = result.appeared ?? []
  if (result.opened !== undefined) {
    const opened = `opened ${shortAddress(result.opened)}`
    if (result.covered !== true) return opened
    return result.closed === true ? `${opened}; a pop-up covered it, and closed` : `${opened}; a pop-up covers it${appeared.length > 0 ? `: ${listOf(appeared)}` : ''}`
  }
  // Covered and closed at once: told again after a re-read found the pop-up the line named gone (post mortem 2026-10-19).
  if (result.closed === true) return result.covered === true ? 'the address did not change; a pop-up appeared over the page, and closed' : 'the pop-up closed'
  if (result.covered === true) return `the address did not change; a pop-up appeared over the page${appeared.length > 0 ? `: ${listOf(appeared)}` : ''}`
  if (appeared.length > 0) return `the address did not change; ${listOf(appeared)} appeared`
  return 'the page changed'
}

/**
 * One action in a hop's "Done so far" (#336): the verb and its target by
 * label (a ref's number changes between hops), and what it did —
 * `click "Pinned…" (nothing changed)`, `click "Elon Musk" (opened x.com/elonmusk)`,
 * `click "Elon Musk @elonmusk 2h…" (the address did not change; a pop-up appeared over the page: "Close", "Log in" and "Sign up")`.
 */
export function doneLine(command: Command, page: CommandPage, result: DoneResult): string {
  const outcome = !result.changed ? 'nothing changed' : changedFacts(result)
  return `${doneAction(command, page)} (${outcome})`
}

/** An action as "Done so far" names it: the verb and its target by label, a ref's number changing between hops. */
export function doneAction(command: Command, page: CommandPage): string {
  const label = targetLabel(command, page)
  if (label === undefined) return describeCommand(command)
  return command.verb === 'type' ? `type ${JSON.stringify(command.slot ?? '')} into ${JSON.stringify(label)}` : `${command.verb} ${JSON.stringify(label)}`
}

/** The least probability a runner-up may have (#363, ADR 0079): under it, Jev did not offer the ref at all. */
export const RUNNER_UP_FLOOR = 0.05

/**
 * The runner-up of a reading (#363, ADR 0079): the most probable action of
 * the opener's own kind on its action card (#370) — the next click after a
 * click, the next right-click after a menu — on a ref that is not the one
 * it fired, nor one the Task set aside, at {@link RUNNER_UP_FLOOR} or over;
 * named by its set-aside identity, since the page it is fired on is
 * collected anew. Null when there is none.
 */
export function runnerUpOf(action: DecisionChoiceAnswer, page: CommandPage, fired: number, setAside: readonly SetAside[], kind: 'click' | 'menu' = 'click'): SetAside | null {
  const firedRef = page.refs.find((ref) => ref.ref === fired)
  const excluded = [...setAside, ...(firedRef !== undefined ? [setAsideOf(firedRef, page)] : [])]
  const ranked = Object.entries(action.probabilities)
    .filter(([, probability]) => probability >= RUNNER_UP_FLOOR)
    .sort((a, b) => b[1] - a[1])
  for (const [label] of ranked) {
    const acted = refActionOf(label)
    const ref = acted?.act === kind ? page.refs.find((candidate) => candidate.ref === acted.n) : undefined
    if (ref === undefined) continue
    const own = setAsideOf(ref, page)
    if (!excluded.some((aside) => sameAside(aside, own))) return own
  }
  return null
}

/** The ref on a page that a set-aside identity names (#363): its label and its address; null when the page has none. */
export function refNamed(page: CommandPage, named: SetAside): CommandRef | null {
  return page.refs.find((ref) => sameAside(setAsideOf(ref, page), named)) ?? null
}

/** A result link a hop may open, numbered as its `link-N` line in the state and its `open-N` option. */
interface OfferedLink extends PageLink {
  readonly n: number
}

/**
 * What a hop offers of a page: its refs and the page's links further down
 * — on a Web Engine's search its results alone, its own chrome left out;
 * on any other page every link (owner's rule 2026-10-19: the widest net,
 * so a link below the fold costs no scroll) — none of them an address the
 * Task has visited, no link twice or already a ref.
 */
function offered(page: CommandPage, hop: HopContext | undefined): { page: CommandPage; links: OfferedLink[] } {
  if (hop === undefined) return { page, links: [] }
  const seen = new Set(hop.visited.map(pageAddressOf))
  const fresh = (href: string | null): boolean => href === null || !seen.has(pageAddressOf(href))
  const setAside = hop.setAside ?? []
  const kept = (ref: CommandRef): boolean => {
    const own = setAsideOf(ref, page)
    return !setAside.some((aside) => sameAside(aside, own))
  }
  const refs = page.refs.filter((ref) => fresh(ref.href) && kept(ref))
  const taken = new Set(page.refs.flatMap((ref) => (ref.href === null ? [] : [pageAddressOf(ref.href)])))
  const links: OfferedLink[] = []
  // A Choice holds at most 255 options: `none`, the refs, then the links.
  const room = MAX_SPANS - refs.length
  for (const link of isWebEngineSearch(page.url) ? resultLinksOf(hop.links, page.url) : hop.links) {
    if (links.length >= room) break
    const address = pageAddressOf(link.href)
    if (seen.has(address) || taken.has(address)) continue
    taken.add(address)
    links.push({ label: link.label, href: link.href, n: links.length + 1 })
  }
  return { page: { ...page, refs }, links }
}

function describeLink(link: PageLink): string {
  return `link ${JSON.stringify(link.label)} ${link.href}`
}

/**
 * Where a Step stands in its line (#364, ADR 0076 "a line is Steps"): the
 * whole line, which Step this is, and what the Steps before it did — so a
 * later Step's reading starts from the page the last one left.
 */
export interface StepContext {
  readonly line: string
  /** 1 for the first Step. */
  readonly step: number
  readonly of: number
  /** One line per earlier Step: its words and what it did. */
  readonly done: readonly string[]
}

/** The state the questions are asked over; at a hop past the first, where the Task stands; in a Step, where the line stands. */
export function commandState(text: string, page: CommandPage, hop?: HopContext, step?: StepContext): string {
  const shown = offered(page, hop)
  const done = [...(step?.done ?? []), ...(hop?.actions ?? [])]
  return [
    `The user spoke to a web browser: ${JSON.stringify(text)}`,
    ...(step !== undefined ? [`Step ${step.step} of ${step.of} of the line: ${JSON.stringify(step.line)}`] : []),
    ...(hop !== undefined
      ? [`This is step ${hop.hop + 1} of the task. Done so far: ${done.join('; ') || 'nothing'}`, `Pages visited: ${hop.visited.join(' ') || 'none'}`]
      : step !== undefined && done.length > 0
        ? [`Done so far: ${done.join('; ')}`]
        : []),
    `Page: ${page.url} — ${JSON.stringify(page.title)}`,
    ...(page.media !== undefined ? [mediaLine(page.media)] : []),
    ...(page.dialog !== undefined ? [`A dialog is open: ${JSON.stringify(page.dialog.text)}`] : []),
    'Refs (number, kind, label, address, states):',
    ...shown.page.refs.map((ref) => `[${ref.ref}] ${describeRef(ref, page)}`),
    ...(shown.links.length > 0 ? [`${isWebEngineSearch(page.url) ? 'Result links' : 'Links'} further down the page (name, address):`, ...shown.links.map((link) => `[link-${link.n}] ${describeLink(link)}`)] : []),
  ].join('\n')
}

/** A type, not an interface, so it reads as the port's `DecisionQuestions` record. */
type ActionQuestions = {
  readonly action: DecisionChoiceQuestion
  readonly slot: DecisionChoiceQuestion
}

/**
 * The reading's questions (#340): the action card and the Slot, or those and `where` —
 * a union, never an optional key, so each still reads as the port's
 * `DecisionQuestions` record — and at hop 0, on a line with a conjunction,
 * `steps` (#364).
 */
type ReadingQuestions = ActionQuestions | (ActionQuestions & { readonly where: DecisionChoiceQuestion })
export type CommandQuestions = ReadingQuestions | (ReadingQuestions & { readonly steps: DecisionChoiceQuestion })

/** Where a line splits into two Steps (#364): the word the second starts at, and each Step's words. */
export interface StepBoundary {
  /** The index, among the line's whitespace-split words, of the second Step's first word. */
  readonly at: number
  readonly first: string
  readonly rest: string
}

/** The words that join two Commands in a line; a comma ending a word joins them too. */
const CONJUNCTIONS: ReadonlySet<string> = new Set(['and', 'then'])

const bareWord = (token: string): string => token.toLowerCase().replace(/[.,!?;:]+$/, '')

/**
 * Every place the line could split into two Steps (#364): after a word
 * that ends in a comma, or at "and", "then" or "and then" — the
 * conjunctions in neither half, each place once, and both halves words.
 * Jev chooses among them; which "and" is a title's is its to read.
 */
export function stepBoundaries(text: string): StepBoundary[] {
  const tokens = text.trim().split(/\s+/).filter((token) => token !== '')
  const joins = (index: number): boolean => CONJUNCTIONS.has(bareWord(tokens[index] ?? ''))
  const boundaries: StepBoundary[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const comma = /,$/.test(tokens[index]!) && !joins(index)
    // A run of conjunctions ("and then", ", and") is one place, at its first word.
    if (!comma && !(joins(index) && !joins(index - 1) && !/,$/.test(tokens[index - 1] ?? ''))) continue
    const firstEnd = comma ? index + 1 : index
    let at = comma ? index + 1 : index
    while (at < tokens.length && joins(at)) at += 1
    if (firstEnd === 0 || at >= tokens.length) continue
    const first = tokens.slice(0, firstEnd).join(' ').replace(/,$/, '')
    boundaries.push({ at, first, rest: tokens.slice(at).join(' ') })
  }
  return boundaries.slice(0, MAX_SPANS)
}

/** The `steps` Choice (#364): one Command, or two split at a boundary; null when the line has none. */
function stepsQuestion(text: string): DecisionChoiceQuestion | null {
  const boundaries = stepBoundaries(text)
  if (boundaries.length === 0) return null
  return {
    type: 'choice',
    instructions:
      'Is the line one command, or two the user wants done one after the other? Choose none when it is one: an "and" or a comma inside a name, a title or words to search for or type joins no commands. Otherwise choose where the second command starts.',
    options: { none: 'one command: the whole line', ...Object.fromEntries(boundaries.map((boundary) => [`w${boundary.at}`, `${boundary.first} | ${boundary.rest}`])) },
  }
}

/** The Steps Jev split the line into (#364); null for one Command — `none`, no `steps` asked, or a place the line does not offer. */
export function readSteps(answers: CommandAnswers, text: string): StepBoundary | null {
  if (!('steps' in answers)) return null
  const match = /^w(\d+)$/.exec(answers.steps.choice)
  return match === null ? null : (stepBoundaries(text).find((boundary) => boundary.at === Number(match[1])) ?? null)
}

/** The `where` Choice (#340): on this page, on this site, or elsewhere on the web. */
function whereQuestion(site: string): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions: `Where do the words point: at something on this page, at something on ${site} that is not on this page, or somewhere else on the web?`,
    options: {
      page: 'on this page: one of the numbered refs',
      site: `on ${site} but not on this page: a page, a person, a post, a section of it`,
      web: 'elsewhere: another website, or a search of the whole web',
    },
  }
}

/**
 * The questions: the action card and the Slot; at a hop past the first,
 * the card's refs and links are what the hop offers. On a site (#340) — a real page that
 * is no Web Engine's web search — `where` is asked beside them in the same
 * call; an Early Fire partial is a hop-0 reading and asks it too; a later
 * hop asks it on a site the Task has not searched (#341). At hop 0, on a
 * line with a conjunction, `steps` is asked too (#364) — never at a later
 * hop, on a partial, over a pop-up a dismiss phrase closes, or for a Step's
 * own words (`steps: false`).
 */
export function commandQuestions(text: string, pageRead: CommandPage, hop?: HopContext, options: { readonly steps?: boolean; readonly capabilities?: readonly Capability[] } = {}): CommandQuestions {
  const { page, links } = offered(pageRead, hop)
  const reading: ActionQuestions = { action: actionQuestion(page, pageRead, links, hop !== undefined, options.capabilities ?? []), slot: slotQuestion(text) }
  const site = scopableSite(pageRead.url, hop)
  const where = site === null ? reading : { ...reading, where: whereQuestion(site) }
  const steps = hop === undefined && options.steps !== false ? stepsQuestion(text) : null
  return steps === null ? where : { ...where, steps }
}

/**
 * The action card (#370): one option per whole action — a click on every
 * ref the reading offers, as the ref is shown; a type into each text
 * field; an open of each link further down; the ref-less verbs; the
 * Capabilities on offer; and `none`. No `done`: done-ness is the
 * Verdict's alone. Under the Choice cap the clicks come first, then the
 * types, then the opens, and a right-click on each ref fills what room is
 * left — a menu is the last resort, never chosen over the page's own
 * control in the logged asks.
 */
function actionQuestion(page: CommandPage, pageRead: CommandPage, links: readonly OfferedLink[], later: boolean, capabilities: readonly Capability[]): DecisionChoiceQuestion {
  let room = MAX_SPANS + 1 - (REFLESS_VERBS.length + 1 + capabilities.length)
  const take = <T>(items: readonly T[]): readonly T[] => {
    const taken = items.slice(0, Math.max(0, room))
    room -= taken.length
    return taken
  }
  const clicked = new Set(take(page.refs).map((ref) => ref.ref))
  const typed = new Set(take(page.refs.filter((ref) => clicked.has(ref.ref) && isTextField(ref))).map((ref) => ref.ref))
  const opened = take(links)
  const menus = take(page.refs.filter((ref) => clicked.has(ref.ref)))
  // A sentence on when to right-click, or a ref line on each right-click, lowered every sure click (replay 2026-10-21: "disable captions" 0.66–0.72 → 0.41–0.46, its top `none`).
  const instructions = `${later ? "Which one action comes next for the user's words, given Done so far and the page now?" : "Which one action does the browser take for the user's words?"} Each option is a whole action: a numbered ref with what is done to it, or a verb that needs no ref. Choose none when the words are not a command.`
  return {
    type: 'choice',
    instructions: capabilities.length === 0 ? instructions : `${instructions} ${CAPABILITY_INSTRUCTIONS}`,
    options: {
      ...Object.fromEntries(
        page.refs.flatMap((ref) => {
          const line = `[${ref.ref}] ${describeRef(ref, pageRead)}`
          return [...(typed.has(ref.ref) ? [[`type-${ref.ref}`, `type the words into ${line}`]] : []), ...(clicked.has(ref.ref) ? [[`click-${ref.ref}`, `click ${line}`]] : [])]
        }),
      ),
      ...Object.fromEntries(opened.map((link) => [`open-${link.n}`, `open result ${describeLink(link)}`])),
      ...Object.fromEntries(menus.map((ref) => [`menu-${ref.ref}`, `right-click [${ref.ref}] to open its menu`])),
      ...REFLESS_DESCRIPTIONS,
      ...Object.fromEntries(capabilities.map((capability) => [capability, CAPABILITY_DESCRIPTIONS[capability]])),
    },
  }
}

function slotQuestion(text: string): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions: 'Which words of the transcript are the thing the command carries verbatim: the address to open, the search terms, the song to play, the text to type, the key to press? Never the command word itself: "play X" carries X. Choose none when it carries none.',
    options: { none: 'the command carries no words of its own', ...Object.fromEntries(slotSpans(text).map((span) => [`s${span.start}-${span.end}`, span.words])) },
  }
}

/** The Verdict's answers: what was asked for is done; a pop-up covers the page; or there is more to do. */
export const OUTCOMES = ['yes', 'in_the_way', 'not_yet'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** The Verdict a hop's reading carries: where the Task stands on this page, and how sure Jev is. */
export interface Verdict {
  readonly outcome: Outcome
  readonly confidence: number
}

/**
 * The outcome Choice (the Verdict): is what the user asked for done? Read
 * off their words and "Done so far", not the page alone, so an action the
 * user asked for ("close the pop-up") can be done on a page that is no
 * one's goal. A pop-up covering the page is asked first, so a wall stays a
 * sure `in_the_way` whatever the words. Asked at every hop past the first
 * beside the verb, so an end is a verdict and never a verb's plurality: a
 * Task ends on a sure `yes`, meets a wall on a sure `in_the_way`, and says
 * it is not sure otherwise.
 */
function outcomeQuestion(): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions:
      'Is what the user asked for done? First: if a pop-up, sign-in prompt, cookie notice or challenge covers the page now, choose in_the_way. Otherwise judge by their words and Done so far, not by the page alone: choose yes when the page shows what they asked to see, or the action they asked for has happened; not_yet when more steps are needed.',
    options: {
      yes: 'done: the page shows it, or the action they asked for has happened',
      in_the_way: 'a pop-up or prompt covers the page now',
      not_yet: 'not done: more to do, nothing covering the page',
    },
  }
}

/**
 * The dismiss Choice (#354, owner's rule 2026-10-19): with a pop-up open,
 * which of its controls closes it. Every control of the dialog's layer that
 * a dismissal may click is offered — the widest net, no label list deciding
 * — beside `escape`, with the instructions saying what a close is and what
 * is a way through instead. Asked beside the Verdict in the same call, so
 * a Step Aside costs no second ask; the runner's Dismissal Ladder puts the
 * answer after the consent policy and before the label rung.
 */
function dismissQuestion(page: CommandPage): DecisionChoiceQuestion | null {
  if (page.dialog === undefined) return null
  const controls = dialogControls(page)
  if (controls.length === 0) return null
  return {
    type: 'choice',
    instructions:
      'A pop-up covers the page. Which control closes it and leaves the page behind as it was: a close, dismiss, not now, skip, reject or decline control, or an X? On a cookie notice, the one that declines the optional cookies: reject, decline, continue without accepting, necessary only. Never one that goes through it: sign in, sign up, subscribe, accept, agree, allow, install. Choose escape when no control closes it and the Escape key should be tried.',
    options: {
      escape: 'no control closes it: press the Escape key',
      ...Object.fromEntries(controls.map((ref) => [`ref-${ref.ref}`, describeRef(ref)])),
    },
  }
}

/**
 * The questions a dismiss phrase over a pop-up asks (owner's rule
 * 2026-10-19): the Command's and the dismiss Choice in one call, so a
 * spoken "close" walks the Dismissal Ladder with Jev's choice on it as a
 * Step Aside does. Null when the pop-up offers no control to choose.
 */
export function dismissPhraseQuestions(text: string, page: CommandPage, { capabilities }: { readonly capabilities?: readonly Capability[] } = {}): (CommandQuestions & { readonly dismiss: DecisionChoiceQuestion }) | null {
  const dismiss = dismissQuestion(page)
  return dismiss === null ? null : { ...commandQuestions(text, page, undefined, { steps: false, capabilities }), dismiss }
}

/** A hop's questions: the Command's, the Verdict and, with a pop-up open, the dismiss Choice. */
export type HopQuestions = CommandQuestions & { readonly outcome: DecisionChoiceQuestion; readonly dismiss?: DecisionChoiceQuestion }

export function hopQuestions(text: string, pageRead: CommandPage, hop: HopContext, { capabilities }: { readonly capabilities?: readonly Capability[] } = {}): HopQuestions {
  const dismiss = dismissQuestion(pageRead)
  return { ...commandQuestions(text, pageRead, hop, { capabilities }), outcome: outcomeQuestion(), ...(dismiss !== null ? { dismiss } : {}) }
}

/** The answers to {@link HopQuestions}: the Command's, the Verdict's and, when asked, the dismiss Choice's. */
export type HopAnswers = CommandAnswers & { readonly outcome: DecisionChoiceAnswer; readonly dismiss?: DecisionChoiceAnswer }

/** How Jev answered the dismiss Choice: a dialog control by ref, or Escape, with its confidence. Null when it was not asked, or names nothing offered. */
export function readDismissChoice(answers: CommandAnswers | HopAnswers, page: CommandPage): DismissChoice | null {
  if (!('dismiss' in answers) || answers.dismiss === undefined) return null
  const { choice, confidence } = answers.dismiss
  if (choice === 'escape') return { choice: 'escape', confidence }
  const match = /^ref-(\d+)$/.exec(choice)
  const ref = match === null ? NaN : Number(match[1])
  return dialogControls(page).some((control) => control.ref === ref) ? { choice: { ref }, confidence } : null
}

/** The Verdict a hop's answers carry; null when none was asked, or the answer names no outcome. */
export function readVerdict(answers: CommandAnswers | HopAnswers): Verdict | null {
  if (!('outcome' in answers)) return null
  const { choice, confidence } = answers.outcome
  return OUTCOMES.some((outcome) => outcome === choice) ? { outcome: choice as Outcome, confidence } : null
}

/**
 * A partial transcript's questions (Early Fire, #326): the three Choices
 * and one Noul — whether the words so far are the whole Command. The Noul
 * decides only whether to wait for more words, never whether to act.
 */
export type PartialQuestions = CommandQuestions & { readonly complete: DecisionNoulQuestion }

export function partialQuestions(text: string, page: CommandPage, { capabilities }: { readonly capabilities?: readonly Capability[] } = {}): PartialQuestions {
  return {
    ...commandQuestions(text, page, undefined, { steps: false, capabilities }),
    complete: { type: 'noul', instructions: 'Is this a complete command, with nothing still to be said?' },
  }
}

type ActionAnswers = {
  readonly action: DecisionChoiceAnswer
  readonly slot: DecisionChoiceAnswer
}

/** The answers to {@link CommandQuestions}: the action card's and the Slot's, or those and `where`; `steps` when it was asked (#364). */
type ReadingAnswers = ActionAnswers | (ActionAnswers & { readonly where: DecisionChoiceAnswer })
export type CommandAnswers = ReadingAnswers | (ReadingAnswers & { readonly steps: DecisionChoiceAnswer })

/** What an action card label does to a numbered ref or link (#370): `click-12` is a click on ref 12, `open-3` the open of link 3. */
interface RefAction {
  readonly act: 'click' | 'type' | 'menu' | 'open'
  readonly n: number
}

/** The ref or link action a card label names; null for a ref-less verb, a Capability, `none`, or a label the card never offers. */
function refActionOf(label: string): RefAction | null {
  const match = /^(click|type|menu|open)-(\d+)$/.exec(label)
  return match === null ? null : { act: match[1] as RefAction['act'], n: Number(match[2]) }
}

/** The ref an action names, when the hop offers it — for a type, only a text field. */
function offeredRefOf(acted: RefAction, page: CommandPage): CommandRef | null {
  const ref = page.refs.find((candidate) => candidate.ref === acted.n)
  return ref === undefined || (acted.act === 'type' && !isTextField(ref)) ? null : ref
}

/** The offered result link an `open-N` names. */
function linkOf(acted: RefAction, links: readonly OfferedLink[]): OfferedLink | undefined {
  return links.find((candidate) => candidate.n === acted.n)
}

/** What the most probable label the answer gives any probability resolves to; null when none resolves. */
function mostProbable<T>(answer: DecisionChoiceAnswer, resolve: (label: string) => T | null): T | null {
  let best: { value: T; probability: number } | null = null
  for (const [label, probability] of Object.entries(answer.probabilities)) {
    const value = probability > 0 ? resolve(label) : null
    if (value !== null && (best === null || probability > best.probability)) best = { value, probability }
  }
  return best?.value ?? null
}

/**
 * The opening a card label names (#332): a click on an offered ref, the
 * open of an offered link at its address; null for anything else. `refs`,
 * when given, are the only refs that may be clicked.
 */
function openingOf(label: string, page: CommandPage, links: readonly OfferedLink[], refs: ReadonlySet<number> | null = null): Command | null {
  const acted = refActionOf(label)
  if (acted?.act === 'open') {
    const link = linkOf(acted, links)
    return link === undefined ? null : { verb: 'navigate', target: null, slot: link.href }
  }
  if (acted?.act !== 'click') return null
  const ref = offeredRefOf(acted, page)
  return ref === null || (refs !== null && !refs.has(ref.ref)) ? null : { verb: 'click', target: ref.ref, slot: null }
}

/** The opening the action card gives the most probability (#332), the top label set aside; null when it gives no offered ref or link any. */
function mostProbableOpening(answer: DecisionChoiceAnswer, page: CommandPage, links: readonly OfferedLink[]): Command | null {
  return mostProbable<Command>(answer, (label) => openingOf(label, page, links))
}

/**
 * The results a Web Engine's landing offers a hop to fall back on: the refs
 * that are result links, and the result links further down — none at all
 * when no result is among the refs. An engine's page read before its
 * script drew the results shows its chrome alone — the Search button and
 * box, the tabs, the footer's links off its host — and a hop that opened
 * the most probable of those clicked Search, which re-submitted the words
 * and reset the page, hop after hop to the cap (2026-10-19). On such a
 * landing a hop opens a result or nothing. Off an engine every offered
 * target stands, as before.
 */
function fallbackTargets(page: CommandPage, links: readonly OfferedLink[]): { refs: ReadonlySet<number> | null; links: readonly OfferedLink[] } {
  if (!isWebEngineSearch(page.url)) return { refs: null, links }
  const refs = new Set(resultRefsOf(page.refs, page.url).map((ref) => ref.ref))
  return { refs, links: refs.size === 0 ? [] : links }
}

/** {@link mostProbableOpening} for a later hop on a search landing: on a Web Engine's, a result or nothing ({@link fallbackTargets}). */
function mostProbableFallbackOpening(answer: DecisionChoiceAnswer, page: CommandPage, links: readonly OfferedLink[]): Command | null {
  const targets = fallbackTargets(page, links)
  return mostProbable<Command>(answer, (label) => openingOf(label, page, targets.links, targets.refs))
}

/** The words the Slot answer names; the words after the verb when it names none — what a Task that found nothing says it could not find (#363). */
export function slotWords(answer: DecisionChoiceAnswer, text: string): string {
  const span = slotSpanOf(answer)
  if (span !== null) {
    const words = wordsOf(text).slice(span.start, span.end + 1).join(' ')
    if (words !== '') return words
  }
  return wordsAfterVerb(text)
}

/** The span of the transcript's words the Slot answer names; null when it names none. */
function slotSpanOf(answer: DecisionChoiceAnswer): { start: number; end: number } | null {
  const match = /^s(\d+)-(\d+)$/.exec(answer.choice)
  return match === null ? null : { start: Number(match[1]), end: Number(match[2]) }
}

/**
 * A Capability reading (ADR 0079): a `play` Command carrying the Player's
 * action — a search's words, or a `volume`'s number, off the Slot; null for
 * a `volume` whose words carry no number it takes.
 */
function capabilityCommand(capability: Capability, slot: DecisionChoiceAnswer, text: string): Command | null {
  const searches = capabilitySearches(capability)
  const words = searches || capability === 'volume' ? slotWords(slot, text) : null
  const music = capabilityAction(capability, words)
  return music === null ? null : { verb: 'play', target: null, slot: searches ? words : null, music, capability }
}

/** The Command a card label naming a ref or a link makes (#370); null when the hop does not offer what it names. */
function refCommand(acted: RefAction, answers: CommandAnswers | HopAnswers, text: string, page: CommandPage, links: readonly OfferedLink[]): Command | null {
  if (acted.act === 'open') return openingOf(`open-${acted.n}`, page, links)
  const ref = offeredRefOf(acted, page)
  if (ref === null) return null
  return { verb: acted.act, target: ref.ref, slot: acted.act === 'type' ? slotWords(answers.slot, text) : null }
}

/** Whether a card label is a verb the card offers as it is. */
const isRefLessVerb = (label: string): label is RefLessVerb => (REFLESS_VERBS as readonly string[]).includes(label)

/** The Command Jev's answers make: the action card's top option, with the Slot and `where` read as the action needs them. */
export function readCommandAnswers(answers: CommandAnswers | HopAnswers, text: string, pageRead: CommandPage, hop?: HopContext): Command {
  const none: Command = { verb: 'none', target: null, slot: null }
  const label = answers.action.choice
  if (isCapability(label)) return capabilityCommand(label, answers.slot, text) ?? none
  const { page, links } = offered(pageRead, hop)
  const acted = refActionOf(label)
  // A ref or a link the hop does not offer is no Command.
  if (acted !== null) return refCommand(acted, answers, text, page, links) ?? none
  if (!isRefLessVerb(label)) return none
  const verb = label
  const slot = verbTakesSlot(verb) ? slotWords(answers.slot, text) : null
  if ((verb === 'navigate' || verb === 'search') && slot !== null) {
    // An address-shaped Slot Jev reads as a navigation is navigated to.
    if (verb === 'navigate' && isAddressShaped(slot)) return { verb, target: null, slot }
    // Words about something, not an address (#353): the page, the site or
    // the web decides, and the verb word never does.
    const where = 'where' in answers ? answers.where.choice : null
    // Words that point on this site but not on this page (#340) are looked
    // for on the site: a search scoped to it, the Slot kept as the words —
    // at a later hop too, on a site the Task has not searched (#341).
    const site = where === 'site' ? scopableSite(page.url, hop) : null
    if (site !== null) return { verb: 'search', target: null, slot, site }
    if (hop === undefined) {
      // Words that point at this page (#353) never search: the most
      // probable click or open on the card is taken; when it gives none
      // any probability, the line is no Command. Elsewhere the words are
      // searched for on the web.
      if (where === 'page') return mostProbableOpening(answers.action, page, links) ?? none
      return { verb: 'search', target: null, slot }
    }
    // Past the first hop the words were already acted on (#332): a hop
    // never searches again. On a search landing it opens the most probable
    // click or open on the card — on a Web Engine's landing a result, never
    // the engine's own chrome; off one the Task has reached a page and a
    // target Jev barely offered would overrun it (#342), so the hop has no
    // next step — nor on a landing with nothing to open.
    if (!onResults(page.url, hop)) return none
    return mostProbableFallbackOpening(answers.action, page, links) ?? none
  }
  if (verb === 'press') {
    const key = slot === null ? null : pressKeyOf(slot)
    return { verb, target: null, slot, key: key ?? PRESS_KEYS.enter, times: 1 }
  }
  return { verb, target: null, slot }
}
