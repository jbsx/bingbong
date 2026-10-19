import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'
import { OWNER_BODY, standInWeighIns, weighInsFile } from './weighIns'

// The Idle Screen's Last Page (CONTEXT.md): a profile that remembers a page
// boots into the idle screen naming it, and the card's tap runs `resume` —
// the pane boots blank after a restart, so the Command navigates there.
// The page the pane then shows is recorded for the next restart. The News
// card shows the Top Repos a previous run read (repos.json, read this hour
// so GitHub is not asked), and a tap on one opens it in the pane.

describe('idle screen e2e: the Last Page and resume', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-'))
    fixture = await startFixtureServer()
    // The Top Repos a previous run read, each linking to a fixture page; the second has no summary yet, so it shows its description.
    const repo = (name: string, link: string, stars: number, starsThisMonth: number, description: string) => ({ name, link, description, language: 'TypeScript', stars, starsThisMonth })
    await writeFile(
      join(userDataDir, 'repos.json'),
      `${JSON.stringify({
        fetchedAt: Date.now(),
        repos: [
          repo('acme/voice', fixture.url('/second'), 77289, 42036, 'A voice studio.'),
          repo('acme/memory', fixture.url('/interactive'), 51625, 27550, 'Agent memory that learns'),
          repo('acme/paperclip', fixture.url('/'), 104655, 23340, 'Manage agents at work'),
        ],
        summaries: { 'acme/voice': 'Fully local voice cloning, dubbing and transcription.', 'acme/paperclip': 'Runs teams of AI agents toward business goals.' },
      })}\n`,
      'utf8',
    )
    // The Last Page a previous run left behind.
    await writeFile(
      join(userDataDir, 'last-page.json'),
      `${JSON.stringify({ url: fixture.url('/second'), title: 'Second fixture page', at: 1 })}\n`,
      'utf8',
    )
    // Stand-in Weigh-ins (#350) and the owner's Body Profile, for the Weight card.
    await writeFile(join(userDataDir, 'weighins.json'), weighInsFile(standInWeighIns()), 'utf8')
    await writeFile(join(userDataDir, 'settings.json'), `${JSON.stringify({ body: OWNER_BODY })}\n`, 'utf8')
    harness = await startHarness({
      userDataDir,
      fixture,
      wakeFromBootIdle: false,
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('shows this month on the idle screen with today marked, and no events with no source wired', async () => {
    const month = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.idle-cal-month')?.textContent ?? ''`)
        return text !== '' ? text : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    const expected = await harness.dashboardEval<{ month: string; day: string }>(
      `({ month: new Date().toLocaleDateString([], { month: 'long' }), day: String(new Date().getDate()) })`,
    )
    expect(month).toBe(expected.month)
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-cal [aria-current="date"] .idle-cal-num')?.textContent ?? ''`)).toBe(expected.day)
    // Bank holidays are the only entries a day can hold with no source wired.
    expect(
      await harness.dashboardEval<number>(`document.querySelectorAll('.idle-cal-entry:not(.idle-cal-entry--holiday), .idle-cal-more, .idle-upnext').length`),
    ).toBe(0)
  })

  it('lays the pinned cards out in Card Slots, every tile holding its words inside the window', async () => {
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-slot[data-card="news"] .idle-news')`)) ? true : undefined), {
      timeoutMs: 10000,
      intervalMs: 250,
    })
    const geometry = await harness.dashboardEval<{ cards: string[]; overflowing: string[] }>(`(() => {
      const screen = document.querySelector('.idle-screen').getBoundingClientRect()
      const tiles = [...document.querySelectorAll('.idle-screen .idle-card, .idle-screen .idle-tile--bare')]
      return {
        cards: [...document.querySelectorAll('.idle-slot')].map((slot) => slot.dataset.card),
        overflowing: tiles
          .filter((tile) => {
            const rect = tile.getBoundingClientRect()
            return tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1 || rect.right > screen.right + 1 || rect.bottom > screen.bottom + 1
          })
          .map((tile) => (tile.closest('.idle-slot')?.dataset.card ?? 'dock') + ' ' + tile.className),
      }
    })()`)
    // The default pins, in order; the usage card is there only when the dashboard answers or fails, the weather only once its city is set.
    expect(geometry.cards.filter((card) => card !== 'usage')).toEqual(['weather', 'calendar', 'lastPage', 'weight', 'news'])
    expect(geometry.overflowing).toEqual([])
  })

  it('shows the Weight card from the stand-in Weigh-ins: the weight, its week’s change, the body fat and the 30-day trend (#350)', async () => {
    const card = await harness.dashboardEval<{ text: string; box: string; trendDots: number }>(`(() => {
      const slot = document.querySelector('.idle-slot[data-card="weight"]')
      return {
        text: slot.querySelector('.weight-card').textContent,
        box: slot.style.gridColumn + '|' + slot.style.gridRow,
        trendDots: slot.querySelectorAll('.weight-chart-dot').length,
      }
    })()`)
    // A 1×2 Card Slot: where it lands depends on the cards around it (the weather is unset here).
    expect(card.box).toMatch(/span 1\|\d+ \/ span 2$/)
    expect(card.text).toContain('81.25')
    expect(card.text).toMatch(/[−+]\d+(\.\d+)? kg · 7 days/)
    expect(card.text).toMatch(/Body fat \d+\.\d%/)
    expect(card.trendDots).toBe(30)
  })

  it('names the Last Page on the idle screen, and a tap reopens it in the blank pane', async () => {
    const title = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.idle-last-page-title')?.textContent ?? ''`)
        return text !== '' ? text : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(title).toBe('Second fixture page')
    // The pane boots blank: the restart lost the page.
    expect(await harness.paneUrl()).not.toBe(fixture.url('/second'))

    await harness.clickDashboardElement('.idle-last-page')

    // The tap woke the dashboard and the `resume` Command navigated to the page.
    expect(await harness.waitForPaneUrl(fixture.url('/second'))).toBe(fixture.url('/second'))
    await waitFor(
      async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)) ? true : undefined),
      { timeoutMs: 10000, intervalMs: 250 },
    )
  })

  it('records the page the pane shows as the Last Page for the next restart', async () => {
    await harness.navigatePane(fixture.url('/'))

    const recorded = await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'last-page.json'), 'utf8').catch(() => undefined)
        if (!raw) return undefined
        const page = JSON.parse(raw) as { url?: string }
        return page.url === fixture.url('/') ? page : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(recorded.url).toBe(fixture.url('/'))
  })

  it('shows the Top Repos — name, summary or description, stars in all — and a tap opens one in the pane', async () => {
    const IDLE_SHORTCUT = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ }
    await harness.pressKey('pane', IDLE_SHORTCUT)
    const rows = await waitFor(
      async () => {
        const found = await harness.dashboardEval<{ name: string; line: string; stars: string; gain: string; language: string }[]>(
          `[...document.querySelectorAll('.idle-slot[data-card="news"] .idle-repo')].filter((row) => !row.closest('li').hidden).map((row) => ({ name: row.querySelector('.idle-repo-name').textContent, line: row.querySelector('.idle-repo-line')?.textContent ?? '', stars: row.querySelector('.idle-repo-stars').textContent, gain: row.querySelector('.idle-repo-gain').textContent, language: row.querySelector('.idle-repo-language')?.textContent ?? '' }))`,
        )
        return found.length > 0 ? found : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(rows).toEqual([
      { name: 'acme/voice', line: 'Fully local voice cloning, dubbing and transcription.', stars: '★ 77.3k', gain: '+42kthis month', language: 'TypeScript' },
      { name: 'acme/memory', line: 'Agent memory that learns', stars: '★ 51.6k', gain: '+27.6kthis month', language: 'TypeScript' },
      { name: 'acme/paperclip', line: 'Runs teams of AI agents toward business goals.', stars: '★ 104.7k', gain: '+23.3kthis month', language: 'TypeScript' },
    ])
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-repos .idle-kicker').textContent`)).toBe('Top repos this month')

    // The usage card lands after the first layout and moves the cards: the row is tapped once it has landed and the row holds still.
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-slot[data-card="usage"]')`)) ? true : undefined), { timeoutMs: 15000, intervalMs: 250 })
    const rowAt = (): Promise<string> => harness.dashboardEval<string>(`(() => { const r = document.querySelector('.idle-repos li:nth-child(2) .idle-repo').getBoundingClientRect(); return r.x + ',' + r.y })()`)
    let last = ''
    await waitFor(
      async () => {
        const at = await rowAt()
        const still = at === last
        last = at
        return still ? true : undefined
      },
      { timeoutMs: 10000, intervalMs: 500 },
    )
    await harness.clickDashboardElement('.idle-repos li:nth-child(2) .idle-repo')

    expect(await harness.waitForPaneUrl(fixture.url('/interactive'))).toBe(fixture.url('/interactive'))
    await waitFor(
      async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input') && !document.querySelector('.idle-screen')`)) ? true : undefined),
      { timeoutMs: 10000, intervalMs: 250 },
    )
  })

  it('Ctrl+Shift+L shows the idle screen at once, from the pane or the dashboard', async () => {
    const IDLE_SHORTCUT = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ }
    const idleShown = (): Promise<true> =>
      waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    const dashboardShown = (): Promise<true> =>
      waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })

    // Awake, with the idle timeout minutes away: only the shortcut can bring the idle screen now.
    await dashboardShown()
    await harness.pressKey('pane', IDLE_SHORTCUT)
    expect(await idleShown()).toBe(true)

    await harness.clickDashboardElement('.idle-screen')
    await dashboardShown()
    await harness.pressKey('dashboard', IDLE_SHORTCUT)
    expect(await idleShown()).toBe(true)
  })

  it('typing on the idle screen wakes it into the Prompt Bar, the panel opened, from the pane or the dashboard', async () => {
    const IDLE_SHORTCUT = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ }
    const idleShown = (): Promise<true> =>
      waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    const draftIs = (text: string): Promise<true> =>
      waitFor(
        async () => ((await harness.overlayEval<string>(`document.querySelector('.prompt-input')?.value ?? ''`)) === text ? true : undefined),
        { timeoutMs: 5000, intervalMs: 100 },
      )
    const panelOpen = (): Promise<boolean> => harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--open')`)

    for (const target of ['pane', 'dashboard'] as const) {
      if (await panelOpen()) await harness.clickOverlayElement('[aria-label="Collapse the feed panel"]')
      // Clear the last round's draft through the native setter, so React hears the change.
      await harness.overlayEval(
        `(() => { const input = document.querySelector('.prompt-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })()`,
      )
      await harness.pressKey(target, IDLE_SHORTCUT)
      expect(await idleShown()).toBe(true)

      await harness.pressKey(target, { key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71 })

      expect(await draftIs('g')).toBe(true)
      expect(await panelOpen()).toBe(true)
      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
    }
  })
})
