import type { KeyPress } from '../ports/browser'
import type { MediaFacts, PageMedia, PageSnapshot, PlayerSwitch, RefKind, RegionFacts, SnapshotRef } from '../browser/snapshot'
import type { TextBelow } from '../browser/pageText'
import { pageTermsOf } from '../voice/pageTerms'
import { describeDuration } from '../timer/duration'
import type { MusicAction } from '../music/musicWords'
import type { ApplianceFact } from './applianceFacts'
import { describeMediaOp, type MediaOpAction } from './mediaOp'
import { describeExtent, scrollOpOfVerb, type ScrollExtent } from './scrollOp'

// A Command (CONTEXT.md, ADR 0076): what an Utterance becomes on this
// branch — one verb, at most one target on the page and one Slot, performed
// at once. No plan, no confirmation, no second step. A verb is an action
// the browser can take, never a word the user said (#353): "open" is
// words, `navigate` and `search` are verbs. The reading that makes one
// (the Local Match, Jev's Choices) lives beside this file; the runner
// that performs it lives in main.

/**
 * The verbs a Command can carry. The Decision Model is offered
 * {@link JEV_VERBS} on its action card (#370) — a click, type or menu on
 * each ref, a media ref's Media Ops (#372, ADR 0080: the `media` verb,
 * its op on the Command), the rest as they are — and `play` through the
 * Appliance Verbs (#374), and `say` through the facts' options (#402);
 * `screenshot`, `help`, `resume` and `timer` are the CLI grammar's alone,
 * reached only through the Local Match.
 */
export const COMMAND_VERBS = [
  'navigate',
  'search',
  'click',
  'type',
  'menu',
  'media',
  'scroll_up',
  'scroll_down',
  'back',
  'forward',
  'reload',
  'press',
  'read',
  'clear',
  'stop',
  'none',
  'screenshot',
  'help',
  'resume',
  'timer',
  'play',
  'say',
] as const
export type CommandVerb = (typeof COMMAND_VERBS)[number]

/** The verbs the CLI grammar alone reaches: Jev is never offered them. */
export const GRAMMAR_ONLY_VERBS: ReadonlySet<CommandVerb> = new Set<CommandVerb>(['screenshot', 'help', 'resume', 'timer'])

/**
 * The browser's verbs the Decision Model chooses among (#324), `none`
 * included. `play` is not one: Jev reaches the Player through the
 * Appliance Verbs, offered beside these while a Player is wired (#374);
 * nor `say`, reached through the option of the fact it says (#402).
 */
export const JEV_VERBS = COMMAND_VERBS.filter((verb) => !GRAMMAR_ONLY_VERBS.has(verb) && verb !== 'play' && verb !== 'say') as readonly Exclude<CommandVerb, 'screenshot' | 'help' | 'resume' | 'timer' | 'play' | 'say'>[]

/** The keys `press` speaks: enter, escape, tab, space and the arrows. */
export const PRESS_KEYS: Readonly<Record<string, KeyPress>> = {
  enter: { key: 'Enter' },
  escape: { key: 'Escape' },
  tab: { key: 'Tab' },
  space: { key: 'Space' },
  up: { key: 'ArrowUp' },
  down: { key: 'ArrowDown' },
  left: { key: 'ArrowLeft' },
  right: { key: 'ArrowRight' },
}

export interface Command {
  readonly verb: CommandVerb
  /** The ref the verb acts on (click, type, menu, media; a scroll's Scroll Region, #383); null for the rest. */
  readonly target: number | null
  /**
   * The Slot: the Utterance's own words the Command carries verbatim — the
   * address to navigate to, the search terms, the text to type, the key to
   * press. Null when the verb takes none.
   */
  readonly slot: string | null
  /** For `press`: the key the Slot named (the CLI grammar names it directly). */
  readonly key?: KeyPress
  /** For `press`: how many times; 1 when absent. */
  readonly times?: number
  /** For `search`: the Site Scope (#340) — the host it searches on (`x.com`); absent for a search of the whole web. */
  readonly site?: string
  /** For `timer`: the length to count down; absent turns the Timer off. */
  readonly durationMs?: number
  /** For `play` (#343): what the line asks of the Player; a search's words are the Slot. */
  readonly music?: MusicAction
  /** For `say` (#402): the fact the appliance holds that the Answer says. */
  readonly fact?: ApplianceFact
  /** For `media` (#372, ADR 0080): the Media Op on the target ref's element — a seek's rung and seconds, a volume's or a speed's level. */
  readonly mediaOp?: MediaOpAction
  /**
   * For `scroll_up` and `scroll_down` (#383, ADR 0085): how far, as the
   * Extent read it — a Scroll Op's on the region `target` names, or the
   * page's own; absent for a page scroll the grammar's line made, which
   * moves its fixed three notches.
   */
  readonly extent?: ScrollExtent
  /** For `scroll_down`, a Show Op (#393, ADR 0086): the block of Text Further Down it brings into view, in place of an Extent. */
  readonly show?: TextBelow
  /** The click or the Escape closes an open dialog (#336): its Answer is "Closed the pop-up.", and a dialog still open after it is a failure. */
  readonly dismiss?: true
  /** The Mark Ask chose the target (#382, ADR 0084): the control the words named on the image of the page, which "Done so far" says. */
  readonly marked?: true
  /** For `type`, a Search Op (#398): the words replace what the search box holds, then the box is submitted. */
  readonly submit?: true
}

/** What the reading sees of one ref: the number, its kind, its label and, for a link, its address. */
export interface CommandRef {
  readonly ref: number
  readonly kind: RefKind
  readonly label: string
  readonly href: string | null
  /** An input's type (`text`, `checkbox`, …); null for every other kind. */
  readonly inputType: string | null
  /** Its Ref State (`pressed=true`, `expanded=false`, …); absent when the tree said nothing of it. */
  readonly states?: readonly string[]
  /** A media ref's own facts (#372, ADR 0080): its line's state, and what its Media Ops are gated by; absent for every other kind. */
  readonly media?: MediaFacts
  /** A Scroll Region's own facts (#383, ADR 0085): its line's position and length, and what a Scroll Op moved; absent for every other kind. */
  readonly region?: RegionFacts
  /** What a closed trigger opens (#388): the names of its hidden panel's controls, its line's "menu holds"; absent for every other ref. */
  readonly holds?: readonly string[]
  /** A media ref's Player Switches (#389, ADR 0080): each by its ref, label and on or off; absent for every other ref. */
  readonly switches?: readonly PlayerSwitch[]
  /** The host of the frame it was read in (#377, ADR 0081); absent for the top document's own. */
  readonly frame?: string
  /** A search box (#398): a field that searches, by kind, and the words it holds now; absent for every other ref. */
  readonly searchBox?: SearchBoxFacts
  /** The submit control of a form that holds a search box (#398): its line says `button[submit]`; absent for every other ref. */
  readonly submitsSearch?: true
}

/** A search box's own facts (#398): what its line says it holds, since a stale value is what a type used to append to. */
export interface SearchBoxFacts {
  readonly holds: string
}

/** The page a Command is read against: its address, its title and its numbered refs. */
export interface CommandPage {
  readonly url: string
  readonly title: string
  readonly refs: readonly CommandRef[]
  /** The Page Terms (ADR 0077): the names the page shows, ranked, for the Name Match; absent for a page read without them. */
  readonly terms?: readonly string[]
  /** The text in view (#390), block by block in reading order: what every ask, the Verdict's among them, sees the page show; absent for a page read without it. */
  readonly viewportText?: readonly string[]
  /** How many more blocks were in view past those the collect keeps (#392): the line says the cut; absent when none. */
  readonly viewportTextMore?: number
  /** Text Further Down (#393, ADR 0086): the blocks below the view, the action card's targets; absent for a page read without them. */
  readonly textBelow?: readonly TextBelow[]
  /** The dialog open over the page (#336): its text and the refs in its layer; absent when none is open. */
  readonly dialog?: PageDialog
  /** The media element playing on it (#363): what Jev is told and what "Done so far" compares; absent when none has started. */
  readonly media?: PageMedia
  /** Whether the document is in full screen (#387): a fact of the page by kind, never a site's button label; absent for a page read without it. */
  readonly fullScreen?: boolean
}

/** A dialog open over the page (#336). */
export interface PageDialog {
  readonly text: string
  /** The refs of the dialog's layer, by number. */
  readonly refs: readonly number[]
}

export function commandRefOf(ref: SnapshotRef): CommandRef {
  return { ref: ref.ref, kind: ref.kind, label: ref.label, href: ref.href, inputType: ref.inputType, ...(ref.states !== undefined ? { states: ref.states } : {}), ...(ref.media !== undefined ? { media: ref.media } : {}), ...(ref.region !== undefined ? { region: ref.region } : {}), ...(ref.holds !== undefined ? { holds: ref.holds } : {}), ...(ref.switches !== undefined ? { switches: ref.switches } : {}), ...(ref.frame !== undefined ? { frame: ref.frame } : {}), ...searchFactsOf(ref) }
}

/** A search box's facts and a search form's submit (#398), off the collect's own: the box's kind and what it holds, the submit's kind. */
function searchFactsOf(ref: SnapshotRef): Pick<CommandRef, 'searchBox' | 'submitsSearch'> {
  if (ref.kind === 'input' && ref.searchField) return { searchBox: { holds: ref.value ?? '' } }
  return ref.kind === 'button' && ref.submitsForm && ref.formHasSearch ? { submitsSearch: true } : {}
}

/** The page a Command is read against, off a collected snapshot: its refs, its Page Terms, its text in view and the dialog open over it. */
export function commandPageOf(snapshot: PageSnapshot): CommandPage {
  return {
    url: snapshot.url,
    title: snapshot.title,
    refs: snapshot.refs.map(commandRefOf),
    terms: pageTermsOf({ title: snapshot.title, labels: snapshot.refs.map((ref) => ref.label), text: snapshot.viewportText }),
    viewportText: snapshot.viewportText,
    ...(snapshot.viewportTextMore !== undefined ? { viewportTextMore: snapshot.viewportTextMore } : {}),
    ...(snapshot.textBelow !== undefined ? { textBelow: snapshot.textBelow } : {}),
    ...(snapshot.media != null ? { media: snapshot.media } : {}),
    ...(snapshot.fullScreen !== undefined ? { fullScreen: snapshot.fullScreen } : {}),
    ...(snapshot.dialogOpen ? { dialog: { text: snapshot.dialogText, refs: snapshot.refs.filter((ref) => ref.layer === 'dialog').map((ref) => ref.ref) } } : {}),
  }
}

/**
 * Whether the page is still mounting (post mortem 2026-10-19 23:26): at
 * most one ref, or a dialog open with no text and no controls. A script-
 * drawn site's load event fires on its empty shell — Truth Social's
 * profile was read with an empty dialog and no refs, then with "Home"
 * alone, and its sign-up sheet drew seconds later — so such a page is a
 * loading signal, not a page to read, nor an Obstacle to step aside from.
 */
export function isMounting(page: CommandPage): boolean {
  if (page.dialog !== undefined && page.dialog.text.trim() === '' && page.dialog.refs.length === 0) return true
  return page.refs.length <= 1
}

/** The verbs that act on one ref. */
export function verbTakesTarget(verb: CommandVerb): boolean {
  return verb === 'click' || verb === 'type' || verb === 'menu' || verb === 'media'
}

/**
 * The verbs that need no pane on the screen — the Timer, a Stop,
 * `none`, the Player's (#344: the search and the watch page happen in
 * the hidden pane, and the music plays on there), a Media Op (#372: one
 * evaluate on the element, which plays on under the Idle Screen as a
 * song does) and a fact the appliance says (#402). A Command carrying one
 * leaves the Idle Screen up (CONTEXT.md), save "show the video": see
 * {@link commandKeepsIdle}.
 */
export function verbKeepsIdle(verb: CommandVerb): boolean {
  return verb === 'timer' || verb === 'stop' || verb === 'none' || verb === 'play' || verb === 'media' || verb === 'say'
}

/** The verbs that act on the page in the pane: with none there (#361), they answer so and touch nothing — the hidden pane would never answer them. */
export function verbNeedsPage(verb: CommandVerb): boolean {
  return !verbKeepsIdle(verb) && !verbOpensPage(verb) && verb !== 'help'
}

/** The verbs that bring a page to a blank pane. */
export function verbOpensPage(verb: CommandVerb): boolean {
  return verb === 'navigate' || verb === 'search' || verb === 'resume'
}

/**
 * Whether this Command leaves the Idle Screen up: its verb does, unless it
 * is "show the video", which wakes the dashboard on the watch page (#344).
 * On a blank pane every Command does but one that opens a page (#361): the
 * blank pane is never worth the screen, so a `scroll down` there answers
 * over the Idle Screen.
 */
export function commandKeepsIdle(command: Command, paneHasPage = true): boolean {
  if (!paneHasPage && !verbOpensPage(command.verb)) return true
  return verbKeepsIdle(command.verb) && command.music?.kind !== 'show'
}

/** The verbs that carry a Slot. */
export function verbTakesSlot(verb: CommandVerb): boolean {
  return verb === 'navigate' || verb === 'search' || verb === 'type' || verb === 'press'
}

/**
 * The words of an Utterance, normalized for matching: lower case, letters
 * and digits only, one space between words.
 */
export function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The key a spoken word names (`pressKeyOf('return')` is Enter); null for a
 * word that names none. "arrow up" and "up arrow" both read as the up arrow.
 */
export function pressKeyOf(words: string): KeyPress | null {
  const normalized = normalizeWords(words)
    .replace(/\b(the|a|an|arrow|key)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  switch (normalized) {
    case 'enter':
    case 'return':
    case 'go':
      return PRESS_KEYS.enter
    case 'escape':
    case 'esc':
      return PRESS_KEYS.escape
    case 'tab':
      return PRESS_KEYS.tab
    case 'space':
    case 'spacebar':
    case 'space bar':
      return PRESS_KEYS.space
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      return PRESS_KEYS[normalized]
    default:
      return null
  }
}

/** One line describing a Command: the verb, its target and its Slot — what the Feed Entry shows as the action taken. */
export function describeCommand(command: Command, page?: CommandPage): string {
  const label = (ref: number | null): string => {
    if (ref === null) return ''
    const found = page?.refs.find((candidate) => candidate.ref === ref)
    return found && found.label !== '' ? ` [${ref}] ${JSON.stringify(found.label)}` : ` [${ref}]`
  }
  switch (command.verb) {
    case 'navigate':
      return `navigate ${command.slot ?? ''}`.trim()
    case 'search':
      return `search ${command.slot ?? ''}${command.site !== undefined ? ` on ${command.site}` : ''}`.trim()
    case 'click':
      return `click${label(command.target)}`
    case 'type':
      // A Search Op (#398) is told as the search it is.
      if (command.submit === true) return `search for ${JSON.stringify(command.slot ?? '')} with${label(command.target)}`
      return `type ${JSON.stringify(command.slot ?? '')} into${label(command.target)}`
    case 'menu':
      return `menu${label(command.target)}`
    case 'media':
      return `${command.mediaOp !== undefined ? describeMediaOp(command.mediaOp) : 'media'}${label(command.target)}`
    case 'scroll_up':
    case 'scroll_down': {
      if (command.show !== undefined) return showOpAction(command.show)
      // A Scroll Op names its region (#383, ADR 0085); either scroll names its Extent when it has one.
      const op = scrollOpOfVerb(command.verb)!
      const how = command.extent !== undefined ? ` ${describeExtent(command.extent, op)}` : ''
      return `scroll${label(command.target)} ${op}${how}`
    }
    case 'press': {
      const key = command.key?.key ?? command.slot ?? 'Enter'
      return `press ${key}${(command.times ?? 1) > 1 ? ` ×${command.times}` : ''}`
    }
    case 'read':
      return 'read the page'
    case 'resume':
      return 'resume the last page'
    case 'timer':
      return command.durationMs !== undefined ? `timer ${describeDuration(command.durationMs)}` : 'timer off'
    case 'play':
      return describeMusic(command.music, command.slot)
    case 'say':
      return `say ${command.fact === 'playing' ? 'the song playing' : `the ${command.fact ?? 'fact'}`}`
    case 'none':
      return 'not a command'
    default:
      return command.verb
  }
}

/**
 * A Show Op in words (#393, ADR 0086), the block by its first 80
 * characters: the card's option with the entry's number `n` and the
 * block's kind (#405), and without them as the Feed and "Done so far" name
 * what was done — one sentence, so the two never drift apart. The kind
 * rides the option only, as it was measured.
 */
export function showOpAction(block: TextBelow, n?: number): string {
  const which = n !== undefined ? `[text-${n}] ${block.kind !== undefined ? `${block.kind} ` : ''}` : ''
  return `scroll until ${which}${JSON.stringify(block.text.slice(0, 80))} is in view`
}

/** A music line as the Feed names it (#343): `play <words>`, `queue <words>`, `play <words> next`, `skip`, `loop off`, `volume 40`. */
function describeMusic(music: MusicAction | undefined, words: string | null): string {
  if (music === undefined) return 'play'
  switch (music.kind) {
    case 'search':
      return music.place === 'end' ? `queue ${words ?? ''}` : `play ${words ?? ''}${music.place === 'front' ? ' next' : ''}`
    case 'unpause':
      return 'play'
    case 'loop':
      return music.on ? 'loop' : 'loop off'
    case 'volume':
      return `volume ${music.to}`
    case 'mute':
      return music.on ? 'mute' : 'unmute'
    case 'show':
      return 'show the video'
    case 'correct':
      return music.step > 0 ? 'not that one' : 'the one before'
    case 'forget':
      return 'forget this song'
    default:
      return music.kind
  }
}

/** The label the page shows on the ref a Command acts on (click, type); undefined when it acts on none, or the page has no such ref. */
export function targetLabel(command: Command, page: CommandPage): string | undefined {
  return command.target === null ? undefined : page.refs.find((ref) => ref.ref === command.target)?.label
}
