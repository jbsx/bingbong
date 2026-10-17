import type { KeyPress } from '../ports/browser'
import type { RefKind, SnapshotRef } from '../browser/snapshot'

// A Command (CONTEXT.md, ADR 0076): what an Utterance becomes on this
// branch — one verb, at most one target on the page and one Slot, performed
// at once. No plan, no confirmation, no second step. The reading that makes
// one (the Local Match, Jev's Choices, the best guess) lives beside this
// file; the runner that performs it lives in main.

/**
 * The verbs a Command can carry. The Decision Model is offered
 * {@link JEV_VERBS}; `screenshot` and `help` are the CLI grammar's alone,
 * reached only through the Local Match.
 */
export const COMMAND_VERBS = [
  'open',
  'click',
  'type',
  'scroll_up',
  'scroll_down',
  'back',
  'forward',
  'press',
  'read',
  'clear',
  'stop',
  'none',
  'screenshot',
  'help',
] as const
export type CommandVerb = (typeof COMMAND_VERBS)[number]

/** The verbs the Decision Model chooses among (#324): the spoken vocabulary, `none` included. */
export const JEV_VERBS = COMMAND_VERBS.filter((verb) => verb !== 'screenshot' && verb !== 'help') as readonly Exclude<CommandVerb, 'screenshot' | 'help'>[]

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
}

export function commandRefOf(ref: SnapshotRef): CommandRef {
  return { ref: ref.ref, kind: ref.kind, label: ref.label, href: ref.href, inputType: ref.inputType }
}

/** The verbs that act on one ref. */
export function verbTakesTarget(verb: CommandVerb): boolean {
  return verb === 'click' || verb === 'type'
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
      return `open ${command.slot ?? ''}`.trim()
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
    case 'none':
      return 'not a command'
    default:
      return command.verb
  }
}
