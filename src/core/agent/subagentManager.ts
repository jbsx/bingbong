import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { SessionGeneration, SessionId } from '../session/sessionIdentity'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import { capSentences } from '../agent/answerContract'
import { SUBAGENT_LIMITS, type SubagentSharedDeadline } from './subagentRails'
import type { SubagentReport } from './subagentReport'
import { SubagentCancelledError } from './subagentRunner'

// The subagent supervisor (issue #13). Owns the agent rail (≤4 concurrent,
// of which at most 3 may be browsing agents on independent Investigation
// branches, #120), delegates the tab rail to the injected tab allocator
// (browse agents claim a tab), tracks every agent's lifecycle, and merges
// results for the orchestrator's agent_results tool. Refusals come back as
// reasons the orchestrator model can read — a rail hit is a recoverable
// tool result, never a crash. Sessions own their agents outright (#97):
// retire() ends every agent with the Session, discards its reports, and
// gates late settlement so an ended Session can never reach a later one.
// Delegation carries its own selected Memory Entries (#98): they ride the
// spec into the workhorse as untrusted context, and completed agents keep
// their structured Subagent Report for the orchestrator to reconcile.
// Browsing workers also carry their parent Run's shared active-work
// deadline (#120): the workhorse polls it and finalizes when it passes.

export type SubagentKind = 'browse' | 'background'

export type SubagentStatus = 'running' | 'completed' | 'cancelled' | 'failed'

/** Kinds that drive their own browser tab (bounded by the tab rail). */
export const TAB_KINDS: readonly SubagentKind[] = ['browse']

/** The Session identity that owns a spawned agent (#97) — absent outside any Session. */
export interface SubagentOwner {
  sessionId: SessionId
  generation: SessionGeneration
}

export interface SubagentRecord {
  id: string
  kind: SubagentKind
  task: string
  status: SubagentStatus
  startedAt: number
  finishedAt: number | null
  steps: number
  lastAction: string | null
  /** The report's prose — what the card shows and the announcement speaks. */
  result: string | null
  /** The validated structured report (#98) — present on completed agents. */
  report?: Readonly<SubagentReport>
  error: string | null
  /** The Session that spawned this agent — late events stay attributable after the Session ends (#97). */
  owner?: SubagentOwner
}

export type SubagentEvent =
  | { type: 'spawned'; record: SubagentRecord }
  | { type: 'progress'; record: SubagentRecord }
  | { type: 'finished'; record: SubagentRecord }

export interface SubagentSpec {
  id: string
  kind: SubagentKind
  task: string
  /**
   * The orchestrator turn that spawned this agent (#29): the workhorse keys
   * its LLM perf spans to it. Absent for spawns outside any turn (tests,
   * the CLI harness) — those rounds simply go unlogged.
   */
  turnId?: string
  /**
   * The Memory Entries delegation selected for this task (#98): a frozen,
   * bounded slice of the spawning Run's Working Memory snapshot. Absent
   * when the orchestrator shared nothing.
   */
  memory?: WorkingMemorySnapshot
}

export type { SubagentSharedDeadline }

export interface SubagentTaskHooks {
  isCancelled(): boolean
  /** The parent Run's shared active-work deadline (#120); absent when the spawn carries none. */
  isWorkExpired?(): boolean
  waitIfPaused?(): Promise<void>
  onProgress(step: number, action: string): void
}

/** Port: starts one workhorse loop (runSubagent in production). */
export interface SubagentTaskApi {
  start(spec: SubagentSpec, hooks: SubagentTaskHooks): { done: Promise<SubagentReport> }
}

/** Port: the tab allocator (the subagent tab machine in production). */
export interface SubagentTabAllocator {
  openFor(agentId: string): { ok: true } | { ok: false; reason: string }
  finish(agentId: string): void
}

export interface SubagentManagerDeps {
  taskApi: SubagentTaskApi
  tabs: SubagentTabAllocator
  clock?: Clock
  onEvent(event: SubagentEvent): void
  maxConcurrent?: number
  /** Browse-only concurrency (#120/AC1): defaults to SUBAGENT_LIMITS.maxConcurrentBrowseAgents. */
  maxConcurrentBrowse?: number
  /** How long agent_results(wait) blocks before reporting a snapshot. */
  waitTimeoutMs?: number
  /** The Session that owns each new spawn (#97) — read live at spawn time. */
  owner?(): SubagentOwner | null
}

export type SpawnResult = { ok: true; agent: SubagentRecord } | { ok: false; reason: string }

export type CancelResult = { ok: true } | { ok: false; reason: string }

export interface SubagentManager {
  spawn(kind: SubagentKind, task: string, turnId?: string, memory?: WorkingMemorySnapshot, sharedDeadline?: SubagentSharedDeadline): SpawnResult
  cancel(agentId: string): CancelResult
  cancelAll(): number
  /**
   * Session end (#97): cancels every running agent, discards all records —
   * pending reports included — and arms the epoch guard so late progress or
   * completion from the ended Session never emits. The manager stays
   * reusable for the next Session's spawns. Returns how many were running.
   */
  retire(): number
  pauseAll(): void
  resumeAll(): void
  results(options: { ids?: string[]; wait?: boolean }): Promise<string>
  list(): SubagentRecord[]
  /** Whether the agent is still working — the capture loop's gate (#57). */
  isRunning(agentId: string): boolean
}

const DEFAULT_WAIT_TIMEOUT_MS = 120_000

export function createSubagentManager(deps: SubagentManagerDeps): SubagentManager {
  const { taskApi, tabs, onEvent } = deps
  const clock = deps.clock ?? systemClock
  const maxConcurrent = deps.maxConcurrent ?? SUBAGENT_LIMITS.maxConcurrentAgents
  const maxConcurrentBrowse = deps.maxConcurrentBrowse ?? SUBAGENT_LIMITS.maxConcurrentBrowseAgents
  const waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS

  const records = new Map<string, SubagentRecord>()
  const cancelled = new Set<string>()
  const settled = new Map<string, Promise<void>>()
  const pauseWaiters = new Map<string, Set<() => void>>()
  let paused = false
  // Bumped by retire() (#97): a spawn captures the epoch it belongs to, and
  // settlement or progress from a superseded epoch is dropped before it can
  // touch tabs, records, or the event stream.
  let epoch = 0

  function releasePause(agentId: string): void {
    const waiters = pauseWaiters.get(agentId)
    pauseWaiters.delete(agentId)
    for (const resolve of waiters ?? []) resolve()
  }

  function waitIfPaused(agentId: string): Promise<void> {
    if (!paused || cancelled.has(agentId)) return Promise.resolve()
    return new Promise((resolve) => {
      const waiters = pauseWaiters.get(agentId) ?? new Set<() => void>()
      waiters.add(resolve)
      pauseWaiters.set(agentId, waiters)
    })
  }

  /** Running agents, optionally narrowed to one kind. */
  function liveCount(kind?: SubagentKind): number {
    let live = 0
    for (const record of records.values()) {
      if (record.status !== 'running') continue
      if (kind !== undefined && record.kind !== kind) continue
      live += 1
    }
    return live
  }

  function finish(record: SubagentRecord, spawnEpoch: number, status: SubagentStatus, report: SubagentReport | null, error: string | null): void {
    if (spawnEpoch !== epoch) return
    record.status = status
    record.finishedAt = clock.now()
    record.result = report !== null ? report.text : null
    if (report !== null) record.report = report
    record.error = error
    tabs.finish(record.id)
    onEvent({ type: 'finished', record: { ...record } })
  }

  function cancelAllRunning(): number {
    let count = 0
    for (const record of records.values()) {
      if (record.status !== 'running') continue
      cancelled.add(record.id)
      releasePause(record.id)
      count += 1
    }
    paused = false
    for (const agentId of [...pauseWaiters.keys()]) releasePause(agentId)
    return count
  }

  return {
    spawn(kind, task, turnId, memory, sharedDeadline) {
      if (liveCount() >= maxConcurrent) {
        return {
          ok: false,
          reason: `subagent limit (${maxConcurrent}) reached — wait for a running agent to finish or collect results first`,
        }
      }
      // Browse-only concurrency (#120/AC1): at most three browsing agents
      // work in parallel, whatever the overall rail allows — the fourth
      // branch waits or the orchestrator collects first.
      if (kind === 'browse' && liveCount('browse') >= maxConcurrentBrowse) {
        return {
          ok: false,
          reason: `browse subagent limit (${maxConcurrentBrowse}) reached — at most three browsing agents run at once; wait for one to finish or collect its results first`,
        }
      }

      const id = `a-${records.size + 1}`
      if (TAB_KINDS.includes(kind)) {
        const tab = tabs.openFor(id)
        if (!tab.ok) return { ok: false, reason: tab.reason }
      }

      const spawnEpoch = epoch
      const owner = deps.owner?.() ?? undefined
      const record: SubagentRecord = {
        id,
        kind,
        task,
        status: 'running',
        startedAt: clock.now(),
        finishedAt: null,
        steps: 0,
        lastAction: null,
        result: null,
        error: null,
        ...(owner ? { owner } : {}),
      }
      records.set(id, record)

      const { done } = taskApi.start(
        {
          id,
          kind,
          task,
          ...(turnId !== undefined ? { turnId } : {}),
          ...(memory !== undefined && memory.length > 0 ? { memory } : {}),
        },
        {
          isCancelled: () => cancelled.has(id) || spawnEpoch !== epoch,
          // The parent Run's shared active-work deadline (#120): the
          // workhorse polls it alongside cancellation and finalizes with a
          // bounded report when the parent's work time is gone.
          ...(sharedDeadline !== undefined ? { isWorkExpired: () => sharedDeadline.expired() } : {}),
          waitIfPaused: () => waitIfPaused(id),
          onProgress: (step, action) => {
            if (spawnEpoch !== epoch) return
            record.steps = step
            record.lastAction = action
            onEvent({ type: 'progress', record: { ...record } })
          },
        },
      )

      settled.set(
        id,
        done.then(
          (report) => {
            if (record.status === 'running') finish(record, spawnEpoch, 'completed', report, null)
          },
          (err: unknown) => {
            if (record.status !== 'running') return
            if (err instanceof SubagentCancelledError || cancelled.has(id) || spawnEpoch !== epoch) {
              finish(record, spawnEpoch, 'cancelled', null, null)
            } else {
              finish(record, spawnEpoch, 'failed', null, err instanceof Error ? err.message : String(err))
            }
          },
        ),
      )

      onEvent({ type: 'spawned', record: { ...record } })
      return { ok: true, agent: { ...record } }
    },

    cancel(agentId) {
      const record = records.get(agentId)
      if (!record) return { ok: false, reason: `no such subagent: '${agentId}'` }
      if (record.status !== 'running') return { ok: false, reason: `subagent ${agentId} already ${record.status}` }
      cancelled.add(agentId)
      releasePause(agentId)
      return { ok: true }
    },

    cancelAll() {
      return cancelAllRunning()
    },

    retire() {
      const running = cancelAllRunning()
      // Everything the ended Session owned goes: pending reports, finished
      // history, tab claims — a later Session starts from an empty rail and
      // a fresh id namespace. The epoch bump keeps any in-flight settlement
      // from re-entering through finish().
      epoch += 1
      records.clear()
      cancelled.clear()
      settled.clear()
      return running
    },

    pauseAll() {
      paused = true
    },

    resumeAll() {
      paused = false
      for (const agentId of [...pauseWaiters.keys()]) releasePause(agentId)
    },

    async results(options) {
      const selected = options.ids
        ? options.ids.map((id) => {
            const record = records.get(id)
            if (!record) throw new Error(`no such subagent: '${id}'`)
            return record
          })
        : [...records.values()]

      if (options.wait) {
        const running = selected.filter((record) => record.status === 'running')
        if (running.length > 0) {
          const allSettled = Promise.all(running.map((record) => settled.get(record.id)!))
          const timeout = new Promise<void>((resolve) => clock.setTimer(waitTimeoutMs, resolve))
          await Promise.race([allSettled, timeout])
        }
      }

      return formatAgentResults(selected.map((record) => ({ ...record })))
    },

    list: () => [...records.values()].map((record) => ({ ...record })),

    isRunning: (agentId) => records.get(agentId)?.status === 'running',
  }
}

const KIND_LABEL: Record<SubagentKind, string> = {
  browse: 'browsing',
  background: 'background',
}

/**
 * The spoken one-liner for a finished agent (issue #13: completion announced
 * via TTS). Completed speaks the report's first sentence; failed speaks the
 * error; cancelled stays silent — the user asked for it.
 */
export function subagentAnnouncement(record: SubagentRecord): string | null {
  if (record.status === 'completed') {
    const first = capSentences(record.result ?? '', 1)
    return first === '' ? `The ${KIND_LABEL[record.kind]} agent finished.` : `The ${KIND_LABEL[record.kind]} agent finished: ${first}`
  }
  if (record.status === 'failed') {
    const first = capSentences(record.error ?? 'unknown error', 1)
    return `The ${KIND_LABEL[record.kind]} agent failed: ${first}`
  }
  return null
}

export function formatAgentResults(records: SubagentRecord[]): string {
  if (records.length === 0) return 'no subagents have been spawned yet'
  return records
    .map((record) => {
      const header = `${record.id} [${KIND_LABEL[record.kind]}] ${record.status} — ${record.task}`
      if (record.status === 'completed') return `${header}\n${formatReport(record)}`
      if (record.status === 'failed') return `${header}\nfailed: ${record.error ?? 'unknown error'}`
      if (record.status === 'cancelled') return header
      return `${header} (still running${record.lastAction ? `, last: ${record.lastAction}` : ''})`
    })
    .join('\n\n')
}

/**
 * One agent's report for agent_results (#98): the structured sections first
 * — findings with their evidence, unresolved items — then the full prose.
 * The id-prefixed header is the provenance the orchestrator cites as
 * subagent_id when it commits these findings; evidence keeps its page titles
 * so committed references can carry them too.
 */
function formatReport(record: SubagentRecord): string {
  const report = record.report
  const sections: string[] = []
  if (report && report.findings.length > 0) {
    const findings = report.findings
      .map((finding) => {
        const evidence = finding.references
          .map((reference) => (reference.title !== undefined ? `${reference.url} — ${reference.title}` : reference.url))
          .join(' | ')
        return `- ${finding.subject}: ${finding.detail}${evidence !== '' ? ` (evidence: ${evidence})` : ''}`
      })
      .join('\n')
    sections.push(`findings:\n${findings}`)
  }
  if (report && report.unresolved.length > 0) {
    sections.push(`unresolved:\n${report.unresolved.map((item) => `- ${item}`).join('\n')}`)
  }
  sections.push(`report:\n${record.result ?? ''}`)
  return sections.join('\n')
}
