import { DEFAULT_DECISION_THRESHOLDS, choiceProbability, type DecisionChoiceAnswer, type DecisionChoiceQuestion, type DecisionNoulAnswer, type DecisionNoulQuestion } from '../ports/decisionModel'
import type { MediaFacts, PageLink, PageMedia, RegionFacts } from '../browser/snapshot'
import type { DialogText, TextBelow } from '../browser/pageText'
import { isRealPage } from '../browser/lastPage'
import { JEV_VERBS, PRESS_KEYS, describeCommand, normalizeWords, pressKeyOf, showOpAction, targetLabel, verbTakesSlot, verbTakesTarget, type Command, type CommandPage, type CommandRef } from './command'
import { dialogControls, dialogTexts, type DismissChoice } from './dismissDialog'
import { isSearchLanding, isTextField, pageAddressOf, resultLinksOf, resultRefsOf, wordsAfterVerb } from './localMatch'
import { isAddressShaped } from './openAddress'
import type { NameHearing } from './nameMatch'
import { isMediaEngine, isWebEngineSearch, siteOf } from './siteScope'
import type { MusicAction } from '../music/musicWords'
import { EXTENT_RUNGS, describeExtent, extentQuestion, isScrollOp, regionChangeOf, regionStateOf, scrollExtent, scrollOpDescription, scrollOpOfVerb, scrollOpsOf, scrollVerbOf, type ExtentRung, type ScrollOp } from './scrollOp'
import { AMOUNT_RUNGS, LEVEL_RUNGS, amountQuestion, clockOf, describeMediaOp, isMediaOp, isSeek, mediaChangesOf, mediaOpDescription, mediaOpsOf, mediaStateOf, rateLevel, seekAmount, volumeLevel, type AmountRung, type LevelRung, type MediaOp, type MediaOpAction } from './mediaOp'
import { factOfLabel, sayOptions, withPageSong, type ApplianceFacts } from './applianceFacts'
import { promptChars } from '../decision/cardBudget'

// One Jev call per Command the Local Match cannot settle (#324, ADR 0076).
// The state is the transcript, the page's address and title, the text in
// view (#390) and its numbered refs — label, kind, href. Jev reads the Command
// as one whole action (#370): one Choice, the action card, whose every
// option is an action — a click, a type or a right-click on a numbered
// ref, an open of a link further down, a verb that needs no ref (an action
// the browser can take, never a word the user said, #353), an Appliance
// Verb while the appliance has something to act on (#374) — or `none`. Beside it in
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

/** A browser verb the action card offers as it is (#370): one that acts on no ref. */
type RefLessVerb = Exclude<(typeof JEV_VERBS)[number], 'click' | 'type' | 'menu' | 'media' | 'none'>

/** The verbs the action card offers as they are: every browser verb that acts on no ref. */
const REFLESS_VERBS = JEV_VERBS.filter((verb): verb is RefLessVerb => verb !== 'none' && !verbTakesTarget(verb))

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
  none: 'not a command for this page: a remark, a question, a name, noise',
}

/**
 * An Appliance Verb (CONTEXT.md, #374): a ref-less option that acts on the
 * appliance itself, never on the page — the Player's search (`play`,
 * `play_next`, `queue`), the Queue's walk (`skip`, `previous`), `show`,
 * and the corrections of the last pick (`correct`, `correct_back`,
 * `forget`), which read intent and so are never the grammar's (ADR 0089).
 * A fixed small set beside the browser's ref-less verbs, grown only with
 * the appliance's own features, never per site: the song's own ops are the
 * Media Ops its ref carries (ADR 0080).
 */
type ApplianceVerb = 'play' | 'play_next' | 'queue' | 'skip' | 'previous' | 'show' | 'correct' | 'correct_back' | 'forget'

/** Each Appliance Verb's Player action — the Command the grammar's exact lines make — and its one line on the card. */
const APPLIANCE_VERBS: Readonly<Record<ApplianceVerb, { readonly music: MusicAction; readonly line: string }>> = {
  play: { music: { kind: 'search', place: 'now' }, line: 'music: find a song or video by the words and play it now, on YouTube or on this site as the words point — never the page\'s play button, which is a click' },
  play_next: { music: { kind: 'search', place: 'front' }, line: 'music: find a song by the words and play it after the one playing' },
  queue: { music: { kind: 'search', place: 'end' }, line: 'music: find a song by the words and add it to the end of the queue' },
  skip: { music: { kind: 'skip' }, line: 'music: skip to the next song' },
  previous: { music: { kind: 'previous' }, line: 'music: go back to the song before' },
  show: { music: { kind: 'show' }, line: 'music: show the video playing on the screen' },
  correct: { music: { kind: 'correct', step: 1 }, line: 'music: the song playing is the wrong one: play the next result of its search instead' },
  correct_back: { music: { kind: 'correct', step: -1 }, line: 'music: play the result of the search before the song playing instead' },
  forget: { music: { kind: 'forget' }, line: 'music: forget the song playing, so its words search again next time' },
}

/**
 * What the card's instructions add beside a media ref's ops (#374): words
 * that say click, press or tap name a button on the page, never the
 * element's own op — "click play" over a playing video is YouTube's
 * toggle, not `play-N` (replay 2026-10-21, the "click play" case: click
 * 0.14–0.20 with the clause on the `play` line, 0.36–0.45 with the
 * Capabilities' paragraph, 0.64–0.78 with this; a second example, "press
 * pause", cost the captions cases ~0.06, and none dropped click play to
 * 0.34–0.48).
 */
const CLICK_NAMES_A_BUTTON = 'When the words say click, press or tap — "click play" — they name a button on the page: choose its click, never an op on the video or audio itself.'

/**
 * What a card with Show Ops (ADR 0086) says beside them, so a question the
 * page answers further down reads as a show of the block that answers it,
 * not a blind scroll (#405): the instructions say a question takes its
 * show, on every ask but the Where Ask, and the page scroll says it is
 * for when no block below holds the ask. Measured on the gate (Mammoth ∩
 * Elephant) with the corpus's question cases, 2026-10-23: the two lines
 * together won 3 model-passes and lost none; the block's kind on each
 * Show line (heading, code, table row) won the Playwright README on
 * Elephant too, but each arm carrying it lost a case that passed before.
 */
const QUESTION_TAKES_ITS_SHOW = 'When the words ask something a block of text further down answers, choose the show of that block.'
const SCROLL_DOWN_PAST_SHOWS = 'scroll the page down a screen, when no block further down holds what the words ask for'

/** What the appliance holds that its verbs act on: whether the Queue holds a current song (#374), absent when no Player is wired; what it knows, each fact an option on the card (#402); and the Last Page's name, which `resume` reopens (#408). */
export interface Appliance {
  readonly queued?: boolean
  readonly facts?: ApplianceFacts
  readonly lastPage?: string
}

/**
 * `resume` on the card (#408, ADR 0089): "where was i" and "last page" read
 * intent and are Jev's, so the Last Page is offered where reopening it is an
 * action — a blank pane, after a restart — its line naming the page. On a
 * real page the pane is already on a page, and `back` is the browser's.
 */
function resumeOption(appliance: Appliance | undefined, page: CommandPage): [string, string][] {
  return appliance?.lastPage === undefined || isRealPage(page.url) ? [] : [['resume', `reopen the last page the screen showed: ${JSON.stringify(appliance.lastPage)}`]]
}

/**
 * The Appliance Verbs offered by ability (#374), each while there is
 * something for it to act on: a song to play whenever a Player is wired;
 * the Queue's walk and the corrections while the Queue holds a song —
 * never over a page's own video with nothing queued, where a `skip` fires
 * nothing but a pause and there is no pick to correct; `show` while any
 * song is on, the Player's or the page's.
 */
function applianceVerbsOf(appliance: Appliance | undefined, page: CommandPage): ApplianceVerb[] {
  if (appliance?.queued === undefined) return []
  const songOn = appliance.queued || page.media !== undefined
  const corrections = appliance.queued ? (['correct', 'correct_back', 'forget'] as const) : []
  return ['play', 'play_next', 'queue', ...(appliance.queued ? (['skip', 'previous'] as const) : []), ...(songOn ? (['show'] as const) : []), ...corrections]
}

/** Whether an action card label names an Appliance Verb. */
const isApplianceVerb = (label: string): label is ApplianceVerb => Object.hasOwn(APPLIANCE_VERBS, label)

/** The Appliance Verb whose Player action a `play` Command carries; null for one no Appliance Verb fires (a loop, a pause: the ref's own ops). */
function applianceVerbOf(music: MusicAction): ApplianceVerb | null {
  const same = (verb: ApplianceVerb): boolean => {
    const own = APPLIANCE_VERBS[verb].music
    if (own.kind === 'search') return music.kind === 'search' && own.place === music.place
    if (own.kind === 'correct') return music.kind === 'correct' && own.step === music.step
    return own.kind === music.kind
  }
  return (Object.keys(APPLIANCE_VERBS) as ApplianceVerb[]).find(same) ?? null
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
function describeRef(ref: CommandRef, page?: CommandPage, marked?: ReadonlySet<number>): string {
  const kind = kindOf(ref)
  // A search box says its value once, as what it holds (#398): the tree's `value=` state is that.
  const shownStates = ref.searchBox !== undefined ? ref.states?.filter((state) => !state.startsWith('value=')) : ref.states
  const states = shownStates !== undefined && shownStates.length > 0 ? ` ${shownStates.join(' ')}` : ''
  // What a closed trigger opens rides its line (#388): the words the user names are often behind it.
  const holds = ref.holds !== undefined && ref.holds.length > 0 ? ` menu holds ${ref.holds.map((name) => JSON.stringify(name)).join(', ')}` : ''
  // A media ref's own state rides its line (#372, ADR 0080): what its ops change, and what the Verdict reads.
  const media = ref.media !== undefined ? ` ${mediaStateOf(ref.media)}` : ''
  // Its player's switches ride the same line (#389, ADR 0080), each by its own label: Jev reads what it switches.
  const switches = ref.switches !== undefined && ref.switches.length > 0 ? ` ${ref.switches.map((toggle) => `[${toggle.ref}] ${JSON.stringify(toggle.label)} ${toggle.on ? 'on' : 'off'}`).join(', ')}` : ''
  // A Scroll Region's position and length ride its line (#383, ADR 0085): what its ops move, and what the Verdict reads.
  const region = ref.region !== undefined ? ` ${regionStateOf(ref.region)}` : ''
  // A ref read in a frame names its host (#377, ADR 0081): the embedded player is another site's.
  const frame = ref.frame !== undefined ? ` in ${ref.frame}` : ''
  // A Textless Ref the Mark Ask boxed on the image (#382, ADR 0084) is named by its mark, the one thing Jev can find it by.
  const label = marked?.has(ref.ref) === true ? `, the control marked ${ref.ref}` : ` ${JSON.stringify(shownLabel(ref, page))}`
  // What a search box holds rides its line (#398): stale words in the box are what a type used to append to.
  const words = ref.searchBox !== undefined && ref.searchBox.holds !== '' ? ` holds ${JSON.stringify(ref.searchBox.holds)}` : ''
  return `${kind}${label}${frame}${ref.href !== null ? ` ${ref.href}` : ''}${words}${states}${holds}${media}${switches}${region}`
}

/**
 * A ref's kind as its line names it: a search box as `searchbox` and the
 * submit of its form as `button[submit]` (#398) — the gate 2026-10-22 read
 * `button[submit] "Search"` as the click where `button "Search Search"` read
 * `none` — an input by its type, the rest as they are.
 */
function kindOf(ref: CommandRef): string {
  if (ref.searchBox !== undefined) return 'searchbox'
  if (ref.submitsSearch === true) return 'button[submit]'
  return ref.kind === 'input' && ref.inputType !== null ? `input[${ref.inputType}]` : ref.kind
}

/** Whether a ref is a search box (#398): a field the card offers a Search Op on. */
function isSearchBox(ref: CommandRef): boolean {
  return ref.searchBox !== undefined && isTextField(ref)
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
  /** The actions a hop that changed nothing (#336) or did not help (#373) set aside, by card label: never offered again in this Task. */
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
 * A ref as a Task knows it across hops (#336): its label and its address —
 * the link's own, or the page's for a control that has none — since a
 * ref's number changes from one hop to the next.
 */
export interface RefIdentity {
  readonly label: string
  readonly address: string
}

/** Whether two identities name the same ref. */
function sameRef(a: RefIdentity, b: RefIdentity): boolean {
  return a.label === b.label && a.address === b.address
}

/** The identity of a ref on a page. */
export function refIdentityOf(ref: CommandRef, page: CommandPage): RefIdentity {
  return { label: ref.label, address: pageAddressOf(ref.href ?? page.url) }
}

/** What an action card label does to a numbered ref, as a set-aside keeps it: a click, a type, a right-click, a Search Op (#398), a Media Op (#372) or a Scroll Op (#383). */
type RefAct = 'click' | 'type' | 'menu' | 'search' | MediaOp | ScrollOp

/**
 * An action set aside (#336, #373, ADR 0080), keyed by its card label: a
 * ref's action (`click-10`) by its act and the ref's identity, so the ref
 * keeps its other actions; a ref-less verb or an Appliance Verb
 * (`scroll_down`, `skip`) by its name.
 */
export type SetAside = (RefIdentity & { readonly act: RefAct }) | { readonly verb: string } | ShowAside

/** A Show Op set aside (#393, ADR 0086): by its block's text and the page's address, never as the page's own scroll. */
interface ShowAside {
  readonly show: string
  readonly address: string
}

/**
 * The set-aside of the action a Command fired on a page; null when the
 * page lacks the ref it names, or it is no card action. A navigation sets
 * nothing aside: an `open-N` fires as one, and the address it opened is
 * never offered again anyway (a visited address).
 */
export function setAsideOf(command: Command, page: CommandPage): SetAside | null {
  if (command.show !== undefined) return { show: command.show.text, address: pageAddressOf(page.url) }
  if (command.verb === 'play') {
    const verb = command.music === undefined ? null : applianceVerbOf(command.music)
    return verb === null ? null : { verb }
  }
  // A Media Op by its op and the ref's identity (#372, ADR 0080): `forward-7` is set aside as `click-10` is, the ref's other ops staying.
  const act = command.verb === 'media' ? command.mediaOp?.op : command.verb === 'type' && command.submit === true ? 'search' : command.verb === 'click' || command.verb === 'type' || command.verb === 'menu' ? command.verb : scrollOpOf(command)
  if (act !== undefined) {
    const ref = page.refs.find((candidate) => candidate.ref === command.target)
    return ref === undefined ? null : { act, ...refIdentityOf(ref, page) }
  }
  return command.verb !== 'navigate' && isRefLessVerb(command.verb) ? { verb: command.verb } : null
}

/** The Scroll Op a scroll of a region is (#383): `down` or `up`; undefined for anything else, the page's own scroll among it. */
function scrollOpOf(command: Command): ScrollOp | undefined {
  return command.target === null ? undefined : (scrollOpOfVerb(command.verb) ?? undefined)
}

/** Whether the Task set aside what a card label names on this page; a `show-N` by the block `texts` numbers N. */
function isAside(label: string, page: CommandPage, setAside: readonly SetAside[], texts: readonly TextTarget[]): boolean {
  if (setAside.length === 0) return false
  const shown = showOf(label, texts)
  if (shown !== null) return setAside.some((aside) => 'show' in aside && aside.show === shown.text && aside.address === pageAddressOf(page.url))
  const acted = refActionOf(label)
  if (acted === null) return setAside.some((aside) => 'verb' in aside && aside.verb === label)
  if (acted.act === 'open') return false
  const ref = page.refs.find((candidate) => candidate.ref === acted.n)
  if (ref === undefined) return false
  const own = refIdentityOf(ref, page)
  return setAside.some((aside) => 'act' in aside && aside.act === acted.act && sameRef(aside, own))
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
  | { readonly changed: true; readonly opened?: string; readonly target?: TargetChange; readonly appeared?: readonly string[]; readonly covered?: boolean; readonly closed?: boolean; readonly media?: readonly string[]; readonly region?: string; readonly fullScreen?: boolean }

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

/** What an action changed, for "Done so far": a full-screen change (#387) beside what the page shows of it. */
export function doneFacts(before: CommandPage, after: CommandPage, result: DoneResult, target?: number | null): DoneResult {
  // Full screen is the document's (#387): a change to it is told whatever else the action did, and first.
  const screen = fullScreenChange(before, after)
  const facts = pageDoneFacts(before, after, result, target)
  if (screen === undefined) return facts
  return { ...(facts.changed ? facts : { changed: true }), fullScreen: screen }
}

/** The page's full screen after the action, when it changed between two reads that both carry it (#387). */
function fullScreenChange(before: CommandPage, after: CommandPage): boolean | undefined {
  return before.fullScreen !== undefined && after.fullScreen !== undefined && before.fullScreen !== after.fullScreen ? after.fullScreen : undefined
}

/** What an action changed on the page: a Scroll Region's move, the target's own change, what appeared, a pop-up, the media element. */
function pageDoneFacts(before: CommandPage, after: CommandPage, result: DoneResult, target?: number | null): DoneResult {
  // A Scroll Region tells what a scroll moved by its own facts (#383, ADR 0085): its position, never a state flip.
  const scrolled = regionRefChange(before, after, target)
  if (scrolled === null) return { changed: false }
  if (scrolled !== undefined) return { changed: true, ...(result.changed && result.opened !== undefined ? { opened: result.opened } : {}), region: scrolled }
  // A page another address opened is a new page: what the target did on the old one is no fact of it.
  const change = !result.changed || result.opened === undefined ? targetChange(before, after, target) : undefined
  // An acted media ref tells its change from its own facts (#372, ADR 0080); otherwise a change to the page's media element is one the DOM does not show (#363): Loop ticked in a right-click menu changes no ref.
  const ownMedia = change !== undefined ? mediaRefChanges(before, after, target) : null
  const media = ownMedia ?? mediaChanges(before.media, after.media)
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

/**
 * What the acted media ref's own facts changed between the two reads
 * (#372): the element on the page the action left, matched as the target
 * is; null when the target is no media ref read with its facts, so the
 * page's media line tells the change instead.
 */
function mediaRefChanges(before: CommandPage, after: CommandPage, ref: number | null | undefined): string[] | null {
  const target = ref === null || ref === undefined ? undefined : before.refs.find((one) => one.ref === ref)
  if (target === undefined || !isMediaRef(target)) return null
  const now = targetAfter(target, before, after)
  return now === undefined || !isMediaRef(now) ? null : mediaChangesOf(target.media, now.media)
}

/**
 * What a scroll moved on the acted Scroll Region (#383): the way it moved
 * and its position change, or null when it did not move; undefined when
 * the target is no region read with its facts, or is gone from the page
 * the action left. Saying which way the scrolling part moved is what the
 * Verdict reads the scroll as done by (measured 2026-10-22 on a live
 * YouTube chat's hop 1, five replays each: yes 0.74–0.79 with the change
 * alone, 0.84–0.89 with it; the ref line saying what a region is did not
 * help).
 */
function regionRefChange(before: CommandPage, after: CommandPage, ref: number | null | undefined): string | null | undefined {
  const target = ref === null || ref === undefined ? undefined : before.refs.find((one) => one.ref === ref)
  if (target === undefined || !isRegionRef(target)) return undefined
  const now = targetAfter(target, before, after)
  if (now === undefined || !isRegionRef(now)) return undefined
  const change = regionChangeOf(target.region, now.region)
  return change === null ? null : `the scrolling part moved ${now.region.top > target.region.top ? 'down' : 'up'}: ${change}`
}

/** A media ref read with its facts (#372): the one kind that carries Media Ops. */
function isMediaRef(ref: CommandRef): ref is CommandRef & { readonly media: MediaFacts } {
  return ref.kind === 'media' && ref.media !== undefined
}

/** A Scroll Region read with its facts (#383): the one kind that carries Scroll Ops. */
function isRegionRef(ref: CommandRef): ref is CommandRef & { readonly region: RegionFacts } {
  return ref.kind === 'region' && ref.region !== undefined
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
  const told = [...(result.fullScreen !== undefined ? [fullScreenFact(result.fullScreen)] : []), ...(result.region !== undefined ? [result.region] : []), ...(result.target !== undefined ? [targetFacts(result.target)] : []), ...(page === 'the page changed' ? [] : [page]), ...(result.media ?? [])]
  return told.length > 0 ? told.join('; ') : page
}

/** A full-screen change (#387), told first: `the page went full screen`, `the page left full screen`. */
function fullScreenFact(fullScreen: boolean): string {
  return fullScreen ? 'the page went full screen' : 'the page left full screen'
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
  // A target with no words is named by its number, and one the Mark Ask found by the image (#382): `click ""` told the
  // Verdict nothing (replay 2026-10-22 of a gear click's hop 1: yes 0.52–0.64; `click [6]` 0.83–0.84; the image's wording 0.95–0.97).
  if (label.trim() === '' && (command.verb === 'click' || command.verb === 'menu' || command.verb === 'type')) {
    return command.marked === true ? `${describeCommand(command)}, the control the user's words named on the image of the page` : describeCommand(command)
  }
  if (command.verb === 'type') return command.submit === true ? `search for ${JSON.stringify(command.slot ?? '')} with ${JSON.stringify(label)}` : `type ${JSON.stringify(command.slot ?? '')} into ${JSON.stringify(label)}`
  // A Media Op by what it did (#372): `skip forward 10 s "Title"`, `mute "Title"`.
  if (command.verb === 'media' && command.mediaOp !== undefined) return `${describeMediaOp(command.mediaOp)} ${JSON.stringify(label)}`
  // A Scroll Op by its direction and Extent (#383): `scroll down a screen "Live chat"`.
  const op = scrollOpOf(command)
  if (op !== undefined) return `scroll ${op}${command.extent !== undefined ? ` ${describeExtent(command.extent, op)}` : ''} ${JSON.stringify(label)}`
  return `${command.verb} ${JSON.stringify(label)}`
}

/** The least probability a runner-up may have (#363, ADR 0079): under it, Jev did not offer the ref at all. */
export const RUNNER_UP_FLOOR = 0.05

/**
 * The runner-up of a reading (#363, ADR 0079): the most probable action of
 * the opener's own kind on its action card (#370) — the next click after a
 * click, the next right-click after a menu — on a ref that is not the one
 * it fired, nor one whose action of that kind the Task set aside, at
 * {@link RUNNER_UP_FLOOR} or over; named by its identity, since the page
 * it is fired on is collected anew. Null when there is none.
 */
export function runnerUpOf(action: DecisionChoiceAnswer, page: CommandPage, fired: number, setAside: readonly SetAside[], kind: 'click' | 'menu' = 'click'): RefIdentity | null {
  const firedRef = page.refs.find((ref) => ref.ref === fired)
  const firedIdentity = firedRef !== undefined ? refIdentityOf(firedRef, page) : null
  for (const label of rankedOffered(action, page, setAside, NO_SHOW_OPS)) {
    const acted = refActionOf(label)
    const ref = acted?.act === kind ? page.refs.find((candidate) => candidate.ref === acted.n) : undefined
    if (ref === undefined) continue
    const own = refIdentityOf(ref, page)
    if (firedIdentity === null || !sameRef(own, firedIdentity)) return own
  }
  return null
}

/** The card labels an answer gives {@link RUNNER_UP_FLOOR} or over, most probable first, none the Task set aside. */
function rankedOffered(action: DecisionChoiceAnswer, page: CommandPage, setAside: readonly SetAside[], texts: readonly TextTarget[]): string[] {
  return Object.entries(action.probabilities)
    .filter(([label, probability]) => probability >= RUNNER_UP_FLOOR && !isAside(label, page, setAside, texts))
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label)
}

/** The ref on a page that an identity names (#363): its label and its address; null when the page has none. */
export function refNamed(page: CommandPage, named: RefIdentity): CommandRef | null {
  return page.refs.find((ref) => sameRef(refIdentityOf(ref, page), named)) ?? null
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
 * Task has visited, no link twice or already a ref. A ref whose address is
 * this page's stays (2026-10-21): an `<a href="#">` control, a "Show more",
 * a "Comments" anchor leads nowhere the Task has been, and the page is
 * always among the addresses visited.
 */
function offered(page: CommandPage, hop: HopContext | undefined): { page: CommandPage; links: OfferedLink[] } {
  if (hop === undefined) return { page, links: [] }
  const seen = new Set(hop.visited.map(pageAddressOf))
  const here = pageAddressOf(page.url)
  const fresh = (href: string | null): boolean => href === null || pageAddressOf(href) === here || !seen.has(pageAddressOf(href))
  const refs = page.refs.filter((ref) => fresh(ref.href))
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

/** A block of Text Further Down as the card numbers it: its `[text-N]` entry and its `show-N` option. */
interface TextTarget {
  readonly n: number
  readonly block: TextBelow
}

/** A Text Further Down entry's line in the state: `[text-2] "…"`. */
function textEntry(target: TextTarget): string {
  return `[text-${target.n}] ${target.block.kind !== undefined ? `${target.block.kind} ` : ''}${JSON.stringify(target.block.text)}`
}

/**
 * Text Further Down (#393, ADR 0086): the blocks below the view a hop can
 * offer, numbered in reading order, none repeating a label on the card or
 * a block in view — every one: the Choice's room and the Card Budget are
 * their bound (#407), as a count of characters stopped the jellyfin README
 * before its port. The numbers never hang on what the Task set aside — a
 * set-aside is read against them on the very call that answered, and a
 * renumbering there would fire another block — so a set-aside block
 * leaves a gap.
 */
function textTargetsOf(pageRead: CommandPage, hop: HopContext | undefined): TextTarget[] {
  const shown = offered(pageRead, hop)
  const onCard = new Set([...shown.page.refs, ...shown.links].map((named) => named.label))
  const inView = new Set(pageRead.viewportText ?? [])
  const targets: TextTarget[] = []
  for (const block of pageRead.textBelow ?? []) {
    if (onCard.has(block.text) || inView.has(block.text)) continue
    targets.push({ n: targets.length + 1, block })
  }
  return targets
}

/** No numbered targets: for a reader that only resolves clicks, right-clicks and opens, to which a `show-N` is never one. */
const NO_SHOW_OPS: readonly TextTarget[] = []

/** The block a `show-N` label names among the numbered targets; null for any other label, or a number none carries. */
function showOf(label: string, texts: readonly TextTarget[]): TextBelow | null {
  const match = /^show-(\d+)$/.exec(label)
  return match === null ? null : (texts.find((target) => target.n === Number(match[1]))?.block ?? null)
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

/** Where the Mark Ask's image stands in its state (#382, ADR 0084): the reference the ask's `images` holds it under. */
export const MARKS_IMAGE = '<marks>'

/**
 * The blocks of text in view the card shows (#390, #392), in reading
 * order: every block the collect kept but a label already on the card (a
 * nav link, a button), which the card names once. The passage Choice
 * offers them in this order as `view-N` (#401).
 */
function inViewBlocks(page: CommandPage, hop: HopContext | undefined): string[] {
  const shown = offered(page, hop)
  const onCard = new Set([...shown.page.refs, ...shown.links].map((named) => named.label))
  return (page.viewportText ?? []).filter((block) => !onCard.has(block))
}

/**
 * The text in view as one line under the page (#390): each block quoted,
 * in reading order. A forecast, a score or a definition is text, not a
 * control, and the Verdict cannot see it is on screen without it. The
 * screen is the bound, as the collect keeps it (#392): no cap of its own,
 * which cut the page from the top and spent itself on the masthead; the
 * blocks the collect could not keep are said, so a cut never reads as a
 * page with nothing more on it. No line when no block is left. It stays
 * unnumbered (#401): numbered, every layout measured cost two Mammoth
 * passes, so the passage Choice names each block in its own options.
 */
function textInViewLine(page: CommandPage, hop: HopContext | undefined): string[] {
  const blocks = inViewBlocks(page, hop).map((block) => JSON.stringify(block))
  const more = page.viewportTextMore ?? 0
  if (more > 0) blocks.push(`… (${more} more ${more === 1 ? 'block' : 'blocks'} in view)`)
  return blocks.length === 0 ? [] : [`Text in view: ${blocks.join(' · ')}`]
}

/**
 * Text Further Down at the card's end (#393, ADR 0086): the entries the
 * action card it is asked beside offers a Show Op for, each whole — never
 * an entry without its op, which the Verdict read as text on screen.
 */
function textFurtherDownLines(page: CommandPage, hop: HopContext | undefined, card: { readonly action: DecisionChoiceQuestion } | undefined): string[] {
  if (card === undefined) return []
  const entries = textTargetsOf(page, hop).filter((target) => Object.hasOwn(card.action.options, `show-${target.n}`))
  return entries.length === 0 ? [] : ['Text further down the page, not on screen yet (number, text):', ...entries.map(textEntry)]
}

/**
 * The state the questions are asked over; at a hop past the first, where
 * the Task stands; in a Step, where the line stands; for the Mark Ask, the
 * marked refs and the image of them; and, given the `card` asked beside
 * it, the Text Further Down it offers.
 */
export function commandState(text: string, page: CommandPage, hop?: HopContext, step?: StepContext, marked?: ReadonlySet<number>, card?: { readonly action: DecisionChoiceQuestion }, heard?: readonly NameHearing[]): string {
  const shown = offered(page, hop)
  // The links the card asked beside it opens, and no other (#406, ADR 0088): a link the Card Budget or the option cap left off the card is no line of the state either, as a block further down is never an entry without its op.
  const links = card === undefined ? shown.links : shown.links.filter((link) => Object.hasOwn(card.action.options, `open-${link.n}`))
  const done = [...(step?.done ?? []), ...(hop?.actions ?? [])]
  return [
    `The user spoke to a web browser: ${JSON.stringify(text)}`,
    ...heardLine(heard),
    ...(step !== undefined ? [`Step ${step.step} of ${step.of} of the line: ${JSON.stringify(step.line)}`] : []),
    ...(hop !== undefined
      ? [`This is step ${hop.hop + 1} of the task. Done so far: ${done.join('; ') || 'nothing'}`, `Pages visited: ${hop.visited.join(' ') || 'none'}`]
      : step !== undefined && done.length > 0
        ? [`Done so far: ${done.join('; ')}`]
        : []),
    `Page: ${page.url} — ${JSON.stringify(page.title)}`,
    ...textInViewLine(page, hop),
    ...(page.media !== undefined ? [mediaLine(page.media)] : []),
    ...(page.fullScreen !== undefined ? [`Full screen: ${page.fullScreen ? 'on' : 'off'}`] : []),
    ...(page.dialog !== undefined ? [`A dialog is open: ${JSON.stringify(page.dialog.text)}`] : []),
    'Refs (number, kind, label, address, states):',
    ...shown.page.refs.map((ref) => `[${ref.ref}] ${describeRef(ref, page, marked)}`),
    ...(marked !== undefined ? [`The page now, each control with no words boxed in red with its number: ${MARKS_IMAGE}`] : []),
    ...(links.length > 0 ? [`${isWebEngineSearch(page.url) ? 'Result links' : 'Links'} further down the page (name, address):`, ...links.map((link) => `[link-${link.n}] ${describeLink(link)}`)] : []),
    ...textFurtherDownLines(page, hop, card),
  ].join('\n')
}

/** A type, not an interface, so it reads as the port's `DecisionQuestions` record. */
type ActionQuestions = {
  readonly action: DecisionChoiceQuestion
  readonly slot: DecisionChoiceQuestion
}

/** Questions with one more Choice asked beside them, or not: a union, never an optional key, so each still reads as the port's `DecisionQuestions` record. */
type Asked<Q, K extends string> = Q | (Q & { readonly [key in K]: DecisionChoiceQuestion })

/**
 * The reading's questions (#340): the action card, the Slot and the
 * Extent (#383); the Amount beside them on an ask that offers a media ref (#372); `where` on
 * a site; and at hop 0, on a line with a conjunction, `steps` (#364).
 */
type ReadingQuestions = Asked<Asked<ActionQuestions & { readonly extent: DecisionChoiceQuestion }, 'amount'>, 'where'>
export type CommandQuestions = Asked<ReadingQuestions, 'steps'>

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
export function commandQuestions(
  text: string,
  pageRead: CommandPage,
  hop?: HopContext,
  options: { readonly steps?: boolean; readonly appliance?: Appliance; readonly asked?: CardAsk; readonly marked?: ReadonlySet<number>; readonly heard?: readonly NameHearing[]; readonly further?: number } = {},
): CommandQuestions {
  const { page, links } = offered(pageRead, hop)
  const card = actionQuestion(page, pageRead, links, textTargetsOf(pageRead, hop), options.asked ?? (hop !== undefined ? 'later' : 'first'), applianceVerbsOf(options.appliance, pageRead), hop?.setAside ?? [], options.marked, options.appliance?.facts && withPageSong(options.appliance.facts, pageRead.media), resumeOption(options.appliance, pageRead), options.further)
  const action: ActionQuestions = { action: card.question, slot: slotQuestion(text, options.heard) }
  // The Amount rides beside a card that offers a media ref's ops (#372, ADR 0080): read only when the action is a seek.
  // The Extent rides every ask (#383, ADR 0085): the page's own scroll reads it as a Scroll Op does.
  const extended = { ...action, extent: extentQuestion() }
  const reading: Asked<typeof extended, 'amount'> = card.mediaOps ? { ...extended, amount: amountQuestion() } : extended
  const site = scopableSite(pageRead.url, hop)
  const asked = site === null ? reading : { ...reading, where: whereQuestion(site) }
  const steps = hop === undefined && options.steps !== false ? stepsQuestion(text) : null
  return steps === null ? asked : { ...asked, steps }
}

/**
 * What the action card is asked (#379, ADR 0082): at hop 0, which action
 * the words are; at a later hop, which comes next; and, when hop 0 read
 * `none`, the Where Ask — the same card, asked where on the page the thing
 * the words name would be, its `none` a remark or noise. The wording is
 * the one `jev:replay` settled on (#379 AC3): saying the words are a
 * command put Wikipedia's Tools click top for "open page information"
 * (0.25–0.33, `none` 0.06–0.11) where "the words name something" left it
 * at 0.01, the ambient asks' Settings click stayed top (0.35–0.53), and
 * "Thank you." and "I'm so hungry." stayed none (0.68–1.00). The first
 * ask's wording stays as it was measured.
 */
export type CardAsk = 'first' | 'later' | 'where' | 'mark'

const SAYS_NOT_A_COMMAND = { chooseNone: 'Choose none when the words are not a command.', none: REFLESS_DESCRIPTIONS.none }

const CARD_ASKS: Readonly<Record<CardAsk, { readonly question: string; readonly chooseNone: string; readonly none: string }>> = {
  first: { question: "Which one action does the browser take for the user's words?", ...SAYS_NOT_A_COMMAND },
  later: { question: "Which one action comes next for the user's words, given Done so far and the page now?", ...SAYS_NOT_A_COMMAND },
  where: {
    question: 'The words are a command for something this page does not show. Which one action would reveal it, or find it?',
    chooseNone: 'Choose none when the words are a remark or noise, nothing to look for.',
    none: 'a remark or noise, nothing to look for',
  },
  // The Mark Ask (#382, ADR 0084): the first ask's question, the marked controls found on the image.
  mark: { question: "Which one action does the browser take for the user's words? A control with no words is found by its number on the image.", ...SAYS_NOT_A_COMMAND },
}

/** The Where Ask's questions: the Command's and the Verdict (#394); with a block in view, the passage Choice (#401). */
export type WhereQuestions = CommandQuestions & { readonly outcome: DecisionChoiceQuestion; readonly passage?: DecisionChoiceQuestion }

/**
 * The Where Ask's questions (#379, ADR 0082): hop 0's, with the action
 * card asked where the thing the words name would be — every option it
 * offered, `search` and `where` as they were — and no `steps`: the first
 * reading already read the line as one Command. The Verdict rides the
 * same call (#394), worded as every hop's: a page that already shows what
 * the words ask for is kept, not left for the Where Ask's action. Adding
 * it moved none of 40 measured Where Ask picks. The passage Choice rides
 * beside that Verdict as beside every hop's (#401, ADR 0087).
 */
export function whereQuestions(text: string, page: CommandPage, { appliance, heard, further }: { readonly appliance?: Appliance; readonly heard?: readonly NameHearing[]; readonly further?: number } = {}): WhereQuestions {
  return withPassage({ ...commandQuestions(text, page, undefined, { steps: false, appliance, asked: 'where', heard, further }), outcome: outcomeQuestion() }, page, undefined)
}

/**
 * The Textless Refs on a card (#382, ADR 0084): the refs it offers a click
 * on — or a Scroll Op, a region being found by its mark too (#383, ADR
 * 0085) — whose label, as Jev is shown it, has no words: an icon the page
 * named nothing and the browser named nothing either.
 */
export function textlessRefsOf(questions: CommandQuestions, page: CommandPage): number[] {
  const offeredClicks = new Set(Object.keys(questions.action.options).flatMap((label) => {
    const acted = refActionOf(label)
    // A region by its `down-N`, which comes with its `up-N` on every card: each region counts once.
    return acted?.act === 'click' || acted?.act === 'down' ? [acted.n] : []
  }))
  return page.refs.filter((ref) => offeredClicks.has(ref.ref) && shownLabel(ref, page).trim() === '').map((ref) => ref.ref)
}

/**
 * Whether a reading is an unsure guess at a Textless Ref (owner ruling
 * 2026-10-22, ADR 0084 amended): its top choice a click on one, under the
 * Choice bar. Text ran dry there — Jev guessed among controls it could not
 * tell apart (the 2026-10-22 ledger lines) — so the Mark Ask is asked
 * instead of firing the guess.
 */
export function isTextlessGuess(action: DecisionChoiceAnswer, questions: CommandQuestions, page: CommandPage, bar: number): boolean {
  const acted = refActionOf(action.choice)
  return choiceProbability(action) < bar && acted?.act === 'click' && textlessRefsOf(questions, page).includes(acted.n)
}

/**
 * The Mark Ask's questions (#382, ADR 0084): the Where Ask's card asked
 * once more with the page's image beside it, every option as it was but
 * a marked ref's, which reads "the control marked N"; no `steps`.
 */
export function markQuestions(text: string, page: CommandPage, { appliance, marked, heard, further }: { readonly appliance?: Appliance; readonly marked: ReadonlySet<number>; readonly heard?: readonly NameHearing[]; readonly further?: number }): CommandQuestions {
  return commandQuestions(text, page, undefined, { steps: false, appliance, asked: 'mark', marked, heard, further })
}

/**
 * The action card (#370): one option per whole action — a click on every
 * ref the reading offers, as the ref is shown; a type into each text
 * field; an open of each link further down; the ref-less verbs; the
 * Appliance Verbs on offer; and `none`. No `done`: done-ness is the
 * Verdict's alone. Under the Choice cap the clicks come first, then the
 * types, then each media ref's Media Ops (#372, ADR 0080) — every op the
 * element can take, whatever its state — then the shows of the blocks
 * further down (#407), then the opens, and a right-click on each ref fills
 * what room is left — a menu is the last resort, never chosen over the
 * page's own control in the logged asks. An action the Task set aside is
 * not offered (#373): a ref's other actions stay.
 */
function actionQuestion(
  page: CommandPage,
  pageRead: CommandPage,
  links: readonly OfferedLink[],
  texts: readonly TextTarget[],
  asked: CardAsk,
  offeredVerbs: readonly ApplianceVerb[],
  setAside: readonly SetAside[],
  marked?: ReadonlySet<number>,
  facts?: ApplianceFacts,
  resume: readonly [string, string][] = [],
  further = Infinity,
): { question: DecisionChoiceQuestion; mediaOps: boolean } {
  const kept = (label: string): boolean => !isAside(label, page, setAside, texts)
  // Each media ref's Media Ops the element can take and the Task has not set aside (#372, ADR 0080).
  const opsOf = (ref: CommandRef): [MediaOp, CommandRef][] => (isMediaRef(ref) ? mediaOpsOf(ref.media).filter((op) => kept(`${op}-${ref.ref}`)).map((op) => [op, ref]) : [])
  // Each Scroll Region's Scroll Ops the Task has not set aside (#383, ADR 0085).
  const scrollsOf = (ref: CommandRef): [ScrollOp, CommandRef][] => (isRegionRef(ref) ? scrollOpsOf(ref.region).filter((op) => kept(`${op}-${ref.ref}`)).map((op) => [op, ref]) : [])
  // A region carries no click (ADR 0085): a right-click is a click too.
  const clickable = (ref: CommandRef): boolean => ref.kind !== 'region'
  const applianceVerbs = offeredVerbs.filter(kept)
  // What the appliance knows (#402): one option per fact, each line carrying it — never on the Where Ask, whose
  // question is what would reveal or find the thing on the page: there the facts read Gurgaon's weather as the
  // home city's (gate 2026-10-23), and the first ask already offered them.
  const factOptions = facts === undefined || asked === 'where' ? [] : Object.entries(sayOptions(facts)).filter(([label]) => kept(label))
  const refLess = Object.entries(REFLESS_DESCRIPTIONS)
    .filter(([verb]) => kept(verb))
    .map(([verb, line]) => [verb, verb === 'none' ? CARD_ASKS[asked].none : line] as const)
  let room = MAX_SPANS + 1 - (refLess.length + applianceVerbs.length + factOptions.length + resume.length)
  const take = <T>(items: readonly T[]): readonly T[] => {
    const taken = items.slice(0, Math.max(0, room))
    room -= taken.length
    return taken
  }
  // The refs the clicks reach under the cap; their types, Media Ops and right-clicks come from these.
  const reached = page.refs.slice(0, Math.max(0, room))
  // Each search box's Search Op (#398): its words replaced and the box submitted, one action where the ladder was four.
  // A page has a box or two, so theirs take the room first: on a full card the clicks would leave none.
  const searched = new Set(take(reached.filter((ref) => isSearchBox(ref) && kept(`search-${ref.ref}`))).map((ref) => ref.ref))
  const clicked = new Set(take(reached.filter((ref) => clickable(ref) && kept(`click-${ref.ref}`))).map((ref) => ref.ref))
  const typed = new Set(take(reached.filter((ref) => isTextField(ref) && kept(`type-${ref.ref}`))).map((ref) => ref.ref))
  const ops = take(reached.flatMap(opsOf))
  const scrolls = take(reached.flatMap(scrollsOf))
  // What is further down yields to the Choice's room and the Card Budget (#406, ADR 0088): the first `further` of the
  // shows, the opens and the right-clicks, in that order, each list nearest the view first. The shows come first (#407):
  // a block the page answers in has no other road to the card, while a link's page is a hop away.
  let toKeep = further
  const nearest = <T>(items: readonly T[]): readonly T[] => {
    const near = items.slice(0, Math.max(0, toKeep))
    toKeep -= near.length
    return near
  }
  // `take` and `nearest` hand out room in the order they are called: the three lines below are the yield order.
  // The Show Ops stand just before the page's own scroll (ADR 0086); on a full card the refs win.
  const showOps = nearest(take(texts.filter((target) => kept(`show-${target.n}`)))).map((target) => [`show-${target.n}`, showOpAction(target.block, target.n)] as const)
  const opened = nearest(take(links))
  const menus = nearest(take(reached.filter((ref) => clickable(ref) && kept(`menu-${ref.ref}`))))
  const scrollAt = refLess.findIndex(([verb]) => verb === 'scroll_up' || verb === 'scroll_down')
  const refLessLines = showOps.length === 0 ? refLess : refLess.map(([verb, line]) => [verb, verb === 'scroll_down' ? SCROLL_DOWN_PAST_SHOWS : line] as const)
  const verbs = scrollAt < 0 ? [...refLessLines, ...showOps] : [...refLessLines.slice(0, scrollAt), ...showOps, ...refLessLines.slice(scrollAt)]
  // A sentence on when to right-click, or a ref line on each right-click, lowered every sure click (replay 2026-10-21: "disable captions" 0.66–0.72 → 0.41–0.46, its top `none`).
  const instructions = `${CARD_ASKS[asked].question} Each option is a whole action: a numbered ref with what is done to it, or a verb that needs no ref. ${CARD_ASKS[asked].chooseNone}`
  const question: DecisionChoiceQuestion = {
    type: 'choice',
    instructions: [instructions, ...(ops.length === 0 ? [] : [CLICK_NAMES_A_BUTTON]), ...(showOps.length === 0 || asked === 'where' ? [] : [QUESTION_TAKES_ITS_SHOW])].join(' '),
    options: {
      ...Object.fromEntries(
        page.refs.flatMap((ref) => {
          const line = `[${ref.ref}] ${describeRef(ref, pageRead, marked)}`
          return [
            ...(searched.has(ref.ref) ? [[`search-${ref.ref}`, `search for the words with ${line}: its words replaced, then submitted`]] : []),
            ...(typed.has(ref.ref) ? [[`type-${ref.ref}`, `type the words into ${line}`]] : []),
            ...(clicked.has(ref.ref) ? [[`click-${ref.ref}`, `click ${line}`]] : []),
          ]
        }),
      ),
      ...Object.fromEntries(ops.map(([op, ref]) => [`${op}-${ref.ref}`, mediaOpDescription(op, ref.ref, shownLabel(ref, pageRead))])),
      ...Object.fromEntries(scrolls.map(([op, ref]) => [`${op}-${ref.ref}`, scrollOpDescription(op, ref.ref, ref.label, marked?.has(ref.ref) === true)])),
      ...Object.fromEntries(opened.map((link) => [`open-${link.n}`, `open result ${describeLink(link)}`])),
      ...Object.fromEntries(menus.map((ref) => [`menu-${ref.ref}`, `right-click [${ref.ref}] to open its menu`])),
      ...Object.fromEntries(verbs),
      ...Object.fromEntries(applianceVerbs.map((verb) => [verb, APPLIANCE_VERBS[verb].line])),
      ...Object.fromEntries(factOptions),
      ...Object.fromEntries(resume),
    },
  }
  return { question, mediaOps: ops.length > 0 }
}

/** Where a heard name came from, as the Hearing line says it. */
const HEARD_FROM: Readonly<Record<NameHearing['from'], string>> = { page: 'a name on this page', learned: 'a name the user taught the app' }

/**
 * The Hearing line (#396, ADR 0077 as amended): the words were heard by
 * ear, and these of them sound like names the page shows or the user
 * taught — said before the card, so Jev reads a misheard name as the name
 * and not as noise. No line when the transcript sounds like no name.
 */
export function heardLine(heard: readonly NameHearing[] | undefined): string[] {
  if (heard === undefined || heard.length === 0) return []
  return [`Heard by ear, so a word may be misheard: ${heard.map((hearing) => `${JSON.stringify(hearing.heard)} sounds like ${JSON.stringify(hearing.candidate)}, ${HEARD_FROM[hearing.from]}`).join('; ')}`]
}

/** A span's words as the Slot offers them: the span that was heard as a name says which (#396). */
export function spanOption(words: string, heard: readonly NameHearing[] | undefined): string {
  const hearing = heard?.find((candidate) => normalizeWords(candidate.heard) === normalizeWords(words))
  return hearing === undefined ? words : `${words} (sounds like ${JSON.stringify(hearing.candidate)})`
}

function slotQuestion(text: string, heard?: readonly NameHearing[]): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions: 'Which words of the transcript are the thing the command carries verbatim: the address to open, the search terms, the song to play, the text to type, the key to press? Never the command word itself: "play X" carries X. A line with no command word, such as a question, carries itself: its search terms are the line as asked. Choose none when it carries none.',
    options: { none: 'the command carries no words of its own', ...Object.fromEntries(slotSpans(text).map((span) => [`s${span.start}-${span.end}`, spanOption(span.words, heard)])) },
  }
}

/** The Verdict's answers: what was asked for is done; a pop-up covers the page; or there is more to do. */
export const OUTCOMES = ['yes', 'in_the_way', 'not_yet'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** The Verdict a hop's reading carries: where the Task stands on this page, and how sure Jev is. */
export interface Verdict {
  readonly outcome: Outcome
  /** The outcome's probability, the number the Choice bar reads (#403). */
  readonly probability: number
}

/**
 * The outcome Choice (the Verdict): is what the user asked for done? Read
 * off their words and "Done so far", not the page alone, so an action the
 * user asked for ("close the pop-up") can be done on a page that is no
 * one's goal. A pop-up covering the page is asked first, so a wall stays a
 * sure `in_the_way` whatever the words; a consent strip that covers nothing
 * is said not to be one (#404: a cookie notice named among the walls read
 * every strip on BBC, Reddit and gov.uk as one). Asked at every hop past
 * the first beside the verb, so an end is a verdict and never a verb's
 * plurality: a Task ends on a sure `yes`, meets a wall on a sure
 * `in_the_way`, and says it is not sure otherwise.
 */
function outcomeQuestion(): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions:
      'Is what the user asked for done? First: if a pop-up, sign-in prompt or challenge covers the page now, choose in_the_way; a cookie strip or other notice on the page that covers nothing is not in the way. Otherwise judge by their words and Done so far, not by the page alone: choose yes when the page shows what they asked to see (for a question, when Text in view states its answer), or Done so far shows the action they asked for has happened; not_yet when more steps are needed.',
    options: {
      yes: 'done: the page shows it or its answer, or the action they asked for has happened',
      in_the_way: 'a pop-up or prompt covers the page now',
      not_yet: 'not done: more to do, nothing covering the page',
    },
  }
}

/**
 * The passage Choice (#401, ADR 0087): which block of Text in view states
 * what the user asked for, or `none`. Asked beside every Verdict; no line
 * is marked a question, so a line that asked nothing has no block that
 * states it. Each block is offered whole, as the state shows it, under the
 * Choice cap, its option naming it `view-N` in reading order. Null when no
 * block is in view.
 */
function passageQuestion(page: CommandPage, hop: HopContext | undefined): DecisionChoiceQuestion | null {
  const blocks = inViewBlocks(page, hop).slice(0, MAX_SPANS)
  if (blocks.length === 0) return null
  return {
    type: 'choice',
    instructions:
      'Which block of Text in view states what the user asked to know, in the page\'s own words? Choose none when no block states it, or when the user asked for an action and nothing to be told.',
    options: { none: 'no block states it', ...Object.fromEntries(blocks.map((block, index) => [`view-${index + 1}`, JSON.stringify(block)])) },
  }
}

/** The questions with the passage Choice beside them (#401), when a block is in view. */
function withPassage<Q extends object>(questions: Q, page: CommandPage, hop: HopContext | undefined): Q | (Q & { readonly passage: DecisionChoiceQuestion }) {
  const passage = passageQuestion(page, hop)
  return passage === null ? questions : { ...questions, passage }
}

/**
 * The Answer Passage (#401, ADR 0087): the block of text in view a sure
 * pick names, verbatim and whole; null when the passage was not asked, its
 * pick is `none` or its probability under the Choice bar (#403), or names
 * no block shown.
 */
export function readPassage(answers: CommandAnswers | HopAnswers, page: CommandPage, hop?: HopContext): string | null {
  if (!('passage' in answers) || answers.passage === undefined) return null
  const match = /^view-(\d+)$/.exec(answers.passage.choice)
  if (match === null || choiceProbability(answers.passage) < DEFAULT_DECISION_THRESHOLDS.choice) return null
  return inViewBlocks(page, hop)[Number(match[1]) - 1] ?? null
}

/**
 * The dismiss Choice (#354, owner's rule 2026-10-19): with a pop-up open,
 * which of its controls closes it. Every control of the dialog's layer that
 * a dismissal may click is offered — the widest net, no label list deciding
 * — beside `escape`, with the instructions saying what a close is and what
 * is a way through instead. Asked beside the Verdict in the same call, so
 * a Step Aside costs no second ask; the runner's Dismissal Ladder puts the
 * answer after the consent policy and before the label rung.
 *
 * Beside the controls, every piece of the pop-up's own text that no
 * control holds (#416, ADR 0076): a close no cue made a control — a ×
 * whose listener sits on an ancestor — is still a place a click lands.
 * Measured on Mammoth and Elephant: the text alone left Elephant on a way
 * through, the "never" sentence said by class alone left every target on
 * Escape; both together closed every target and lured no control card.
 * The controls come first, and the text yields to the 255-option cap.
 * Its options are `popup-N`, never `text-N`: the same card's state numbers
 * Text Further Down `[text-N]`, and one name would point at two things.
 */
function dismissQuestion(page: CommandPage): DecisionChoiceQuestion | null {
  if (page.dialog === undefined) return null
  const controls = dialogControls(page)
  const texts = offeredDialogTexts(page)
  if (controls.length === 0 && texts.length === 0) return null
  return {
    type: 'choice',
    instructions:
      `A pop-up covers the page. Which control closes it and leaves the page behind as it was: a close, dismiss, not now, skip, reject or decline control, or an X? On a cookie notice, the one that declines the optional cookies: reject, decline, continue without accepting, necessary only. ${DISMISS_NEVER} Choose escape when no control closes it and the Escape key should be tried.` +
      (texts.length > 0 ? ` ${DISMISS_TEXT_OFFERED}` : ''),
    options: {
      escape: 'no control closes it: press the Escape key',
      ...Object.fromEntries(controls.map((ref) => [`ref-${ref.ref}`, describeRef(ref)])),
      ...Object.fromEntries(texts.map((piece, index) => [`popup-${index + 1}`, `the text ${JSON.stringify(piece.text)} in the pop-up, not listed as a control: a click lands on it`])),
    },
  }
}

/** What a dismissal never is, said by class (#416): the words name kinds, and "only one that leaves" holds for a way through no word names. */
const DISMISS_NEVER = 'Never one that does what the pop-up asks of you, such as sign in, sign up, subscribe, accept, agree, allow or install. Only one that leaves without doing it.'

/** The dismiss instructions' word on the text options (#416), said only when some are offered. */
const DISMISS_TEXT_OFFERED = "Some of the pop-up's text is offered too, where a control may not have been listed as one."

/** The pop-up's text the dismiss Choice offers, numbered from 1 as its options are: what is left of the 255-option cap after `escape` and the controls. */
function offeredDialogTexts(page: CommandPage): DialogText[] {
  return dialogTexts(page).slice(0, Math.max(0, MAX_SPANS - dialogControls(page).length))
}

/**
 * The questions a dismiss phrase over a pop-up asks (owner's rule
 * 2026-10-19): the Command's and the dismiss Choice in one call, so a
 * spoken "close" walks the Dismissal Ladder with Jev's choice on it as a
 * Step Aside does. Null when the pop-up offers no control to choose.
 */
export function dismissPhraseQuestions(text: string, page: CommandPage, { appliance, further }: { readonly appliance?: Appliance; readonly further?: number } = {}): (CommandQuestions & { readonly dismiss: DecisionChoiceQuestion }) | null {
  const dismiss = dismissQuestion(page)
  return dismiss === null ? null : { ...commandQuestions(text, page, undefined, { steps: false, appliance, further }), dismiss }
}

/**
 * The Progress Noul (#373, ADR 0080): did the last action bring the page
 * closer to what the words ask? Asked beside the Verdict at every hop past
 * the first; the runner acts on it only when sure it did not help
 * ({@link PROGRESS_FLOOR}), and it never ends a Task. Measured 2026-10-21 on
 * that day's 11:50 run's hop asks and #370 AC8's: wordings naming repeats, or changes
 * that would have happened anyway, did not lower the clock flips reading
 * 0.4–0.6, and one lowered the menu step.
 */
function progressQuestion(): DecisionNoulQuestion {
  return {
    type: 'noul',
    instructions:
      "Did the last action in Done so far bring the page closer to what the user's words ask for? Judge by what it did and the page now: closer when it did part or all of what they asked, or opened the way to it; not closer when what changed is not what they asked for.",
  }
}

/** At or under it, the Progress Noul is sure the last action did not help (#373): the mirror of the Choice bar, 0.3. */
export const PROGRESS_FLOOR = Math.round((1 - DEFAULT_DECISION_THRESHOLDS.choice) * 100) / 100

/** A hop's questions: the Command's, the Verdict, the Progress Noul and, with a pop-up open, the dismiss Choice; with a block in view, the passage Choice (#401). */
export type HopQuestions = CommandQuestions & { readonly outcome: DecisionChoiceQuestion; readonly progress: DecisionNoulQuestion; readonly dismiss?: DecisionChoiceQuestion; readonly passage?: DecisionChoiceQuestion }

export function hopQuestions(text: string, pageRead: CommandPage, hop: HopContext, { appliance, heard, further }: { readonly appliance?: Appliance; readonly heard?: readonly NameHearing[]; readonly further?: number } = {}): HopQuestions {
  const dismiss = dismissQuestion(pageRead)
  const asked = { ...commandQuestions(text, pageRead, hop, { appliance, heard, further }), outcome: outcomeQuestion(), progress: progressQuestion(), ...(dismiss !== null ? { dismiss } : {}) }
  return withPassage(asked, pageRead, hop)
}

/** The answers to {@link HopQuestions}: the Command's, the Verdict's, the Progress Noul's and, when asked, the dismiss Choice's and the passage Choice's (#401). */
export type HopAnswers = CommandAnswers & { readonly outcome: DecisionChoiceAnswer; readonly progress?: DecisionNoulAnswer; readonly dismiss?: DecisionChoiceAnswer; readonly passage?: DecisionChoiceAnswer }

/** The Progress Noul's probability (#373); null when it was not asked. */
export function readProgress(answers: CommandAnswers | HopAnswers): number | null {
  return 'progress' in answers && answers.progress !== undefined ? answers.progress.noul : null
}

/** How Jev answered the dismiss Choice: a dialog control by ref, a piece of its text (#416), or Escape, with its probability. Null when it was not asked, or names nothing offered. */
export function readDismissChoice(answers: CommandAnswers | HopAnswers, page: CommandPage): DismissChoice | null {
  if (!('dismiss' in answers) || answers.dismiss === undefined) return null
  const { choice } = answers.dismiss
  const probability = choiceProbability(answers.dismiss)
  if (choice === 'escape') return { choice: 'escape', probability }
  const text = /^popup-(\d+)$/.exec(choice)
  if (text !== null) {
    const piece = offeredDialogTexts(page)[Number(text[1]) - 1]
    return piece === undefined ? null : { choice: { text: piece }, probability }
  }
  const match = /^ref-(\d+)$/.exec(choice)
  const ref = match === null ? NaN : Number(match[1])
  return dialogControls(page).some((control) => control.ref === ref) ? { choice: { ref }, probability } : null
}

/** The Verdict a hop's answers, or a Where Ask's (#394), carry; null when none was asked, or the answer names no outcome. */
export function readVerdict(answers: CommandAnswers | HopAnswers): Verdict | null {
  if (!('outcome' in answers)) return null
  const { choice } = answers.outcome
  return OUTCOMES.some((outcome) => outcome === choice) ? { outcome: choice as Outcome, probability: choiceProbability(answers.outcome) } : null
}

/**
 * A partial transcript's questions (Early Fire, #326): the action card
 * and one Noul — whether the words so far are the whole Command. The Noul
 * decides only whether to wait for more words, never whether to act.
 */
export type PartialQuestions = CommandQuestions & { readonly complete: DecisionNoulQuestion }

export function partialQuestions(text: string, page: CommandPage, { appliance, heard, further }: { readonly appliance?: Appliance; readonly heard?: readonly NameHearing[]; readonly further?: number } = {}): PartialQuestions {
  return {
    ...commandQuestions(text, page, undefined, { steps: false, appliance, heard, further }),
    complete: { type: 'noul', instructions: 'Is this a complete command, with nothing still to be said?' },
  }
}

/** Whether a card label offers something further down (#406, ADR 0088): an open, a right-click or a show, what yields to the Card Budget. */
const isFurther = (label: string): boolean => /^(open|menu|show)-\d+$/.test(label)

/**
 * An ask built to the Card Budget (#406, ADR 0088): the card `build`
 * makes, with the state `stateOf` reads over it, keeping the most of what
 * is further down that fits `budget` characters — none of what makes the
 * hop is ever cut, so a card whose rest is over the budget goes with
 * nothing further down. No budget, the whole card.
 */
export function fitCard<Q extends CommandQuestions>(budget: number | undefined, build: (further: number) => Q, stateOf: (questions: Q) => string): { questions: Q; state: string } {
  const ask = (further: number): { questions: Q; state: string } => {
    const questions = build(further)
    return { questions, state: stateOf(questions) }
  }
  const whole = ask(Infinity)
  const fits = ({ questions, state }: { questions: Q; state: string }): boolean => budget === undefined || promptChars(state, questions) <= budget
  if (fits(whole)) return whole
  // The dismiss Choice is its own prompt, and what is further down never shrinks it (#416): only the others decide how much of that is kept.
  const fitsRest = ({ questions, state }: { questions: Q; state: string }): boolean => fits({ questions: withoutDismiss(questions), state })
  if (fitsRest(whole)) return fitDialogText(budget, whole, stateOf)
  // The size grows with each item kept: the most that fits is found by halving.
  let [low, high] = [0, Object.keys(whole.questions.action.options).filter(isFurther).length - 1]
  let best = ask(0)
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const tried = ask(middle)
    if (fitsRest(tried)) {
      best = tried
      low = middle + 1
    } else high = middle - 1
  }
  return fitDialogText(budget, best, stateOf)
}

/**
 * The pop-up's own text kept to the Card Budget (#416): the dismiss
 * Choice's prompt — the state with that one question — keeps the most of
 * it that fits beside the state the other questions settled, in document
 * order, its controls and `escape` whole. What is further down is cut for
 * the action card's own prompt alone, never for this one.
 */
function fitDialogText<Q extends CommandQuestions>(budget: number | undefined, fitted: { questions: Q; state: string }, stateOf: (questions: Q) => string): { questions: Q; state: string } {
  const dismiss = (fitted.questions as { readonly dismiss?: DecisionChoiceQuestion }).dismiss
  if (budget === undefined || dismiss === undefined) return fitted
  const texts = Object.keys(dismiss.options).filter((label) => /^popup-\d+$/.test(label))
  const keeping = (kept: number): DecisionChoiceQuestion => {
    const options = Object.fromEntries(Object.entries(dismiss.options).filter(([label]) => !texts.slice(kept).includes(label)))
    return kept > 0 ? { ...dismiss, options } : { ...dismiss, instructions: dismiss.instructions.replace(` ${DISMISS_TEXT_OFFERED}`, ''), options }
  }
  let kept = texts.length
  while (kept > 0 && promptChars(fitted.state, { dismiss: keeping(kept) }) > budget) kept -= 1
  if (kept === texts.length) return fitted
  const cut = keeping(kept)
  // `escape` alone is nothing to choose: the Choice goes, as it is never asked with nothing else to offer.
  const questions = Object.keys(cut.options).length > 1 ? { ...fitted.questions, dismiss: cut } : withoutDismiss(fitted.questions)
  return { questions, state: stateOf(questions) }
}

/** The questions with no dismiss Choice among them. */
function withoutDismiss<Q extends CommandQuestions>(questions: Q): Q {
  const { dismiss: _dismiss, ...rest } = questions as Q & { readonly dismiss?: DecisionChoiceQuestion }
  return rest as Q
}

type ActionAnswers = {
  readonly action: DecisionChoiceAnswer
  readonly slot: DecisionChoiceAnswer
}

/** Answers with one more Choice's answer beside them, or not. */
type Answered<A, K extends string> = A | (A & { readonly [key in K]: DecisionChoiceAnswer })

/** The answers to {@link CommandQuestions}: the action card's and the Slot's; the Amount's (#372), `where` and `steps` (#364) when they were asked. */
type ReadingAnswers = Answered<Answered<Answered<ActionAnswers, 'amount'>, 'extent'>, 'where'>
export type CommandAnswers = Answered<ReadingAnswers, 'steps'>

/** What an action card label does to a numbered ref or link (#370): `click-12` is a click on ref 12, `open-3` the open of link 3, `forward-7` a Media Op on ref 7 (#372). */
interface RefAction {
  readonly act: 'click' | 'type' | 'menu' | 'open' | 'search' | MediaOp | ScrollOp
  readonly n: number
}

/** The ref or link action a card label names; null for a ref-less verb, an Appliance Verb, `none`, or a label the card never offers. */
function refActionOf(label: string): RefAction | null {
  const match = /^([a-z]+)-(\d+)$/.exec(label)
  if (match === null) return null
  const [, act, n] = match as unknown as [string, string, string]
  return act === 'click' || act === 'type' || act === 'menu' || act === 'open' || act === 'search' || isMediaOp(act) || isScrollOp(act) ? { act, n: Number(n) } : null
}

/** The Amount rung a seek reads (#372): the most probable seek rung the answer gives any probability; `little` when none was asked, or it gives none. */
function amountOf(answers: CommandAnswers | HopAnswers): AmountRung {
  if (!('amount' in answers)) return 'little'
  return mostProbable(answers.amount, (label) => AMOUNT_RUNGS.find((rung) => rung === label) ?? null) ?? 'little'
}

/** The Amount rung a volume or a speed reads (#408): the most probable level rung the answer gives any probability; null when none was asked, or it gives none. */
function levelOf(answers: CommandAnswers | HopAnswers): LevelRung | null {
  if (!('amount' in answers)) return null
  return mostProbable(answers.amount, (label) => LEVEL_RUNGS.find((rung) => rung === label) ?? null)
}

/** The Extent rung the answers name (#383); `screen` when none was asked, or the answer names no rung. */
function extentOf(answers: CommandAnswers | HopAnswers): ExtentRung {
  const choice = 'extent' in answers ? answers.extent.choice : null
  return EXTENT_RUNGS.find((rung) => rung === choice) ?? 'screen'
}

/** The scroll a Scroll Op makes of its region (#383, ADR 0085), the Extent read into screens; null on a ref that is no region. */
function scrollCommand(op: ScrollOp, ref: CommandRef, answers: CommandAnswers | HopAnswers, text: string): Command | null {
  if (!isRegionRef(ref)) return null
  return { verb: scrollVerbOf(op), target: ref.ref, slot: null, extent: scrollExtent(extentOf(answers), text) }
}

/**
 * The Media Op Command a card label makes (#372, ADR 0080): the op on the
 * media ref it names, when the element can take it — a seek with the
 * Amount read into seconds, a volume or a speed with the level its rung
 * comes to — the direction Jev's (#408). Null for an op the element cannot
 * take, a ref that is no media ref, no level rung, or a `to` the words
 * give no level for.
 */
function mediaCommand(op: MediaOp, ref: CommandRef, answers: CommandAnswers | HopAnswers, text: string): Command | null {
  if (!isMediaRef(ref) || !mediaOpsOf(ref.media).includes(op)) return null
  const command = (mediaOp: MediaOpAction): Command => ({ verb: 'media', target: ref.ref, slot: null, mediaOp })
  if (isSeek(op)) return command({ op, ...seekAmount(amountOf(answers), op, ref.media, text) })
  if (op === 'volume' || op === 'rate') {
    const rung = levelOf(answers)
    const to = rung === null ? null : op === 'volume' ? volumeLevel(rung, text, ref.media) : rateLevel(rung, text, ref.media)
    return to === null ? null : command({ op, to })
  }
  return command({ op })
}

/** The ref an action names, when the hop offers it — for a type, only a text field; for a Search Op, only a search box. */
function offeredRefOf(acted: RefAction, page: CommandPage): CommandRef | null {
  const ref = page.refs.find((candidate) => candidate.ref === acted.n)
  if (ref === undefined || (acted.act === 'type' && !isTextField(ref)) || (acted.act === 'search' && !isSearchBox(ref))) return null
  return ref
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
 * The opening a card action names (#332): a click on an offered ref, the
 * open of an offered link at its address; null for anything else. `refs`,
 * when given, are the only refs that may be clicked.
 */
function openingOf(acted: RefAction | null, page: CommandPage, links: readonly OfferedLink[], refs: ReadonlySet<number> | null = null): Command | null {
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
  return mostProbable<Command>(answer, (label) => openingOf(refActionOf(label), page, links))
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

/** {@link mostProbableOpening} for a later hop on a search landing: on a Web Engine's, a result or nothing ({@link fallbackTargets}); never a click the Task set aside. */
function mostProbableFallbackOpening(answer: DecisionChoiceAnswer, page: CommandPage, links: readonly OfferedLink[], setAside: readonly SetAside[]): Command | null {
  const targets = fallbackTargets(page, links)
  return mostProbable<Command>(answer, (label) => (isAside(label, page, setAside, NO_SHOW_OPS) ? null : openingOf(refActionOf(label), page, targets.links, targets.refs)))
}

/**
 * A later hop's search (#332): on a search landing it opens the most
 * probable click or open on the card — on a Web Engine's landing a result,
 * never the engine's own chrome; off one the Task has reached a page and a
 * target Jev barely offered would overrun it (#342), so the hop has no
 * next step — nor on a landing with nothing to open.
 */
function laterHopOpening(answer: DecisionChoiceAnswer, page: CommandPage, links: readonly OfferedLink[], hop: HopContext): Command {
  if (!onResults(page.url, hop)) return { verb: 'none', target: null, slot: null }
  return mostProbableFallbackOpening(answer, page, links, hop.setAside ?? []) ?? { verb: 'none', target: null, slot: null }
}

/** Whether the Task already searched for or typed exactly these words (#400): a fact of its record, never a judgement of the words. */
function searchedBefore(words: string, hop: HopContext): boolean {
  const asked = normalizeWords(words)
  return asked !== '' && (hop.terms ?? []).some((term) => normalizeWords(term) === asked)
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
 * An Appliance Verb reading (#374): the `play` Command the grammar's exact
 * lines make, carrying the Player's action — a search's words off the Slot.
 */
function applianceCommand(verb: ApplianceVerb, slot: DecisionChoiceAnswer, text: string, answers: CommandAnswers | HopAnswers, url: string, hop: HopContext | undefined): Command {
  const { music } = APPLIANCE_VERBS[verb]
  const words = music.kind === 'search' ? slotWords(slot, text) : null
  // A song to play reads `where` as a search does (AGENTS.md, "Jev decides;
  // code shapes the ask"): words Jev reads as pointing on the site open
  // but not on this page are looked for on that site, a Site Scope (#340),
  // and the landing's own media plays — on any site, through the media
  // ops (#372). Off a site, or on the Media Engine, where a site scope
  // would be a worse road to the Player's own search, the Player searches.
  // The Queue's own places (`play_next`, `queue`) are the Player's alone.
  if (verb === 'play' && words !== null && 'where' in answers && answers.where.choice === 'site' && !isMediaEngine(url)) {
    const site = scopableSite(url, hop)
    if (site !== null) return { verb: 'search', target: null, slot: words, site }
  }
  return { verb: 'play', target: null, slot: words, music }
}

/** The Command a card label naming a ref or a link makes (#370); null when the hop does not offer what it names. */
function refCommand(acted: RefAction, answers: CommandAnswers | HopAnswers, text: string, page: CommandPage, links: readonly OfferedLink[]): Command | null {
  if (acted.act === 'open') return openingOf(acted, page, links)
  const ref = offeredRefOf(acted, page)
  if (ref === null) return null
  if (isMediaOp(acted.act)) return mediaCommand(acted.act, ref, answers, text)
  if (isScrollOp(acted.act)) return scrollCommand(acted.act, ref, answers, text)
  // A Search Op (#398) is a type that replaces the box's words and submits it; the Slot is the search terms.
  if (acted.act === 'search') return { verb: 'type', target: ref.ref, slot: slotWords(answers.slot, text), submit: true }
  return { verb: acted.act, target: ref.ref, slot: acted.act === 'type' ? slotWords(answers.slot, text) : null }
}

/** Whether a card label is a verb the card offers as it is. */
const isRefLessVerb = (label: string): label is RefLessVerb => (REFLESS_VERBS as readonly string[]).includes(label)

/**
 * The card label a reading acts on: the top choice; or, when the Task set
 * it aside on the same call that judged it no progress (#373), the most
 * probable label still offered, at {@link RUNNER_UP_FLOOR} or over —
 * `none` under it.
 */
function offeredChoice(action: DecisionChoiceAnswer, page: CommandPage, setAside: readonly SetAside[], texts: readonly TextTarget[]): string {
  return isAside(action.choice, page, setAside, texts) ? (rankedOffered(action, page, setAside, texts)[0] ?? 'none') : action.choice
}

/** The Command Jev's answers make: the action card's top option, with the Slot and `where` read as the action needs them. */
export function readCommandAnswers(answers: CommandAnswers | HopAnswers, text: string, pageRead: CommandPage, hop?: HopContext): Command {
  const none: Command = { verb: 'none', target: null, slot: null }
  const texts = textTargetsOf(pageRead, hop)
  const label = offeredChoice(answers.action, pageRead, hop?.setAside ?? [], texts)
  if (isApplianceVerb(label)) return applianceCommand(label, answers.slot, text, answers, pageRead.url, hop)
  if (label === 'resume') return { verb: 'resume', target: null, slot: null }
  // A fact the appliance holds (#402): said, the page untouched.
  const fact = factOfLabel(label)
  if (fact !== null) return { verb: 'say', target: null, slot: null, fact }
  // A Show Op (#393, ADR 0086) is a scroll down that brings its block into view.
  const show = showOf(label, texts)
  if (show !== null) return { verb: 'scroll_down', target: null, slot: null, show }
  const { page, links } = offered(pageRead, hop)
  const acted = refActionOf(label)
  // A Search Op for words the Task already searched (#400) searches nothing new: it reads as a later hop's search (#332).
  if (acted?.act === 'search' && hop !== undefined && searchedBefore(slotWords(answers.slot, text), hop)) return laterHopOpening(answers.action, page, links, hop)
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
    // never searches again.
    return laterHopOpening(answers.action, page, links, hop)
  }
  // The page's own scroll reads the Extent when it was asked (#383, ADR 0085); unasked, it scrolls as the grammar's line does.
  if ((verb === 'scroll_down' || verb === 'scroll_up') && 'extent' in answers) return { verb, target: null, slot, extent: scrollExtent(extentOf(answers), text) }
  if (verb === 'press') {
    const key = slot === null ? null : pressKeyOf(slot)
    return { verb, target: null, slot, key: key ?? PRESS_KEYS.enter, times: 1 }
  }
  return { verb, target: null, slot }
}
