import type { KeyPress } from '../../core/ports/browser'
import { NEXT_TRACK_KEY } from '../../core/pipeline/mediaTools'

export type CliCommand =
  | { type: 'navigate'; input: string }
  | { type: 'read' }
  | { type: 'click'; ref: number }
  | { type: 'type'; ref: number; text: string }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'press'; press: KeyPress; times: number }
  | { type: 'screenshot'; path: string | undefined }
  | { type: 'back' }
  | { type: 'help' }
  | { type: 'quit' }

export type ParsedCliCommand = { ok: true; command: CliCommand } | { ok: false; error: string } | null

// Shortcut keys the CLI can inject — enough to drive media players
// (k play/pause, j/l seek, arrows volume) without a full keyboard grammar.
// The next-track mapping is shared with the media tools (core/pipeline).
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
  next: NEXT_TRACK_KEY,
}

const PRESS_KEY_NAMES = Object.keys(PRESS_KEYS).join(', ')
const PRESS_USAGE = `press: expected 'press <key> [times]' with key one of ${PRESS_KEY_NAMES}`

function unescape(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

export function parseCliCommand(line: string): ParsedCliCommand {
  const trimmed = line.trim()
  if (!trimmed) return null

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
      const press = parts[0] !== undefined ? PRESS_KEYS[parts[0]] : undefined
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
    case 'help':
      return { ok: true, command: { type: 'help' } }
    case 'quit':
    case 'exit':
      return { ok: true, command: { type: 'quit' } }
    default:
      return { ok: false, error: `unknown command: '${head}' — try 'help'` }
  }
}
