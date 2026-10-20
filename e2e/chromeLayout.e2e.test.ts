import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { sleep, waitFor } from './waitFor'

// The shell's chrome follows the window (#334): the collapsed edge tab
// stays on the right edge, vertically centred, at any window width — the
// slot only moves on a resize, so its rect must be re-reported then too —
// and the settings page is never under the Feed Panel: the panel is hidden
// while settings shows and comes back exactly as it was.

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** The screen's bounding box of pure magenta pixels, from the X root (the composite of every native view). */
function magentaOnScreen(): Box | null {
  const xwd = execFileSync('xwd', ['-root', '-silent'], { maxBuffer: 64 * 1024 * 1024 })
  // The XWD header's pixmap_width, a big-endian word at byte 16.
  const width = xwd.readUInt32BE(16)
  const rgb = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'xwd_pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    input: xwd,
    maxBuffer: 64 * 1024 * 1024,
  })
  let box: Box | null = null
  for (let i = 0; i < rgb.length; i += 3) {
    if (rgb[i] !== 255 || rgb[i + 1] !== 0 || rgb[i + 2] !== 255) continue
    const x = (i / 3) % width
    const y = Math.floor(i / 3 / width)
    box = box
      ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x + 1), bottom: Math.max(box.bottom, y + 1) }
      : { left: x, top: y, right: x + 1, bottom: y + 1 }
  }
  return box
}

describe('shell chrome layout e2e', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ env: { BINGBONG_IDLE_TIMEOUT_MS: '600000' } })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  /** The dashboard workspace's right edge and the window's place, in screen pixels. */
  const workspaceOnScreen = (): Promise<{ right: number; top: number; bottom: number }> =>
    harness.dashboardEval(`(() => {
      // A frameless window keeps its frame insets: the content sits centred in the outer bounds.
      const x = screenX + (outerWidth - innerWidth) / 2
      const y = screenY + (outerHeight - innerHeight) / 2
      const r = document.querySelector('.dashboard-workspace').getBoundingClientRect()
      return { right: x + r.right, top: y + r.top, bottom: y + r.bottom }
    })()`)

  /** The Toolbar cluster's left edges: the back control, the address field. */
  const clusterGeometry = (): Promise<{ back: number; field: number }> =>
    harness.dashboardEval(`({
      back: document.querySelector('.chrome-button[aria-label="Go back"]').getBoundingClientRect().left,
      field: document.querySelector('.url-input').getBoundingClientRect().left,
    })`)
  const loading = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.chrome-loading')`)
  const pill = (): Promise<{ text: string; color: string }> =>
    harness.dashboardEval(`(() => {
      const el = document.querySelector('.status-pill')
      return { text: el.textContent, color: getComputedStyle(el).color }
    })()`)

  it('shows a blank pane as an empty address field with its hint, and the capsule says Ready', async () => {
    const field = await harness.dashboardEval<{ value: string; placeholder: string }>(
      `(() => { const el = document.querySelector('.url-input'); return { value: el.value, placeholder: el.placeholder } })()`,
    )
    expect(field).toEqual({ value: '', placeholder: 'Enter address or search' })
    expect((await pill()).text).toBe('Ready')
  })

  it('holds the address field and the back/forward controls still while a page loads, and a Stop reads Stopped in a neutral colour', async () => {
    const still = await clusterGeometry()
    expect(await harness.submitCommand(`navigate ${harness.fixture.url('/held-response')}`)).toBe('submitted')
    await waitFor(async () => ((await loading()) ? true : undefined), { timeoutMs: 5_000, intervalMs: 50 })
    expect(await clusterGeometry()).toEqual(still)

    await harness.overlayEval(`window.bingbong.assistant.abort()`)
    await waitFor(async () => ((await loading()) ? undefined : true), { timeoutMs: 5_000, intervalMs: 50 })
    expect(await clusterGeometry()).toEqual(still)
    const stopped = await waitFor(async () => {
      const shown = await pill()
      return shown.text === 'Stopped' ? shown : undefined
    }, { timeoutMs: 5_000, intervalMs: 50 })
    // Red is the failure colour (#329); a Stop is the user's own act.
    expect(stopped.color).not.toBe('rgb(255, 59, 48)')
    expect(stopped.color).not.toBe('rgb(255, 69, 58)')
    await harness.overlayEval(`window.bingbong.feedPanel.toggle()`)
  })

  it('keeps the collapsed edge tab on the right edge, vertically centred, at every window width', async () => {
    await waitFor(async () => (await harness.overlayEval<boolean>(`!!document.querySelector('.feed-edge-tab')`)) || undefined, {
      timeoutMs: 10_000,
      intervalMs: 100,
    })
    // A colour nothing else on screen draws, so the composite shows where the view really is.
    await harness.overlayEval(`document.querySelector('.feed-edge-tab').style.cssText = 'background: #ff00ff !important; border: none !important; box-shadow: none !important; color: #ff00ff !important'`)

    for (const width of [1280, 760, 600, 520, 480, 1280]) {
      await harness.dashboardEval(`window.resizeTo(${width}, 760)`)
      await waitFor(async () => ((await harness.dashboardEval<number>(`innerWidth`)) === width ? true : undefined), {
        timeoutMs: 5_000,
        intervalMs: 50,
      })
      // Let main move the view and the compositor draw it.
      await sleep(400)
      const workspace = await workspaceOnScreen()
      const tab = magentaOnScreen()
      expect(tab, `edge tab at ${width} px`).not.toBeNull()
      expect(Math.abs(tab!.right - workspace.right), `edge tab's right edge at ${width} px`).toBeLessThanOrEqual(1)
      const tabMiddle = (tab!.top + tab!.bottom) / 2
      const workspaceMiddle = (workspace.top + workspace.bottom) / 2
      expect(Math.abs(tabMiddle - workspaceMiddle), `edge tab centred at ${width} px`).toBeLessThanOrEqual(2)
    }
  })

  it('hides the panel while settings shows, settings fully visible, and restores it as it was', async () => {
    await harness.dashboardEval(`window.resizeTo(1280, 760)`)
    await harness.ensurePanelOpen()
    await harness.overlayEval(`(() => {
      window.bingbong.feedPanel.setMode('docked')
      window.bingbong.feedPanel.setWidth(500)
    })()`)
    const before = await waitFor(
      async () => {
        const state = await harness.dashboardEval<{ mode: string; open: boolean; width: number }>(`window.bingbong.feedPanel.getState()`)
        const viewWidth = await harness.overlayEval<number>(`innerWidth`)
        return state.mode === 'docked' && state.width === 500 && viewWidth === 500 ? state : undefined
      },
      { timeoutMs: 5_000, intervalMs: 100 },
    )
    // A hidden view keeps its last viewport size, so only the composite tells shown from hidden.
    await harness.overlayEval(`(() => {
      const surface = document.querySelector('.feed-surface')
      surface.style.cssText += '; background: #ff00ff !important; border: none !important; box-shadow: none !important'
      surface.querySelector('.feed').style.visibility = 'hidden'
    })()`)
    const panelBox = async (): Promise<Box | null> => {
      await sleep(400)
      return magentaOnScreen()
    }
    const shown = await panelBox()
    const workspace = await workspaceOnScreen()
    expect(shown).not.toBeNull()
    // The view is 500 px; the panel in it keeps the window's 16 px gutter on its right (ADR 0078).
    expect(shown!.right - shown!.left).toBe(484)
    expect(Math.abs(workspace.right - 16 - shown!.right)).toBeLessThanOrEqual(1)

    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)) || undefined, {
      timeoutMs: 5_000,
      intervalMs: 100,
    })
    // The panel is gone and the settings page has the whole workspace.
    expect(await panelBox()).toBeNull()
    const layout = await harness.dashboardEval<{ page: number; workspace: number; overflowing: number }>(`(() => {
      const page = document.querySelector('.settings-page').getBoundingClientRect()
      const workspace = document.querySelector('.dashboard-workspace').getBoundingClientRect()
      const overflowing = [...document.querySelectorAll('.settings-page input, .settings-page select, .settings-page p')]
        .filter((el) => el.getBoundingClientRect().right > page.right + 0.5).length
      return { page: page.width, workspace: workspace.width, overflowing }
    })()`)
    expect(layout.page).toBe(layout.workspace)
    expect(layout.overflowing).toBe(0)
    // Hiding is not a change of the panel's state.
    expect(await harness.dashboardEval(`window.bingbong.feedPanel.getState()`)).toEqual(before)

    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)) || undefined, {
      timeoutMs: 5_000,
      intervalMs: 100,
    })
    expect(await panelBox()).toEqual(shown)
    expect(await harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--open')`)).toBe(true)
    expect(await harness.dashboardEval(`window.bingbong.feedPanel.getState()`)).toEqual(before)
  })
})
