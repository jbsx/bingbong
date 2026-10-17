// One place that renders a browser action as a compact human-readable line
// for the Feed.

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
    case 'press':
      return `press ${String(args.key ?? '')}${typeof args.times === 'number' && args.times > 1 ? ` ×${args.times}` : ''}`
    case 'read_page':
      return args.part !== undefined ? `read page (part ${String(args.part)})` : 'read page'
    case 'screenshot':
      return 'screenshot'
    case 'back':
      return 'go back'
    case 'forward':
      return 'go forward'
    default:
      return Object.keys(args).length > 0 ? `${name} ${JSON.stringify(args)}` : name
  }
}
