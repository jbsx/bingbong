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
    // "Tue · October 2026": the weekday, the month and the year beside today's date.
    expect(month).toContain(expected.month)
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-cal-today')?.textContent ?? ''`)).toBe(expected.day)
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-cal [aria-current="date"] .idle-cal-num')?.textContent ?? ''`)).toBe(expected.day)
    // No source wired: no entries under the weeks and no Up Next line.
    expect(await harness.dashboardEval<number>(`document.querySelectorAll('.idle-cal-entry, .idle-upnext').length`)).toBe(0)
  })

  it('puts each pinned card in its home Column and the Last Page in a Clock Line, every card holding its words inside the window', async () => {
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-home[data-card="news"] .idle-news')`)) ? true : undefined), {
      timeoutMs: 10000,
      intervalMs: 250,
    })
    const geometry = await harness.dashboardEval<{ cards: string[]; lines: string; overflowing: string[] }>(`(() => {
      const screen = document.querySelector('.idle-screen').getBoundingClientRect()
      const tiles = [...document.querySelectorAll('.idle-screen .idle-card, .idle-screen .idle-line')]
      return {
        cards: [...document.querySelectorAll('.idle-home')].map((home) => home.closest('.idle-col').className.replace(/.*idle-col--/, '') + ' ' + home.dataset.card),
        lines: document.querySelector('.idle-lines').dataset.lines,
        overflowing: tiles
          .filter((tile) => {
            const rect = tile.getBoundingClientRect()
            return tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1 || rect.right > screen.right + 1 || rect.bottom > screen.bottom + 1
          })
          .map((tile) => (tile.closest('.idle-home')?.dataset.card ?? 'lines') + ' ' + tile.className),
      }
    })()`)
    // The default pins in their homes; the usage card is there only when the dashboard answers or fails. The weather is unset
    // here, so its home holds its line.
    expect(geometry.cards.filter((card) => card !== 'middle usage')).toEqual(['left weather', 'right calendar', 'right weight', 'right news'])
    expect(geometry.lines).toBe('voice lastPage')
    expect(geometry.overflowing).toEqual([])
  })

  it('shows the Weight card from the stand-in Weigh-ins: the weight, its change, the body fat and the 30-day trend (#350)', async () => {
    const card = await harness.dashboardEval<{ text: string; form: string; trendDots: number }>(`(() => {
      const home = document.querySelector('.idle-home[data-card="weight"]')
      return {
        text: home.querySelector('.weight-card').textContent,
        form: home.dataset.form,
        trendDots: home.querySelectorAll('.weight-chart-dot').length,
      }
    })()`)
    // Under the Calendar in the right Column, in its full form: the change an arrow and its size, what it is against under the line.
    expect(card.form).toBe('full')
    expect(card.text).toContain('81.25')
    expect(card.text).toMatch(/[▼▲] \d+\.\d\d|±0/)
    expect(card.text).toContain('Δ since the last Weigh-in')
    expect(card.text).toMatch(/\d+\.\d% fat/)
    expect(card.trendDots).toBe(30)
  })

  it('hides the cursor once it lies still over the idle screen, and a move brings it back without waking it', async () => {
    const cursor = () => harness.dashboardEval<{ hidden: boolean; card: string; up: boolean }>(`({
      hidden: document.documentElement.classList.contains('cursor-hidden'),
      card: getComputedStyle(document.querySelector('.idle-cal')).cursor,
      up: !!document.querySelector('.idle-screen'),
    })`)
    // Still since boot: hidden over everything, a card's own pointer too.
    await waitFor(async () => ((await cursor()).hidden ? true : undefined), { timeoutMs: 8000, intervalMs: 200 })
    expect((await cursor()).card).toBe('none')
    // A move shows it at once and leaves the screen up.
    await harness.moveDashboardMouse(300, 300)
    await harness.moveDashboardMouse(320, 310)
    const moved = await waitFor(async () => {
      const state = await cursor()
      return state.hidden ? undefined : state
    }, { timeoutMs: 2000, intervalMs: 50 })
    expect(moved.card).not.toBe('none')
    expect(moved.up).toBe(true)
    // Still again: hidden again.
    await waitFor(async () => ((await cursor()).hidden ? true : undefined), { timeoutMs: 8000, intervalMs: 200 })
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
          `[...document.querySelectorAll('.idle-home[data-card="news"] .idle-repo')].filter((row) => !row.closest('li').hidden).map((row) => ({ name: row.querySelector('.idle-repo-name').textContent, line: row.querySelector('.idle-repo-line')?.textContent ?? '', stars: row.querySelector('.idle-repo-stars').textContent, gain: row.querySelector('.idle-repo-gain').textContent, language: row.querySelector('.idle-repo-language')?.textContent ?? '' }))`,
        )
        return found.length > 0 ? found : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(rows).toEqual([
      { name: 'acme/voice', line: 'Fully local voice cloning, dubbing and transcription.', stars: '★ 77.3k', gain: '+42.0kthis month', language: 'TypeScript' },
      { name: 'acme/memory', line: 'Agent memory that learns', stars: '★ 51.6k', gain: '+27.6kthis month', language: 'TypeScript' },
      { name: 'acme/paperclip', line: 'Runs teams of AI agents toward business goals.', stars: '★ 104.7k', gain: '+23.3kthis month', language: 'TypeScript' },
    ])
    expect(await harness.dashboardEval<string>(`document.querySelector('.idle-repos .idle-kicker').textContent`)).toBe('Top repos ★ this month')

    // The usage card lands after the first layout and moves the cards: the row is tapped once it has landed and the row holds still.
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-home[data-card="usage"]')`)) ? true : undefined), { timeoutMs: 15000, intervalMs: 250 })
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

  it('typing on the idle screen opens the Idle Prompt over it, the Feed shut, from the pane or the dashboard (#361)', async () => {
    const IDLE_SHORTCUT = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ }
    const idleShown = (): Promise<true> =>
      waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    const promptIs = (text: string | null): Promise<true> =>
      waitFor(
        async () => ((await harness.dashboardEval<string | null>(`document.querySelector('.idle-prompt-input')?.value ?? null`)) === text ? true : undefined),
        { timeoutMs: 5000, intervalMs: 100 },
      )
    const panelOpen = (): Promise<boolean> => harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--open')`)

    for (const target of ['pane', 'dashboard'] as const) {
      if (await panelOpen()) await harness.clickOverlayElement('[aria-label="Collapse the feed panel"]')
      await harness.pressKey(target, IDLE_SHORTCUT)
      expect(await idleShown()).toBe(true)

      await harness.pressKey(target, { key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71 })

      expect(await promptIs('g')).toBe(true)
      expect(await panelOpen()).toBe(false)
      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)

      // A tap outside the Prompt closes it; the screen stays. The card sits in the scrim's middle, so the tap is at its corner.
      await harness.clickDashboardAt(8, 8)
      expect(await promptIs(null)).toBe(true)
      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
      // With a page in the pane, a tap wakes the dashboard as before.
      await harness.clickDashboardElement('.idle-screen')
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    }
  })

  it('opens settings from the idle screen, and the Toolbar’s home button or the shortcut shows the idle screen from every other view', async () => {
    const IDLE_SHORTCUT = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ }
    const shown = (selector: string): Promise<true> =>
      waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('${selector}')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    const idleShown = async (): Promise<boolean> => (await shown('.idle-screen')) && !(await harness.dashboardEval<boolean>(`!!document.querySelector('.toolbar')`))

    // From the browsing pane.
    await shown('.url-input')
    await harness.clickDashboardElement('.idle-toggle')
    expect(await idleShown()).toBe(true)

    // The idle screen's corner opens settings; the home button comes back.
    await harness.clickDashboardElement('.idle-settings')
    await shown('.settings-page[aria-label="settings"]')
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(false)
    await harness.clickDashboardElement('.idle-toggle')
    expect(await idleShown()).toBe(true)

    // From settings, the shortcut too.
    await harness.clickDashboardElement('.idle-settings')
    await shown('.settings-page[aria-label="settings"]')
    await harness.pressKey('dashboard', IDLE_SHORTCUT)
    expect(await idleShown()).toBe(true)

    // From the Weight page.
    await harness.clickDashboardElement('.weight-card-row[data-person="jaish"]')
    await shown('.weight-page')
    await harness.clickDashboardElement('.idle-toggle')
    expect(await idleShown()).toBe(true)
  })
})
