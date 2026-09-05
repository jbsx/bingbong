import type { SubagentKind, SubagentManager } from '../agent/subagentManager'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import type { Tool } from './tool'
import type { ToolCall } from '../ports/llm'
import type { EffortTier } from './runPlan'

// The orchestrator's delegation tools (issue #13): spawn_agent starts a
// workhorse subagent (browse = own visible tab, background = approved
// download/file tools), cancel_agent stops one or all, agent_results merges
// reports — optionally blocking until the selected agents finish. The old
// research kind died with the off-screen fetcher (ADR 0009): all web work
// now happens in a visible tab. Delegation shares memory explicitly (#98):
// spawn_agent names the Memory Entry ids the task needs, the pipeline
// validates them against this Run's snapshot, and only that bounded slice
// reaches the worker — never the whole store.
//
// Bounded delegation (#120, ADR 0027): browse workers are for genuinely
// independent Investigation branches only. The tool refuses a browse spawn
// while the Run sits on a lower tier — a Direct Action or an ordinary
// Lookup does its own browsing, and delegation is never a device to gain
// more budget. Each worker runs on its own 12-round leash and shares the
// Run's active-work deadline through the context's live predicate.

/**
 * The #120 tier gate's refusal, verbatim — a browse spawn attempted off the
 * Investigation tier. Exported so measurement can tell "the model never
 * reached for delegation" apart from "the model reached and was refused"
 * (#163's delegation probe) without re-typing the message.
 */
export const OFF_TIER_BROWSE_SPAWN_REFUSAL =
  'browse subagents are for genuinely independent Investigation branches'

const KINDS: SubagentKind[] = ['browse', 'background']

const KIND_HINT =
  'browse: drives its own visible tab (searches and reads happen on screen) — Investigations only; background: approved downloads/file work'

const TIER_NAMES: Readonly<Record<EffortTier, string>> = {
  direct_action: 'Direct Action',
  lookup: 'Lookup',
  investigation: 'Investigation',
}

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

/** The explicit memory selection (#98): non-empty unique entry ids, or nothing. */
function memoryIdsArg(call: ToolCall): string[] | undefined {
  const value = call.args.memory_ids
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("spawn_agent: 'memory_ids' must be a non-empty array of Memory Entry ids, or omitted")
  }
  const ids = value.map((id) => {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error("spawn_agent: 'memory_ids' entries must be non-empty strings")
    }
    return id.trim()
  })
  return [...new Set(ids)]
}

export function createSubagentTools(manager: SubagentManager): Tool[] {
  return [
    {
      name: 'spawn_agent',
      acquisition: true,
      description:
        `Start a subagent that works in the background while you continue. ${KIND_HINT}. Browse subagents are for genuinely independent Investigation branches (distinct sources or hypotheses) — at most three run at once, each with 12 tool rounds, sharing your run's active-work deadline; never delegate to gain more budget. Returns the new agent id.`,
      parameters: {
        kind: { type: 'string', enum: KINDS, description: `Which subagent to start — ${KIND_HINT}` },
        task: { type: 'string', description: 'Complete, self-contained instruction for the subagent, including any URLs' },
        memory_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of the Memory Entries (from the Working Memory block in your context) this task needs. Omit when none apply — never share the whole store.',
          required: false,
        },
      },
      assessRisk(call) {
        if (call.args.kind !== 'background') return { kind: 'allow' }
        const task = typeof call.args.task === 'string' ? call.args.task.trim() : 'this task'
        return { kind: 'confirm', prompt: `Start background download/file task: "${task}"?` }
      },
      async execute(call, ctx) {
        const kind = kindArg(call)
        const task = stringArg(call, 'task', 'spawn_agent')
        // Bounded delegation (#120/AC3): browse workers exist only for
        // Investigation branches. A Direct Action or an ordinary Lookup
        // browses on the main pane — delegation must never be a lever for
        // more budget. Absent tier source (lean pipelines) leaves the
        // decision to the caller.
        if (kind === 'browse' && ctx.effortTier !== undefined && ctx.effortTier() !== 'investigation') {
          throw new Error(
            `spawn_agent: ${OFF_TIER_BROWSE_SPAWN_REFUSAL} — this run is on the ${TIER_NAMES[ctx.effortTier()]} tier. ` +
              'Do the browsing yourself, or escalate the Run Plan to investigation with the new evidence before delegating.',
          )
        }
        const memoryIds = memoryIdsArg(call)
        let memory: WorkingMemorySnapshot | undefined
        if (memoryIds !== undefined) {
          if (!ctx.selectMemoryEntries) {
            throw new Error('spawn_agent: no Session Working Memory is available to this run')
          }
          memory = ctx.selectMemoryEntries(memoryIds)
        }
        // The parent Run's shared active-work deadline (#120/AC2) rides the
        // spawn unchanged: the worker polls it and finalizes when the
        // parent's work time is gone.
        // The Subagent's own reasoning records (#183) and the events its
        // Tool Rounds publish to nobody (#185) ride the spawn the same
        // way: present only when the Run is tracing them.
        const spawned = manager.spawn(kind, task, {
          ...(ctx.turnId !== undefined ? { turnId: ctx.turnId } : {}),
          ...(memory !== undefined ? { memory } : {}),
          ...(ctx.delegationDeadline !== undefined ? { sharedDeadline: ctx.delegationDeadline } : {}),
          ...(ctx.traceSubagentReasoning !== undefined ? { traceReasoning: ctx.traceSubagentReasoning } : {}),
          ...(ctx.traceSubagentPipelineEvent !== undefined
            ? { tracePipelineEvent: ctx.traceSubagentPipelineEvent }
            : {}),
        })
        if (!spawned.ok) throw new Error(spawned.reason)
        return `spawned ${spawned.agent.id} [${kind}]${memory !== undefined ? ` with ${memory.length} shared memory entr${memory.length === 1 ? 'y' : 'ies'}` : ''} — poll with agent_results (wait: true) or keep working`
      },
    },
    {
      name: 'cancel_agent',
      acquisition: true,
      description: 'Cancel a running subagent by id, or all of them with agent_id "all".',
      parameters: {
        agent_id: { type: 'string', description: 'Agent id (e.g. "a-1") or "all"' },
      },
      async execute(call) {
        const agentId = stringArg(call, 'agent_id', 'cancel_agent')
        if (agentId === 'all') {
          return `cancelled ${manager.cancelAll()} running subagent(s)`
        }
        const result = manager.cancel(agentId)
        if (!result.ok) throw new Error(result.reason)
        return `cancelled ${agentId}`
      },
    },
    {
      name: 'agent_results',
      acquisition: true,
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
      async execute(call, ctx) {
        const rawId = call.args.agent_id
        const ids = typeof rawId === 'string' && rawId.trim() !== '' ? [rawId.trim()] : undefined
        const wait = call.args.wait === true
        if (wait) {
          // Progress detail (#43): the wait only reads as a stall if the
          // dashboard doesn't know what it is waiting on. Snapshot at wait
          // start; live agent cards keep the count honest from there.
          const running = manager.list().filter((record) => record.status === 'running').length
          if (running > 0) ctx.waitingOnAgents?.(running)
        }
        return manager.results({ ids, wait })
      },
    },
  ]
}
