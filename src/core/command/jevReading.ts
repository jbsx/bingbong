import type { DecisionChoiceAnswer, DecisionChoiceQuestion, DecisionNoulQuestion } from '../ports/decisionModel'
import type { PageLink, PageMedia } from '../browser/snapshot'
import { JEV_VERBS, PRESS_KEYS, describeCommand, normalizeWords, pressKeyOf, targetLabel, verbTakesSlot, verbTakesTarget, type Command, type CommandPage, type CommandRef, type CommandVerb } from './command'
import { dialogControls, type DismissChoice } from './dismissDialog'
import { isSearchLanding, pageAddressOf, resultLinksOf, resultRefsOf, wordsAfterVerb } from './localMatch'
import { isAddressShaped } from './openAddress'
import { isWebEngineSearch, siteOf } from './siteScope'
import { CAPABILITY_DESCRIPTIONS, CAPABILITY_INSTRUCTIONS, capabilityAction, capabilitySearches, isCapability, type Capability } from './capability'

// One Jev call per Command the Local Match cannot settle (#324, ADR 0076).
// The state is the transcript, the page's address and title and its
// numbered refs — label, kind, href, no page text. Three Choices are asked
// in parallel: the verb — an action the browser can take, never a word the
// user said (#353), so "open the tweet" is Jev's to read as a click, a
// search or a navigation — the target among the refs plus `none`, and the
// Slot among the transcript's contiguous word spans; on a site, a fourth
// beside them — where the words point (#340), at a later hop only on a site
// the Task has not searched (#341); at every hop past the first, the
// Verdict beside them — is this page what was asked for — so a Task's end
// is a sure answer and never a verb's plurality. Unneeded answers are
// ignored; the top Choice is acted on at any confidence; only `none` as
// the verb drops the Utterance. Speed over accuracy: nothing here asks
// "did you mean". While the appliance can act itself — the Player's ops
// (ADR 0079) — its Capabilities join the verb Choice beside the browser's.

/** A Choice offers at most 255 options; one is `none`. */
const MAX_SPANS = 254

const VERB_DESCRIPTIONS: Readonly<Record<(typeof JEV_VERBS)[number], string>> = {
  navigate: 'go to a web address the words name: a website, a host or a url',
  search: 'search for the words: on the web, or on this site when they point at something on it',
  click: 'click one of the numbered refs on the page',
  type: 'type words into one of the numbered refs (a text field)',
  menu: 'open the menu on one of the numbered refs (a right-click) to see options it hides',
  scroll_up: 'scroll the page up',
  scroll_down: 'scroll the page down',
  back: 'go back to the previous page',
  forward: 'go forward',
  reload: 'reload the page',
  press: 'press a key: enter, escape, space or an arrow key',
  read: 'read the page aloud or show its contents',
  clear: 'clear the text in the focused field',
  stop: 'stop what the browser is doing',
  done: 'this page is what the user asked for: nothing more to do',
  none: 'not a command for this page: a remark, a question, a name, noise',
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

function describeRef(ref: CommandRef): string {
  const kind = ref.kind === 'input' && ref.inputType !== null ? `input[${ref.inputType}]` : ref.kind
  return `${kind} ${JSON.stringify(ref.label)}${ref.href !== null ? ` ${ref.href}` : ''}`
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
  | { readonly changed: true; readonly opened?: string; readonly appeared?: readonly string[]; readonly covered?: boolean; readonly closed?: boolean; readonly media?: readonly string[] }

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

export function doneFacts(before: CommandPage, after: CommandPage, result: DoneResult): DoneResult {
  // A change to the media element is one the DOM does not show (#363): Loop ticked in a right-click menu changes no ref.
  const media = mediaChanges(before.media, after.media)
  if (!result.changed) return media.length > 0 ? { changed: true, media } : result
  const fresh = freshRefs(before, after)
  const inDialog = new Set(after.dialog?.refs ?? [])
  const appeared = [...fresh.filter((ref) => inDialog.has(ref.ref)), ...fresh.filter((ref) => !inDialog.has(ref.ref))].slice(0, NAMED_APPEARANCES).map((ref) => ref.label)
  const covered = after.dialog !== undefined && before.dialog === undefined
  const closed = before.dialog !== undefined && after.dialog === undefined
  return { ...result, ...(appeared.length > 0 ? { appeared } : {}), ...(covered ? { covered: true } : {}), ...(closed ? { closed: true } : {}), ...(media.length > 0 ? { media } : {}) }
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

/** What a changed page came to, in facts. */
function changedFacts(result: Extract<DoneResult, { changed: true }>): string {
  const page = pageFacts(result)
  const media = result.media ?? []
  if (media.length === 0) return page
  // A change the media element alone shows: the page's own line says only "the page changed", which it adds nothing to.
  return page === 'the page changed' ? media.join('; ') : `${page}; ${media.join('; ')}`
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
 * The runner-up of a reading (#363, ADR 0079): the most probable ref of
 * its target answer that is not the one it fired, nor one the Task set
 * aside, at {@link RUNNER_UP_FLOOR} or over — named by its set-aside
 * identity, since the page it is fired on is collected anew. Null when
 * there is none.
 */
export function runnerUpOf(target: DecisionChoiceAnswer, page: CommandPage, fired: number, setAside: readonly SetAside[]): SetAside | null {
  const firedRef = page.refs.find((ref) => ref.ref === fired)
  const excluded = [...setAside, ...(firedRef !== undefined ? [setAsideOf(firedRef, page)] : [])]
  const ranked = Object.entries(target.probabilities)
    .filter(([, probability]) => probability >= RUNNER_UP_FLOOR)
    .sort((a, b) => b[1] - a[1])
  for (const [label] of ranked) {
    const ref = page.refs.find((candidate) => candidate.ref === refOfLabel(label))
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

/** A result link a hop may open, numbered as its `link-N` option. */
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

/** The state the three questions are asked over; at a hop past the first, where the Task stands; in a Step, where the line stands. */
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
    'Refs (number, kind, label, address):',
    ...shown.page.refs.map((ref) => `[${ref.ref}] ${describeRef(ref)}`),
    ...(shown.links.length > 0 ? [`${isWebEngineSearch(page.url) ? 'Result links' : 'Links'} further down the page (name, address):`, ...shown.links.map((link) => `[link-${link.n}] ${describeLink(link)}`)] : []),
  ].join('\n')
}

/** A type, not an interface, so it reads as the port's `DecisionQuestions` record. */
type ThreeQuestions = {
  readonly verb: DecisionChoiceQuestion
  readonly target: DecisionChoiceQuestion
  readonly slot: DecisionChoiceQuestion
}

/**
 * The reading's questions (#340): the three, or the three and `where` —
 * a union, never an optional key, so each still reads as the port's
 * `DecisionQuestions` record — and at hop 0, on a line with a conjunction,
 * `steps` (#364).
 */
type ReadingQuestions = ThreeQuestions | (ThreeQuestions & { readonly where: DecisionChoiceQuestion })
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
 * The questions: the verb, the target, the Slot; at a hop past the first,
 * the targets are what the hop offers. On a site (#340) — a real page that
 * is no Web Engine's web search — `where` is asked beside them in the same
 * call; an Early Fire partial is a hop-0 reading and asks it too; a later
 * hop asks it on a site the Task has not searched (#341). At hop 0, on a
 * line with a conjunction, `steps` is asked too (#364) — never at a later
 * hop, on a partial, over a pop-up a dismiss phrase closes, or for a Step's
 * own words (`steps: false`).
 */
export function commandQuestions(text: string, pageRead: CommandPage, hop?: HopContext, options: { readonly steps?: boolean; readonly capabilities?: readonly Capability[] } = {}): CommandQuestions {
  const three = threeQuestions(text, pageRead, hop, options.capabilities ?? [])
  const site = scopableSite(pageRead.url, hop)
  const reading = site === null ? three : { ...three, where: whereQuestion(site) }
  const steps = hop === undefined && options.steps !== false ? stepsQuestion(text) : null
  return steps === null ? reading : { ...reading, steps }
}

function threeQuestions(text: string, pageRead: CommandPage, hop: HopContext | undefined, capabilities: readonly Capability[]): ThreeQuestions {
  const { page, links } = offered(pageRead, hop)
  const instructions = 'Which verb did the user ask the browser for? Choose none when the words are not a command for this page.'
  return {
    verb: {
      type: 'choice',
      instructions: capabilities.length === 0 ? instructions : `${instructions} ${CAPABILITY_INSTRUCTIONS}`,
      options: { ...VERB_DESCRIPTIONS, ...Object.fromEntries(capabilities.map((capability) => [capability, CAPABILITY_DESCRIPTIONS[capability]])) },
    },
    target: {
      type: 'choice',
      instructions: 'Which numbered ref on the page do the words name as the thing to click or type into? Choose none when the command needs no ref, or names none of them.',
      options: {
        none: 'no ref: the command does not act on one element',
        ...Object.fromEntries(page.refs.map((ref) => [`ref-${ref.ref}`, describeRef(ref)])),
        ...Object.fromEntries(links.map((link) => [`link-${link.n}`, describeLink(link)])),
      },
    },
    slot: {
      type: 'choice',
      instructions: 'Which words of the transcript are the thing the command carries verbatim: the address to open, the search terms, the song to play, the text to type, the key to press? Never the command word itself: "play X" carries X. Choose none when it carries none.',
      options: { none: 'the command carries no words of its own', ...Object.fromEntries(slotSpans(text).map((span) => [`s${span.start}-${span.end}`, span.words])) },
    },
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

type ThreeAnswers = {
  readonly verb: DecisionChoiceAnswer
  readonly target: DecisionChoiceAnswer
  readonly slot: DecisionChoiceAnswer
}

/** The answers to {@link CommandQuestions}: the three, or the three and `where`; `steps` when it was asked (#364). */
type ReadingAnswers = ThreeAnswers | (ThreeAnswers & { readonly where: DecisionChoiceAnswer })
export type CommandAnswers = ReadingAnswers | (ReadingAnswers & { readonly steps: DecisionChoiceAnswer })

function refOfLabel(label: string): number | null {
  const match = /^ref-(\d+)$/.exec(label)
  return match ? Number(match[1]) : null
}

/** The ref a `ref-N` label names, when the page offers it. */
function offeredRef(label: string, page: CommandPage): number | null {
  const ref = refOfLabel(label)
  return ref !== null && page.refs.some((candidate) => candidate.ref === ref) ? ref : null
}

/** The offered result link a `link-N` label names. */
function linkOfLabel(label: string, links: readonly OfferedLink[]): OfferedLink | undefined {
  const match = /^link-(\d+)$/.exec(label)
  return match === null ? undefined : links.find((candidate) => candidate.n === Number(match[1]))
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

/** The most probable ref the target answer holds; null when it gives no offered ref any probability — never a ref Jev did not name (owner's rule 2026-10-19). */
function mostProbableRef(answer: DecisionChoiceAnswer, page: CommandPage): number | null {
  return offeredRef(answer.choice, page) ?? mostProbable(answer, (label) => offeredRef(label, page))
}

/**
 * The opening of the offered target the target answer gives the most
 * probability, `none` set aside (#332): a ref is clicked, a result link
 * opened at its address; null when the answer gives no offered target any.
 */
function mostProbableOpening(answer: DecisionChoiceAnswer, page: CommandPage, links: readonly OfferedLink[]): Command | null {
  return mostProbable<Command>(answer, (label) => {
    const ref = offeredRef(label, page)
    if (ref !== null) return { verb: 'click', target: ref, slot: null }
    const link = linkOfLabel(label, links)
    return link === undefined ? null : { verb: 'navigate', target: null, slot: link.href }
  })
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

/** The most probable ref a later hop may fall back on: on a Web Engine's landing a result alone ({@link fallbackTargets}). */
function mostProbableFallbackRef(answer: DecisionChoiceAnswer, page: CommandPage): number | null {
  const { refs } = fallbackTargets(page, [])
  return mostProbable(answer, (label) => {
    const ref = offeredRef(label, page)
    return ref !== null && (refs === null || refs.has(ref)) ? ref : null
  })
}

/** {@link mostProbableOpening} for a later hop on a search landing: on a Web Engine's, a result or nothing ({@link fallbackTargets}). */
function mostProbableFallbackOpening(answer: DecisionChoiceAnswer, page: CommandPage, links: readonly OfferedLink[]): Command | null {
  const targets = fallbackTargets(page, links)
  return mostProbable<Command>(answer, (label) => {
    const ref = offeredRef(label, page)
    if (ref !== null) return targets.refs === null || targets.refs.has(ref) ? { verb: 'click', target: ref, slot: null } : null
    const link = linkOfLabel(label, targets.links)
    return link === undefined ? null : { verb: 'navigate', target: null, slot: link.href }
  })
}

/** The words the Slot answer names; the words after the verb when it names none — what a Task that found nothing says it could not find (#363). */
export function slotWords(answer: DecisionChoiceAnswer, text: string): string {
  const match = /^s(\d+)-(\d+)$/.exec(answer.choice)
  if (match) {
    const words = wordsOf(text)
    const span = words.slice(Number(match[1]), Number(match[2]) + 1).join(' ')
    if (span !== '') return span
  }
  return wordsAfterVerb(text)
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

/** The Command Jev's answers make: the top Choice of each, read as the verb needs them. */
export function readCommandAnswers(answers: CommandAnswers | HopAnswers, text: string, pageRead: CommandPage, hop?: HopContext): Command {
  const none: Command = { verb: 'none', target: null, slot: null }
  if (isCapability(answers.verb.choice)) return capabilityCommand(answers.verb.choice, answers.slot, text) ?? none
  const verb = answers.verb.choice as CommandVerb
  if (!JEV_VERBS.includes(verb as (typeof JEV_VERBS)[number]) || verb === 'none') return none
  if (verb === 'done') return { verb, target: null, slot: null }
  const { page, links } = offered(pageRead, hop)
  if (verb === 'click' || verb === 'navigate' || verb === 'search') {
    // A result link further down the page has no ref to click: it is opened at its address.
    const chosen = linkOfLabel(answers.target.choice, links)
    if (chosen !== undefined) return { verb: 'navigate', target: null, slot: chosen.href }
  }
  let target: number | null = null
  if (verbTakesTarget(verb)) {
    // Past the first hop, off a search landing, a ref Jev barely offered
    // under a top `none` would walk the Task off the page it reached (as
    // #342 for an open): a click or a type acts only on the ref Jev names.
    // On a landing the most probable ref stands in for a top `none` — on a
    // Web Engine's, a result alone, never its chrome (2026-10-19).
    const later = hop !== undefined && hop.hop > 0
    if (!later) target = mostProbableRef(answers.target, page)
    else target = offeredRef(answers.target.choice, page) ?? (onResults(page.url, hop) ? mostProbableFallbackRef(answers.target, page) : null)
    // A click or a type on a page with nothing to act on is no Command.
    if (target === null) return none
  }
  const slot = verbTakesSlot(verb) ? slotWords(answers.slot, text) : null
  if ((verb === 'navigate' || verb === 'search') && slot !== null) {
    // An address-shaped Slot Jev reads as a navigation is navigated to, whatever the target says.
    if (verb === 'navigate' && isAddressShaped(slot)) return { verb, target: null, slot }
    // Words about something, not an address (#353): the page, the site or
    // the web decides, and the verb word never does. A target Choice that
    // names a ref outright is the thing the words name, and opening it is
    // clicking it — the Local Match's own rule for a label one ref carries.
    const chosen = offeredRef(answers.target.choice, page)
    if (chosen !== null) return { verb: 'click', target: chosen, slot: null }
    const where = 'where' in answers ? answers.where.choice : null
    // Words that point on this site but not on this page (#340) are looked
    // for on the site: a search scoped to it, the Slot kept as the words —
    // at a later hop too, on a site the Task has not searched (#341).
    const site = where === 'site' ? scopableSite(page.url, hop) : null
    if (site !== null) return { verb: 'search', target: null, slot, site }
    if (hop === undefined) {
      // Words that point at this page (#353) never search: the most
      // probable ref Jev gave any probability is opened, `none` set aside;
      // when it gave none any, the line is no Command. Elsewhere the words
      // are searched for on the web.
      if (where === 'page') return mostProbableOpening(answers.target, page, links) ?? none
      return { verb: 'search', target: null, slot }
    }
    // Past the first hop the words were already acted on (#332): a hop
    // never searches again. On a search landing it opens the most probable
    // target the hop offers, Jev often topping `none` over the right result
    // — on a Web Engine's landing a result, never the engine's own chrome;
    // off one the Task has reached a page and a target Jev barely offered
    // would overrun it (#342), so the hop has no next step — nor on a
    // landing with nothing to open.
    if (!onResults(page.url, hop)) return none
    return mostProbableFallbackOpening(answers.target, page, links) ?? none
  }
  if (verb === 'press') {
    const key = slot === null ? null : pressKeyOf(slot)
    return { verb, target: null, slot, key: key ?? PRESS_KEYS.enter, times: 1 }
  }
  return { verb, target, slot }
}
