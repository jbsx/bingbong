import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cli } from './cliSupport'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The pane out of sight (#425, ADR 0079 amended 2026-10-25): hidden at
// rest, so Chromium stops decoding and painting a page no one sees, its
// media playing on; parked a pixel on screen while it may be read, so a
// page loaded out of sight builds itself in full before a Task reads it.

describe('pane hidden e2e: out of sight, hidden at rest and parked while it may be read', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ wakeFromBootIdle: false })
    await waitFor(async () => ((await idleUp()) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  const idleUp = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const promptValue = (): Promise<string | null> => harness.dashboardEval<string | null>(`document.querySelector('.idle-prompt-input')?.value ?? null`)
  const visibility = (): Promise<string> => harness.paneEval<string>('document.visibilityState')
  const results = (): Promise<number> => harness.paneEval<number>(`document.querySelectorAll('#results li').length`)
  const until = <T>(read: () => Promise<T>, want: T, timeoutMs = 5000): Promise<boolean> =>
    waitFor(async () => ((await read()) === want ? true : undefined), { timeoutMs, intervalMs: 50 })
  /** Loads a page in the pane out of sight: no Command, so the Idle Screen stays up and nothing parks the pane. */
  const loadOutOfSight = async (path: string): Promise<void> => {
    const url = harness.fixture.url(path)
    await harness.paneEval(`location.href = ${JSON.stringify(url)}`).catch(() => {})
    await harness.waitForPaneUrl(url)
  }
  const ESCAPE = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }

  it('a page loaded out of sight is hidden at rest, and builds only what it built before hiding', async () => {
    await loadOutOfSight('/lazy-list')
    expect(await until(visibility, 'hidden')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await results()).toBeLessThan(19)
    expect(await idleUp()).toBe(true)
  })

  it('the Idle Prompt open parks it: visible, the page fills in; closed, hidden again', async () => {
    await harness.pressKey('dashboard', { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, text: 's' })
    expect(await until(promptValue, 's')).toBe(true)
    expect(await until(visibility, 'visible')).toBe(true)
    expect(await until(results, 19)).toBe(true)

    await harness.pressKey('dashboard', ESCAPE)
    expect(await until(promptValue, null)).toBe(true)
    expect(await until(visibility, 'hidden')).toBe(true)
    expect(await idleUp()).toBe(true)
  })

  it('a playing video keeps its time moving while hidden', async () => {
    await loadOutOfSight('/native-video')
    expect(await until(visibility, 'hidden')).toBe(true)
    const playing = await waitFor(async () => ((await harness.paneEval<number>(`document.querySelector('video').currentTime`)) > 0 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    expect(playing).toBe(true)
    const before = await harness.paneEval<number>(`document.querySelector('video').currentTime`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const after = await harness.paneEval<number>(`document.querySelector('video').currentTime`)
    expect(after - before).toBeGreaterThan(1)
    expect(await visibility()).toBe('hidden')
  })

  it('a Command typed over the Idle Screen reads every result of a list that builds itself only when visible', async () => {
    await loadOutOfSight('/lazy-list')
    expect(await until(visibility, 'hidden')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await results()).toBeLessThan(19)

    await harness.pressKey('dashboard', { key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79, text: 'o' })
    expect(await until(promptValue, 'o')).toBe(true)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`document.activeElement?.classList.contains('idle-prompt-input') === true`)) ? true : undefined), { timeoutMs: 2000, intervalMs: 50 })
    // At a person's pace: the park starts at the first key, and no Task waits on it.
    for (const key of 'pen Result 19') {
      await harness.typeIntoDashboard(key)
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    await harness.pressKey('dashboard', ENTER)
    expect(await harness.waitForPaneUrl(harness.fixture.url('/second?result=19'))).toBe(harness.fixture.url('/second?result=19'))
  })
})

describe('pane hidden e2e: a screenshot of the pane out of sight', () => {
  let harness: Harness
  let dir: string

  beforeAll(async () => {
    harness = await startHarness({ launchArgs: ['--browser-cli'], pipeStdio: true, wakeFromBootIdle: false })
    dir = await mkdtemp(join(tmpdir(), 'bingbong-hidden-shots-'))
  })

  afterAll(async () => {
    await harness?.quit()
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it('a capture of the pane out of sight, hidden until the Task parks it, is taken', async () => {
    const url = harness.fixture.url('/lazy-list')
    await harness.paneEval(`location.href = ${JSON.stringify(url)}`).catch(() => {})
    await harness.waitForPaneUrl(url)
    await waitFor(async () => ((await harness.paneEval<string>('document.visibilityState')) === 'hidden' ? true : undefined), { timeoutMs: 5000, intervalMs: 50 })
    // Never 0×0: the pane was shown parked for a frame when it was created, and keeps its size hidden.
    expect(await harness.paneEval<number>('innerWidth')).toBeGreaterThan(300)
    // Each capture is the first after hiding: a screenshot wakes the dashboard, so the idle shortcut hides the pane again before the next.
    for (const name of ['first.jpg', 'second.jpg']) {
      if (!(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`))) await harness.pressKey('dashboard', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 | 8 })
      await waitFor(async () => ((await harness.paneEval<string>('document.visibilityState')) === 'hidden' ? true : undefined), { timeoutMs: 5000, intervalMs: 50 })
      const path = join(dir, name)
      await cli(harness, `screenshot ${path}`, new RegExp(`^screenshot saved: ${path}$`))
      const bytes = await readFile(path)
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xd8)
      expect(bytes.byteLength).toBeGreaterThan(3000)
    }
  })
})
