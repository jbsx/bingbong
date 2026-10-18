import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { promptBarScript } from './scripts'
import { waitFor } from './waitFor'

// The shell's chrome holds one shape in every state and view (#331): the
// edge tab shows from boot, a panel the human opened stays open through a
// Command's end and a Stop, the Status Capsule stays clear of the back
// control, the Toolbar's controls keep the right edge on every page, and
// the Prompt Bar's placeholder reads whole at the default width.

/** The Toolbar's measured geometry, in the dashboard's CSS pixels. */
const toolbarGeometry = `(() => {
  const rect = (selector) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right }
  }
  return {
    width: innerWidth,
    capsule: rect('.status-capsule'),
    back: rect('.chrome-button[aria-label="Go back"]'),
    settings: rect('.settings-toggle'),
  }
})()`

interface ToolbarGeometry {
  width: number
  capsule: { left: number; right: number } | null
  back: { left: number; right: number } | null
  settings: { left: number; right: number } | null
}

describe('shell chrome e2e', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ env: { BINGBONG_IDLE_TIMEOUT_MS: '600000' } })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  const panelOpen = (): Promise<boolean> => harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--open')`)

  /** A typed Command run to its end: the Prompt Bar's submit settles only when the Command has unwound. */
  async function promptIdle(): Promise<void> {
    await waitFor(
      async () => ((await harness.overlayEval<boolean>(`!document.querySelector('.prompt-form[aria-busy]')`)) ? true : undefined),
      { timeoutMs: 20_000, intervalMs: 100 },
    )
  }

  it('shows the collapsed edge tab from boot, and a click on it opens the panel', async () => {
    // No resize, no toggle: the view the boot left must already show the tab.
    const viewport = await waitFor(
      async () => {
        const size = await harness.overlayEval<{ width: number; height: number; tab: boolean }>(
          `({ width: innerWidth, height: innerHeight, tab: !!document.querySelector('.feed-edge-tab') })`,
        )
        return size.width > 0 && size.height > 0 && size.tab ? size : undefined
      },
      { timeoutMs: 10_000, intervalMs: 100 },
    )
    expect(viewport.width).toBeGreaterThan(0)
    expect(await panelOpen()).toBe(false)

    await harness.clickOverlayElement('.feed-edge-tab', { minViewportWidth: 1 })
    await waitFor(async () => (await panelOpen()) || undefined, { timeoutMs: 5_000, intervalMs: 100 })
  })

  it('keeps a panel the human opened open after a typed Command finishes', async () => {
    await harness.ensurePanelOpen()
    expect(await harness.overlayEval<string>(promptBarScript(`navigate ${harness.fixture.url('/')}`))).toBe('submitted')
    await harness.waitForPaneUrl(harness.fixture.url('/'))
    await promptIdle()
    expect(await panelOpen()).toBe(true)

    // The Answer was read in the open panel: closing it shows the edge tab, not a stale Peek Card.
    await harness.overlayEval(`window.bingbong.feedPanel.toggle()`)
    await waitFor(async () => (await harness.overlayEval<boolean>(`!!document.querySelector('.feed-edge-tab')`)) || undefined, {
      timeoutMs: 5_000,
      intervalMs: 100,
    })
  })

  it('reads the Prompt Bar placeholder whole with Stop showing, and keeps the panel open after Stop', async () => {
    await harness.ensurePanelOpen()
    // A page that never goes quiet holds the Command at the 3 s landing cap — long enough to show Stop.
    expect(await harness.overlayEval<string>(promptBarScript(`navigate ${harness.fixture.url('/landing/busy')}`))).toBe('submitted')
    await waitFor(async () => (await harness.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`)) || undefined, {
      timeoutMs: 5_000,
      intervalMs: 50,
    })

    const fit = await harness.overlayEval<{ panel: number; text: number; room: number }>(`(() => {
      const input = document.querySelector('.prompt-input')
      const style = getComputedStyle(input)
      const context = document.createElement('canvas').getContext('2d')
      context.font = style.font
      const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      return {
        panel: document.querySelector('.feed-surface').getBoundingClientRect().width,
        text: context.measureText(input.placeholder).width,
        room,
      }
    })()`)
    expect(fit.panel).toBe(380)
    expect(fit.text).toBeLessThanOrEqual(fit.room)

    await harness.clickOverlayElement('.panel-stop')
    await promptIdle()
    expect(await panelOpen()).toBe(true)
  })

  it('keeps the Status Capsule clear of the back control, a long partial transcript included', async () => {
    // The live partial is React-owned text; a long one is written into a
    // hint the way the capsule renders it, and the capsule must ellipsize.
    await harness.dashboardEval(`(() => {
      const hint = document.createElement('span')
      hint.className = 'voice-hint voice-hint--listening probe-hint'
      hint.textContent = '“' + 'open the second result on the page and read me the whole article '.repeat(4) + '…”'
      document.querySelector('.status-capsule').appendChild(hint)
    })()`)
    const geometry = await harness.dashboardEval<ToolbarGeometry>(toolbarGeometry)
    await harness.dashboardEval(`document.querySelector('.probe-hint')?.remove()`)
    expect(geometry.capsule && geometry.back).toBeTruthy()
    expect(geometry.capsule!.right).toBeLessThan(geometry.back!.left)
  })

  it('keeps the feed and settings controls at the right edge on the dashboard and on the settings page', async () => {
    const dashboard = await harness.dashboardEval<ToolbarGeometry>(toolbarGeometry)
    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(async () => (await harness.dashboardEval<boolean>(`!document.querySelector('.url-input')`)) || undefined, {
      timeoutMs: 5_000,
      intervalMs: 100,
    })
    const settings = await harness.dashboardEval<ToolbarGeometry>(toolbarGeometry)
    await harness.clickDashboardElement('.settings-toggle')

    expect(dashboard.width - dashboard.settings!.right).toBe(14)
    expect(settings.settings).toEqual(dashboard.settings)
    expect(settings.capsule!.left).toBe(dashboard.capsule!.left)
  })
})
