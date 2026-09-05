import { describe, expect, it } from 'vitest'
import { FakeClock, memoryEntry } from '../testing/doubles'
import type { SessionId } from '../session/sessionIdentity'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import type { TracedReasoningRound, SubagentReasoningTrace } from '../trace/reasoningTrace'
import type { SubagentReport } from './subagentReport'
import {
  createSubagentManager,
  subagentAnnouncement,
  type SubagentEvent,
  type SubagentOwner,
  type SubagentRecord,
  type SubagentTaskHooks,
} from './subagentManager'
import { SubagentCancelledError } from './subagentRunner'

// The supervisor (issue #13): spawns workhorse loops, tracks them, cancels
// them, merges their results for the orchestrator — with the rails enforced
// here in code: at most 4 concurrent agents, of which at most 3 browsing
// (#120), tab kinds bounded by the tab allocator (3 tabs), refusals
// returned as reasons the orchestrator model can read and act on.
// Delegation carries its own selected Memory Entries (#98), completed
// agents keep their structured Subagent Report, and browsing workers carry
// their parent Run's shared active-work deadline (#120).

interface ManualTask {
  id: string
  resolve(report: string | SubagentReport): void
  reject(error: Error): void
  progress(step: number, action: string): void
  cancelFlag(): boolean
  workExpired?(): boolean
  waitIfPaused(): Promise<void>
}

/** A finished report from prose alone — the shape most loops produce. */
function proseReport(text: string): SubagentReport {
  return { text, findings: [], unresolved: [] }
}

/** TaskApi double: tasks sit running until manually resolved/rejected. */
function manualTaskApi() {
  const tasks = new Map<string, ManualTask>()
  const started: { id: string; kind: string; task: string; turnId?: string; memory?: WorkingMemorySnapshot }[] = []
  const hooksSeen = new Map<string, SubagentTaskHooks>()
  return {
    started,
    tasks,
    hooksSeen,
    api: {
      start(spec: { id: string; kind: string; task: string; turnId?: string; memory?: WorkingMemorySnapshot }, hooks: SubagentTaskHooks) {
        started.push({ id: spec.id, kind: spec.kind, task: spec.task, turnId: spec.turnId, ...(spec.memory !== undefined ? { memory: spec.memory } : {}) })
        hooksSeen.set(spec.id, hooks)
        let settle: ((report: SubagentReport) => void) | null = null
        let fail: ((error: Error) => void) | null = null
        const done = new Promise<SubagentReport>((resolve, reject) => {
          settle = resolve
          fail = reject
        })
        tasks.set(spec.id, {
          id: spec.id,
          resolve: (report) => settle?.(typeof report === 'string' ? proseReport(report) : report),
          reject: (error) => fail?.(error),
          progress: hooks.onProgress,
          cancelFlag: () => hooks.isCancelled(),
          ...(hooks.isWorkExpired !== undefined ? { workExpired: () => hooks.isWorkExpired!() } : {}),
          waitIfPaused: () => hooks.waitIfPaused?.() ?? Promise.resolve(),
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
  owner?: () => SubagentOwner | null
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
    ...(options?.owner !== undefined ? { owner: options.owner } : {}),
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

    const spawned = mgr.spawn('background', 'compare mechanical keyboards')
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return
    expect(spawned.agent).toMatchObject({ kind: 'background', task: 'compare mechanical keyboards', status: 'running' })

    api.tasks.get(spawned.agent.id)!.progress(1, 'search "mechanical keyboards"')
    expect(mgr.list()[0]).toMatchObject({ steps: 1, lastAction: 'search "mechanical keyboards"' })

    api.tasks.get(spawned.agent.id)!.resolve('Keyboards compared: A vs B.')
    await flush()

    expect(mgr.list()[0]).toMatchObject({ status: 'completed', result: 'Keyboards compared: A vs B.' })
    const kinds = events.map((e) => `${e.type}:${e.record.status}`)
    expect(kinds).toEqual(['spawned:running', 'progress:running', 'finished:completed'])
  })

  it('isRunning is the live-work gate the capture loop polls', async () => {
    const { mgr, api } = manager()

    const spawned = mgr.spawn('background', 'slow work')
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return
    expect(mgr.isRunning(spawned.agent.id)).toBe(true)

    api.tasks.get(spawned.agent.id)!.resolve('done')
    await flush()
    expect(mgr.isRunning(spawned.agent.id)).toBe(false)
    expect(mgr.isRunning('a-ghost')).toBe(false)
  })

  it('threads the spawning turn id into the task spec', () => {
    const { mgr, api } = manager()

    expect(mgr.spawn('background', 'compare keyboards', { turnId: 'turn-voice-4' }).ok).toBe(true)

    expect(api.started[0]).toMatchObject({ id: 'a-1', kind: 'background', task: 'compare keyboards', turnId: 'turn-voice-4' })
  })

  it('threads the delegation-selected Memory Entries into the task spec (#98)', () => {
    const { mgr, api } = manager()
    const selection: WorkingMemorySnapshot = Object.freeze([Object.freeze(memoryEntry('memory-1'))])

    expect(mgr.spawn('browse', 'compare keyboards', { turnId: 'turn-voice-4', memory: selection }).ok).toBe(true)
    expect(mgr.spawn('browse', 'no memory shared').ok).toBe(true)

    // Only an explicit selection rides the spec — and it is the same frozen
    // slice the pipeline validated, never a copy the worker could mutate.
    expect(api.started[0]?.memory).toBe(selection)
    expect(api.started[1]?.memory).toBeUndefined()
  })

  it('keeps the structured Subagent Report on completed records (#98)', async () => {
    const { mgr, api } = manager()

    mgr.spawn('browse', 'compare keyboards')
    api.tasks.get('a-1')!.resolve({
      text: 'Two strong candidates.',
      findings: [{ subject: 'Winner', detail: 'Model X leads.', references: [{ url: 'https://reviews.test/x' }] }],
      unresolved: ['Stock check pending'],
    })
    await flush()

    const record = mgr.list()[0]!
    expect(record.status).toBe('completed')
    // The prose stays on result (card + announcement); the sections ride
    // alongside as the validated report.
    expect(record.result).toBe('Two strong candidates.')
    expect(record.report).toEqual({
      text: 'Two strong candidates.',
      findings: [{ subject: 'Winner', detail: 'Model X leads.', references: [{ url: 'https://reviews.test/x' }] }],
      unresolved: ['Stock check pending'],
    })
  })

  it('enforces the 4-concurrent-agent rail under a scripted storm', () => {
    const { mgr } = manager()

    for (let i = 1; i <= 4; i += 1) {
      expect(mgr.spawn('background', `task ${i}`).ok).toBe(true)
    }
    const fifth = mgr.spawn('background', 'task 5')
    expect(fifth.ok).toBe(false)
    if (!fifth.ok) expect(fifth.reason).toMatch(/4/)
  })

  it('enforces the browse-only rail: three concurrent browsing agents, a fourth refused (#120)', () => {
    const { mgr } = manager()

    for (let i = 1; i <= 3; i += 1) {
      expect(mgr.spawn('browse', `branch ${i}`).ok).toBe(true)
    }
    const fourth = mgr.spawn('browse', 'branch 4')
    expect(fourth.ok).toBe(false)
    if (!fourth.ok) {
      expect(fourth.reason).toMatch(/browse subagent limit \(3\) reached/)
      expect(fourth.reason).toMatch(/wait for one to finish/)
    }
    // Refused spawns start nothing.
    expect(mgr.list()).toHaveLength(3)
    // The overall rail still has a slot: a non-browsing agent fits.
    expect(mgr.spawn('background', 'file work').ok).toBe(true)
  })

  it('frees a browse slot when a browsing agent finishes (#120)', async () => {
    // Tabs above the browse rail so only the browse rail binds here.
    const { mgr, api } = manager({ tabsCapacity: 4 })

    for (let i = 1; i <= 3; i += 1) expect(mgr.spawn('browse', `branch ${i}`).ok).toBe(true)
    api.tasks.get('a-1')!.resolve('done branch 1')
    await flush()

    expect(mgr.spawn('browse', 'branch 4 now').ok).toBe(true)
  })

  it('threads the parent Run\'s shared active-work deadline into the workhorse (#120)', () => {
    const { mgr, api } = manager()
    let expired = false

    expect(mgr.spawn('browse', 'shared deadline work', { sharedDeadline: { expired: () => expired } }).ok).toBe(true)
    // A spawn without a deadline starts a worker that has none.
    expect(mgr.spawn('background', 'own clock').ok).toBe(true)

    expect(api.tasks.get('a-1')!.workExpired?.()).toBe(false)
    expired = true
    expect(api.tasks.get('a-1')!.workExpired?.()).toBe(true)
    expect(api.tasks.get('a-2')!.workExpired).toBeUndefined()
  })

  it("threads the parent Run's reasoning trace into the workhorse, and only when it was handed one (#183)", () => {
    const { mgr, api } = manager()
    const traced: TracedReasoningRound[] = []
    const trace: SubagentReasoningTrace = (round) => traced.push(round)

    expect(mgr.spawn('browse', 'traced work', { turnId: 'turn-1', traceReasoning: trace }).ok).toBe(true)
    // A spawn without a trace starts a worker that collects nothing.
    expect(mgr.spawn('background', 'untraced work').ok).toBe(true)

    api.hooksSeen.get('a-1')!.traceReasoning?.({ round: 1, attempt: 1, text: 'thought', agentId: 'a-1' })
    expect(traced).toEqual([{ round: 1, attempt: 1, text: 'thought', agentId: 'a-1' }])
    expect(api.hooksSeen.get('a-2')!.traceReasoning).toBeUndefined()
  })

  it('frees an agent slot when an agent finishes — but a lingering tab keeps the tab slot busy', async () => {
    const { mgr, api, tabs } = manager({ tabsCapacity: 3 })

    const first = mgr.spawn('browse', 'open site A')
    expect(first.ok).toBe(true)
    const second = mgr.spawn('browse', 'open site B')
    expect(second.ok).toBe(true)

    // Slot freed for tab-less kinds even while the browse tab lingers.
    api.tasks.get('a-1')!.resolve('done A')
    await flush()
    expect(mgr.list().find((r) => r.id === 'a-1')?.status).toBe('completed')
    expect(mgr.spawn('background', 'more filing').ok).toBe(true)

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

    const spawned = mgr.spawn('background', 'long task')
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

    const spawned = mgr.spawn('background', 'quick')
    expect(spawned.ok).toBe(true)
    api.tasks.get('a-1')!.resolve('fast')
    await flush()
    expect(mgr.cancel('a-1').ok).toBe(false)
  })

  it('cancels every running agent without changing completed agents', async () => {
    const { mgr, api } = manager()
    mgr.spawn('background', 'already done')
    mgr.spawn('background', 'still running')
    mgr.spawn('browse', 'also running')
    api.tasks.get('a-1')!.resolve('complete')
    await flush()

    expect(mgr.cancelAll()).toBe(2)
    expect(api.tasks.get('a-1')!.cancelFlag()).toBe(false)
    expect(api.tasks.get('a-2')!.cancelFlag()).toBe(true)
    expect(api.tasks.get('a-3')!.cancelFlag()).toBe(true)
  })

  it('pauses every workhorse on a shared gate until resumed', async () => {
    const { mgr, api } = manager()
    mgr.spawn('background', 'one')
    mgr.spawn('browse', 'two')

    mgr.pauseAll()
    let firstResumed = false
    let secondResumed = false
    void api.tasks.get('a-1')!.waitIfPaused().then(() => { firstResumed = true })
    void api.tasks.get('a-2')!.waitIfPaused().then(() => { secondResumed = true })
    await flush()
    expect([firstResumed, secondResumed]).toEqual([false, false])

    mgr.resumeAll()
    await flush()
    expect([firstResumed, secondResumed]).toEqual([true, true])
  })

  it('clears the shared pause when mass-cancelling so future agents can run', async () => {
    const { mgr, api } = manager()
    mgr.spawn('background', 'paused work')
    mgr.pauseAll()
    let cancelledAgentReleased = false
    void api.tasks.get('a-1')!.waitIfPaused().then(() => { cancelledAgentReleased = true })

    expect(mgr.cancelAll()).toBe(1)
    await flush()
    expect(cancelledAgentReleased).toBe(true)

    mgr.spawn('background', 'next command work')
    let nextAgentReleased = false
    void api.tasks.get('a-2')!.waitIfPaused().then(() => { nextAgentReleased = true })
    await flush()
    expect(nextAgentReleased).toBe(true)
  })

  it('marks a rejected task as failed with its error', async () => {
    const { mgr, api } = manager()

    mgr.spawn('background', 'doomed')
    api.tasks.get('a-1')!.reject(new Error('model routing for subagent is not configured'))
    await flush()

    expect(mgr.list()[0]).toMatchObject({ status: 'failed', error: 'model routing for subagent is not configured' })
  })

  it('merges results across agents in one report for the orchestrator', async () => {
    const { mgr, api } = manager()

    mgr.spawn('background', 'task one')
    mgr.spawn('browse', 'task two')
    api.tasks.get('a-1')!.resolve('Report one.')
    api.tasks.get('a-2')!.resolve('Report two.')
    await flush()

    const merged = await mgr.results({})
    expect(merged).toContain('a-1')
    expect(merged).toContain('background')
    expect(merged).toContain('[browsing]')
    expect(merged).toContain('Report one.')
    expect(merged).toContain('a-2')
    expect(merged).toContain('Report two.')
  })

  it('results(wait) blocks until the selected agents finish', async () => {
    const { mgr, api } = manager()

    mgr.spawn('background', 'slow one')
    mgr.spawn('background', 'slow two')
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

    mgr.spawn('background', 'slow one') // never resolves

    const waiting = mgr.results({ wait: true })
    clock.advance(5_000)
    const merged = await waiting

    expect(merged).toContain('slow one')
    expect(merged).toContain('running')
  })

  it('results reports running agents plainly when not waiting', async () => {
    const { mgr, api } = manager()

    mgr.spawn('background', 'pending')
    mgr.spawn('background', 'done')
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

  it('renders structured reports in merged results — sections first, prose under report (#98)', async () => {
    const { mgr, api } = manager()

    mgr.spawn('browse', 'compare keyboards')
    mgr.spawn('background', 'file the receipts')
    api.tasks.get('a-1')!.resolve({
      text: 'Full comparison prose.',
      findings: [
        { subject: 'Winner', detail: 'Model X leads on typing feel.', references: [{ url: 'https://reviews.test/x', title: 'Review' }, { url: 'https://shop.test/x' }] },
        { subject: 'Runner-up', detail: 'Model Y is cheaper.', references: [] },
      ],
      unresolved: ['Stock check pending'],
    })
    api.tasks.get('a-2')!.resolve(proseReport('Receipts filed.'))
    await flush()

    const merged = await mgr.results({})
    // Provenance stays the id-prefixed header the orchestrator cites as
    // subagent_id when committing these findings.
    expect(merged).toMatch(/a-1 \[browsing\] completed — compare keyboards\n/)
    expect(merged).toContain('findings:\n- Winner: Model X leads on typing feel. (evidence: https://reviews.test/x — Review | https://shop.test/x)')
    expect(merged).toContain('- Runner-up: Model Y is cheaper.\n')
    expect(merged).toContain('unresolved:\n- Stock check pending')
    expect(merged).toContain('report:\nFull comparison prose.')
    // A prose-only report renders without empty section headers.
    const backgroundBlock = merged.split('\n\n').find((block) => block.startsWith('a-2'))!
    expect(backgroundBlock).toBe('a-2 [background] completed — file the receipts\nreport:\nReceipts filed.')
  })

  it('keeps worker observations hidden — agent_results renders findings and prose, never provenance records (#123)', async () => {
    const { mgr, api } = manager()

    mgr.spawn('browse', 'check the rival page')
    api.tasks.get('a-1')!.resolve({
      text: 'Rival report prose.',
      findings: [{ subject: 'Price', detail: 'The rival router costs $29.', references: [{ url: 'https://rival.example/router' }] }],
      unresolved: [],
      observations: [{
        id: 'wobs-1' as never,
        at: 0,
        producer: 'page_read',
        ok: true,
        payload: 'SECRET RETAINED PAGE TEXT wobs-1',
        sourceUrl: 'https://rival.example/router',
      }],
    })
    await flush()

    const merged = await mgr.results({})
    expect(merged).toContain('findings:\n- Price: The rival router costs $29.')
    expect(merged).toContain('report:\nRival report prose.')
    // The retained records are machine provenance for the checkpoint seam
    // — no observation payload or identity reaches the model-facing text.
    expect(merged).not.toContain('wobs-1')
    expect(merged).not.toContain('SECRET RETAINED PAGE TEXT')
    // The record itself stays available to the runtime's checkpoint seam.
    expect(mgr.list().find((record) => record.id === 'a-1')?.report?.observations).toHaveLength(1)
  })

  it('keeps the worker\u2019s Finalization Cause off agent_results \u2014 the orchestrator\u2019s model cannot read it (#162)', async () => {
    const { mgr, api } = manager()

    mgr.spawn('browse', 'compare keyboards', { turnId: 'turn-3' })
    api.tasks.get('a-1')!.resolve({
      text: 'Cut short prose.',
      findings: [],
      unresolved: ['Cut short at the delegated work limit — the task is incomplete.'],
      finalizationCause: 'no_progress',
    })
    await flush()

    const merged = await mgr.results({})
    // Mechanical stop causes stay out of model context (ADR 0027): no
    // cause value, and no vocabulary from it, in what the model reads.
    for (const cause of ['no_progress', 'budget_exhausted', 'deadline_reached', 'model_answered', 'user_unavailable']) {
      expect(merged).not.toContain(cause)
    }
    expect(merged).not.toContain('finalizationCause')
    // The manager's record keeps it, with the turn that delegated the work.
    const record = mgr.list().find((candidate) => candidate.id === 'a-1')
    expect(record?.report?.finalizationCause).toBe('no_progress')
    expect(record?.turnId).toBe('turn-3')
  })
})

// #97: Sessions own their subagents outright. retire() is the Session-end
// seam — running agents cancel, pending reports vanish, and anything still
// in flight from the ended Session can never re-enter through finish().
describe('subagent manager retirement', () => {
  it('retire cancels running agents and discards every report', async () => {
    const { mgr, api } = manager()
    mgr.spawn('background', 'running work')
    mgr.spawn('background', 'finished work')
    api.tasks.get('a-2')!.resolve('Finished report.')
    await flush()

    expect(mgr.retire()).toBe(1)
    expect(api.tasks.get('a-1')!.cancelFlag()).toBe(true)
    expect(mgr.list()).toEqual([])
    await expect(mgr.results({})).resolves.toBe('no subagents have been spawned yet')
    await expect(mgr.results({ ids: ['a-1'] })).rejects.toThrow(/a-1/)
  })

  it('late completion and progress from the ended Session never emit', async () => {
    const { mgr, api, events, tabs } = manager()
    mgr.spawn('browse', 'long work')
    const eventsAtRetire = events.length
    const finishedAtRetire = [...tabs.finished]

    expect(mgr.retire()).toBe(1)

    // The loop keeps running oblivious; its settlement and progress land
    // after the Session ended.
    api.tasks.get('a-1')!.progress(9, 'still working')
    api.tasks.get('a-1')!.resolve('Late report from an ended Session.')
    await flush()

    expect(events.length).toBe(eventsAtRetire)
    expect(tabs.finished).toEqual(finishedAtRetire)
    expect(mgr.list()).toEqual([])
  })

  it('a late failure from the ended Session is equally silent', async () => {
    const { mgr, api, events } = manager()
    mgr.spawn('background', 'doomed but retired first')
    const eventsAtRetire = events.length

    mgr.retire()
    api.tasks.get('a-1')!.reject(new Error('late failure'))
    await flush()

    expect(events.length).toBe(eventsAtRetire)
  })

  it('retire flags cancellation so in-flight loops stop initiating work', () => {
    const { mgr, api } = manager()
    mgr.spawn('background', 'still working')

    mgr.retire()

    expect(api.tasks.get('a-1')!.cancelFlag()).toBe(true)
  })

  it('the manager stays reusable for the next Session — fresh ids, live events', async () => {
    const { mgr, api, events } = manager()
    mgr.spawn('background', 'first Session work')
    mgr.retire()

    const respawned = mgr.spawn('background', 'next Session work')
    expect(respawned.ok).toBe(true)
    if (!respawned.ok) return
    // The id namespace is Session-owned: the next Session starts at a-1.
    expect(respawned.agent.id).toBe('a-1')

    api.tasks.get('a-1')!.progress(1, 'reading')
    api.tasks.get('a-1')!.resolve('Fresh report.')
    await flush()

    expect(mgr.list()[0]).toMatchObject({ status: 'completed', result: 'Fresh report.' })
    expect(events.at(-1)).toMatchObject({ type: 'finished' })
  })

  it('stamps each record with the Session that spawned it', () => {
    let owner: SubagentOwner | null = { sessionId: 'session-1' as SessionId, generation: 2 }
    const { mgr } = manager({ owner: () => owner })

    expect(mgr.spawn('background', 'owned work').ok).toBe(true)
    expect(mgr.list()[0]).toMatchObject({ owner: { sessionId: 'session-1', generation: 2 } })

    // The stamp is read live per spawn: the next Session's spawns carry it.
    owner = { sessionId: 'session-2' as SessionId, generation: 3 }
    expect(mgr.spawn('background', 'next Session work').ok).toBe(true)
    expect(mgr.list()[1]).toMatchObject({ owner: { sessionId: 'session-2', generation: 3 } })
  })

  it('records spawned outside any Session carry no owner', () => {
    const { mgr } = manager()

    expect(mgr.spawn('background', 'unowned work').ok).toBe(true)
    expect(mgr.list()[0]?.owner).toBeUndefined()
  })
})

describe('SubagentRecord shape', () => {
  it('exposes copies, not live records', () => {
    const { mgr } = manager()
    mgr.spawn('background', 'task')
    const first = mgr.list()[0] as SubagentRecord
    const before = first.status
    first.status = 'completed'
    expect(mgr.list()[0]?.status).toBe(before)
  })
})

describe('subagentAnnouncement', () => {
  const base: SubagentRecord = {
    id: 'a-1',
    kind: 'background',
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
      'The background agent finished: Keyboards compared.',
    )
  })

  it('speaks a plain finish line when the report is empty', () => {
    expect(subagentAnnouncement({ ...base, result: '' })).toBe('The background agent finished.')
  })

  it('speaks the failure plainly, naming the kind', () => {
    expect(
      subagentAnnouncement({ ...base, status: 'failed', error: 'model routing for subagent is not configured. Set vars.' }),
    ).toBe('The background agent failed: model routing for subagent is not configured.')
  })

  it('stays silent for cancelled agents', () => {
    expect(subagentAnnouncement({ ...base, status: 'cancelled' })).toBeNull()
  })
})
