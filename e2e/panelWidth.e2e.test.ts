import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FEED_WIDTH_STORAGE_KEY } from '../src/core/panel/feedPanelState'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Feed panel width (#65): the doubled default (880px, kiosk 800px) with
// enforced bounds (min 320px, max 75% of the window), drag-resize on the
// panel's left edge that persists as a View Preference across restarts,
// and content that wraps instead of horizontally scrolling — code blocks
// reflow, cards and bubbles use the panel's full width.

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`
const SLOT_WIDTH = `document.querySelector('.feed-slot')?.getBoundingClientRect().width ?? 0`
const WORKSPACE_WIDTH = `document.querySelector('.dashboard-workspace')?.getBoundingClientRect().width ?? 0`
const SURFACE_WIDTH = `document.querySelector('.feed-surface')?.getBoundingClientRect().width ?? 0`
const FOLD_WIDTH = `window.bingbong.feedPanel.getState().then((s) => s?.width ?? 0)`

const DRAG_GEOMETRY = `(() => {
  const handle = document.querySelector('.feed-resize-handle')
  const surface = document.querySelector('.feed-surface')
  if (!handle || !surface) return null
  const r = handle.getBoundingClientRect()
  return { right: surface.getBoundingClientRect().right, y: r.y + r.height / 2 }
})()`

const WRAP_PROBE = `(() => {
  const pre = document.querySelector('.feed-entry--display .feed-markdown pre')
  const card = document.querySelector('.feed-entry--display .feed-card')
  const bubble = document.querySelector('.feed-entry--command .feed-bubble')
  if (!pre || !card || !bubble) return null
  return {
    scrollWidth: pre.scrollWidth,
    clientWidth: pre.clientWidth,
    whiteSpace: getComputedStyle(pre).whiteSpace,
    cardMaxWidth: getComputedStyle(card).maxWidth,
    bubbleMaxWidth: getComputedStyle(bubble).maxWidth,
  }
})()`

interface WrapProbe {
  scrollWidth: number
  clientWidth: number
  whiteSpace: string
  cardMaxWidth: string
  bubbleMaxWidth: string
}

async function openPanel(harness: Harness): Promise<void> {
  await harness.clickDashboardElement('.feed-panel-toggle')
  await waitFor(
    async () =>
      (await harness.overlayEval<boolean>(OPEN_CHROME)) &&
      (await harness.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--overlay:not(.feed-slot--collapsed)')`))
        ? true
        : undefined,
    { timeoutMs: 5000, intervalMs: 100 },
  )
}

async function waitForSlotWidth(harness: Harness, expected: number, tolerance = 2): Promise<number> {
  return waitFor(
    async () => {
      const width = await harness.dashboardEval<number>(SLOT_WIDTH)
      return Math.abs(width - expected) <= tolerance ? width : undefined
    },
    { timeoutMs: 10000, intervalMs: 100 },
  )
}

describe('feed panel width e2e (#65)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('defaults to 880px and enforces both bounds through the fold', async () => {
    const app = await startHarness({ fixture })
    try {
      await openPanel(app)
      // The doubled default renders on both surfaces: the dashboard's slot
      // and the overlay's surface paint one folded width.
      await waitForSlotWidth(app, 880)
      const surfaceWidth = await app.overlayEval<number>(SURFACE_WIDTH)
      expect(surfaceWidth).toBeGreaterThan(870)

      // Below the floor: the fold clamps to 320 — the IPC seam, not CSS.
      await app.dashboardEval(`window.bingbong.feedPanel.setWidth(120)`)
      await waitForSlotWidth(app, 320)
      expect(await app.dashboardEval<number>(FOLD_WIDTH)).toBe(320)

      // Above the ceiling: main clamps to 75% of the window, the slot's
      // own clamp to 75% of the workspace bounds it — one bound, asserted
      // against the real workspace rather than a hardcoded pixel count.
      await app.dashboardEval(`window.bingbong.feedPanel.setWidth(5000)`)
      const workspace = await app.dashboardEval<number>(WORKSPACE_WIDTH)
      await waitForSlotWidth(app, Math.floor(workspace * 0.75))
      const ceiling = await app.dashboardEval<number>(FOLD_WIDTH)
      expect(ceiling).toBeLessThanOrEqual(960)
      expect(ceiling).toBeGreaterThanOrEqual(900)
    } finally {
      await app.quit()
    }
  })

  it('drag-resizes on the left edge and the width survives a restart', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-width-'))
    try {
      const target = 600
      const first = await startHarness({ fixture, userDataDir, env: { BINGBONG_IDLE_TIMEOUT_MS: '60000' } })
      try {
        await openPanel(first)

        // The drag: press on the resize handle, pull left to a definite
        // width, release. The handle sits at the surface's left edge; the
        // width is the surface's right edge minus the cursor. Settle the
        // view first — it resizes asynchronously after the open broadcast,
        // and a press aimed at mid-transition coordinates hits stale
        // layout.
        await waitFor(
          () => first.overlayEval<number>(`innerWidth`).then((w) => (w > 800 ? w : undefined)),
          { timeoutMs: 5000, intervalMs: 100 },
        )
        const geometry = await waitFor(
          () => first.overlayEval<{ right: number; y: number } | null>(DRAG_GEOMETRY).then((value) => value ?? undefined),
          { timeoutMs: 5000, intervalMs: 100 },
        )
        expect(geometry!.right).toBeGreaterThan(0)
        await first.overlayMouseEvent('move', 5, geometry!.y)
        await first.overlayMouseEvent('down', 5, geometry!.y)
        // A couple of moves through the drag, exactly like a real pull.
        for (const x of [geometry!.right - (target + 150), geometry!.right - target]) {
          await first.overlayMouseEvent('move', x, geometry!.y)
        }
        await first.overlayMouseEvent('up', geometry!.right - target, geometry!.y)

        // The drag's width landed on both surfaces and persisted.
        await waitForSlotWidth(first, target)
        const surfaceWidth = await first.overlayEval<number>(SURFACE_WIDTH)
        expect(Math.abs(surfaceWidth - target)).toBeLessThanOrEqual(2)
        await waitFor(
          () =>
            first
              .dashboardEval<string | null>(`window.localStorage.getItem(${JSON.stringify(FEED_WIDTH_STORAGE_KEY)})`)
              .then((value) => (value === String(target) ? value : undefined)),
          { timeoutMs: 5000, intervalMs: 100 },
        )
      } finally {
        await first.quit()
      }

      // Restart on the same profile: the dragged width is the boot width.
      const second = await startHarness({ fixture, userDataDir, env: { BINGBONG_IDLE_TIMEOUT_MS: '60000' } })
      try {
        await openPanel(second)
        await waitForSlotWidth(second, target)
        const stored = await second.dashboardEval<string | null>(
          `window.localStorage.getItem(${JSON.stringify(FEED_WIDTH_STORAGE_KEY)})`,
        )
        expect(stored).toBe(String(target))
      } finally {
        await second.quit()
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('ships the same wider default in kiosk (800px)', async () => {
    const app = await startHarness({ fixture, launchArgs: ['--kiosk'], env: { BINGBONG_IDLE_TIMEOUT_MS: '60000' } })
    try {
      await openPanel(app)
      await waitForSlotWidth(app, 800)
      expect(await app.dashboardEval<number>(FOLD_WIDTH)).toBe(800)
    } finally {
      await app.quit()
    }
  })

  it('wraps code blocks and spans the panel width — nothing scrolls away', async () => {
    // One answer whose fenced block carries a line far wider than any
    // panel: wrapping is the only way it stays visible.
    const display = ['## Long line check', '', '```js', `const wrapped = ${'x'.repeat(300)};`, '```'].join('\n')
    const script: AssistantTurn[] = [{ kind: 'answer', speak: 'Wrapped.', display }]
    const app = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      await openPanel(app)
      expect(await app.submitCommand('print a long line')).toBe('submitted')

      const wrap = await waitFor(
        () => app.overlayEval<WrapProbe | null>(WRAP_PROBE).then((value) => value ?? undefined),
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // The block wraps: no horizontal overflow inside the panel.
      expect(wrap.whiteSpace).toBe('pre-wrap')
      expect(wrap.scrollWidth).toBeLessThanOrEqual(wrap.clientWidth)
      // Cards and bubbles use the panel's full width.
      expect(wrap.cardMaxWidth).toBe('100%')
      expect(wrap.bubbleMaxWidth).toBe('100%')
    } finally {
      await app.quit()
    }
  })
})
