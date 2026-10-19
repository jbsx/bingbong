import type { KeyPress } from '../ports/browser'
import type { PageSnapshot, RefKind, SnapshotRef } from '../browser/snapshot'
import { pageTermsOf } from '../voice/pageTerms'
import { describeDuration } from '../timer/duration'
import type { MusicAction } from '../music/musicWords'

// A Command (CONTEXT.md, ADR 0076): what an Utterance becomes on this
// branch — one verb, at most one target on the page and one Slot, performed
// at once. No plan, no confirmation, no second step. The reading that makes
// one (the Local Match, Jev's Choices, the best guess) lives beside this
// file; the runner that performs it lives in main.

/**
 * The verbs a Command can carry. The Decision Model is offered
 * {@link JEV_VERBS}; `screenshot`, `help`, `resume` and `timer` are the
 * CLI grammar's alone, reached only through the Local Match.
 */
export const COMMAND_VERBS = [
  'open',
  'click',
  'type',
  'scroll_up',
  'scroll_down',
  'back',
  'forward',
  'reload',
  'press',
  'read',
  'clear',
  'stop',
  'done',
  'none',
  'screenshot',
  'help',
  'resume',
  'timer',
  'play',
] as const
export type CommandVerb = (typeof COMMAND_VERBS)[number]

/** The verbs the CLI grammar alone reaches: Jev is never offered them. `play` is the Player's (#343, owner's ruling 1). */
export const GRAMMAR_ONLY_VERBS: ReadonlySet<CommandVerb> = new Set<CommandVerb>(['screenshot', 'help', 'resume', 'timer', 'play'])

/** The verbs the Decision Model chooses among (#324): the spoken vocabulary, `none` included. */
export const JEV_VERBS = COMMAND_VERBS.filter((verb) => !GRAMMAR_ONLY_VERBS.has(verb)) as readonly Exclude<CommandVerb, 'screenshot' | 'help' | 'resume' | 'timer' | 'play'>[]

/** The keys `press` speaks: enter, escape, space and the arrows. */
export const PRESS_KEYS: Readonly<Record<string, KeyPress>> = {
  enter: { key: 'Enter' },
  escape: { key: 'Escape' },
  space: { key: 'Space' },
  up: { key: 'ArrowUp' },
  down: { key: 'ArrowDown' },
  left: { key: 'ArrowLeft' },
  right: { key: 'ArrowRight' },
}

export interface Command {
  readonly verb: CommandVerb
  /** The ref the verb acts on (click, type); null for the rest. */
  readonly target: number | null
  /**
   * The Slot: the Utterance's own words the Command carries verbatim — the
   * address to open, the text to type, the key to press. Null when the
   * verb takes none.
   */
  readonly slot: string | null
  /** For `press`: the key the Slot named (the CLI grammar names it directly). */
  readonly key?: KeyPress
  /** For `press`: how many times; 1 when absent. */
  readonly times?: number
  /** For `open`: the Slot is search terms however it reads ("search for rust"). */
  readonly search?: boolean
  /** For an `open` search: the Site Scope (#340) — the host it searches on (`x.com`); absent for a search of the whole web. */
  readonly site?: string
  /** For `timer`: the length to count down; absent turns the Timer off. */
  readonly durationMs?: number
  /** For `play` (#343): what the line asks of the Player; a search's words are the Slot. */
  readonly music?: MusicAction
  /** The click or the Escape closes an open dialog (#336): its Answer is "Closed the pop-up.", and a dialog still open after it is a failure. */
  readonly dismiss?: true
}

/** What the reading sees of one ref: the number, its kind, its label and, for a link, its address. */
export interface CommandRef {
  readonly ref: number
  readonly kind: RefKind
  readonly label: string
  readonly href: string | null
  /** An input's type (`text`, `checkbox`, …); null for every other kind. */
  readonly inputType: string | null
}

/** The page a Command is read against: its address, its title and its numbered refs. */
export interface CommandPage {
  readonly url: string
  readonly title: string
  readonly refs: readonly CommandRef[]
  /** The Page Terms (ADR 0077): the names the page shows, ranked, for the Name Match; absent for a page read without them. */
  readonly terms?: readonly string[]
  /** The dialog open over the page (#336): its text and the refs in its layer; absent when none is open. */
  readonly dialog?: PageDialog
}

/** A dialog open over the page (#336). */
export interface PageDialog {
  readonly text: string
  /** The refs of the dialog's layer, by number. */
  readonly refs: readonly number[]
}

export function commandRefOf(ref: SnapshotRef): CommandRef {
  return { ref: ref.ref, kind: ref.kind, label: ref.label, href: ref.href, inputType: ref.inputType }
}

/** The page a Command is read against, off a collected snapshot: its refs, its Page Terms and the dialog open over it. */
export function commandPageOf(snapshot: PageSnapshot): CommandPage {
  return {
    url: snapshot.url,
    title: snapshot.title,
    refs: snapshot.refs.map(commandRefOf),
    terms: pageTermsOf({ title: snapshot.title, labels: snapshot.refs.map((ref) => ref.label), text: snapshot.viewportText }),
    ...(snapshot.dialogOpen ? { dialog: { text: snapshot.dialogText, refs: snapshot.refs.filter((ref) => ref.layer === 'dialog').map((ref) => ref.ref) } } : {}),
  }
}

/** The verbs that act on one ref. */
export function verbTakesTarget(verb: CommandVerb): boolean {
  return verb === 'click' || verb === 'type'
}

/**
 * The verbs that need no pane on the screen — the Timer, a Stop, `done`,
 * `none` and the Player's (#344: the search and the watch page happen in
 * the hidden pane, and the music plays on there). A Command carrying one
 * leaves the Idle Screen up (CONTEXT.md), save "show the video": see
 * {@link commandKeepsIdle}.
 */
export function verbKeepsIdle(verb: CommandVerb): boolean {
  return verb === 'timer' || verb === 'stop' || verb === 'done' || verb === 'none' || verb === 'play'
}

/** Whether this Command leaves the Idle Screen up: its verb does, unless it is "show the video", which wakes the dashboard on the watch page (#344). */
export function commandKeepsIdle(command: Command): boolean {
  return verbKeepsIdle(command.verb) && command.music?.kind !== 'show'
}

/** The verbs that carry a Slot. */
export function verbTakesSlot(verb: CommandVerb): boolean {
  return verb === 'open' || verb === 'type' || verb === 'press'
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
    case 'open':
      return `open ${command.slot ?? ''}${command.site !== undefined ? ` on ${command.site}` : ''}`.trim()
    case 'click':
      return `click${label(command.target)}`
    case 'type':
      return `type ${JSON.stringify(command.slot ?? '')} into${label(command.target)}`
    case 'scroll_up':
      return 'scroll up'
    case 'scroll_down':
      return 'scroll down'
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
    case 'none':
      return 'not a command'
    default:
      return command.verb
  }
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
    default:
      return music.kind
  }
}

/** The label the page shows on the ref a Command acts on (click, type); undefined when it acts on none, or the page has no such ref. */
export function targetLabel(command: Command, page: CommandPage): string | undefined {
  return command.target === null ? undefined : page.refs.find((ref) => ref.ref === command.target)?.label
}
