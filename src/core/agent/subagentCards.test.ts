import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import type { SessionId } from '../session/sessionIdentity'
import { createSubagentManager, type SubagentEvent, type SubagentManager, type SubagentOwner } from './subagentManager'
import { createSubagentTabs, type SubagentTab, type SubagentTabs } from '../browser/subagentTabs'
import { createSubagentCardBridge } from './subagentCards'
import type { PipelineEvent } from '../pipeline/events'

// The live-card seam (issue #13): manager events and tab-machine transitions
// merge into agent_update pipeline events the dashboard reduces into cards,
// and completions announce themselves as speak events. Pure composition —
// the main-process runtime hands these to the window + TTS.

interface Wiring {
  manager: SubagentManager
  tabs: SubagentTabs
  events: PipelineEvent[]
  clock: FakeClock
  settle(id: string, outcome: 'resolve' | 'reject', payload?: string): void
}

function wiring(owner?: () => SubagentOwner | null): Wiring {
  const clock = new FakeClock(0)
  const events: PipelineEvent[] = []
  const managerEvents: SubagentEvent[] = []
  const tabChanges: SubagentTab[] = []
  const settlers = new Map<string, { resolve(r: string): void; reject(e: Error): void }>()

  // The bridge needs manager + tabs before the manager exists — a small
  // indirection wires onEvent through both collectors once built.
  const tabs = createSubagentTabs({ clock })
  tabs.subscribe((tab) => {
    tabChanges.push(tab)
    bridge.onTabChange(tab)
  })
  const manager = createSubagentManager({
    taskApi: {
      start(spec) {
        const done = new Promise<string>((resolve, reject) => {
          settlers.set(spec.id, { resolve, reject })
        })
        return { done }
      },
    },
    tabs: { openFor: (id) => tabs.open(id, ''), finish: (id) => tabs.finish(id) },
    clock,
    onEvent: (event) => {
      managerEvents.push(event)
      bridge.onManagerEvent(event)
    },
    ...(owner !== undefined ? { owner } : {}),
  })
  const bridge = createSubagentCardBridge({
    manager,
    tabs,
    clock,
    emit: (event) => events.push(event),
  })

  return {
    manager,
    tabs,
    events,
    clock,
    settle(id, outcome, payload = 'boom') {
      const settler = settlers.get(id)
      if (!settler) return
      if (outcome === 'resolve') settler.resolve(payload)
      else settler.reject(new Error(payload))
    },
  }
}

/** Wiring whose spawns are owned by one fixed Session (#97). */
function ownedWiring(owner: SubagentOwner): Wiring {
  return wiring(() => owner)
}

function flush(times = 4): Promise<void> {
  let promise = Promise.resolve()
  for (let i = 0; i < times; i += 1) promise = promise.then(() => undefined)
  return promise
}

function agentUpdates(events: PipelineEvent[]): Extract<PipelineEvent, { type: 'agent_update' }>[] {
  return events.filter((e): e is Extract<PipelineEvent, { type: 'agent_update' }> => e.type === 'agent_update')
}

describe('subagent card bridge', () => {
  it('merges manager and tab state into agent_update events', async () => {
    const w = wiring()
    w.manager.spawn('browse', 'compare prices')
    w.tabs.update('a-1', { url: 'https://shop.test', title: 'Shop' })
    w.settle('a-1', 'resolve', 'Cheapest: Shop.')
    await flush()

    const updates = agentUpdates(w.events)
    expect(updates.length).toBeGreaterThanOrEqual(2)
    expect(updates[0].agent).toMatchObject({ id: 'a-1', kind: 'browse', task: 'compare prices', status: 'running' })

    const last = updates.at(-1)!.agent
    expect(last).toMatchObject({ status: 'completed', result: 'Cheapest: Shop.' })
    // tabs.finish runs before the finished event, so the card already lingers.
    expect(last.tab).toMatchObject({ url: 'https://shop.test', title: 'Shop', phase: 'lingering' })
  })

  it('announces completions as speak events, and failures too', async () => {
    const w = wiring()
    w.manager.spawn('background', 'one')
    w.settle('a-1', 'resolve', 'Found it. Details on screen.')
    await flush()

    w.manager.spawn('background', 'two')
    w.settle('a-2', 'reject', 'model routing for subagent is not configured')
    await flush()

    const spoken = w.events.filter((e): e is Extract<PipelineEvent, { type: 'speak' }> => e.type === 'speak').map((e) => e.text)
    expect(spoken.some((text) => /Found it\./.test(text))).toBe(true)
    expect(spoken.some((text) => /failed/.test(text))).toBe(true)
  })

  it('stays silent for cancelled agents', async () => {
    const w = wiring()
    const spawned = w.manager.spawn('background', 'one')
    expect(spawned.ok).toBe(true)
    w.manager.cancel('a-1')
    w.settle('a-1', 'reject', 'subagent cancelled by the user')
    await flush()

    const spoken = w.events.filter((e): e is Extract<PipelineEvent, { type: 'speak' }> => e.type === 'speak').map((e) => e.text)
    expect(spoken).toEqual([])
    const last = agentUpdates(w.events).at(-1)!.agent
    expect(last.status).toBe('cancelled')
  })

  it('follows tab phase changes with fresh agent_update events', async () => {
    const w = wiring()
    w.manager.spawn('browse', 'browse task')
    w.settle('a-1', 'resolve', 'done')
    await flush()
    w.clock.advance(60_000) // linger ends → closed

    const phases = agentUpdates(w.events).map((e) => e.agent.tab?.phase ?? 'none')
    expect(phases).toContain('lingering')
    expect(phases).toContain('closed')
  })

  it('rides captured thumbnails on the agent_update payload — the card\'s live preview (#57)', async () => {
    const w = wiring()
    w.manager.spawn('browse', 'compare prices')

    w.tabs.update('a-1', { thumbnail: 'data:image/jpeg;base64,frame-1' })
    w.tabs.update('a-1', { thumbnail: 'data:image/jpeg;base64,frame-2' })
    w.settle('a-1', 'resolve', 'done')
    await flush()

    const frames = agentUpdates(w.events).map((e) => e.agent.tab?.thumbnail)
    expect(frames).toContain('data:image/jpeg;base64,frame-1')
    expect(frames).toContain('data:image/jpeg;base64,frame-2')
    // The last frame survives the finish — the card keeps its final preview.
    expect(frames.at(-1)).toBe('data:image/jpeg;base64,frame-2')
  })

  it('renders no thumbnail for agents without a tab', async () => {
    const w = wiring()
    w.manager.spawn('background', 'pure filing work')
    w.settle('a-1', 'resolve', 'found')
    await flush()

    for (const update of agentUpdates(w.events)) {
      expect(update.agent.tab).toBeUndefined()
    }
  })

  // #97: cards and announcements carry the spawning Session's identity, so
  // the window gate can reject them once that Session is no longer live.
  it('stamps agent_update and speak events with the record’s Session identity', async () => {
    const w = ownedWiring({ sessionId: 'session-1' as SessionId, generation: 2 })
    w.manager.spawn('background', 'owned work')
    w.settle('a-1', 'resolve', 'Report from session one.')
    await flush()

    const updates = agentUpdates(w.events)
    expect(updates.length).toBeGreaterThanOrEqual(1)
    for (const update of updates) {
      expect(update.sessionId).toBe('session-1')
      expect(update.sessionGeneration).toBe(2)
      expect(update.agent.owner).toEqual({ sessionId: 'session-1', generation: 2 })
    }
    const spoken = w.events.find((e): e is Extract<PipelineEvent, { type: 'speak' }> => e.type === 'speak')
    expect(spoken).toMatchObject({ sessionId: 'session-1', sessionGeneration: 2 })
  })

  it('tab phase changes carry the spawning Session’s identity too', async () => {
    const w = ownedWiring({ sessionId: 'session-9' as SessionId, generation: 1 })
    w.manager.spawn('browse', 'browse task')
    w.settle('a-1', 'resolve', 'done')
    await flush()
    w.clock.advance(60_000) // linger ends → closed

    const updates = agentUpdates(w.events)
    const closed = updates.find((update) => update.agent.tab?.phase === 'closed')
    expect(closed).toMatchObject({ sessionId: 'session-9', sessionGeneration: 1 })
  })

  it('leaves events unstamped for agents spawned outside any Session', async () => {
    const w = wiring()
    w.manager.spawn('background', 'unowned work')
    w.settle('a-1', 'resolve', 'Report.')
    await flush()

    for (const event of w.events) {
      expect(event.sessionId).toBeUndefined()
      expect(event.sessionGeneration).toBeUndefined()
    }
  })
})
