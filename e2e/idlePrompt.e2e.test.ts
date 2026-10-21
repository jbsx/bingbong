import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The blank pane is never shown (#361): the app boots into the Idle Screen
// with nothing in the pane, and stays there — a tap, a key that types
// nothing, the Feed shortcut and a Command that acts on the blank pane all
// leave it up. A typed key opens the Idle Prompt over it; a Command that
// opens a page wakes the dashboard on it.

describe('idle prompt e2e: the blank pane is never shown', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ wakeFromBootIdle: false })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  const idleUp = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const promptValue = (): Promise<string | null> => harness.dashboardEval<string | null>(`document.querySelector('.idle-prompt-input')?.value ?? null`)
  const feedOpen = (): Promise<boolean> => harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--open')`)
  const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 600))

  it('boots into the Idle Screen, and a tap with no page in the pane leaves it up', async () => {
    await waitFor(async () => ((await idleUp()) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    await harness.clickDashboardElement('.idle-screen')
    await settle()
    expect(await idleUp()).toBe(true)
  })

  it('a key that types nothing does nothing, from the dashboard or the pane', async () => {
    for (const target of ['dashboard', 'pane'] as const) {
      for (const key of [
        { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
        { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
        { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      ]) {
        await harness.pressKey(target, key)
      }
    }
    await settle()
    expect(await idleUp()).toBe(true)
    expect(await promptValue()).toBeNull()
  })

  it('the Feed shortcut does not open the Feed over the Idle Screen', async () => {
    await harness.pressPanelShortcut('dashboard')
    await harness.pressPanelShortcut('pane')
    await settle()
    expect(await feedOpen()).toBe(false)
    expect(await idleUp()).toBe(true)
  })

  it('a typed key opens the Idle Prompt with it, the Feed shut; Escape closes it and the screen stays', async () => {
    // A key that carries its character reaches the dashboard's renderer, which main's before-input-event never sees: it opens the Prompt too.
    await harness.pressKey('dashboard', { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, text: 's' })
    expect(await waitFor(async () => ((await promptValue()) === 's' ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })).toBe(true)
    expect(await idleUp()).toBe(true)
    expect(await feedOpen()).toBe(false)

    await harness.pressKey('dashboard', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    expect(await waitFor(async () => ((await promptValue()) === null ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })).toBe(true)
    expect(await idleUp()).toBe(true)
  })

  it('a Command that acts on the blank pane answers in the Prompt, the Idle Screen up', async () => {
    // From the pane this time: main hears the key there and hands it over.
    await harness.pressKey('pane', { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
    await waitFor(async () => ((await promptValue()) === 's' ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    // The field takes focus as it opens: the keys after the first land in it.
    expect(
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`document.activeElement?.classList.contains('idle-prompt-input') === true`)) ? true : undefined), { timeoutMs: 2000, intervalMs: 50 }),
    ).toBe(true)
    await harness.typeIntoDashboard('croll')
    // Space and Backspace are real key presses that edit the field; main does not swallow them.
    await harness.pressKey('dashboard', { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' })
    await harness.pressKey('dashboard', { key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, text: 'x' })
    await harness.pressKey('dashboard', { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    expect(await promptValue()).toBe('scroll ')
    await harness.typeIntoDashboard('down')
    expect(await promptValue()).toBe('scroll down')
    await harness.pressKey('dashboard', ENTER)

    const reply = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.idle-prompt-answer')?.textContent ?? ''`)
        return text !== '' && text !== '…' ? text : undefined
      },
      { timeoutMs: 10000, intervalMs: 100 },
    )
    expect(reply).toBe("There's no page open.")
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-prompt-said')?.textContent ?? ''`)).toBe('scroll down')
    await settle()
    expect(await idleUp()).toBe(true)
  })

  it('a Command that opens a page wakes the dashboard on it', async () => {
    await harness.typeIntoDashboard(`navigate ${harness.fixture.url('/second')}`)
    await harness.pressKey('dashboard', ENTER)
    expect(await harness.waitForPaneUrl(harness.fixture.url('/second'))).toBe(harness.fixture.url('/second'))
    expect(
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input') && !document.querySelector('.idle-screen')`)) ? true : undefined), {
        timeoutMs: 10000,
        intervalMs: 100,
      }),
    ).toBe(true)
  })
})
