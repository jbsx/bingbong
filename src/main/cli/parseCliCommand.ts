export type CliCommand =
  | { type: 'navigate'; input: string }
  | { type: 'read' }
  | { type: 'click'; ref: number }
  | { type: 'type'; ref: number; text: string }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'screenshot'; path: string | undefined }
  | { type: 'back' }
  | { type: 'help' }
  | { type: 'quit' }

export type ParsedCliCommand = { ok: true; command: CliCommand } | { ok: false; error: string } | null

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
