import type { KeyPress } from '../ports/browser'
import { parseDuration } from '../timer/duration'
import { readMusicLine, type MusicAction } from '../music/musicWords'

export type CliCommand =
  | { type: 'navigate'; input: string }
  | { type: 'read' }
  | { type: 'click'; ref: number }
  | { type: 'menu'; ref: number }
  | { type: 'type'; ref: number; text: string }
  | { type: 'scroll'; direction: 'up' | 'down'; ref?: number }
  | { type: 'press'; press: KeyPress; times: number }
  | { type: 'screenshot'; path: string | undefined }
  | { type: 'back' }
  | { type: 'reload' }
  | { type: 'resume' }
  | { type: 'timer'; durationMs: number | null }
  | { type: 'play'; music: MusicAction }
  | { type: 'help' }
  | { type: 'quit' }

export type ParsedCliCommand = { ok: true; command: CliCommand } | { ok: false; error: string } | null

// Shortcut keys the CLI can inject — enough to drive media players
// (k play/pause, j/l seek, arrows volume, Shift+N next) without a full
// keyboard grammar.
const PRESS_KEYS: Record<string, KeyPress> = {
  k: { key: 'k' },
  j: { key: 'j' },
  l: { key: 'l' },
  up: { key: 'ArrowUp' },
  down: { key: 'ArrowDown' },
  left: { key: 'ArrowLeft' },
  right: { key: 'ArrowRight' },
  space: { key: 'Space' },
  enter: { key: 'Enter' },
  tab: { key: 'Tab' },
  escape: { key: 'Escape' },
  esc: { key: 'Escape' },
  next: { key: 'n', shift: true },
}

const PRESS_KEY_NAMES = Object.keys(PRESS_KEYS).join(', ')
const PRESS_USAGE = `press: expected 'press <key> [times]' with key one of ${PRESS_KEY_NAMES}`

/** The keys an Answer names when `press` is refused: the plain ones, not the player's letters or the `esc` alias. */
const PRESS_KEYS_SAID = 'up, down, left, right, space, enter, tab, escape'

/**
 * The grammar's error for a line that starts with a verb it knows but goes
 * wrong past it, in the plain words an Answer is written in (the CLI keeps
 * the usage line); null for any other line.
 */
export function grammarErrorOf(line: string): string | null {
  const parsed = parseCliCommand(line)
  if (parsed === null || parsed.ok || parsed.error.startsWith('unknown command')) return null
  const trimmed = line.trim()
  const head = trimmed.split(/\s+/)[0] ?? ''
  const rest = trimmed.slice(head.length).trim()
  switch (head) {
    case 'navigate':
      return 'Navigate needs an address or something to search for.'
    case 'click':
      return 'Click needs the number of an item, like “click 7”.'
    case 'menu':
      return 'Menu needs the number of an item, like “menu 7”.'
    case 'type':
      return 'Type needs the number of a field and the words, like “type 3 hello”.'
    case 'scroll':
      return 'I can scroll up or down, or a scrolling part of the page by its number, like “scroll 12 down”.'
    case 'press': {
      const key = rest.split(/\s+/)[0] ?? ''
      if (key !== '' && PRESS_KEYS[key.toLowerCase()] !== undefined) return 'Press takes a whole number of times, like “press down 3”.'
      return key === '' ? `Press needs a key. Keys I know: ${PRESS_KEYS_SAID}.` : `I can't press ${key}. Keys I know: ${PRESS_KEYS_SAID}.`
    }
    case 'timer':
      return 'I couldn\'t read that length. Try “timer 10 minutes”, “timer 1h30m” or “timer off”.'
    default:
      // The Player's volume line (#343) is the one left.
      return 'Volume takes a number from 0 to 100, like “volume 40”.'
  }
}

/**
 * The Flag's fixed heads (#421): two words or more, so a ref labelled
 * "flag" or "mark" keeps its own reading (ADR 0089). Adding one is a
 * grammar change.
 */
const FLAG_HEADS: readonly string[] = ['mark this as a failure', 'flag that', 'that was wrong']
const HINT_MARK = 'with the hint'
/** The mark in the line as given: its words with whatever {@link flagWords} reads as a space between them. */
const HINT_MARK_RE = /with[^\p{L}\p{N}']+the[^\p{L}\p{N}']+hint/iu

const flagWords = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim()

/**
 * The Flag line (#421): a fixed head, the whole line or followed by
 * `with the hint <words>`, typed or as spoken; its hint as it was said,
 * less the punctuation around it. Null for any other line. It is the
 * runner's own, never a Command, and never Jev's.
 */
export function readFlagLine(line: string): { hint?: string } | null {
  const words = flagWords(line)
  const head = FLAG_HEADS.find((candidate) => words === candidate || words.startsWith(`${candidate} ${HINT_MARK}`))
  if (head === undefined) return null
  if (words === head || words === `${head} ${HINT_MARK}`) return {}
  // The hint's own spelling: everything after the mark in the line as given, however it was spaced or punctuated.
  const mark = HINT_MARK_RE.exec(line)
  const hint = mark === null ? '' : line.slice(mark.index + mark[0].length).replace(/^[\s,:;—-]+/, '').replace(/[\s.!?]+$/, '')
  return hint === '' ? {} : { hint }
}

/**
 * Whether a partial may yet be a Flag line (#326): a head's first word,
 * whole, or more of it, or a head and more; it waits for its Endpoint, so
 * a ref labelled "Mark" never fires under "mark this as a failure".
 */
export function headsFlagLine(partial: string): boolean {
  const words = flagWords(partial).split(' ').filter(Boolean)
  if (words.length === 0) return false
  if (words.length === 1) return FLAG_HEADS.some((head) => head.split(' ')[0] === words[0])
  return FLAG_HEADS.some((head) => {
    const said = head.split(' ')
    if (words.length > said.length) return words.slice(0, said.length).join(' ') === head
    const last = words.length - 1
    return words.every((word, index) => (index === last ? said[index]!.startsWith(word) : said[index] === word))
  })
}

/** The verbs the grammar reads only as the whole line. */
const WORDLESS_HEADS: ReadonlySet<string> = new Set(['read', 'read_page', 'back', 'reload', 'resume', 'help', 'quit', 'exit'])

function unknownCommand(head: string): ParsedCliCommand {
  return { ok: false, error: `unknown command: '${head}' — try 'help'` }
}

function unescape(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

export function parseCliCommand(line: string): ParsedCliCommand {
  const trimmed = line.trim()
  if (!trimmed) return null

  // The Player's lines (#343) first: "go back a song" is not `back`, and they read as typed or spoken.
  const music = readMusicLine(trimmed)
  if (music === 'invalid') return { ok: false, error: "volume: expected 'volume <0-100>'" }
  if (music !== null) return { ok: true, command: { type: 'play', music: music.music } }

  const space = trimmed.indexOf(' ')
  const head = space === -1 ? trimmed : trimmed.slice(0, space)
  const rest = space === -1 ? '' : trimmed.slice(space + 1).trim()

  // A verb that takes no words is the whole line or no grammar line (#368): "back to the results" is the spoken reading's.
  if (rest !== '' && WORDLESS_HEADS.has(head)) return unknownCommand(head)

  switch (head) {
    case 'navigate':
      if (!rest) return { ok: false, error: "navigate: expected 'navigate <url or search>'" }
      return { ok: true, command: { type: 'navigate', input: rest } }
    case 'read':
    case 'read_page':
      return { ok: true, command: { type: 'read' } }
    case 'click': {
      if (!/^\d+$/.test(rest)) {
        return { ok: false, error: "click: expected a ref number, e.g. 'click 7'" }
      }
      return { ok: true, command: { type: 'click', ref: Number(rest) } }
    }
    case 'menu': {
      // Open the ref's right-click menu (#363, ADR 0079): its options are the next read's refs.
      if (!/^\d+$/.test(rest)) {
        return { ok: false, error: "menu: expected a ref number, e.g. 'menu 7'" }
      }
      return { ok: true, command: { type: 'menu', ref: Number(rest) } }
    }
    case 'type': {
      const refText = space === -1 ? '' : trimmed.slice(space + 1)
      const refMatch = /^(\d+)\s+(.+)$/s.exec(refText.trim())
      if (!refMatch) return { ok: false, error: "type: expected 'type <ref> <text>'" }
      return { ok: true, command: { type: 'type', ref: Number(refMatch[1]), text: unescape(refMatch[2]) } }
    }
    case 'scroll': {
      if (rest === 'up' || rest === 'down') return { ok: true, command: { type: 'scroll', direction: rest } }
      // A Scroll Region by its number (#383, ADR 0085): one screen, no ask.
      const region = /^(\d+)\s+(up|down)$/.exec(rest)
      if (region === null) return { ok: false, error: "scroll: expected 'scroll up', 'scroll down' or 'scroll <ref> up|down'" }
      return { ok: true, command: { type: 'scroll', direction: region[2] as 'up' | 'down', ref: Number(region[1]) } }
    }
    case 'press': {
      const parts = rest.split(/\s+/).filter(Boolean)
      const press = parts[0] !== undefined ? PRESS_KEYS[parts[0].toLowerCase()] : undefined
      if (parts.length < 1 || parts.length > 2 || !press) {
        return { ok: false, error: PRESS_USAGE }
      }
      const times = parts.length === 2 ? Number(parts[1]) : 1
      if (!Number.isInteger(times) || times < 1) {
        return { ok: false, error: 'press: times must be a positive integer' }
      }
      return { ok: true, command: { type: 'press', press, times } }
    }
    case 'screenshot':
      return { ok: true, command: { type: 'screenshot', path: rest || undefined } }
    case 'back':
      return { ok: true, command: { type: 'back' } }
    case 'reload':
      return { ok: true, command: { type: 'reload' } }
    case 'resume':
      return { ok: true, command: { type: 'resume' } }
    case 'timer': {
      if (rest === 'off' || rest === 'cancel' || rest === 'stop') return { ok: true, command: { type: 'timer', durationMs: null } }
      const durationMs = parseDuration(rest)
      if (durationMs === null) return { ok: false, error: "timer: expected 'timer <length>' (5m, 1h30m, 2:30, 10 minutes) or 'timer off'" }
      return { ok: true, command: { type: 'timer', durationMs } }
    }
    case 'help':
      return { ok: true, command: { type: 'help' } }
    case 'quit':
    case 'exit':
      return { ok: true, command: { type: 'quit' } }
    default:
      return unknownCommand(head)
  }
}
