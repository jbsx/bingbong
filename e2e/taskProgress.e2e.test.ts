import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { decisionScript, HUB_TASK_LINE as LINE, hubTaskReadings } from './scriptedJev'
import { waitFor } from './waitFor'

// The Task's progress bar (#375): the Status Capsule's bar moves with each
// hop's Progress Noul (#373) as it arrives, and the Feed's lines carry the
// same reading beside the action it judged. A scripted Jev whose Nouls are
// chosen walks the hub fixture (`hubTaskReadings`) — hub Aurora's link
// (helped), back (unsure), hub Borealis's link (did not help), its audit
// link (helped), then a sure yes — so the bar reads forward, held, back,
// forward, full; a Local Match Command after it shows no bar at all.

/** The dashboard's bar as it stands: its moves and fill. */
interface Bar {
  readonly moves: string
  readonly filled: string
}

describe('the Task progress bar e2e (#375)', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ env: decisionScript(...hubTaskReadings()) })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  /** The bar, or null while none is shown. */
  const bar = (): Promise<Bar | null> =>
    harness.dashboardEval<Bar | null>(`(() => { const el = document.querySelector('.task-bar'); return el ? { moves: el.dataset.moves, filled: el.dataset.filled } : null })()`)

  const idle = (): Promise<true> => waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })

  it('AC2: the bar moves per hop — forward on a hop that helped, held on an unsure one, back on one that did not, full on the sure yes', async () => {
    expect(await harness.submitCommand(`navigate ${harness.fixture.url('/hub-index')}`)).toBe('submitted')
    await harness.waitForPaneUrl(harness.fixture.url('/hub-index'))
    await idle()
    expect(await bar(), 'no bar before a Task has a reading').toBeNull()

    expect(await harness.submitCommand(LINE)).toBe('submitted')
    // Every move the bar made, in order: each hop's reading adds one, so the history is the bar having moved per hop.
    const seen = new Set<string>()
    const whole = 'forward held back forward full'
    await waitFor(
      async () => {
        const now = await bar()
        if (now !== null) seen.add(now.moves)
        return now?.moves === whole ? true : undefined
      },
      { timeoutMs: 40_000, intervalMs: 50 },
    )
    expect(await bar()).toEqual({ moves: whole, filled: '100' })
    // The bar was seen moving mid-Task, each sample a longer prefix of the whole history; a hop
    // landing within one poll of the last (back needs no settle) may be sampled with it.
    const samples = [...seen]
    expect(samples.length).toBeGreaterThanOrEqual(3)
    for (const [index, sample] of samples.entries()) {
      expect(whole.startsWith(sample), `${sample} is a prefix of ${whole}`).toBe(true)
      if (index > 0) expect(sample.length).toBeGreaterThan(samples[index - 1]!.length)
    }
    await idle()
    expect(await bar(), 'the bar stands where the Task left it once it ends').toEqual({ moves: whole, filled: '100' })
  })

  it('AC3: the Feed\'s lines carry the reading beside the action it judged', async () => {
    const readings = await harness.overlayEval<string[][]>(
      `Array.from(document.querySelectorAll('.feed-entry--command')).map((entry) => Array.from(entry.querySelectorAll('.feed-action')).map((line) => line.textContent))`,
    )
    const task = readings.find((lines) => lines.length === 4)
    expect(task, `the Task's entry with its four action lines among ${JSON.stringify(readings)}`).toBeDefined()
    expect(task![0]).toMatch(/Regional hub Aurora.*closer$/)
    expect(task![0]).not.toMatch(/no closer$/)
    expect(task![1]).toMatch(/^back.*unsure$/)
    expect(task![2]).toMatch(/Regional hub Borealis.*no closer$/)
    expect(task![3]).toMatch(/audit for hub Borealis.*closer$/)
    expect(task![3]).not.toMatch(/no closer$/)
  })

  it('AC3: a Local Match Command shows no bar, and clears the last Task\'s', async () => {
    expect(await harness.submitCommand('reload')).toBe('submitted')
    await waitFor(async () => ((await bar()) === null ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })
    await idle()
    expect(await bar()).toBeNull()
  })
})
