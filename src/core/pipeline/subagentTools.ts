import type { SubagentKind, SubagentManager } from '../agent/subagentManager'
import type { Tool } from './tool'
import type { ToolCall } from '../ports/llm'

// The orchestrator's delegation tools (issue #13): spawn_agent starts a
// workhorse subagent (research = web only, browse = own tab, background =
// approved download/file tools),
// cancel_agent stops one or all, agent_results merges reports — optionally
// blocking until the selected agents finish.

const KINDS: SubagentKind[] = ['research', 'browse', 'background']

const KIND_HINT =
  'research: web_search + read_url, no tab; browse: drives its own visible tab; background: approved downloads/file work'

function stringArg(call: ToolCall, name: string, tool: string): string {
  const value = call.args[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${tool}: '${name}' must be a non-empty string`)
  }
  return value.trim()
}

function kindArg(call: ToolCall): SubagentKind {
  const value = call.args.kind
  if (typeof value !== 'string' || !(KINDS as string[]).includes(value)) {
    throw new Error(`spawn_agent: 'kind' must be one of ${KINDS.join(', ')}`)
  }
  return value as SubagentKind
}

export function createSubagentTools(manager: SubagentManager): Tool[] {
  return [
    {
      name: 'spawn_agent',
      description: `Start a subagent that works in the background while you continue. ${KIND_HINT}. Returns the new agent id.`,
      parameters: {
        kind: { type: 'string', enum: KINDS, description: `Which subagent to start — ${KIND_HINT}` },
        task: { type: 'string', description: 'Complete, self-contained instruction for the subagent, including any URLs' },
      },
      assessRisk(call) {
        if (call.args.kind !== 'background') return { kind: 'allow' }
        const task = typeof call.args.task === 'string' ? call.args.task.trim() : 'this task'
        return { kind: 'confirm', prompt: `Start background download/file task: "${task}"?` }
      },
      async execute(call) {
        const kind = kindArg(call)
        const task = stringArg(call, 'task', 'spawn_agent')
        const spawned = manager.spawn(kind, task)
        if (!spawned.ok) throw new Error(spawned.reason)
        return `spawned ${spawned.agent.id} [${kind}] — poll with agent_results (wait: true) or keep working`
      },
    },
    {
      name: 'cancel_agent',
      description: 'Cancel a running subagent by id, or all of them with agent_id "all".',
      parameters: {
        agent_id: { type: 'string', description: 'Agent id (e.g. "a-1") or "all"' },
      },
      async execute(call) {
        const agentId = stringArg(call, 'agent_id', 'cancel_agent')
        if (agentId === 'all') {
          const running = manager.list().filter((record) => record.status === 'running')
          for (const record of running) {
            const result = manager.cancel(record.id)
            if (!result.ok) throw new Error(result.reason)
          }
          return `cancelled ${running.length} running subagent(s)`
        }
        const result = manager.cancel(agentId)
        if (!result.ok) throw new Error(result.reason)
        return `cancelled ${agentId}`
      },
    },
    {
      name: 'agent_results',
      description:
        'Collect subagent reports. Without agent_id: every agent so far. With wait: true: block until the selected agents finish (bounded wait).',
      parameters: {
        agent_id: {
          type: 'string',
          description: 'One agent id to collect, or omit for all',
          required: false,
        },
        wait: {
          type: 'boolean',
          description: 'Wait for running agents to finish before answering (default false)',
          required: false,
        },
      },
      async execute(call) {
        const rawId = call.args.agent_id
        const ids = typeof rawId === 'string' && rawId.trim() !== '' ? [rawId.trim()] : undefined
        const wait = call.args.wait === true
        return manager.results({ ids, wait })
      },
    },
  ]
}
