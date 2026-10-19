import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// The Idle Screen's screenshot review (`pnpm shot:idle`): the screen at the
// appliance's 1920×1080 with every card holding sample data — London's
// weather fulfilled over CDP (the renderer fetches Open-Meteo itself), a
// stand-in usage dashboard with BINGBONG_IDLE_SHOT_PROVIDERS providers
// (default 3), and with BINGBONG_IDLE_SHOT_MUSIC=1 a song playing from the
// YouTube stand-in so Now Playing takes its Card Slot — shot in dark and
// light into BINGBONG_IDLE_SHOT_DIR (default a temp folder, printed). The
// stand-in usage server also answers as Hacker News's front page, so the
// News card holds Today's Highlight (#346), and news.json is seeded with a
// fortnight's story history so This Week and This Month (#347) are full. It
// also holds every Card Slot to its box at that size, and the News card at
// 2×2, 2×1 and 1×1 in dark and light.
// Gated: BINGBONG_IDLE_SHOT=1, so the plain e2e run skips it.

const PROVIDERS = ['Codex', 'Claude', 'Kaggle', 'GLM', 'Grok']

/** Hacker News's stand-in front page: a long title — as long as a GitHub repo's with its description — that matches the default Interest Profile over shorter ones, some that do not. */
function frontPage(now: number) {
  const at = Math.floor(now / 1000) - 3 * 3600
  return {
    hits: [
      { objectID: '1', title: 'Claude Code’s new harness lets a coding agent run your whole test suite in parallel across machines, and the agents now review each other’s pull requests before a human sees them', url: 'https://example.com/harness', points: 1840, num_comments: 612, created_at_i: at },
      { objectID: '2', title: 'A history of the bread knife', url: 'https://example.com/bread', points: 2950, num_comments: 210, created_at_i: at },
      { objectID: '3', title: 'Codex now reviews every pull request before a human sees it', url: 'https://example.com/codex-review', points: 1210, num_comments: 380, created_at_i: at },
      { objectID: '4', title: 'Show HN: A terminal that remembers every command you ran', url: 'https://example.com/terminal', points: 760, num_comments: 140, created_at_i: at },
    ],
  }
}

/** The local day key a day back from now, as the News Desk writes it. */
function dayBack(back: number): string {
  const now = new Date()
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

/** A fortnight of story history: stories that lasted (polled on three days or more) and ones of a single day this week. */
function storyHistory() {
  const seeded: [string, string, number, number[]][] = [
    ['Frontier lab publishes the weights of its largest open model yet, with a 400-page report', 'https://example.com/weights', 3120, [12, 11, 10, 9]],
    ['GPT-6 benchmarks: what the new evals do and do not measure', 'https://example.com/gpt6', 2440, [8, 7, 6]],
    ['The agent harness wars: who owns the loop', 'https://example.com/harness-wars', 1980, [5, 4, 3]],
    ['Markets slide as chip export rules tighten again', 'https://example.com/chips', 1660, [13, 12, 11]],
    ['Rust in the Linux kernel, five years on', 'https://example.com/rust-kernel', 1400, [2, 1]],
    ['SQLite as the default database for agents', 'https://example.com/sqlite', 990, [4]],
  ]
  return Object.fromEntries(
    seeded.map(([title, link, points, days], index) => [
      `Hacker News:seed-${index}`,
      { title, link, source: 'Hacker News', unit: 'points', topical: true, cluster: `Hacker News:seed-${index}`, days: Object.fromEntries(days.map((back, n) => [dayBack(back), { score: 0.98 - index * 0.04 - n * 0.01, magnitude: points }])) },
    ]),
  )
}
const HOUR = 3_600_000

function usagePayload(count: number, now: number) {
  const providers = PROVIDERS.slice(0, count).map((name, index) => ({
    name,
    connected: true,
    plan: index === 1 ? 'Max 20x' : 'pro',
    windows: [
      { key: '7d', label: '7-Day', usedPct: [14, 84, 41, 22, 63][index], resetAt: now + (index + 1) * 26 * HOUR },
      ...(index === 1 ? [{ key: '7d-fable', label: '7-Day (Fable)', usedPct: 80, resetAt: now + 21 * HOUR }] : []),
    ],
  }))
  const samples = Array.from({ length: 720 }, (_, step) => ({
    sampledAt: now - step * 60_000,
    providers: providers.map((provider) => ({
      name: provider.name,
      windows: provider.windows.map((window) => ({ key: window.key, label: window.label, usedPct: Math.max(0, window.usedPct - step * 0.01) })),
    })),
  }))
  return { usage: { updatedAt: now, providers }, history: { samples } }
}

function forecast() {
  const day = (offset: number): string => {
    const at = new Date(Date.now() + offset * 24 * HOUR)
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  }
  const hours = Array.from({ length: 48 }, (_, hour) => `${day(hour < 24 ? 0 : 1)}T${String(hour % 24).padStart(2, '0')}:00`)
  const nowHour = new Date().getHours()
  return {
    current: { time: `${day(0)}T${String(nowHour).padStart(2, '0')}:00`, temperature_2m: 11.2, weather_code: 61, is_day: 1 },
    daily: {
      time: [day(0), day(1), day(2), day(3)],
      temperature_2m_max: [14.2, 13.1, 15.6, 12.4],
      temperature_2m_min: [9.6, 7.8, 8.9, 6.2],
      precipitation_probability_max: [69, 40, 10, 85],
      sunrise: [`${day(0)}T07:31`, `${day(1)}T07:33`, `${day(2)}T07:35`, `${day(3)}T07:36`],
      sunset: [`${day(0)}T17:58`, `${day(1)}T17:56`, `${day(2)}T17:54`, `${day(3)}T17:52`],
      weather_code: [61, 3, 1, 63],
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, hour) => 9 + Math.round(4 * Math.sin((hour - 9) / 4))),
      weather_code: hours.map((_, hour) => [61, 61, 3, 3, 2, 1][hour % 6]),
      precipitation_probability: hours.map((_, hour) => [69, 56, 34, 10, 0, 0][hour % 6]),
      is_day: hours.map((_, hour) => (hour % 24 >= 8 && hour % 24 < 18 ? 1 : 0)),
    },
  }
}

describe.skipIf(!process.env.BINGBONG_IDLE_SHOT)('idle screen screenshot review', () => {
  let harness: Harness
  let server: Server
  let userDataDir: string
  let session: string
  let fixture: FixtureServer | undefined
  const music = process.env.BINGBONG_IDLE_SHOT_MUSIC === '1'
  const outDir = process.env.BINGBONG_IDLE_SHOT_DIR ?? join(tmpdir(), 'bingbong-idle-shot')
  const count = Math.min(PROVIDERS.length, Math.max(1, Number(process.env.BINGBONG_IDLE_SHOT_PROVIDERS ?? 3)))

  beforeAll(async () => {
    server = createServer((request, response) => {
      const payload = usagePayload(count, Date.now())
      const body = request.url?.startsWith('/api/history')
        ? payload.history
        : request.url?.startsWith('/api/usage')
          ? payload.usage
          : request.url?.startsWith('/api/v1/search')
            ? frontPage(Date.now())
            : null
      response.writeHead(body === null ? 404 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body ?? {}))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-shot-'))
    await writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ weather: { city: 'London', units: 'metric' }, usageDashboard: { url: `http://127.0.0.1:${port}`, providers: PROVIDERS.slice(0, count) } }),
      'utf8',
    )
    await writeFile(join(userDataDir, 'news.json'), `${JSON.stringify({ shown: [], history: {}, highlight: null, stories: storyHistory() })}\n`, 'utf8')
    await writeFile(join(userDataDir, 'last-page.json'), `${JSON.stringify({ url: 'https://duckduckgo.com/?q=weather+in+london', title: 'weather in London at DuckDuckGo', at: 1 })}\n`, 'utf8')
    if (music) {
      fixture = await startFixtureServer()
      harness = await startHarness({
        userDataDir,
        fixture,
        wakeFromBootIdle: false,
        launchArgs: ['--browser-cli', '--mute-audio'],
        pipeStdio: true,
        env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, BINGBONG_NEWS_FIXTURE: `http://127.0.0.1:${port}` },
      })
      await harness.waitForCliOutput(/bingbong browser harness/)
    } else {
      harness = await startHarness({ userDataDir, wakeFromBootIdle: false, env: { BINGBONG_NEWS_FIXTURE: `http://127.0.0.1:${port}` } })
    }

    const { sessionId } = await harness.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: harness.dashboardTargetId(), flatten: true })
    session = sessionId
    harness.cdp.on('Fetch.requestPaused', (params) => {
      const { requestId, request } = params as { requestId: string; request: { url: string } }
      const body = request.url.includes('geocoding') ? { results: [{ name: 'London', latitude: 51.5, longitude: -0.12 }] } : forecast()
      void harness.cdp.send(
        'Fetch.fulfillRequest',
        {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'content-type', value: 'application/json' },
            { name: 'access-control-allow-origin', value: '*' },
          ],
          body: Buffer.from(JSON.stringify(body)).toString('base64'),
        },
        session,
      )
    })
    await harness.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*open-meteo.com*' }] }, session)
    await harness.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, session)
    await harness.cdp.send('Page.reload', {}, session)
    await waitFor(
      async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.wx-card') && !!document.querySelector('.usage-card') && !!document.querySelector('.idle-news')`)) ? true : undefined),
      { timeoutMs: 20000, intervalMs: 250 },
    )
    if (music) {
      await cli(harness, 'play fixture song', /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-slot .idle-music')`)) ? true : undefined), {
        timeoutMs: 15000,
        intervalMs: 250,
      })
    }
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await new Promise((resolve) => server?.close(resolve))
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('holds every card inside its Card Slot and the Card Slots above the strip at 1920×1080, the event-less Calendar beside the News card', async () => {
    const geometry = await harness.dashboardEval<{ overflowing: string[]; middleBottom: number; stripTop: number; cards: string[] }>(`(() => {
      const overflowing = [...document.querySelectorAll('.idle-slot > .idle-card')]
        .filter((card) => card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1)
        .map((card) => card.closest('.idle-slot').dataset.card + ' ' + card.scrollHeight + '>' + card.clientHeight)
      return {
        overflowing,
        middleBottom: document.querySelector('.idle-screen-middle').getBoundingClientRect().bottom,
        stripTop: document.querySelector('.idle-screen-bottom').getBoundingClientRect().top,
        cards: [...document.querySelectorAll('.idle-slot')].map((slot) => slot.dataset.card),
      }
    })()`)
    expect(geometry.overflowing).toEqual([])
    expect(geometry.cards).toEqual(expect.arrayContaining(['weather', 'usage', 'calendar', 'news']))
    expect(geometry.middleBottom).toBeLessThanOrEqual(geometry.stripTop)
  })

  it('holds the News card to its box at 2×2, 2×1 and 1×1', async () => {
    await mkdir(outDir, { recursive: true })
    // The grid gives News the box its sizes allow; each size is forced on its slot in turn, the card choosing its horizons by container query.
    const sizes: [number, number, string[]][] = [
      [2, 2, ['This week', 'This month']],
      [2, 1, ['This week']],
      [1, 1, []],
    ]
    for (const scheme of ['dark', 'light']) {
      await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session)
      for (const [w, h, lists] of sizes) {
        // A 2-row box starts on the top row wherever the grid put the card, the cards it lands on hidden; the card refits its words a frame after the resize.
        await harness.dashboardEval(`(() => {
              for (const other of document.querySelectorAll('.idle-slot:not([data-card="news"])')) other.style.visibility = 'hidden'
              const slot = document.querySelector('.idle-slot[data-card="news"]')
              slot.dataset.origin ??= slot.style.gridColumn + '|' + slot.style.gridRow
              const [column, row] = slot.dataset.origin.split('|').map((span) => span.split(' / ')[0])
              slot.style.gridColumn = column + ' / span ${w}'
              slot.style.gridRow = (${h} === 2 ? '1' : row) + ' / span ${h}'
            })()`)
        await new Promise((resolve) => setTimeout(resolve, 300))
        const box = await harness.dashboardEval<{ overflowing: string[]; lists: string[]; items: number; width: number; height: number; x: number; y: number; title: string }>(`(() => {
              const card = document.querySelector('.idle-slot[data-card="news"] .idle-news')
              const rect = card.getBoundingClientRect()
              const today = card.querySelector('.idle-news-today').getBoundingClientRect()
              const title = card.querySelector('.idle-news-title').getBoundingClientRect()
              const figure = card.querySelector('.idle-news-figure').getBoundingClientRect()
              const overflowing = []
              if (card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1) overflowing.push('card')
              if (figure.bottom > today.bottom + 1 || title.bottom > figure.top + 1) overflowing.push('highlight')
              if (card.querySelector('.idle-news-today').dataset.fit === 'over') overflowing.push('highlight clamped')
              const shown = [...card.querySelectorAll('.idle-news-list')].filter((list) => list.checkVisibility())
              for (const list of shown) {
                const box = list.getBoundingClientRect()
                if (box.bottom > rect.bottom + 1 || box.right > rect.right + 1) overflowing.push(list.getAttribute('aria-label'))
                const rows = list.querySelector('ol')
                const cut = [...rows.children].filter((row) => !row.hidden && row.getBoundingClientRect().bottom > rows.getBoundingClientRect().bottom + 1)
                if (cut.length > 0) overflowing.push(list.getAttribute('aria-label') + ' row cut')
              }
              return {
                overflowing,
                lists: shown.map((list) => list.getAttribute('aria-label')),
                items: shown.reduce((sum, list) => sum + [...list.querySelectorAll('li')].filter((row) => !row.hidden).length, 0),
                width: rect.width, height: rect.height, x: rect.x, y: rect.y,
                title: card.querySelector('.idle-news-title').textContent,
              }
            })()`)
        expect(box.overflowing, `${w}×${h} ${scheme}`).toEqual([])
        expect(box.lists, `${w}×${h}`).toEqual(lists)
        if (lists.length > 0) expect(box.items).toBeGreaterThanOrEqual(lists.length * 2 - 1)
        expect(box.title).toContain('Claude Code')
        const { data } = await harness.cdp.send<{ data: string }>(
          'Page.captureScreenshot',
          { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } },
          session,
        )
        await writeFile(join(outDir, `news-${w}x${h}-${scheme}.png`), Buffer.from(data, 'base64'))
      }
    }
    await harness.dashboardEval(`(() => {
      const slot = document.querySelector('.idle-slot[data-card="news"]')
      const [column, row] = slot.dataset.origin.split('|')
      slot.style.gridColumn = column
      slot.style.gridRow = row
      for (const other of document.querySelectorAll('.idle-slot')) other.style.visibility = ''
    })()`)
  })

  it('shoots the screen in dark and light', async () => {
    await mkdir(outDir, { recursive: true })
    for (const scheme of ['dark', 'light']) {
      await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session)
      await new Promise((resolve) => setTimeout(resolve, 600))
      const { data } = await harness.cdp.send<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } },
        session,
      )
      await writeFile(join(outDir, `idle-${count}${music ? '-music' : ''}-${scheme}.png`), Buffer.from(data, 'base64'))
    }
    process.stdout.write(`idle screen shots in ${outDir}\n`)
  })
})
