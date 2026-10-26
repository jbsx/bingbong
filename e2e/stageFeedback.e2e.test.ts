import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'
import { STUCK_STAGE_MS } from '../src/core/pipeline/runProgress'

// The stages a Command passes through (#428): the Status Capsule says
// "Thinking…" from the moment a line is taken, before any Command is read,
// and on the Idle Screen too — never "Ready" while a slow reading is under
// way, never nothing. The scripted stand-in holds its reading long enough
// to watch, past the stuck-stage bound.

const LINE = 'what a lovely day'
const HELD_MS = 6_500

describe('stage feedback e2e (#428): the Capsule over the Idle Screen while a line is read', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({
      wakeFromBootIdle: false,
      launchArgs: ['--mute-audio'],
      env: decisionScript(readingOf(LINE, 'none', { delayMs: HELD_MS })),
    })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  const idleUp = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const capsule = (): Promise<{ pill: string; hint: string } | null> =>
    harness.dashboardEval(`(() => {
      const pill = document.querySelector('.idle-screen .idle-status .status-pill')
      if (!pill) return null
      return { pill: pill.textContent ?? '', hint: document.querySelector('.idle-screen .idle-status .run-hint')?.textContent ?? '' }
    })()`)

  it('shows "Thinking…" with the heard words and its own seconds while the line is read, then names the stuck stage', async () => {
    await waitFor(async () => ((await idleUp()) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    expect(await capsule()).toBeNull()

    await harness.pressKey('dashboard', { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, text: 'w' })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`document.activeElement?.classList.contains('idle-prompt-input') === true`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 50 })
    await harness.typeIntoDashboard(LINE.slice(1))
    await harness.pressKey('dashboard', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })

    const thinking = await waitFor(async () => {
      const shown = await capsule()
      return shown?.pill === 'Thinking…' ? shown : undefined
    }, { timeoutMs: 3000, intervalMs: 50 })
    expect(thinking.hint).toMatch(new RegExp(`^“${LINE}” · \\ds$`))
    expect(await idleUp()).toBe(true)

    const stuck = await waitFor(async () => {
      const shown = await capsule()
      return shown?.hint.includes('still thinking') === true ? shown : undefined
    }, { timeoutMs: 8000, intervalMs: 100 })
    expect(stuck.pill).toBe('Thinking…')
    // Past thinking's own bound (#442), never before it.
    expect(stuck.hint).toMatch(/still thinking · \d+s$/)
    expect(Number(/(\d+)s$/.exec(stuck.hint)?.[1])).toBeGreaterThanOrEqual(Math.floor(STUCK_STAGE_MS.thinking! / 1000))
    // The screen never names the model that decides.
    expect(`${stuck.pill} ${stuck.hint}`).not.toMatch(/jev|decision/i)

    // Read as no Command: the line ends, the Capsule goes, the Idle Screen stays.
    expect(await waitFor(async () => ((await capsule()) === null ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })).toBe(true)
    expect(await idleUp()).toBe(true)
  })
})

// The narrated wait (#438): a slow navigate's Capsule says the Feed's stage
// word and the host, never the raw line, its seconds climbing; Run never
// moves when Stop shows; and thirty Commands in the panel shift its layout
// by under 0.05 in all.
describe('narrated wait e2e (#438): stage words in the Capsule, no layout shift in the panel', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ launchArgs: ['--mute-audio'] })
  })

  afterAll(async () => {
    await harness?.quit()
  })

  const capsule = (): Promise<{ pill: string; hint: string }> =>
    harness.dashboardEval(`(() => ({
      pill: document.querySelector('.toolbar .status-pill')?.textContent ?? '',
      hint: document.querySelector('.toolbar .run-hint')?.textContent ?? '',
    }))()`)
  const runBox = (): Promise<string> => harness.overlayEval(`JSON.stringify(document.querySelector('.prompt-verb')?.getBoundingClientRect())`)
  const promptIdle = (): Promise<true> =>
    waitFor(async () => ((await harness.overlayEval<boolean>(`!document.querySelector('.prompt-form[aria-busy]')`)) ? true : undefined), { timeoutMs: 25_000, intervalMs: 50 })

  it('a slow navigate says "Loading…" and the host, the Feed the same words, seconds climbing; Run keeps its box as Stop shows', async () => {
    await harness.ensurePanelOpen()
    // The panel opening moves Run with it: its box is read once it holds still.
    let held = ''
    const before = await waitFor(async () => {
      const box = await runBox()
      const still = box === held
      held = box
      return still ? box : undefined
    }, { timeoutMs: 5_000, intervalMs: 300 })
    expect(JSON.parse(before)).toMatchObject({ width: expect.any(Number) })
    expect(await harness.submitCommand(`navigate ${harness.fixture.url('/held-response')}`)).toBe('submitted')
    // The held page sends nothing, so its navigate never shows a first effect: it stays Acting, as "Opening…".
    const first = await waitFor(async () => {
      const shown = await capsule()
      return shown.pill === 'Opening…' && /\d+s$/.test(shown.hint) ? shown : undefined
    }, { timeoutMs: 5_000, intervalMs: 50 })
    // The stage word in the pill and the host in the hint, never the raw line.
    expect(first.hint).toMatch(/^127\.0\.0\.1 · \d+s$/)
    expect(`${first.pill} ${first.hint}`).not.toMatch(/navigate|http|acting/i)
    // The Feed's Run Detail names the same stage with the same words.
    const lines = await harness.overlayEval<string[]>(`Array.from(document.querySelectorAll('.feed-entry--stage .feed-text')).map((el) => el.textContent)`)
    expect(lines).toContain('Opening 127.0.0.1')
    expect(lines.join(' ')).not.toMatch(/Understanding|Working on the page|Waiting for the page/)
    const seconds = (hint: string): number => Number(/(\d+)s$/.exec(hint)![1])
    const later = await waitFor(async () => {
      const shown = await capsule()
      return seconds(shown.hint) >= seconds(first.hint) + 2 ? shown : undefined
    }, { timeoutMs: 5_000, intervalMs: 100 })
    expect(later.pill).toBe('Opening…')
    // Stop is up, and Run has not moved.
    expect(await harness.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`)).toBe(true)
    expect(await runBox()).toBe(before)
    await harness.overlayEval(`window.bingbong.assistant.abort()`)
    await promptIdle()
    expect(await runBox()).toBe(before)
  })

  it('thirty Commands in the panel shift its layout by under 0.05 in all; past a hundred entries, every one off screen is skipped', async () => {
    await harness.navigatePane(harness.fixture.url('/story'))
    await harness.ensurePanelOpen()
    await harness.overlayEval(`(() => {
      window.__shift = { sum: 0, sources: [] }
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue
          window.__shift.sum += entry.value
          window.__shift.sources.push(entry.value.toFixed(3) + ' ' + (entry.sources ?? []).map((source) => (source.node?.className ?? '?') + ' ' + Math.round(source.previousRect.y) + '>' + Math.round(source.currentRect.y)).join(' | '))
        }
      }).observe({ type: 'layout-shift' })
    })()`)
    for (let index = 0; index < 30; index++) {
      expect(await harness.submitCommand(index % 2 === 0 ? 'scroll down' : 'scroll up')).toBe('submitted')
      await promptIdle()
    }
    const shift = await harness.overlayEval<{ sum: number; sources: string[] }>(`window.__shift`)
    console.log(`layout shift over 30 Commands: ${shift.sum.toFixed(4)}`)
    expect(shift.sum, shift.sources.join('\n')).toBeLessThan(0.05)
    // The Feed is not capped (owner ruling 2026-10-26): what is off screen is skipped by content-visibility, never dropped.
    for (let index = 0; index < 20; index++) {
      expect(await harness.submitCommand(index % 2 === 0 ? 'scroll down' : 'scroll up')).toBe('submitted')
      await promptIdle()
    }
    const feed = await harness.overlayEval<{ entries: number; offScreen: number; skippable: number }>(`(() => {
      const list = document.querySelector('.feed-list').getBoundingClientRect()
      const items = [...document.querySelectorAll('.feed-list > .feed-entry, .feed-list > .feed-run')]
      const off = items.filter((el) => { const box = el.getBoundingClientRect(); return box.bottom < list.top || box.top > list.bottom })
      return { entries: document.querySelectorAll('.feed-entry').length, offScreen: off.length, skippable: off.filter((el) => getComputedStyle(el).contentVisibility === 'auto').length }
    })()`)
    expect(feed.entries).toBeGreaterThanOrEqual(100)
    expect(feed.offScreen).toBeGreaterThan(0)
    expect(feed.skippable).toBe(feed.offScreen)
  })
})
