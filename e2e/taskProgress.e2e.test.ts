import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { decisionScript, HUB_TASK_LINE as LINE, hubTaskReadings } from './scriptedJev'
import { waitFor } from './waitFor'

// The Task's progress bar (#375): the Status Capsule's bar moves with each
// hop's Progress Noul (#373) as it arrives, and the Feed's lines carry the
// same reading beside the action it judged. A scripted Jev whose Nouls are
// chosen walks the hub fixture (`hubTaskReadings`) — the hub's link
// (helped), its audit link (did not), back (helped), then a sure yes — so
// the bar reads forward, back, full; a Local Match Command after it shows
// no bar at all.

describe('the Task progress bar e2e (#375)', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ env: decisionScript(...hubTaskReadings()) })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  /** The dashboard's bar as it stands: its moves and fill, or null while none is shown. */
  const bar = (): Promise<{ moves: string; filled: string } | null> =>
    harness.dashboardEval<{ moves: string; filled: string } | null>(
      `(() => { const el = document.querySelector('.task-bar'); return el ? { moves: el.dataset.moves, filled: el.dataset.filled } : null })()`,
    )

  const idle = (): Promise<true> => waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })

  it('AC2: the bar moves per hop — forward on the hop that helped, back on the one that did not, full on the sure yes', async () => {
    expect(await harness.submitCommand(`navigate ${harness.fixture.url('/hub-index')}`)).toBe('submitted')
    await harness.waitForPaneUrl(harness.fixture.url('/hub-index'))
    await idle()
    expect(await bar(), 'no bar before a Task has a reading').toBeNull()

    expect(await harness.submitCommand(LINE)).toBe('submitted')
    // Every move the bar made, in order: each hop's reading adds one, so the history is the bar having moved per hop.
    const seen = new Set<string>()
    await waitFor(
      async () => {
        const now = await bar()
        if (now !== null) seen.add(now.moves)
        return now?.moves === 'forward back full' ? true : undefined
      },
      { timeoutMs: 40_000, intervalMs: 50 },
    )
    expect(await bar()).toEqual({ moves: 'forward back full', filled: '100' })
    expect([...seen]).toEqual(['forward', 'forward back', 'forward back full'])
    await idle()
    expect(await bar(), 'the bar stands where the Task left it once it ends').toEqual({ moves: 'forward back full', filled: '100' })
  })

  it('AC3: the Feed\'s lines carry the reading beside the action it judged', async () => {
    const readings = await harness.overlayEval<string[][]>(
      `Array.from(document.querySelectorAll('.feed-entry--command')).map((entry) => Array.from(entry.querySelectorAll('.feed-action')).map((line) => line.textContent))`,
    )
    const task = readings.find((lines) => lines.length === 3)
    expect(task, `the Task's entry with its three action lines among ${JSON.stringify(readings)}`).toBeDefined()
    expect(task![0]).toMatch(/Regional hub Aurora.*closer$/)
    expect(task![0]).not.toMatch(/no closer$/)
    expect(task![1]).toMatch(/audit.*no closer$/)
    expect(task![2]).toMatch(/^back.*closer$/)
    expect(task![2]).not.toMatch(/no closer$/)
  })

  it('AC3: a Local Match Command shows no bar, and clears the last Task\'s', async () => {
    expect(await harness.submitCommand('reload')).toBe('submitted')
    await waitFor(async () => ((await bar()) === null ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })
    await idle()
    expect(await bar()).toBeNull()
  })
})
