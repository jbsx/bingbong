import { parseSearchUrl } from '../browser/urlInput'
import { parseCliCommand, type CliCommand } from './cliGrammar'
import { normalizeWords, pressKeyOf, type Command, type CommandRef, type CommandVerb } from './command'
import { isAddressShaped } from './openAddress'

// The Local Match (CONTEXT.md, ADR 0076, #324): a Command settled from the
// Utterance and the page alone, without asking the Decision Model — the
// CLI grammar, or a plain verb and the one element the words can name: a
// label exactly one ref carries, or the Nth result on a search page ("the
// first result"). An `open` settles alone only when its words are shaped
// like an address; words about the page go to Jev with the refs. It is
// the fastest reading, and made lenient (`bestGuess`) it is the fallback
// when the Decision Model does not answer in time. Nothing here asks "did
// you mean": a reading that is not settled is null, and Jev is asked.

/** Words a spoken label wears that the ref's label does not: leading articles and trailing kind words. */
const ARTICLES: ReadonlySet<string> = new Set(['the', 'a', 'an', 'that', 'this', 'on'])
const KIND_WORDS: ReadonlySet<string> = new Set(['button', 'link', 'field', 'box', 'tab', 'input', 'option', 'item', 'icon', 'menu', 'thing', 'bar'])

type VerbKind = 'open' | 'search' | 'click' | 'press' | 'type' | CommandVerb

/**
 * The spoken verb phrases, each the words that open a Command of that kind.
 * Matched longest first, as the whole Utterance or as its head.
 */
const VERB_PHRASES: readonly (readonly [string, VerbKind])[] = [
  ['navigate to', 'open'],
  ['navigate', 'open'],
  ['go to', 'open'],
  ['goto', 'open'],
  ['take me to', 'open'],
  ['browse to', 'open'],
  ['open', 'open'],
  ['visit', 'open'],
  ['load', 'open'],
  ['search for', 'search'],
  ['search', 'search'],
  ['look up', 'search'],
  ['look for', 'search'],
  ['google', 'search'],
  ['find', 'search'],
  ['click on', 'click'],
  ['click', 'click'],
  ['tap on', 'click'],
  ['tap', 'click'],
  ['press on', 'click'],
  ['press', 'press'],
  ['hit', 'press'],
  ['push', 'press'],
  ['select', 'click'],
  ['choose', 'click'],
  ['activate', 'click'],
  ['type', 'type'],
  ['enter', 'type'],
  ['write', 'type'],
  ['put', 'type'],
  ['input', 'type'],
  ['fill in', 'type'],
  ['scroll down', 'scroll_down'],
  ['page down', 'scroll_down'],
  ['scroll', 'scroll_down'],
  ['scroll up', 'scroll_up'],
  ['page up', 'scroll_up'],
  ['go back', 'back'],
  ['back', 'back'],
  ['previous page', 'back'],
  ['go forward', 'forward'],
  ['forward', 'forward'],
  ['reload the page', 'reload'],
  ['reload', 'reload'],
  ['refresh the page', 'reload'],
  ['refresh', 'reload'],
  ['read the page', 'read'],
  ['read page', 'read'],
  ['read it', 'read'],
  ['read this', 'read'],
  ['read', 'read'],
  ['resume', 'resume'],
  ['continue', 'resume'],
  ['where was i', 'resume'],
  ['last page', 'resume'],
  ['the last page', 'resume'],
  ['pick up where i left off', 'resume'],
  ['clear the field', 'clear'],
  ['clear it', 'clear'],
  ['clear', 'clear'],
  ['stop', 'stop'],
  ['abort', 'stop'],
  ['cancel', 'stop'],
  ['never mind', 'stop'],
  ['nevermind', 'stop'],
]

/** Whole-Utterance words that are a verb with nothing after it: "down" scrolls, "enter" presses. */
const BARE_WORDS: Readonly<Record<string, VerbKind>> = { down: 'scroll_down', up: 'scroll_up', enter: 'press', escape: 'press', esc: 'press', return: 'press' }

/** The words that join an address to the verb phrase after it: "go to twitter and open …". */
const JOINERS: readonly string[] = ['and then', 'and', 'then']

/** The words between the text to type and the field it goes in. */
const TYPE_SEPARATORS: readonly string[] = ['into the', 'into', 'in the', 'in', 'on the', 'on', 'to the', 'to']

/** Input types a text cannot be typed into. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'range', 'color', 'image', 'hidden'])

/** One token of the Utterance: as spoken, and cleaned for matching (lower case, edge punctuation off, inner kept — `youtube.com` stays whole). */
interface Token {
  readonly spoken: string
  readonly clean: string
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((spoken) => ({ spoken: spoken.replace(/^[^\p{L}\p{N}/]+|[^\p{L}\p{N}/]+$/gu, ''), clean: spoken.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') }))
    .filter((token) => token.clean !== '')
}

function spokenOf(tokens: readonly Token[]): string {
  return tokens.map((token) => token.spoken).join(' ')
}

function cleanOf(tokens: readonly Token[]): string {
  return tokens.map((token) => token.clean).join(' ')
}

/** The verb phrase the Utterance opens with, and the tokens after it. */
function verbOf(tokens: readonly Token[]): { kind: VerbKind; rest: Token[] } | null {
  const clean = cleanOf(tokens)
  const bare = BARE_WORDS[clean]
  if (bare !== undefined) return { kind: bare, rest: [] }
  let best: { kind: VerbKind; length: number } | null = null
  for (const [phrase, kind] of VERB_PHRASES) {
    if (clean !== phrase && !clean.startsWith(`${phrase} `)) continue
    const length = phrase.split(' ').length
    if (best === null || length > best.length) best = { kind, length }
  }
  return best === null ? null : { kind: best.kind, rest: tokens.slice(best.length) }
}

/** The words of a spoken label without the articles and kind words a ref's label never carries. */
function labelWords(phrase: string): string[] {
  const words = normalizeWords(phrase).split(' ').filter((word) => word !== '')
  while (words.length > 1 && ARTICLES.has(words[0]!)) words.shift()
  while (words.length > 1 && KIND_WORDS.has(words[words.length - 1]!)) words.pop()
  return words
}

/** The one ref whose label is these words; null for none, or more than one. */
function exactlyOneLabelled(phrase: string, refs: readonly CommandRef[]): number | null {
  const wanted = labelWords(phrase).join(' ')
  if (wanted === '') return null
  const matches = refs.filter((ref) => normalizeWords(ref.label) === wanted)
  return matches.length === 1 ? matches[0]!.ref : null
}

/** The ref whose label shares the most words with the phrase — at least one — the first on a tie. */
function bestLabelled(phrase: string, refs: readonly CommandRef[]): number | null {
  const wanted = new Set(labelWords(phrase))
  if (wanted.size === 0) return null
  let best: { ref: number; shared: number } | null = null
  for (const ref of refs) {
    const words = new Set(normalizeWords(ref.label).split(' '))
    let shared = 0
    for (const word of wanted) if (words.has(word)) shared += 1
    if (shared > 0 && (best === null || shared > best.shared)) best = { ref: ref.ref, shared }
  }
  return best?.ref ?? null
}

function isTextField(ref: CommandRef): boolean {
  return ref.kind === 'input' && (ref.inputType === null || !NON_TEXT_INPUTS.has(ref.inputType.toLowerCase()))
}

/** The one text field on the page; null for none or several. */
function theOneTextField(refs: readonly CommandRef[]): number | null {
  const fields = refs.filter(isTextField)
  return fields.length === 1 ? fields[0]!.ref : null
}

/** The ordinals a spoken position names: "first result", "2nd link", "top one". */
const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  '1st': 1,
  top: 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  sixth: 6,
  '6th': 6,
  seventh: 7,
  '7th': 7,
  eighth: 8,
  '8th': 8,
  ninth: 9,
  '9th': 9,
  tenth: 10,
  '10th': 10,
}

/** What an ordinal counts: "the first result", "second link", "the top one". */
const ORDINAL_NOUNS: ReadonlySet<string> = new Set(['result', 'results', 'link', 'one', 'item', 'entry', 'hit', 'video', 'article', 'page', 'option', 'match'])

/** The position a phrase names and nothing else — "the first result" is 1; "the first video on the left" is null. */
function ordinalOf(phrase: string): number | null {
  const words = normalizeWords(phrase)
    .split(' ')
    .filter((word) => word !== '' && !ARTICLES.has(word))
  if (words.length < 1 || words.length > 2) return null
  const position = ORDINALS[words[0]!]
  if (position === undefined) return null
  if (words.length === 2 && !ORDINAL_NOUNS.has(words[1]!)) return null
  return position
}

/** The address's host without a leading `www.`; null for text that is no URL. */
function hostOf(url: string): string | null {
  if (!URL.canParse(url)) return null
  return new URL(url).host.replace(/^www\./, '').toLowerCase()
}

/** Whether an address on a search page is one of its results: it leaves the engine, or is the engine's redirect to one. */
function isResultAddress(href: string, engineHost: string): boolean {
  const host = hostOf(href)
  if (host === null) return false
  if (host !== engineHost) return true
  const params = new URL(href).searchParams
  return params.has('uddg') || params.has('url')
}

function isResultLink(ref: CommandRef, engineHost: string): boolean {
  return ref.kind === 'link' && ref.href !== null && isResultAddress(ref.href, engineHost)
}

/**
 * The results among a search page's links (#328): the same rule as the
 * Nth result — the links whose address leaves the engine, or is its
 * redirect to one. Empty off a search page.
 */
export function resultLinksOf<L extends { readonly href: string }>(links: readonly L[], url: string): L[] {
  if (url === '' || parseSearchUrl(url) === null) return []
  const engineHost = hostOf(url)
  if (engineHost === null) return []
  return links.filter((link) => isResultAddress(link.href, engineHost))
}

/**
 * The page an address leads to, for telling whether a Task has been there
 * (#328): an engine's redirect is its target, and the fragment, a trailing
 * slash, `www.` and the host's case make no other page.
 */
export function pageAddressOf(href: string): string {
  if (!URL.canParse(href)) return href
  const url = new URL(href)
  const target = url.searchParams.get('uddg') ?? url.searchParams.get('url')
  if (target !== null && URL.canParse(target) && target !== href) return pageAddressOf(target)
  const host = url.host.replace(/^www\./, '').toLowerCase()
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${host}${path}${url.search}`
}

/**
 * The Nth result on a search results page: the Nth link whose address
 * leaves the engine's host (the engine's own links — home, settings,
 * ads — are not results). Null off a search page, or past the last.
 */
function nthResult(position: number, refs: readonly CommandRef[], url: string): number | null {
  if (url === '' || parseSearchUrl(url) === null) return null
  const engineHost = hostOf(url)
  if (engineHost === null) return null
  const results = refs.filter((ref) => isResultLink(ref, engineHost))
  return results[position - 1]?.ref ?? null
}

/** The text to type and the field it names, split at the last "in"/"into"/"on" that leaves words on both sides. */
function splitTyped(rest: readonly Token[]): { slot: string; field: string | null } {
  for (let at = rest.length - 1; at >= 1; at -= 1) {
    for (const separator of TYPE_SEPARATORS) {
      const words = separator.split(' ')
      const start = at - words.length + 1
      if (start < 1) continue
      if (cleanOf(rest.slice(start, at + 1)) !== separator) continue
      const field = rest.slice(at + 1)
      if (field.length === 0) continue
      return { slot: spokenOf(rest.slice(0, start)), field: spokenOf(field) }
    }
  }
  return { slot: spokenOf(rest), field: null }
}

function command(verb: CommandVerb, extra?: Partial<Command>): Command {
  return { verb, target: null, slot: null, ...extra }
}

/** The CLI grammar's command as a Command; null for `quit`, the harness's own. */
function fromGrammar(parsed: CliCommand): Command | null {
  switch (parsed.type) {
    case 'navigate':
      return command('open', { slot: parsed.input })
    case 'read':
      return command('read')
    case 'click':
      return command('click', { target: parsed.ref })
    case 'type':
      return command('type', { target: parsed.ref, slot: parsed.text })
    case 'scroll':
      return command(parsed.direction === 'up' ? 'scroll_up' : 'scroll_down')
    case 'press':
      // The grammar's key, named as its Slot the way it was typed ("enter", "up").
      return command('press', { slot: parsed.press.key.replace(/^Arrow/, '').toLowerCase(), key: parsed.press, times: parsed.times })
    case 'screenshot':
      return command('screenshot', { slot: parsed.path ?? null })
    case 'back':
      return command('back')
    case 'reload':
      return command('reload')
    case 'resume':
      return command('resume')
    case 'help':
      return command('help')
    case 'quit':
      return null
  }
}

/**
 * The address an `open`'s words start with when words past it go on (#341):
 * the longest leading span that is address-shaped and is followed by a
 * joiner and another verb phrase — "twitter" in "twitter and open donald
 * trumps profile". Null when the words are an address whole, or no such
 * span starts them: "the menu" names no address with more to do.
 */
function addressBeforeMore(rest: readonly Token[]): string | null {
  if (isAddressShaped(spokenOf(rest))) return null
  for (let end = rest.length - 1; end >= 1; end -= 1) {
    const address = spokenOf(rest.slice(0, end))
    if (!isAddressShaped(address)) continue
    const after = rest.slice(end)
    const joiner = JOINERS.find((words) => cleanOf(after).startsWith(`${words} `))
    if (joiner !== undefined && verbOf(after.slice(joiner.split(' ').length)) !== null) return address
  }
  return null
}

/**
 * Whether an Utterance opens an address and carries words past it (#341):
 * "go to twitter and open donald trumps profile" — a Local-Matched `open`
 * of it goes on to hop 1 rather than ending the Task.
 */
export function carriesWordsPastAddress(text: string): boolean {
  const found = verbOf(tokenize(text))
  return found?.kind === 'open' && addressBeforeMore(found.rest) !== null
}

/** The Command a spoken verb and its words settle, exactly (`lenient` false) or by the best reading (`lenient` true). */
function readSpoken(text: string, refs: readonly CommandRef[], url: string, lenient: boolean): Command | null {
  const tokens = tokenize(text)
  if (tokens.length === 0) return null
  const found = verbOf(tokens)
  if (found === null) {
    // No plain verb (ADR 0076): the best guess reads the words as search
    // terms — a Misfire the next Command recovers — and the Local Match
    // settles nothing.
    return lenient ? command('open', { slot: spokenOf(tokens), search: true }) : null
  }
  const { kind, rest } = found
  const labelled = (): number | null => exactlyOneLabelled(spokenOf(rest), refs) ?? (lenient ? bestLabelled(spokenOf(rest), refs) : null)
  /** "the first result": the Nth result on a search page settles it; an ordinal anywhere else is Jev's (`unsettled`). */
  const ordinal = (): { target: number } | 'unsettled' | null => {
    const position = ordinalOf(spokenOf(rest))
    if (position === null) return null
    const target = nthResult(position, refs, url)
    return target !== null ? { target } : 'unsettled'
  }
  const clickOrNone = (): Command | null => {
    const nth = ordinal()
    if (nth !== null && nth !== 'unsettled') return command('click', { target: nth.target })
    if (nth === 'unsettled' && !lenient) return null
    const target = labelled()
    if (target !== null) return command('click', { target })
    return lenient ? command('none') : null
  }
  switch (kind) {
    case 'press': {
      // The bare key words: "enter" alone, "press enter".
      const key = pressKeyOf(cleanOf(rest.length === 0 ? tokens : rest))
      if (key !== null) return command('press', { slot: cleanOf(rest.length === 0 ? tokens : rest), key, times: 1 })
      return clickOrNone()
    }
    case 'click':
      return rest.length === 0 ? (lenient ? command('none') : null) : clickOrNone()
    case 'open': {
      if (rest.length === 0) return lenient ? command('none') : null
      // A label exactly one ref carries, or the Nth result on a search
      // page, is opened by clicking it; an address is opened; words about
      // the page that settle neither are Jev's — the best guess searches them.
      const target = exactlyOneLabelled(spokenOf(rest), refs)
      if (target !== null) return command('click', { target })
      const nth = ordinal()
      if (nth !== null && nth !== 'unsettled') return command('click', { target: nth.target })
      // An address with words past it (#341) opens the address; the Task reads the rest on its landing.
      const address = nth === 'unsettled' ? null : addressBeforeMore(rest)
      if (address !== null) return command('open', { slot: address })
      if (!lenient && (nth === 'unsettled' || !isAddressShaped(spokenOf(rest)))) return null
      return command('open', { slot: spokenOf(rest) })
    }
    case 'search':
      return rest.length === 0 ? (lenient ? command('none') : null) : command('open', { slot: spokenOf(rest), search: true })
    case 'type': {
      if (rest.length === 0) return lenient ? command('none') : null
      const { slot, field } = splitTyped(rest)
      let target: number | null = null
      if (field !== null) target = exactlyOneLabelled(field, refs) ?? (lenient ? bestLabelled(field, refs) : null)
      if (target === null && field === null) target = theOneTextField(refs)
      if (target === null && lenient) target = refs.find(isTextField)?.ref ?? null
      if (target === null) return lenient ? command('none') : null
      return command('type', { target, slot })
    }
    default:
      return command(kind)
  }
}

/**
 * The words after the verb phrase that heads the Utterance, as spoken; the
 * whole Utterance when no verb heads it. The Slot Jev's `none` falls back
 * to for a verb that needs one.
 */
export function wordsAfterVerb(text: string): string {
  const tokens = tokenize(text)
  const found = verbOf(tokens)
  return spokenOf(found === null || found.rest.length === 0 ? tokens : found.rest)
}

/**
 * Whether the words are a whole verb phrase that heads a longer one of
 * another kind — "scroll" (down) heads "scroll up" — so a partial
 * transcript that reads this way may still become a different Command
 * (Early Fire, #326). "read" heading "read the page" is the same Command,
 * and holds nothing back.
 */
export function headsAnotherVerb(text: string): boolean {
  const clean = cleanOf(tokenize(text))
  const kind = BARE_WORDS[clean] ?? VERB_PHRASES.find(([phrase]) => phrase === clean)?.[1]
  if (kind === undefined) return false
  return VERB_PHRASES.some(([phrase, other]) => other !== kind && phrase.startsWith(`${clean} `))
}

/**
 * The Local Match: the CLI grammar, or a plain verb and the one element the
 * words can name — the label exactly one ref carries, or the Nth result on
 * a search page (`url` is the page's address). Null when the words and the
 * page settle no Command — the Decision Model is asked then.
 */
export function localMatch(text: string, refs: readonly CommandRef[], url = ''): Command | null {
  const parsed = parseCliCommand(text)
  if (parsed !== null && parsed.ok) return fromGrammar(parsed.command)
  return readSpoken(text, refs, url, false)
}

/**
 * The best guess: the Local Match where one exists, else the same reading
 * made lenient — the ref sharing the most words, the first text field,
 * the words as search terms — what fires when Jev does not answer. Never
 * null: nothing to read is `none`.
 */
export function bestGuess(text: string, refs: readonly CommandRef[], url = ''): Command {
  return localMatch(text, refs, url) ?? readSpoken(text, refs, url, true) ?? command('none')
}
