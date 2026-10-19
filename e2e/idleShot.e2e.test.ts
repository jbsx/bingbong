import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'
import { OWNER_BODY, standInWeighIns, weighInsFile } from './weighIns'

// The Idle Screen's screenshot review (`pnpm shot:idle`): the screen at the
// appliance's 1920×1080 with every card holding sample data — London's
// weather fulfilled over CDP (the renderer fetches Open-Meteo itself), a
// stand-in usage dashboard with BINGBONG_IDLE_SHOT_PROVIDERS providers
// (default 3), and with BINGBONG_IDLE_SHOT_MUSIC=1 a song playing from the
// YouTube stand-in so Now Playing takes the dock, then a Timer beside it —
// shot in dark and light into BINGBONG_IDLE_SHOT_DIR (default a temp
// folder, printed). The
// stand-in usage server also answers as Hacker News's front page, so the
// News card holds Today's Highlight (#346), and news.json is seeded with a
// fortnight's story history so Big News (#349) is full. The same server
// stands in for the stories' pages and pictures (e2e/fixtures/news), so
// every Story Image comes from a local file, one story left with its tile.
// It also checks the bento (#352) — the clock's cell and each card's box,
// every tile holding its words, nothing under 16 px — and the News card at
// 2×2 and 1×2 in dark and light, with pictures and then with every picture
// failed to its tile, and with no Big News. The Weight card (#350) reads
// two months of stand-in Weigh-ins seeded as weighins.json, held to its
// box at 1×2 and 1×1.
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

/**
 * A fortnight of story history: two stories at the top of two sources this
 * week — one whose page names its picture, one whose source gave its own —
 * one at the top of a single source today with no picture anywhere (its
 * tile), one big story faded past the three, and an ordinary one.
 */
function storyHistory() {
  const seeded: [string, string, string | null, number, number, number][] = [
    ['Frontier lab publishes the weights of its largest open model yet, with a 400-page report', 'https://example.com/weights', null, 3120, 1.5, 1],
    ['GPT-6 benchmarks: what the new evals do and do not measure', 'https://example.com/gpt6', 'https://cdn.example.com/images/gpt6.jpg', 2440, 1.5, 2],
    ['The agent harness wars: who owns the loop', 'https://example.com/harness-wars', null, 1980, 1, 0],
    ['Markets slide as chip export rules tighten again', 'https://example.com/chips', 'https://cdn.example.com/images/chips.jpg', 1660, 1.5, 13],
    ['Rust in the Linux kernel, five years on', 'https://example.com/rust-kernel', null, 1400, 0.8, 1],
  ]
  return Object.fromEntries(
    seeded.map(([title, link, image, points, score, back], index) => [
      `Hacker News:seed-${index}`,
      { title, link, source: 'Hacker News', unit: 'points', topical: true, cluster: `Hacker News:seed-${index}`, image, days: { [dayBack(back)]: { score, magnitude: points } } },
    ]),
  )
}

/** A story's page as the stand-in serves it: its head naming its preview image. */
function articlePage(image: string): string {
  return `<!doctype html><html><head><title>A story</title><meta property="og:image" content="${image}"></head><body>…</body></html>`
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
    const pictures = Object.fromEntries(
      await Promise.all(['weights', 'gpt6', 'harness', 'chips'].map(async (name) => [`/images/${name}.jpg`, await readFile(new URL(`./fixtures/news/${name}.jpg`, import.meta.url))] as const)),
    )
    const pages: Record<string, string> = { '/harness': articlePage('/images/harness.jpg'), '/weights': articlePage('https://example.com/images/weights.jpg') }
    server = createServer((request, response) => {
      const path = request.url ?? ''
      if (path in pictures) {
        response.writeHead(200, { 'content-type': 'image/jpeg' })
        response.end(pictures[path])
        return
      }
      if (path in pages) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(pages[path])
        return
      }
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
      JSON.stringify({ weather: { city: 'London', units: 'metric' }, usageDashboard: { url: `http://127.0.0.1:${port}`, providers: PROVIDERS.slice(0, count) }, body: OWNER_BODY }),
      'utf8',
    )
    await writeFile(join(userDataDir, 'news.json'), `${JSON.stringify({ shown: [], history: {}, highlight: null, stories: storyHistory() })}\n`, 'utf8')
    await writeFile(join(userDataDir, 'weighins.json'), weighInsFile(standInWeighIns()), 'utf8')
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
      async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.wx-card') && !!document.querySelector('.usage-card') && !!document.querySelector('.idle-news') && !!document.querySelector('.weight-card')`)) ? true : undefined),
      { timeoutMs: 20000, intervalMs: 250 },
    )
    if (music) {
      await cli(harness, 'play fixture song', /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-dock .idle-music')`)) ? true : undefined), {
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

  it('lays the cards out as the bento at 1920×1080, every tile holding its words, nothing under 16 px', async () => {
    const geometry = await screenGeometry()
    expect(geometry.overflowing).toEqual([])
    expect(geometry.smallestText).toBeGreaterThanOrEqual(16)
    // The clock bare in the top-left cell; weather down the left, the Calendar and the Last Page over the Weight card in the middle, usage over News down the right (#352, #350).
    expect(geometry.clock).toBe('1|1')
    expect(geometry.slots).toEqual({
      weather: '1 / span 1|2 / span 3',
      calendar: '2 / span 1|1 / span 1',
      lastPage: '2 / span 1|2 / span 1',
      weight: '2 / span 1|3 / span 2',
      usage: '3 / span 1|1 / span 2',
      news: '3 / span 1|3 / span 2',
    })
    expect(geometry.dock).toBe(music)
    // Every provider's gauge a ring, and with two providers Claude's other window one too; with more, it is a bar under Claude.
    expect(geometry.rings).toBe(count <= 2 ? count + 1 : count)
    expect(geometry.bars).toBe(count <= 2 ? 0 : 1)
    expect(geometry.glow).toBe('rain')
  })

  it('shoots the screen in dark and light', async () => {
    await mkdir(outDir, { recursive: true })
    for (const scheme of ['dark', 'light']) {
      await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session)
      await new Promise((resolve) => setTimeout(resolve, 600))
      await shoot(`idle-${count}${music ? '-music' : ''}-${scheme}.png`)
    }
    process.stdout.write(`idle screen shots in ${outDir}\n`)
  })

  it.runIf(music)('docks a running Timer beside Now Playing, the grid rows giving it room', async () => {
    await harness.dashboardEval(`window.bingbong.assistant.submit('timer 25 minutes')`)
    await harness.pressKey('pane', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-dock .idle-timer') && !!document.querySelector('.idle-dock .idle-music')`)) ? true : undefined), {
      timeoutMs: 10000,
      intervalMs: 250,
    })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const geometry = await screenGeometry()
    expect(geometry.overflowing).toEqual([])
    expect(geometry.smallestText).toBeGreaterThanOrEqual(16)
    for (const scheme of ['dark', 'light']) {
      await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session)
      await new Promise((resolve) => setTimeout(resolve, 600))
      await shoot(`idle-${count}-music-timer-${scheme}.png`)
    }
  })

  it('holds the News card to its box at 2×2 and 1×2, with pictures and with every picture its tile', async () => {
    await mkdir(outDir, { recursive: true })
    // Every shown story's picture is in main's cache before the card is looked at: a poll gathers them before it answers.
    await waitFor(
      async () =>
        (await harness.dashboardEval<boolean>(
          `(() => { const imgs = [...document.querySelectorAll('.idle-news img')]; return imgs.length === 3 && imgs.every((img) => img.complete && img.naturalWidth > 0) })()`,
        ))
          ? true
          : undefined,
      { timeoutMs: 20000, intervalMs: 250 },
    )
    const defaults = await harness.dashboardEval<string[]>(`window.bingbong.settings.get().then((s) => s.idleCards)`)
    // Without the Weight card News takes the middle's 2×2; with it (the default) the right column's two cells, the highlight over Big News.
    const orders: [string, string[]][] = [
      ['2x2', ['weather', 'calendar', 'lastPage', 'news', 'usage', 'music']],
      ['1x2', defaults],
    ]
    try {
      for (const pictures of ['images', 'tiles']) {
        for (const [size, order] of orders) {
          await pin(order)
          await waitFor(async () => ((await harness.dashboardEval<string>(`(() => { const s = document.querySelector('.idle-slot[data-card="news"]').style; return s.gridColumn.split(' / ')[1].replace('span ', '') + 'x' + s.gridRow.split(' / ')[1].replace('span ', '') })()`)) === size ? true : undefined), {
            timeoutMs: 5000,
            intervalMs: 100,
          })
          if (pictures === 'tiles') {
            // A picture that fails to load falls back to its source's tile: every one is made to fail.
            await harness.dashboardEval(`(() => { for (const img of document.querySelectorAll('.idle-news img')) img.src = 'bingbong-news://image/missing.jpg' })()`)
            await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.idle-news img').length`)) === 0 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
          }
          for (const scheme of ['dark', 'light']) {
            await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session)
            await new Promise((resolve) => setTimeout(resolve, 400))
            const box = await newsBox()
            const { data } = await harness.cdp.send<{ data: string }>(
              'Page.captureScreenshot',
              { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } },
              session,
            )
            await writeFile(join(outDir, `news-${size}-${scheme}-${pictures}.png`), Buffer.from(data, 'base64'))
            expect(box.overflowing, `${size} ${scheme} ${pictures}`).toEqual([])
            expect(box.items, `${size} ${scheme} ${pictures}`).toBeGreaterThanOrEqual(size === '2x2' ? 3 : 1)
            expect(box.smallestText, `${size} ${scheme} ${pictures}`).toBeGreaterThanOrEqual(16)
            expect(box.lead).toContain('Claude Code')
            expect(box.highlightPicture).toBe(pictures === 'images' ? 'image' : 'tile')
          }
        }
      }
    } finally {
      await pin(defaults)
    }
  })

  it('holds the Weight card to its box at 1×2 and 1×1, in dark and light (#350)', async () => {
    await mkdir(outDir, { recursive: true })
    const defaults = await harness.dashboardEval<string[]>(`window.bingbong.settings.get().then((s) => s.idleCards)`)
    // Pinned after News and the usage card, the Weight card finds one cell left.
    const orders: [string, string[]][] = [
      ['1x2', defaults],
      ['1x1', ['weather', 'calendar', 'lastPage', 'news', 'usage', 'weight', 'music']],
    ]
    try {
      for (const [size, order] of orders) {
        await pin(order)
        await waitFor(async () => ((await harness.dashboardEval<string>(`(() => { const s = document.querySelector('.idle-slot[data-card="weight"]').style; return s.gridColumn.split(' / ')[1].replace('span ', '') + 'x' + s.gridRow.split(' / ')[1].replace('span ', '') })()`)) === size ? true : undefined), {
          timeoutMs: 5000,
          intervalMs: 100,
        })
        for (const scheme of ['dark', 'light']) {
          await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session)
          await new Promise((resolve) => setTimeout(resolve, 400))
          const box = await harness.dashboardEval<{ overflowing: string[]; smallestText: number; text: string; x: number; y: number; width: number; height: number }>(`(() => {
            const card = document.querySelector('.idle-slot[data-card="weight"] .weight-card')
            const slot = card.closest('.idle-slot').getBoundingClientRect()
            const overflowing = []
            for (const tile of card.querySelectorAll('.idle-card')) {
              const rect = tile.getBoundingClientRect()
              if (tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1) overflowing.push(tile.className + ' ' + tile.scrollHeight + '>' + tile.clientHeight)
              if (rect.bottom > slot.bottom + 1 || rect.right > slot.right + 1) overflowing.push(tile.className + ' out of its slot')
              for (const child of tile.children) {
                const inner = child.getBoundingClientRect()
                if (inner.bottom > rect.bottom + 1 || inner.right > rect.right + 1) overflowing.push(child.className + ' cut')
              }
            }
            const plot = card.querySelector('.weight-chart-area')
            if (plot && plot.getBoundingClientRect().height < 60) overflowing.push('trend collapsed')
            const texts = [...card.querySelectorAll('*')].filter((el) => el.checkVisibility() && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== ''))
            return { overflowing, smallestText: Math.min(...texts.map((el) => parseFloat(getComputedStyle(el).fontSize))), text: card.textContent, x: slot.x, y: slot.y, width: slot.width, height: slot.height }
          })()`)
          const { data } = await harness.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } }, session)
          await writeFile(join(outDir, `weight-${size}-${scheme}.png`), Buffer.from(data, 'base64'))
          expect(box.overflowing, `${size} ${scheme}`).toEqual([])
          expect(box.smallestText, `${size} ${scheme}`).toBeGreaterThanOrEqual(16)
          expect(box.text).toContain('81.25')
          expect(box.text).toMatch(/kg · 7 days/)
          if (size === '1x2') expect(box.text).toMatch(/Body fat \d+\.\d%/)
        }
      }
    } finally {
      await pin(defaults)
    }
  })

  it('gives the highlight the whole card when Big News is empty', async () => {
    await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, session)
    // What the card is with nothing in Big News: the list gone and the highlight across the box beside its picture, as React renders it.
    await harness.dashboardEval(`(() => {
      document.querySelector('.idle-news-big')?.remove()
      const today = document.querySelector('.idle-news-today')
      today.style.gridColumn = 'span 2'
      today.dataset.flow = 'row'
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const box = await newsBox()
    const { data } = await harness.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } }, session)
    await writeFile(join(outDir, `news-2x2-dark-no-big-news.png`), Buffer.from(data, 'base64'))
    expect(box.overflowing).toEqual([])
    expect(box.highlightShare).toBeGreaterThan(0.95)
  })

  async function shoot(name: string): Promise<void> {
    const { data } = await harness.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } }, session)
    await writeFile(join(outDir, name), Buffer.from(data, 'base64'))
  }

  /** The owner's pinned cards set as the settings page would, the screen re-laid out from them. */
  async function pin(cards: string[]): Promise<void> {
    await harness.dashboardEval(`window.bingbong.settings.get().then((s) => window.bingbong.settings.update({ ...s, idleCards: ${JSON.stringify(cards)} }))`)
  }

  /** The whole screen: where each card landed, every tile that cuts what it holds or leaves the canvas, the smallest text, the rings and bars, the glow. */
  function screenGeometry() {
    return harness.dashboardEval<{
      overflowing: string[]
      smallestText: number
      clock: string
      slots: Record<string, string>
      dock: boolean
      rings: number
      bars: number
      glow: string | null
    }>(`(() => {
      const screen = document.querySelector('.idle-screen').getBoundingClientRect()
      const tiles = [...document.querySelectorAll('.idle-screen .idle-card, .idle-screen .idle-tile--bare')]
      const overflowing = []
      for (const tile of tiles) {
        const name = (tile.closest('.idle-slot')?.dataset.card ?? 'dock') + ' ' + tile.className
        const rect = tile.getBoundingClientRect()
        if (tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1) overflowing.push(name + ' ' + tile.scrollHeight + '>' + tile.clientHeight)
        if (rect.right > screen.right + 1 || rect.bottom > screen.bottom + 1) overflowing.push(name + ' off the canvas')
        const slot = tile.closest('.idle-slot')?.getBoundingClientRect()
        if (slot && (rect.bottom > slot.bottom + 1 || rect.right > slot.right + 1)) overflowing.push(name + ' out of its slot')
      }
      for (const words of document.querySelectorAll('.usage-ring-item')) {
        const tile = words.closest('.idle-card').getBoundingClientRect()
        const rect = words.getBoundingClientRect()
        if (rect.bottom > tile.bottom + 1 || rect.right > tile.right + 1) overflowing.push('ring ' + words.getAttribute('aria-label'))
        const ring = words.querySelector('.usage-ring').getBoundingClientRect()
        if (Math.min(ring.width, ring.height) < 72) overflowing.push('ring squeezed ' + words.getAttribute('aria-label'))
      }
      // The chart's plot fills the room under its head: a collapsed plot draws its lines nowhere.
      for (const plot of document.querySelectorAll('.usage-chart-area')) {
        if (plot.getBoundingClientRect().height < 60) overflowing.push('usage chart plot collapsed ' + plot.getBoundingClientRect().height)
      }
      const texts = [...document.querySelectorAll('.idle-screen *')].filter((el) => el.checkVisibility() && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== ''))
      const clock = document.querySelector('.idle-clock-tile')
      const clockStyle = getComputedStyle(clock)
      return {
        overflowing,
        smallestText: Math.min(...texts.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        clock: clockStyle.gridColumn + '|' + clockStyle.gridRow,
        slots: Object.fromEntries([...document.querySelectorAll('.idle-slot')].map((slot) => [slot.dataset.card, slot.style.gridColumn + '|' + slot.style.gridRow])),
        dock: !!document.querySelector('.idle-dock'),
        rings: document.querySelectorAll('.usage-ring-item').length,
        bars: document.querySelectorAll('.usage-bar').length,
        glow: document.querySelector('.idle-screen').dataset.glow ?? null,
      }
    })()`)
  }

  /** The News card's box: what overflows or is cut, the Big News rows shown, the smallest text on it, and the highlight's picture. */
  function newsBox() {
    return harness.dashboardEval<{
      overflowing: string[]
      items: number
      smallestText: number
      highlightPicture: 'image' | 'tile' | 'none'
      highlightShare: number
      width: number
      height: number
      x: number
      y: number
      lead: string
    }>(`(() => {
      const card = document.querySelector('.idle-slot[data-card="news"] .idle-news')
      const rect = card.getBoundingClientRect()
      const today = card.querySelector('.idle-news-today')
      const words = card.querySelector('.idle-news-words')
      const title = card.querySelector('.idle-news-title').getBoundingClientRect()
      const stats = card.querySelector('.idle-news-stats').getBoundingClientRect()
      const picture = card.querySelector('.idle-news-picture')
      const overflowing = []
      for (const tile of card.querySelectorAll('.idle-card')) {
        if (tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1) overflowing.push(tile.className)
      }
      if (stats.bottom > words.getBoundingClientRect().bottom + 1 || title.bottom > stats.top + 1) overflowing.push('highlight')
      const lead = card.querySelector('.idle-news-lead').getBoundingClientRect()
      if (lead.bottom > stats.top + 1) overflowing.push('highlight lead cut')
      if (picture.checkVisibility() && picture.getBoundingClientRect().height < 40) overflowing.push('highlight picture squeezed')
      const rows = card.querySelector('.idle-news-big ol')
      const shown = rows ? [...rows.children].filter((row) => !row.hidden) : []
      for (const row of shown) {
        if (row.getBoundingClientRect().bottom > rows.getBoundingClientRect().bottom + 1) overflowing.push('big news row cut')
        const lead = row.querySelector('.idle-news-item-lead')
        if (lead.scrollWidth > lead.clientWidth + 1) overflowing.push('big news lead cut')
      }
      const texts = [...card.querySelectorAll('*')].filter((el) => el.checkVisibility() && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== ''))
      return {
        overflowing,
        items: shown.length,
        smallestText: Math.min(...texts.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        highlightPicture: !picture.checkVisibility() ? 'none' : picture.querySelector('img') ? 'image' : picture.dataset.tile !== undefined ? 'tile' : 'none',
        highlightShare: today.getBoundingClientRect().width / rect.width,
        width: rect.width, height: rect.height, x: rect.x, y: rect.y,
        lead: card.querySelector('.idle-news-lead').textContent,
      }
    })()`)
  }
})
