import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import { createSubagentManager, subagentAnnouncement, type SubagentEvent, type SubagentRecord } from './subagentManager'
import { SubagentCancelledError } from './subagentRunner'

// The supervisor (issue #13): spawns workhorse loops, tracks them, cancels
// them, merges their results for the orchestrator — with the rails enforced
// here in code: at most 4 concurrent agents, tab kinds bounded by the tab
// allocator (3 tabs), refusals returned as reasons the orchestrator model
// can read and act on.

interface ManualTask {
  id: string
  resolve(report: string): void
  reject(error: Error): void
  progress(step: number, action: string): void
  cancelFlag(): boolean
}

/** TaskApi double: tasks sit running until manually resolved/rejected. */
function manualTaskApi() {
  const tasks = new Map<string, ManualTask>()
  const started: { id: string; kind: string; task: string }[] = []
  return {
    started,
    tasks,
    api: {
      start(spec: { id: string; kind: string; task: string }, hooks: { isCancelled(): boolean; onProgress(step: number, action: string): void }) {
        started.push({ id: spec.id, kind: spec.kind, task: spec.task })
        let settle: ((report: string) => void) | null = null
        let fail: ((error: Error) => void) | null = null
        const done = new Promise<string>((resolve, reject) => {
          settle = resolve
          fail = reject
        })
        tasks.set(spec.id, {
          id: spec.id,
          resolve: (report) => settle?.(report),
          reject: (error) => fail?.(error),
          progress: hooks.onProgress,
          cancelFlag: () => hooks.isCancelled(),
        })
        return { done }
      },
    },
  }
}

/** Tab allocator double with a hard capacity. */
function fakeTabs(capacity: number) {
  const open: string[] = []
  const finished: string[] = []
  return {
    open,
    finished,
    allocator: {
      openFor: (agentId: string) => {
        if (open.length >= capacity) return { ok: false as const, reason: `subagent tab limit (${capacity}) reached` }
        open.push(agentId)
        return { ok: true as const }
      },
      finish: (agentId: string) => {
        if (!finished.includes(agentId)) finished.push(agentId)
      },
    },
  }
}

function manager(options?: {
  tabsCapacity?: number
  events?: SubagentEvent[]
  clock?: FakeClock
  waitTimeoutMs?: number
}) {
  const api = manualTaskApi()
  const tabs = fakeTabs(options?.tabsCapacity ?? 3)
  const clock = options?.clock ?? new FakeClock(0)
  const events: SubagentEvent[] = options?.events ?? []
  const mgr = createSubagentManager({
    taskApi: api.api,
    tabs: tabs.allocator,
    clock,
    onEvent: (event) => events.push(event),
    ...(options?.waitTimeoutMs !== undefined ? { waitTimeoutMs: options.waitTimeoutMs } : {}),
  })
  return { mgr, api, tabs, clock, events }
}

function flush(times = 4): Promise<void> {
  // Let manager .then handlers run without vitest fake timers.
  let promise = Promise.resolve()
  for (let i = 0; i < times; i += 1) promise = promise.then(() => undefined)
  return promise
}

describe('subagent manager', () => {
  it('spawns a running agent, streams progress, and records its result', async () => {
    const { mgr, api, events } = manager()

    const spawned = mgr.spawn('research', 'compare mechanical keyboards')
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return
    expect(spawned.agent).toMatchObject({ kind: 'research', task: 'compare mechanical keyboards', status: 'running' })

    api.tasks.get(spawned.agent.id)!.progress(1, 'search "mechanical keyboards"')
    expect(mgr.list()[0]).toMatchObject({ steps: 1, lastAction: 'search "mechanical keyboards"' })

    api.tasks.get(spawned.agent.id)!.resolve('Keyboards compared: A vs B.')
    await flush()

    expect(mgr.list()[0]).toMatchObject({ status: 'completed', result: 'Keyboards compared: A vs B.' })
    const kinds = events.map((e) => `${e.type}:${e.record.status}`)
    expect(kinds).toEqual(['spawned:running', 'progress:running', 'finished:completed'])
  })

  it('enforces the 4-concurrent-agent rail under a scripted storm', () => {
    const { mgr } = manager()

    for (let i = 1; i <= 4; i += 1) {
      expect(mgr.spawn('research', `task ${i}`).ok).toBe(true)
    }
    const fifth = mgr.spawn('research', 'task 5')
    expect(fifth.ok).toBe(false)
    if (!fifth.ok) expect(fifth.reason).toMatch(/4/)
  })

  it('frees an agent slot when an agent finishes — but a lingering tab keeps the tab slot busy', async () => {
    const { mgr, api, tabs } = manager({ tabsCapacity: 3 })

    const first = mgr.spawn('browse', 'open site A')
    expect(first.ok).toBe(true)
    const second = mgr.spawn('browse', 'open site B')
    expect(second.ok).toBe(true)

    // Slot freed for research kinds even while the browse tab lingers.
    api.tasks.get('a-1')!.resolve('done A')
    await flush()
    expect(mgr.list().find((r) => r.id === 'a-1')?.status).toBe('completed')
    expect(mgr.spawn('research', 'more research').ok).toBe(true)

    // The finished browse tab still occupies tab capacity until it closes.
    expect(mgr.spawn('browse', 'site C').ok).toBe(true)
    const refused = mgr.spawn('browse', 'site D')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toMatch(/tab/)
    expect(tabs.finished).toEqual(['a-1'])
  })

  it('enforces the tab rail for browsing spawns before the task even starts', () => {
    const { mgr } = manager({ tabsCapacity: 3 })

    expect(mgr.spawn('browse', 'one').ok).toBe(true)
    expect(mgr.spawn('browse', 'two').ok).toBe(true)
    expect(mgr.spawn('browse', 'three').ok).toBe(true)
    const refused = mgr.spawn('browse', 'four')
    expect(refused.ok).toBe(false)
    // Refused spawns start nothing.
    expect(mgr.list()).toHaveLength(3)
  })

  it('background work consumes an agent slot but no browser-tab slot', () => {
    const { mgr, tabs } = manager({ tabsCapacity: 0 })

    expect(mgr.spawn('background', 'download a report').ok).toBe(true)
    expect(tabs.open).toEqual([])
  })

  it('never leaves a spawn half-started when the tab allocator refuses', () => {
    const { mgr, api } = manager({ tabsCapacity: 0 })

    expect(mgr.spawn('browse', 'no tab for you').ok).toBe(false)
    expect(api.started).toHaveLength(0)
    expect(mgr.list()).toHaveLength(0)
  })

  it('cancel flags a running agent and records cancellation when the loop notices', async () => {
    const { mgr, api, events } = manager()

    const spawned = mgr.spawn('research', 'long task')
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return
    const id = spawned.agent.id

    expect(mgr.cancel(id).ok).toBe(true)
    expect(api.tasks.get(id)!.cancelFlag()).toBe(true)

    api.tasks.get(id)!.reject(new SubagentCancelledError())
    await flush()

    expect(mgr.list()[0]).toMatchObject({ status: 'cancelled', result: null })
    const last = events.at(-1)
    expect(last).toMatchObject({ type: 'finished' })
    if (last?.type === 'finished') {
      expect(last.record.status).toBe('cancelled')
    }
  })

  it('cancel refuses unknown or already-finished agents', async () => {
    const { mgr, api } = manager()

    expect(mgr.cancel('ghost').ok).toBe(false)

    const spawned = mgr.spawn('research', 'quick')
    expect(spawned.ok).toBe(true)
    api.tasks.get('a-1')!.resolve('fast')
    await flush()
    expect(mgr.cancel('a-1').ok).toBe(false)
  })

  it('marks a rejected task as failed with its error', async () => {
    const { mgr, api } = manager()

    mgr.spawn('research', 'doomed')
    api.tasks.get('a-1')!.reject(new Error('model routing for subagent is not configured'))
    await flush()

    expect(mgr.list()[0]).toMatchObject({ status: 'failed', error: 'model routing for subagent is not configured' })
  })

  it('merges results across agents in one report for the orchestrator', async () => {
    const { mgr, api } = manager()

    mgr.spawn('research', 'task one')
    mgr.spawn('browse', 'task two')
    api.tasks.get('a-1')!.resolve('Report one.')
    api.tasks.get('a-2')!.resolve('Report two.')
    await flush()

    const merged = await mgr.results({})
    expect(merged).toContain('a-1')
    expect(merged).toContain('research')
    expect(merged).toContain('Report one.')
    expect(merged).toContain('a-2')
    expect(merged).toContain('Report two.')
  })

  it('results(wait) blocks until the selected agents finish', async () => {
    const { mgr, api } = manager()

    mgr.spawn('research', 'slow one')
    mgr.spawn('research', 'slow two')
    api.tasks.get('a-2')!.resolve('Second report.')

    const waiting = mgr.results({ ids: ['a-1', 'a-2'], wait: true })
    api.tasks.get('a-1')!.resolve('First report.')
    const merged = await waiting

    expect(merged).toContain('First report.')
    expect(merged).toContain('Second report.')
  })

  it('results(wait) gives up after the wait timeout and reports what it has', async () => {
    const clock = new FakeClock(0)
    const { mgr } = manager({ clock, waitTimeoutMs: 5_000 })

    mgr.spawn('research', 'slow one') // never resolves

    const waiting = mgr.results({ wait: true })
    clock.advance(5_000)
    const merged = await waiting

    expect(merged).toContain('slow one')
    expect(merged).toContain('running')
  })

  it('results reports running agents plainly when not waiting', async () => {
    const { mgr, api } = manager()

    mgr.spawn('research', 'pending')
    mgr.spawn('research', 'done')
    api.tasks.get('a-2')!.resolve('Finished report.')
    await flush()

    const merged = await mgr.results({})
    expect(merged).toContain('running')
    expect(merged).toContain('pending')
    expect(merged).toContain('Finished report.')
  })

  it('results refuses unknown agent ids loudly', async () => {
    const { mgr } = manager()
    await expect(mgr.results({ ids: ['ghost'] })).rejects.toThrow(/ghost/)
  })
})

describe('SubagentRecord shape', () => {
  it('exposes copies, not live records', () => {
    const { mgr } = manager()
    mgr.spawn('research', 'task')
    const first = mgr.list()[0] as SubagentRecord
    const before = first.status
    first.status = 'completed'
    expect(mgr.list()[0]?.status).toBe(before)
  })
})

describe('subagentAnnouncement', () => {
  const base: SubagentRecord = {
    id: 'a-1',
    kind: 'research',
    task: 'compare keyboards',
    status: 'completed',
    startedAt: 0,
    finishedAt: 10,
    steps: 3,
    lastAction: null,
    result: null,
    error: null,
  }

  it('speaks the first sentence of a completed report', () => {
    expect(subagentAnnouncement({ ...base, result: 'Keyboards compared. Full table on screen. Bye.' })).toBe(
      'The research agent finished: Keyboards compared.',
    )
  })

  it('speaks a plain finish line when the report is empty', () => {
    expect(subagentAnnouncement({ ...base, result: '' })).toBe('The research agent finished.')
  })

  it('speaks the failure plainly, naming the kind', () => {
    expect(
      subagentAnnouncement({ ...base, status: 'failed', error: 'model routing for subagent is not configured. Set vars.' }),
    ).toBe('The research agent failed: model routing for subagent is not configured.')
  })

  it('stays silent for cancelled agents', () => {
    expect(subagentAnnouncement({ ...base, status: 'cancelled' })).toBeNull()
  })
})
