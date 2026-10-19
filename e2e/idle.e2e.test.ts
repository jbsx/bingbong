import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
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
// card reads a stand-in Hacker News front page (#346), a tap on the
// highlight or on a Big News story (#349), its picture from main's cache,
// opening it in the pane.

describe('idle screen e2e: the Last Page and resume', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string
  let hackerNews: Server

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-'))
    fixture = await startFixtureServer()
    // Hacker News's stand-in: two stories that match the default Interest Profile, each linking to a fixture page; it also serves the picture of the story in the history.
    const picture = await readFile(new URL('../src/core/news/fixtures/images/photo.jpg', import.meta.url))
    hackerNews = createServer((request, response) => {
      if (request.url === '/big-story.jpg') {
        response.writeHead(200, { 'content-type': 'image/jpeg' })
        response.end(picture)
        return
      }
      const at = Math.floor(Date.now() / 1000) - 3600
      const hits = [
        { objectID: '1', title: 'Claude Code ships a new agent harness', url: fixture.url('/second'), points: 1840, num_comments: 312, created_at_i: at },
        { objectID: '2', title: 'Codex sandboxes every coding agent', url: fixture.url('/'), points: 600, num_comments: 40, created_at_i: at },
      ]
      response.writeHead(request.url?.startsWith('/api/v1/search') ? 200 : 404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ hits }))
    })
    await new Promise<void>((resolve) => hackerNews.listen(0, '127.0.0.1', resolve))
    // A story history a previous run left behind: one story at the top of two sources yesterday, with a picture of its own.
    const dayBack = (back: number): string => {
      const now = new Date()
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12)
      return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
    }
    const big = { title: 'A big story from yesterday', link: fixture.url('/interactive'), source: 'Hacker News', unit: 'points', topical: true, cluster: 'Hacker News:big', image: 'https://example.com/big-story.jpg' }
    await writeFile(
      join(userDataDir, 'news.json'),
      `${JSON.stringify({ shown: [], history: {}, highlight: null, stories: { 'Hacker News:big': { ...big, days: { [dayBack(1)]: { score: 1.5, magnitude: 2400 } } } } })}\n`,
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
      env: { BINGBONG_NEWS_FIXTURE: `http://127.0.0.1:${(hackerNews.address() as AddressInfo).port}` },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await new Promise((resolve) => hackerNews?.close(resolve))
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

  it('shows Today’s Highlight from Hacker News, and a tap opens the story in the pane', async () => {
    const IDLE_SHORTCUT = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ }
    await harness.pressKey('pane', IDLE_SHORTCUT)
    const card = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.idle-slot[data-card="news"] .idle-news')?.textContent ?? ''`)
        return text !== '' ? text : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(card).toContain('Claude Code ships a new agent harness')
    expect(card).toContain('Hacker News')
    expect(card).toContain('1,840 points')
    // Shown once, it is marked so in the profile for the next restart.
    const state = JSON.parse(await readFile(join(userDataDir, 'news.json'), 'utf8')) as { shown: { key: string }[] }
    expect(state.shown.map((entry) => entry.key)).toEqual(['Hacker News:1'])

    await harness.clickDashboardElement('.idle-news-today')

    expect(await harness.waitForPaneUrl(fixture.url('/second'))).toBe(fixture.url('/second'))
    await waitFor(
      async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input') && !document.querySelector('.idle-screen')`)) ? true : undefined),
      { timeoutMs: 10000, intervalMs: 250 },
    )
  })

  it('lists Big News under the highlight with its picture from main’s cache, and a tap on the story opens it in the pane', async () => {
    const IDLE_SHORTCUT = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ }
    await harness.pressKey('pane', IDLE_SHORTCUT)
    const big = await waitFor(
      async () => {
        const rows = await harness.dashboardEval<{ title: string; picture: string; loaded: boolean }[]>(
          `[...document.querySelectorAll('.idle-news-big .idle-news-item')].map((item) => ({ title: item.querySelector('.idle-news-item-title').textContent, picture: item.querySelector('.idle-news-thumb img')?.src ?? '', loaded: (item.querySelector('.idle-news-thumb img')?.naturalWidth ?? 0) > 0 }))`,
        )
        return rows.length > 0 && rows.every((row) => row.loaded) ? rows : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    // The Codex story is no bigger than an ordinary day's on a two-story front page: it clears no bar.
    expect(big.map((row) => row.title)).toEqual(['A big story from yesterday'])
    expect(big[0].picture).toMatch(/^bingbong-news:\/\/image\/[0-9a-f]+\.jpg$/)
    expect(await readdir(join(userDataDir, 'news-images'))).toHaveLength(1)

    await harness.clickDashboardElement('.idle-news-big .idle-news-item')

    expect(await harness.waitForPaneUrl(fixture.url('/interactive'))).toBe(fixture.url('/interactive'))
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
