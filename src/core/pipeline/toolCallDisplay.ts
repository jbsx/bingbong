// One place that renders a tool call as a compact human-readable line — the
// dashboard transcript and the subagent cards' progress both use it.

import { scanPartialJsonString } from '../agent/answerContract'

export function describeToolAction(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'navigate':
      return `→ ${String(args.url ?? '')}`
    case 'click':
      return `click [${String(args.ref ?? '?')}]`
    case 'type':
      return `type "${String(args.text ?? '')}" into [${String(args.ref ?? '?')}]`
    case 'scroll':
      return `scroll ${String(args.direction ?? '')}`
    case 'web_search':
      return `search "${String(args.query ?? '')}"`
    case 'read_url':
      return `read ${String(args.url ?? '')}`
    case 'media_control':
      return `media ${String(args.action ?? '')}${args.offset !== undefined ? ` ${String(args.offset)}s` : ''}`
    case 'read_page':
      return 'read page'
    case 'screenshot':
      return 'screenshot'
    case 'ground_visual':
      return `visually locate "${String(args.target ?? '')}"`
    case 'look':
      return 'look at page'
    case 'back':
      return 'go back'
    case 'spawn_agent':
      return `spawn ${String(args.kind ?? 'research')} agent: ${String(args.task ?? '')}`
    case 'cancel_agent':
      return `cancel ${String(args.agent_id ?? args.agentId ?? '')}`.trim()
    case 'agent_results':
      return `collect results${args.wait === true ? ' (waiting)' : ''}`
    case 'ask_user':
      return `ask you: ${String(args.question ?? '')}`
    case 'toggle_panel':
      return 'toggle panel'
    case 'set_panel_mode':
      return `panel mode ${String(args.mode ?? '')}`.trim()
    default:
      return `${name} ${JSON.stringify(args)}`
  }
}

/**
 * Tool-call intent (#48): what the model is about to do, read from the
 * partial arguments JSON while they are still streaming — before the tool
 * executes. Names the action and its target argument value ("clicking
 * 'Search'…"); a still-open value shows everything received so far, so the
 * phrase grows as the arguments arrive. Verbs are tool-specific, never
 * provider-specific.
 */
export function describeToolIntent(name: string, args: string): string {
  switch (name) {
    case 'navigate':
      return withTarget('opening', args, 'url')
    case 'click':
      return withTarget('clicking', args, 'ref')
    case 'type':
      return withTarget('typing', args, 'text')
    case 'scroll':
      return withTarget('scrolling', args, 'direction')
    case 'web_search':
      return withTarget('searching for', args, 'query')
    case 'read_url':
      return withTarget('reading', args, 'url')
    case 'media_control':
      return withTarget('media', args, 'action')
    case 'ground_visual':
      return withTarget('visually locating', args, 'target')
    case 'ask_user':
      return withTarget('asking you', args, 'question')
    case 'spawn_agent': {
      const kind = partialTargetValue(args, 'kind')
      const verb = `spawning${kind && kind.value !== '' && kind.closed ? ` ${kind.value}` : ''} agent:`
      return withTarget(verb, args, 'task')
    }
    case 'cancel_agent':
      return withTarget('cancelling agent', args, 'agent_id', 'agentId')
    case 'read_page':
      return 'reading the page…'
    case 'screenshot':
      return 'taking a screenshot…'
    case 'look':
      return 'looking at the page…'
    case 'back':
      return 'going back…'
    case 'agent_results':
      return 'collecting results…'
    case 'new_session':
      return 'starting a new session…'
    case 'toggle_panel':
      return 'toggling the panel…'
    case 'set_panel_mode':
      return withTarget('setting panel mode', args, 'mode')
    default:
      return `calling ${name}…`
  }
}

interface StreamedTarget {
  value: string
  /** Whether the value's terminator arrived — an open value keeps growing. */
  closed: boolean
}

/**
 * The value streamed so far for `key` in a partial tool-arguments JSON
 * string. String values unescape as their escapes close (the shared
 * scanner); numbers and booleans read raw until `,`/`}` ends them. Null
 * when the key has not arrived; empty when it has but its value has not
 * started.
 */
function partialTargetValue(args: string, key: string): StreamedTarget | null {
  const match = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*`).exec(args)
  if (!match) return null
  const openQuote = match.index + match[0].length
  const rest = args.slice(openQuote)
  if (rest.startsWith('"')) return scanPartialJsonString(args, openQuote)
  if (rest.startsWith('{') || rest.startsWith('[')) return { value: '', closed: false }
  const bare = /^[^,}\s]+/.exec(rest)
  if (!bare) return { value: '', closed: false }
  const after = rest.slice(bare[0]!.length)
  return { value: bare[0]!, closed: after.startsWith(',') || after.startsWith('}') }
}

function withTarget(verb: string, args: string, ...keys: string[]): string {
  for (const key of keys) {
    const target = partialTargetValue(args, key)
    if (!target || target.value === '') continue
    return target.closed ? `${verb} '${target.value}'…` : `${verb} '${target.value}…'`
  }
  return `${verb}…`
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
