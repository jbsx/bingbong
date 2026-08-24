import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import { createSubagentTabs, type SubagentTab } from './subagentTabs'

// The tab rail (issue #13): parallel browsing agents each get a tab, at most 3
// beside the main pane. A finished agent's tab lingers 60 s so the user can
// inspect it, then auto-closes — the card history stays with a reopen button.
// This machine is the brain; Electron glue maps phases to WebContentsViews.

function machine(clock = new FakeClock(0)) {
  const changes: SubagentTab[] = []
  const tabs = createSubagentTabs({ clock })
  tabs.subscribe((tab) => changes.push(tab))
  return { tabs, clock, changes }
}

describe('subagent tab lifecycle', () => {
  it('opens up to 3 subagent tabs and refuses the 4th with a reason', () => {
    const { tabs } = machine()

    expect(tabs.open('a-1', 'https://a.test').ok).toBe(true)
    expect(tabs.open('b-2', 'https://b.test').ok).toBe(true)
    expect(tabs.open('c-3', 'https://c.test').ok).toBe(true)

    const refusal = tabs.open('d-4', 'https://d.test')
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).toMatch(/3/)
  })

  it('keeps a finished tab lingering 60 s, then auto-closes it', () => {
    const { tabs, clock } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.update('a-1', { url: 'https://final.test', title: 'Final' })

    tabs.finish('a-1')
    expect(tabs.snapshot().find((t) => t.agentId === 'a-1')).toMatchObject({ phase: 'lingering' })

    clock.advance(59_999)
    expect(tabs.snapshot().find((t) => t.agentId === 'a-1')?.phase).toBe('lingering')

    clock.advance(1)
    expect(tabs.snapshot().find((t) => t.agentId === 'a-1')).toMatchObject({
      phase: 'closed',
      url: 'https://final.test',
      title: 'Final',
    })
  })

  it('announces every phase change so cards can follow along', () => {
    const { tabs, clock, changes } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.finish('a-1')
    clock.advance(60_000)

    const phases = changes.filter((t) => t.agentId === 'a-1').map((t) => t.phase)
    expect(phases).toEqual(['active', 'lingering', 'closed'])
  })

  it('retains the last URL after auto-close so reopen restores it', () => {
    const { tabs, clock } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.update('a-1', { url: 'https://deep.test/page', title: 'Deep' })
    tabs.finish('a-1')
    clock.advance(60_000)

    const reopened = tabs.reopen('a-1')
    expect(reopened.ok).toBe(true)
    if (reopened.ok) {
      expect(reopened.tab).toMatchObject({ phase: 'active', url: 'https://deep.test/page' })
    }
    expect(tabs.snapshot().find((t) => t.agentId === 'a-1')?.phase).toBe('active')
  })

  it('reopen while lingering cancels the auto-close — a pane moved into the main area must not vanish mid-use (#57)', () => {
    const { tabs, clock, changes } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.finish('a-1') // lingering, 60 s timer armed

    const reopened = tabs.reopen('a-1')
    expect(reopened.ok).toBe(true)
    if (reopened.ok) expect(reopened.tab.phase).toBe('active')

    clock.advance(120_000)
    expect(tabs.snapshot().find((t) => t.agentId === 'a-1')?.phase).toBe('active')
    expect(changes.filter((t) => t.agentId === 'a-1').map((t) => t.phase)).toEqual(['active', 'lingering', 'active'])
  })

  it('reopen still respects the 3-tab rail', () => {
    const { tabs, clock } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.finish('a-1')
    clock.advance(60_000)
    tabs.reopen('a-1')
    tabs.open('b-2', 'https://b.test')
    tabs.open('c-3', 'https://c.test')

    const refusal = tabs.open('d-4', 'https://d.test')
    expect(refusal.ok).toBe(false)
  })

  it('reopen refuses when the rail is full again', () => {
    const { tabs, clock } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.finish('a-1')
    clock.advance(60_000)

    tabs.open('b-2', 'https://b.test')
    tabs.open('c-3', 'https://c.test')
    tabs.open('d-4', 'https://d.test')

    expect(tabs.reopen('a-1').ok).toBe(false)
  })

  it('a lingering tab still counts against the rail', () => {
    const { tabs } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.finish('a-1') // lingering, view still alive

    tabs.open('b-2', 'https://b.test')
    tabs.open('c-3', 'https://c.test')
    expect(tabs.open('d-4', 'https://d.test').ok).toBe(false)
  })

  it('reopen and finish on unknown tabs refuse instead of inventing state', () => {
    const { tabs } = machine()
    expect(tabs.reopen('ghost').ok).toBe(false)
    expect(() => tabs.finish('ghost')).not.toThrow()
    expect(() => tabs.update('ghost', { url: 'https://x.test' })).not.toThrow()
  })

  it('supports a shorter linger for tests', () => {
    const clock = new FakeClock(0)
    const tabs = createSubagentTabs({ clock, lingerMs: 100 })
    tabs.open('a-1', 'https://a.test')
    tabs.finish('a-1')
    clock.advance(100)
    expect(tabs.snapshot().find((t) => t.agentId === 'a-1')?.phase).toBe('closed')
  })

  it('carries a captured thumbnail on the tab and announces it like navigation', () => {
    const { tabs, changes } = machine()
    tabs.open('a-1', 'https://a.test')

    tabs.update('a-1', { thumbnail: 'data:image/jpeg;base64,frame-1' })

    expect(tabs.snapshot().find((t) => t.agentId === 'a-1')?.thumbnail).toBe('data:image/jpeg;base64,frame-1')
    expect(changes.at(-1)).toMatchObject({ agentId: 'a-1', thumbnail: 'data:image/jpeg;base64,frame-1' })
  })

  it('retains the last thumbnail through linger and close like the last URL', () => {
    const { tabs, clock } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.update('a-1', { thumbnail: 'data:image/jpeg;base64,frame-final' })
    tabs.finish('a-1')
    clock.advance(60_000)

    const closed = tabs.snapshot().find((t) => t.agentId === 'a-1')
    expect(closed).toMatchObject({
      phase: 'closed',
      thumbnail: 'data:image/jpeg;base64,frame-final',
    })
  })

  // #96: Session end discards its transient browser surfaces — open tabs
  // close immediately, no linger, no late auto-close firing afterwards.
  it('closeAll closes active and lingering tabs immediately, skipping the linger', () => {
    const { tabs, clock, changes } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.open('b-2', 'https://b.test')
    tabs.finish('b-2') // lingering, 60 s timer armed
    tabs.open('c-3', 'https://c.test')

    expect(tabs.closeAll()).toBe(3)

    const phases = (id: string): string[] => changes.filter((t) => t.agentId === id).map((t) => t.phase)
    expect(phases('a-1')).toEqual(['active', 'closed'])
    expect(phases('b-2')).toEqual(['active', 'lingering', 'closed'])
    expect(phases('c-3')).toEqual(['active', 'closed'])

    // The disarmed linger timer never fires late.
    clock.advance(120_000)
    expect(tabs.snapshot().every((t) => t.phase === 'closed')).toBe(true)
    expect(tabs.closeAll()).toBe(0)
  })

  it('closeAll leaves the rail empty for the next Session', () => {
    const { tabs } = machine()
    tabs.open('a-1', 'https://a.test')
    tabs.open('b-2', 'https://b.test')
    tabs.closeAll()

    expect(tabs.open('fresh-1', 'https://fresh.test').ok).toBe(true)
    expect(tabs.open('fresh-2', 'https://fresh.test').ok).toBe(true)
    expect(tabs.open('fresh-3', 'https://fresh.test').ok).toBe(true)
    expect(tabs.open('fresh-4', 'https://fresh.test').ok).toBe(false)
  })
})
