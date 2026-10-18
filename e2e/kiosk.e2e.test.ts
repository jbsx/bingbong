import { afterAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// Kiosk e2e (T11): --kiosk launches the window fullscreen with the browser
// pane dominant — the appliance deployment shape.

describe('kiosk mode e2e', () => {
  let harness: Harness | undefined

  afterAll(async () => {
    await harness?.quit()
  })

  it('launches fullscreen with the browser pane dominant', async () => {
    harness = await startHarness({ launchArgs: ['--kiosk'], env: { BINGBONG_IDLE_TIMEOUT_MS: '60000' } })
    const app = harness
    if (!app) throw new Error('harness failed to start')

    // Real fullscreen at the window-manager level, not just a big window:
    // the window's outer bounds cover the whole screen (Electron's CDP
    // doesn't expose the Browser domain, so screen coverage is the signal).
    // A 1px tolerance: X11 fullscreen bounds can round one pixel short.
    await waitFor(
      async () => {
        const covers = await app.dashboardEval<boolean>(
          `window.outerWidth >= screen.width - 1 && window.outerHeight >= screen.height - 1`,
        )
        return covers || undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // The renderer knows it's kiosk…
    expect(await app.dashboardEval<boolean>(`!!document.querySelector('.dashboard--kiosk')`)).toBe(true)

    // …and the browser pane owns the layout. Dominant = the viewport takes
    // well over half the window (kiosk chrome + footer leave it ~75%+).
    await waitFor(
      async () => {
        const fraction = await app.dashboardEval<number>(`(() => {
          const viewport = document.querySelector('.browser-viewport')
          if (!viewport) return 0
          return viewport.getBoundingClientRect().height / window.innerHeight
        })()`)
        return fraction > 0.55 ? fraction : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
  })

  it('lays the Toolbar out on the screen exactly as windowed does (ADR 0012, #331)', async () => {
    const app = harness
    if (!app) throw new Error('harness failed to start')
    // Fullscreen must not keep the frameless window's frame insets: the
    // window lies on the screen (X11 without a window manager may round it
    // a pixel short), so the Toolbar's edges are never pushed off it.
    const geometry = await waitFor(
      async () => {
        const measured = await app.dashboardEval<{ x: number; width: number; screen: number; capsule: number; settings: number }>(`(() => ({
          x: screenX,
          width: innerWidth,
          screen: screen.width,
          capsule: document.querySelector('.status-capsule').getBoundingClientRect().left,
          settings: document.querySelector('.settings-toggle').getBoundingClientRect().right,
        }))()`)
        return measured.x >= 0 && measured.x + measured.width <= measured.screen ? measured : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(geometry.width).toBeGreaterThanOrEqual(geometry.screen - 1)
    // The windowed insets: capsule 14 px from the left edge, controls 14 px from the right.
    expect(geometry.x + geometry.capsule).toBe(14)
    expect(geometry.width - geometry.settings).toBe(14)
  })
})
