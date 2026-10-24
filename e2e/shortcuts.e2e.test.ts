import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The app's keyboard shortcuts (appShortcuts.ts), pressed as real X keys:
// Electron's default menu acted on whichever surface held X focus, which a
// CDP keypress never moves — the dashboard reloading under Ctrl+R showed
// only under xdotool. Each chord lands on the browsing pane from every
// surface, and none reloads, zooms, docks the DevTools into or closes the app.

const appWindow = (): string => execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Bing Bong'], { encoding: 'utf8' }).trim().split('\n')[0]!

/** A real click on the toolbar band (the dashboard) or mid-window (the pane): X focus follows it. */
function focus(surface: 'dashboard' | 'pane'): void {
  const [x, y] = surface === 'dashboard' ? [640, 15] : [640, 450]
  execFileSync('xdotool', ['mousemove', '--window', appWindow(), String(x), String(y), 'click', '1'])
}

function press(keys: string): void {
  execFileSync('xdotool', ['key', '--window', appWindow(), keys])
}

const settle = (ms = 1_500) => new Promise((resolve) => setTimeout(resolve, ms))

describe('keyboard shortcuts as real keys', () => {
  let harness: Harness
  let zoom: number

  beforeAll(async () => {
    harness = await startHarness()
    zoom = await harness.paneEval<number>('window.devicePixelRatio')
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
  })

  beforeEach(async () => {
    await harness.navigatePane(harness.fixture.url('/'))
    await harness.navigatePane(harness.fixture.url('/second'))
    await harness.dashboardEval('window.__kept = true')
    await harness.paneEval('window.__kept = true')
  })

  for (const surface of ['dashboard', 'pane'] as const) {
    it(`Ctrl+R on the ${surface} reloads the page, never the dashboard`, async () => {
      focus(surface)
      await settle(800)
      press('ctrl+r')
      await waitFor(async () => ((await harness.paneEval<boolean>('window.__kept === true').catch(() => true)) ? undefined : true), { timeoutMs: 10_000, intervalMs: 100 })
      expect(await harness.dashboardEval<boolean>('window.__kept === true')).toBe(true)
      expect(await harness.paneUrl()).toBe(harness.fixture.url('/second'))
    })
  }

  it('F5 reloads the page too', async () => {
    focus('pane')
    await settle(800)
    press('F5')
    await waitFor(async () => ((await harness.paneEval<boolean>('window.__kept === true').catch(() => true)) ? undefined : true), { timeoutMs: 10_000, intervalMs: 100 })
    expect(await harness.dashboardEval<boolean>('window.__kept === true')).toBe(true)
  })

  it('Alt+Left and Alt+Right step the page back and forward', async () => {
    focus('dashboard')
    await settle(800)
    press('alt+Left')
    expect(await harness.waitForPaneUrl(harness.fixture.url('/'))).toBe(harness.fixture.url('/'))
    press('alt+Right')
    expect(await harness.waitForPaneUrl(harness.fixture.url('/second'))).toBe(harness.fixture.url('/second'))
  })

  it('the zoom chords leave the pane at its zoom Setting', async () => {
    focus('pane')
    await settle(800)
    for (const keys of ['ctrl+0', 'ctrl+minus', 'ctrl+plus', 'ctrl+equal']) press(keys)
    await settle()
    expect(await harness.paneEval<number>('window.devicePixelRatio')).toBe(zoom)
    expect(await harness.dashboardEval<number>('window.devicePixelRatio')).toBe(1)
  })

  it('Ctrl+Space arms listening from the pane, and disarms it again', async () => {
    const listening = () => harness.dashboardEval<boolean>('window.bingbong.voice.getState().then((s) => s.listening)')
    focus('pane')
    await settle(800)
    press('ctrl+space')
    await waitFor(async () => ((await listening()) ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    press('ctrl+space')
    await waitFor(async () => ((await listening()) ? undefined : true), { timeoutMs: 5_000, intervalMs: 100 })
  })

  it('the clipboard chords still edit a field with no menu behind them', async () => {
    focus('dashboard')
    await harness.clickDashboardElement('.url-input')
    await harness.dashboardEval(`document.querySelector('.url-input').value = 'kept words'`)
    await settle(500)
    press('ctrl+a')
    press('ctrl+x')
    await settle(300)
    expect(await harness.dashboardEval<string>(`document.querySelector('.url-input').value`)).toBe('')
    press('ctrl+v')
    await settle(300)
    expect(await harness.dashboardEval<string>(`document.querySelector('.url-input').value`)).toBe('kept words')
    press('Escape')
  })

  it('Ctrl+W and Ctrl+Q leave the appliance up', async () => {
    focus('pane')
    await settle(800)
    press('ctrl+w')
    press('ctrl+q')
    await settle()
    expect(await harness.dashboardEval<boolean>('window.__kept === true')).toBe(true)
    expect(await harness.paneEval<boolean>('window.__kept === true')).toBe(true)
  })
})
