// One place that renders a tool call as a compact human-readable line — the
// dashboard transcript and the subagent cards' progress both use it.

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
    default:
      return `${name} ${JSON.stringify(args)}`
  }
}
