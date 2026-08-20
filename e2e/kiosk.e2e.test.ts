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
})
