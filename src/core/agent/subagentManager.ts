import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import { capSentences } from '../agent/answerContract'
import { SUBAGENT_LIMITS } from './subagentRails'
import { SubagentCancelledError } from './subagentRunner'

// The subagent supervisor (issue #13). Owns the agent rail (≤4 concurrent),
// delegates the tab rail to the injected tab allocator (browse agents claim
// a tab), tracks every agent's lifecycle, and merges results for
// the orchestrator's agent_results tool. Refusals come back as reasons the
// orchestrator model can read — a rail hit is a recoverable tool result,
// never a crash.

export type SubagentKind = 'browse' | 'background'

export type SubagentStatus = 'running' | 'completed' | 'cancelled' | 'failed'

/** Kinds that drive their own browser tab (bounded by the tab rail). */
export const TAB_KINDS: readonly SubagentKind[] = ['browse']

export interface SubagentRecord {
  id: string
  kind: SubagentKind
  task: string
  status: SubagentStatus
  startedAt: number
  finishedAt: number | null
  steps: number
  lastAction: string | null
  result: string | null
  error: string | null
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
}

export interface SubagentTaskHooks {
  isCancelled(): boolean
  waitIfPaused?(): Promise<void>
  onProgress(step: number, action: string): void
}

/** Port: starts one workhorse loop (runSubagent in production). */
export interface SubagentTaskApi {
  start(spec: SubagentSpec, hooks: SubagentTaskHooks): { done: Promise<string> }
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
  /** How long agent_results(wait) blocks before reporting a snapshot. */
  waitTimeoutMs?: number
}

export type SpawnResult = { ok: true; agent: SubagentRecord } | { ok: false; reason: string }

export type CancelResult = { ok: true } | { ok: false; reason: string }

export interface SubagentManager {
  spawn(kind: SubagentKind, task: string, turnId?: string): SpawnResult
  cancel(agentId: string): CancelResult
  cancelAll(): number
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
  const waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS

  const records = new Map<string, SubagentRecord>()
  const cancelled = new Set<string>()
  const settled = new Map<string, Promise<void>>()
  const pauseWaiters = new Map<string, Set<() => void>>()
  let paused = false

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

  function liveCount(): number {
    let live = 0
    for (const record of records.values()) if (record.status === 'running') live += 1
    return live
  }

  function finish(record: SubagentRecord, status: SubagentStatus, result: string | null, error: string | null): void {
    record.status = status
    record.finishedAt = clock.now()
    record.result = result
    record.error = error
    tabs.finish(record.id)
    onEvent({ type: 'finished', record: { ...record } })
  }

  return {
    spawn(kind, task, turnId) {
      if (liveCount() >= maxConcurrent) {
        return {
          ok: false,
          reason: `subagent limit (${maxConcurrent}) reached — wait for a running agent to finish or collect results first`,
        }
      }

      const id = `a-${records.size + 1}`
      if (TAB_KINDS.includes(kind)) {
        const tab = tabs.openFor(id)
        if (!tab.ok) return { ok: false, reason: tab.reason }
      }

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
      }
      records.set(id, record)

      const { done } = taskApi.start({ id, kind, task, ...(turnId !== undefined ? { turnId } : {}) }, {
        isCancelled: () => cancelled.has(id),
        waitIfPaused: () => waitIfPaused(id),
        onProgress: (step, action) => {
          record.steps = step
          record.lastAction = action
          onEvent({ type: 'progress', record: { ...record } })
        },
      })

      settled.set(
        id,
        done.then(
          (report) => {
            if (record.status === 'running') finish(record, 'completed', report, null)
          },
          (err: unknown) => {
            if (record.status !== 'running') return
            if (err instanceof SubagentCancelledError || cancelled.has(id)) {
              finish(record, 'cancelled', null, null)
            } else {
              finish(record, 'failed', null, err instanceof Error ? err.message : String(err))
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
      if (record.status === 'completed') return `${header}\n${record.result ?? ''}`
      if (record.status === 'failed') return `${header}\nfailed: ${record.error ?? 'unknown error'}`
      if (record.status === 'cancelled') return header
      return `${header} (still running${record.lastAction ? `, last: ${record.lastAction}` : ''})`
    })
    .join('\n\n')
}
