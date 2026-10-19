import type { DecisionChoiceAnswer, DecisionChoiceQuestion, DecisionNoulQuestion } from '../ports/decisionModel'
import type { PageLink } from '../browser/snapshot'
import { JEV_VERBS, PRESS_KEYS, describeCommand, pressKeyOf, targetLabel, verbTakesSlot, verbTakesTarget, type Command, type CommandPage, type CommandRef, type CommandVerb } from './command'
import { isSearchLanding, pageAddressOf, resultLinksOf, wordsAfterVerb } from './localMatch'
import { isAddressShaped } from './openAddress'
import { siteOf } from './siteScope'

// One Jev call per Command the Local Match cannot settle (#324, ADR 0076).
// The state is the transcript, the page's address and title and its
// numbered refs — label, kind, href, no page text. Three Choices are asked
// in parallel: the verb — an action the browser can take, never a word the
// user said (#353), so "open the tweet" is Jev's to read as a click, a
// search or a navigation — the target among the refs plus `none`, and the
// Slot among the transcript's contiguous word spans; on a site, a fourth
// beside them — where the words point (#340), at a later hop only on a site
// the Task has not searched (#341). Unneeded answers are
// ignored; the top Choice is acted on at any confidence; only `none` as
// the verb drops the Utterance. Speed over accuracy: nothing here asks
// "did you mean".

/** A Choice offers at most 255 options; one is `none`. */
const MAX_SPANS = 254

const VERB_DESCRIPTIONS: Readonly<Record<(typeof JEV_VERBS)[number], string>> = {
  navigate: 'go to a web address the words name: a website, a host or a url',
  search: 'search for the words: on the web, or on this site when they point at something on it',
  click: 'click one of the numbered refs on the page',
  type: 'type words into one of the numbered refs (a text field)',
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

/** The set-aside identity of a ref on a page. */
export function setAsideOf(ref: CommandRef, page: CommandPage): SetAside {
  return { label: ref.label, address: pageAddressOf(ref.href ?? page.url) }
}

/** How an action came out, for the next hop's "Done so far" (#336). */
export type DoneResult = { readonly changed: false } | { readonly changed: true; readonly opened?: string }

/** An address as "Done so far" names it: no scheme, no www, no trailing slash. */
function shortAddress(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '')
}

/**
 * One action in a hop's "Done so far" (#336): the verb and its target by
 * label (a ref's number changes between hops), and what it did —
 * `click "Pinned…" (nothing changed)`, `click "Elon Musk" (opened x.com/elonmusk)`.
 */
export function doneLine(command: Command, page: CommandPage, result: DoneResult): string {
  const label = targetLabel(command, page)
  const action =
    label === undefined
      ? describeCommand(command)
      : command.verb === 'type'
        ? `type ${JSON.stringify(command.slot ?? '')} into ${JSON.stringify(label)}`
        : `${command.verb} ${JSON.stringify(label)}`
  const outcome = !result.changed ? 'nothing changed' : result.opened !== undefined ? `opened ${shortAddress(result.opened)}` : 'the page changed'
  return `${action} (${outcome})`
}

/** A result link a hop may open, numbered as its `link-N` option. */
interface OfferedLink extends PageLink {
  readonly n: number
}

/** What a hop offers of a page: its refs and result links, none of them an address the Task has visited, no link twice or already a ref. */
function offered(page: CommandPage, hop: HopContext | undefined): { page: CommandPage; links: OfferedLink[] } {
  if (hop === undefined) return { page, links: [] }
  const seen = new Set(hop.visited.map(pageAddressOf))
  const fresh = (href: string | null): boolean => href === null || !seen.has(pageAddressOf(href))
  const setAside = hop.setAside ?? []
  const kept = (ref: CommandRef): boolean => {
    const own = setAsideOf(ref, page)
    return !setAside.some((aside) => aside.label === own.label && aside.address === own.address)
  }
  const refs = page.refs.filter((ref) => fresh(ref.href) && kept(ref))
  const taken = new Set(page.refs.flatMap((ref) => (ref.href === null ? [] : [pageAddressOf(ref.href)])))
  const links: OfferedLink[] = []
  // A Choice holds at most 255 options: `none`, the refs, then the links.
  const room = MAX_SPANS - refs.length
  for (const link of resultLinksOf(hop.links, page.url)) {
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

/** The state the three questions are asked over; at a hop past the first, where the Task stands. */
export function commandState(text: string, page: CommandPage, hop?: HopContext): string {
  const shown = offered(page, hop)
  return [
    `The user spoke to a web browser: ${JSON.stringify(text)}`,
    ...(hop !== undefined
      ? [`This is step ${hop.hop + 1} of the task. Done so far: ${hop.actions.join('; ') || 'nothing'}`, `Pages visited: ${hop.visited.join(' ') || 'none'}`]
      : []),
    `Page: ${page.url} — ${JSON.stringify(page.title)}`,
    ...(page.dialog !== undefined ? [`A dialog is open: ${JSON.stringify(page.dialog.text)}`] : []),
    'Refs (number, kind, label, address):',
    ...shown.page.refs.map((ref) => `[${ref.ref}] ${describeRef(ref)}`),
    ...(shown.links.length > 0 ? ['Result links further down the page (name, address):', ...shown.links.map((link) => `[link-${link.n}] ${describeLink(link)}`)] : []),
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
 * `DecisionQuestions` record.
 */
export type CommandQuestions = ThreeQuestions | (ThreeQuestions & { readonly where: DecisionChoiceQuestion })

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
 * hop asks it on a site the Task has not searched (#341).
 */
export function commandQuestions(text: string, pageRead: CommandPage, hop?: HopContext): CommandQuestions {
  const three = threeQuestions(text, pageRead, hop)
  const site = scopableSite(pageRead.url, hop)
  return site === null ? three : { ...three, where: whereQuestion(site) }
}

function threeQuestions(text: string, pageRead: CommandPage, hop: HopContext | undefined): ThreeQuestions {
  const { page, links } = offered(pageRead, hop)
  return {
    verb: {
      type: 'choice',
      instructions: 'Which verb did the user ask the browser for? Choose none when the words are not a command for this page.',
      options: { ...VERB_DESCRIPTIONS },
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
      instructions: 'Which words of the transcript are the thing the command carries verbatim: the address to open, the search terms, the text to type, the key to press? Choose none when it carries none.',
      options: { none: 'the command carries no words of its own', ...Object.fromEntries(slotSpans(text).map((span) => [`s${span.start}-${span.end}`, span.words])) },
    },
  }
}

/**
 * A partial transcript's questions (Early Fire, #326): the three Choices
 * and one Noul — whether the words so far are the whole Command. The Noul
 * decides only whether to wait for more words, never whether to act.
 */
export type PartialQuestions = CommandQuestions & { readonly complete: DecisionNoulQuestion }

export function partialQuestions(text: string, page: CommandPage): PartialQuestions {
  return {
    ...commandQuestions(text, page),
    complete: { type: 'noul', instructions: 'Is this a complete command, with nothing still to be said?' },
  }
}

type ThreeAnswers = {
  readonly verb: DecisionChoiceAnswer
  readonly target: DecisionChoiceAnswer
  readonly slot: DecisionChoiceAnswer
}

/** The answers to {@link CommandQuestions}: the three, or the three and `where`. */
export type CommandAnswers = ThreeAnswers | (ThreeAnswers & { readonly where: DecisionChoiceAnswer })

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

/** The most probable ref the target answer holds; null when the page has none. */
function mostProbableRef(answer: DecisionChoiceAnswer, page: CommandPage): number | null {
  return offeredRef(answer.choice, page) ?? mostProbable(answer, (label) => offeredRef(label, page)) ?? page.refs[0]?.ref ?? null
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

/** The words the Slot answer names; the words after the verb when it names none. */
function slotWords(answer: DecisionChoiceAnswer, text: string): string {
  const match = /^s(\d+)-(\d+)$/.exec(answer.choice)
  if (match) {
    const words = wordsOf(text)
    const span = words.slice(Number(match[1]), Number(match[2]) + 1).join(' ')
    if (span !== '') return span
  }
  return wordsAfterVerb(text)
}

/** The Command Jev's answers make: the top Choice of each, read as the verb needs them. */
export function readCommandAnswers(answers: CommandAnswers, text: string, pageRead: CommandPage, hop?: HopContext): Command {
  const verb = answers.verb.choice as CommandVerb
  const none: Command = { verb: 'none', target: null, slot: null }
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
    target = mostProbableRef(answers.target, page)
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
    // target the hop offers, Jev often topping `none` over the right result;
    // off one the Task has reached a page and a target Jev barely offered
    // would overrun it (#342), so the hop has no next step — nor on a
    // landing with nothing to open.
    if (!isSearchLanding(page.url)) return none
    return mostProbableOpening(answers.target, page, links) ?? none
  }
  if (verb === 'press') {
    const key = slot === null ? null : pressKeyOf(slot)
    return { verb, target: null, slot, key: key ?? PRESS_KEYS.enter, times: 1 }
  }
  return { verb, target, slot }
}
