import type { KeyPress } from '../ports/browser'
import { NEXT_TRACK_KEY } from '../browser/mediaKeys'
import { parseDuration } from '../timer/duration'
import { readMusicLine, type MusicAction } from '../music/musicWords'

export type CliCommand =
  | { type: 'navigate'; input: string }
  | { type: 'read' }
  | { type: 'click'; ref: number }
  | { type: 'menu'; ref: number }
  | { type: 'type'; ref: number; text: string }
  | { type: 'scroll'; direction: 'up' | 'down' }
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
// (k play/pause, j/l seek, arrows volume) without a full keyboard grammar.
// The next-track mapping is shared with core/browser/mediaKeys.
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
  next: NEXT_TRACK_KEY,
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
      return 'I can scroll up or down.'
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
    case 'scroll':
      if (rest !== 'up' && rest !== 'down') {
        return { ok: false, error: "scroll: expected 'scroll up' or 'scroll down'" }
      }
      return { ok: true, command: { type: 'scroll', direction: rest } }
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
      return { ok: false, error: `unknown command: '${head}' — try 'help'` }
  }
}
