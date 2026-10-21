import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
import { startUsageStandIn, type UsageStandIn, PROVIDERS } from './usageStandIn'
import { waitFor } from './waitFor'
import { brotherWeighIns, standInWeighIns, STEPPING_ON, TWO_PEOPLE, weighInsFile } from './weighIns'

// The Idle Screen's screenshot review (`pnpm shot:idle`, #360): the screen at
// the appliance's 1920×1080 in F1 Headline's three Columns, every card
// holding sample data — London's weather fulfilled over CDP (the renderer
// fetches Open-Meteo itself), a stand-in usage dashboard with
// BINGBONG_IDLE_SHOT_PROVIDERS providers (default 3), the Top Repos seeded as
// repos.json, two People's Weigh-ins, a Last Page, and the Calendar's
// stand-in source (BINGBONG_CALENDAR_FIXTURE) empty until a state fills it.
// With BINGBONG_IDLE_SHOT_MUSIC=1 a song plays from the YouTube stand-in so
// Now Playing takes its card over the AI Usage, then a Timer runs beside the clock. Each
// state is shot into BINGBONG_IDLE_SHOT_DIR (default a temp folder,
// printed) and held to the screen's rules: nothing overflows, no text under
// 16 px, each card inside its home and each home inside its Column. The
// states: the default in dark and light; the Calendar with events; a
// ringing Timer; the weather unset; the Weigh-in pop-up live and settled;
// each card hidden in turn; one Person; and no Weigh-ins. Gated:
// BINGBONG_IDLE_SHOT=1, so the plain e2e run skips it.

/** The Top Repos a previous run read: the longest name and summary of the month's list among them. */
function topRepos() {
  const repo = (name: string, stars: number, starsThisMonth: number, language: string, description: string) => ({ name, link: `https://github.com/${name}`, description, language, stars, starsThisMonth })
  return {
    fetchedAt: Date.now(),
    repos: [
      repo('debpalash/VoiceStudio', 77298, 42036, 'Python', 'VoiceStudio is the open-source, fully-local ElevenLabs alternative — voice cloning, voice design, video dubbing, dictation, transcription & audiobook creation in 646 languages.'),
      repo('vectorize-io/hindsight', 51625, 27550, 'Python', 'Hindsight: Agent Memory That Learns'),
      repo('paperclipai/paperclip', 104657, 23340, 'TypeScript', 'The open-source app everyone uses to manage agents at work'),
    ],
    summaries: {
      'debpalash/VoiceStudio': 'Fully local, open-source voice suite for cloning, dubbing, transcription and audiobooks in 646 languages.',
      'vectorize-io/hindsight': 'Agent memory system that makes agents learn over time, outperforming RAG and knowledge graphs on LongMemEval.',
    },
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** London's forecast as Open-Meteo answers it, the hours from the current one, the city an hour ahead of UTC. */
function forecast() {
  const day = (offset: number): string => {
    const at = new Date(Date.now() + offset * DAY)
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  }
  const hours = Array.from({ length: 48 }, (_, hour) => `${day(hour < 24 ? 0 : 1)}T${String(hour % 24).padStart(2, '0')}:00`)
  const nowHour = new Date().getHours()
  return {
    utc_offset_seconds: -new Date().getTimezoneOffset() * 60,
    current: { time: `${day(0)}T${String(nowHour).padStart(2, '0')}:00`, temperature_2m: 12.2, weather_code: 55, is_day: 1 },
    daily: {
      time: [day(0), day(1), day(2), day(3)],
      temperature_2m_max: [13.2, 12.1, 14.4, 13.4],
      temperature_2m_min: [10.6, 7.8, 8.2, 6.9],
      precipitation_probability_max: [97, 77, 85, 94],
      sunrise: [`${day(0)}T07:32`, `${day(1)}T07:33`, `${day(2)}T07:35`, `${day(3)}T07:36`],
      sunset: [`${day(0)}T17:56`, `${day(1)}T17:54`, `${day(2)}T17:52`, `${day(3)}T17:50`],
      weather_code: [55, 53, 63, 63],
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, hour) => 11 + Math.round(2 * Math.sin((hour - 9) / 4))),
      weather_code: hours.map(() => 53),
      precipitation_probability: hours.map((_, hour) => [73, 80, 88, 94, 97, 97][hour % 6]),
      is_day: hours.map((_, hour) => (hour % 24 >= 8 && hour % 24 < 18 ? 1 : 0)),
    },
  }
}

/** This month's entries for the Calendar's stand-in source: a dinner tonight, a trip later in the month, a call next week. */
function calendarEvents() {
  const at = (days: number, hour: number): number => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour).getTime()
  }
  const event = (id: string, title: string, start: number, end: number, allDay = false) => ({ id, source: 'stand-in', title, start, end, allDay })
  return {
    events: [
      event('dinner', 'Dinner with Barun', at(0, 23), at(0, 24)),
      event('call', 'Call the landlord about the boiler', at(3, 10), at(3, 11)),
      event('trip', 'Edinburgh', at(5, 0), at(7, 0), true),
    ],
  }
}

/** What the screen is held to in every state. */
interface Geometry {
  overflowing: string[]
  smallestText: number
  homes: Record<string, string>
  lines: string[]
  rings: number
}

describe.skipIf(!process.env.BINGBONG_IDLE_SHOT)('idle screen screenshot review (#360)', () => {
  let harness: Harness
  let usage: UsageStandIn | undefined
  let userDataDir: string
  let session: string
  let fixture: FixtureServer | undefined
  const weatherCity = 'London'
  const music = process.env.BINGBONG_IDLE_SHOT_MUSIC === '1'
  const outDir = process.env.BINGBONG_IDLE_SHOT_DIR ?? join(tmpdir(), 'bingbong-idle-shot')
  const count = Math.min(PROVIDERS.length, Math.max(1, Number(process.env.BINGBONG_IDLE_SHOT_PROVIDERS ?? 3)))
  const calendarFile = (): string => join(userDataDir, 'calendar.json')

  beforeAll(async () => {
    usage = await startUsageStandIn(count)
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-shot-'))
    await writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ weather: { city: weatherCity, units: 'metric' }, usageDashboard: usage.settings, weight: TWO_PEOPLE }),
      'utf8',
    )
    await writeFile(join(userDataDir, 'repos.json'), `${JSON.stringify(topRepos())}\n`, 'utf8')
    await writeFile(join(userDataDir, 'weighins.json'), weighInsFile([...standInWeighIns(), ...brotherWeighIns()]), 'utf8')
    await writeFile(join(userDataDir, 'last-page.json'), `${JSON.stringify({ url: 'http://127.0.0.1:40415/lighthouse', title: 'The lighthouse', at: 1 })}\n`, 'utf8')
    await writeFile(calendarFile(), JSON.stringify({ events: [] }), 'utf8')
    // A wake ear that never fires, so the Voice Prompt waits for "Bing Bong" as the appliance does.
    const ear = { BINGBONG_WAKE_ENGINE: 'node', BINGBONG_WAKE_SCRIPT: '[0.01]', BINGBONG_VAD_SCRIPT: '[0.01]', BINGBONG_STT_SCRIPT: '[]', BINGBONG_CALENDAR_FIXTURE: calendarFile() }
    if (music) {
      fixture = await startFixtureServer()
      harness = await startHarness({
        userDataDir,
        fixture,
        wakeFromBootIdle: false,
        launchArgs: ['--browser-cli', '--mute-audio'],
        pipeStdio: true,
        env: { ...ear, BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...decisionScript(readingOf('play fixture song')) },
      })
      await harness.waitForCliOutput(/bingbong browser harness/)
    } else {
      harness = await startHarness({ userDataDir, wakeFromBootIdle: false, launchArgs: ['--mute-audio'], env: ear })
    }

    const { sessionId } = await harness.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: harness.dashboardTargetId(), flatten: true })
    session = sessionId
    harness.cdp.on('Fetch.requestPaused', (params) => {
      const { requestId, request } = params as { requestId: string; request: { url: string } }
      const body = request.url.includes('geocoding') ? { results: [{ name: weatherCity, latitude: 51.5, longitude: -0.12 }] } : forecast()
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
      async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.wx-card') && !!document.querySelector('.usage-card') && !!document.querySelector('.idle-repo') && !!document.querySelector('.weight-card')`)) ? true : undefined),
      { timeoutMs: 20000, intervalMs: 250 },
    )
    if (music) {
      await cli(harness, 'play fixture song', /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-music-card')`)) ? true : undefined), {
        timeoutMs: 15000,
        intervalMs: 250,
      })
    }
    await mkdir(outDir, { recursive: true })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await usage?.close()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    process.stdout.write(`idle screen shots in ${outDir}\n`)
  })

  it('lays the cards out in their Columns at 1920×1080, every card holding its words, nothing under 16 px, in dark and light', async () => {
    const geometry = await screenGeometry()
    expect(geometry.overflowing).toEqual([])
    expect(geometry.smallestText).toBeGreaterThanOrEqual(16)
    // Weather down the left; Now Playing, while a song is held, over the AI Usage under the clock; the Calendar, the Weight card and News down the right.
    expect(geometry.homes).toEqual({ weather: 'left full', ...(music ? { music: 'middle full', usage: 'middle small' } : { usage: 'middle full' }), calendar: 'right full', weight: 'right full', news: 'right full' })
    expect(geometry.lines).toEqual(['voice', 'lastPage'])
    expect(geometry.rings).toBe(count)
    expect(await text('.idle-voice')).toBe('Say “Bing Bong” or start typing')
    expect(await text('.wx-peak')).toMatch(/^97%rainby \d\d:\d\d$/)
    expect(await text('.idle-news-head')).toBe('Top repos ★ this month')
    for (const scheme of ['dark', 'light'] as const) await shoot(`idle-${count}${music ? '-music' : ''}`, scheme)
  })

  it('grows to fill a window larger than the appliance’s display, edge to edge rather than framed in empty ground', async () => {
    const size = { width: 2560, height: 1440 }
    await harness.cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false }, session)
    try {
      // Each side's margin over the far edge of the Columns, so the rects' zoom units cancel: about 0.03 filled (48 px of 1872
      // at 1920×1080), about 0.17 when the screen keeps its 1920×1080 size in the middle of the window.
      const margins = () => harness.dashboardEval<{ across: number; down: number }>(`(() => {
        const screen = document.querySelector('.idle-screen').getBoundingClientRect()
        const left = document.querySelector('.idle-col--left').getBoundingClientRect()
        const right = document.querySelector('.idle-col--right').getBoundingClientRect()
        return { across: (left.left - screen.left) / (right.right - screen.left), down: (left.top - screen.top) / (left.bottom - screen.top) }
      })()`)
      const filled = (m: { across: number; down: number }) => m.across <= 0.05 && m.down <= 0.05
      const grown = await waitFor(async () => {
        const m = await margins()
        return filled(m) ? m : undefined
      }, { timeoutMs: 5000, intervalMs: 100 }).catch(margins)
      expect(grown.across).toBeLessThanOrEqual(0.05)
      expect(grown.down).toBeLessThanOrEqual(0.05)
      await shoot('idle-2560x1440', 'dark', size)
    } finally {
      await harness.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, session)
    }
  })

  it('lists the month’s entries under the weeks while the Calendar has any, a dot under their days', async () => {
    await writeFile(calendarFile(), JSON.stringify(calendarEvents()), 'utf8')
    await reenterIdle()
    await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.idle-cal-entry').length`)) === 3 ? true : undefined), { timeoutMs: 10000, intervalMs: 250 })
    await held('calendar-events')
    expect(await harness.dashboardEval<number>(`document.querySelectorAll('.idle-cal-dot').length`)).toBeGreaterThanOrEqual(2)
    expect(await text('.idle-lines')).toContain('Dinner with Barun')
    await writeFile(calendarFile(), JSON.stringify({ events: [] }), 'utf8')
    await reenterIdle()
  })

  it.runIf(music)('runs a Timer beside the clock, with Up Next and the Last Page, Now Playing stepped down to its smaller card over the rings and a short chart', async () => {
    await writeFile(calendarFile(), JSON.stringify(calendarEvents()), 'utf8')
    await harness.dashboardEval(`window.bingbong.assistant.submit('timer 25 minutes')`)
    await reenterIdle()
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-timer') && !!document.querySelector('.idle-upnext') && !!document.querySelector('.idle-music-card--small')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 250 })
    expect(await text('.idle-timer-sub')).toMatch(/^Timer 25 minutes· ends \d\d:\d\d$/)
    expect((await screenGeometry()).homes).toMatchObject({ music: 'middle small', usage: 'middle full' })
    for (const scheme of ['dark', 'light'] as const) await held(`idle-${count}-music-timer`, scheme)
    await harness.dashboardEval(`window.bingbong.assistant.submit('timer off')`)
    await writeFile(calendarFile(), JSON.stringify({ events: [] }), 'utf8')
  })

  it('pulses "Time’s up" in the Timer Clock while it rings', async () => {
    await harness.dashboardEval(`window.bingbong.assistant.submit('timer 1 second')`)
    await reenterIdle()
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-timer--ringing')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    expect(await text('.idle-timer--ringing .idle-timer-left')).toBe('Time’s up')
    await held('timer-ringing')
    await harness.dashboardEval(`window.bingbong.assistant.submit('timer off')`)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.idle-timer')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
  })

  it('shows the Weigh-in pop-up in the AI Usage chart’s place, live then settled', async () => {
    await writeFile(join(userDataDir, 'scale-frames.txt'), STEPPING_ON, 'utf8')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-popup-place .weighin-popup--live')`)) ? true : undefined), { timeoutMs: 15000, intervalMs: 50 })
    await shoot('weighin-live')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-popup-place .weighin-popup--settled')`)) ? true : undefined), { timeoutMs: 15000, intervalMs: 50 })
    await held('weighin-settled')
    const place = await harness.dashboardEval<{ chart: number; popup: number }>(`({ chart: document.querySelector('.idle-home[data-card="usage"]').getBoundingClientRect().bottom, popup: document.querySelector('.idle-popup-place').getBoundingClientRect().bottom })`)
    expect(Math.abs(place.popup - place.chart)).toBeLessThanOrEqual(1)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.weighin-popup')`)) ? true : undefined), { timeoutMs: 20000, intervalMs: 250 })
  })

  it('hides each card in turn, its Column-mates taking its room', async () => {
    const all = await harness.dashboardEval<string[]>(`window.bingbong.settings.get().then((s) => s.idleCards)`)
    try {
      for (const hidden of ['weather', 'calendar', 'weight', 'usage', 'news', 'lastPage', 'music']) {
        if (hidden === 'music' && !music) continue
        await pin(all.filter((id) => id !== hidden))
        await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.idle-home[data-card="${hidden}"]') && ${hidden === 'lastPage' ? `!document.querySelector('.idle-last-page')` : hidden === 'music' ? `!document.querySelector('.idle-music-card')` : 'true'}`)) ? true : undefined), {
          timeoutMs: 5000,
          intervalMs: 100,
        })
        await held(`hidden-${hidden}`)
        if (['calendar', 'weight', 'news'].includes(hidden)) {
          // The right Column's cards still fill its height.
          const filled = await harness.dashboardEval<number>(`[...document.querySelectorAll('.idle-col--right .idle-home')].reduce((sum, home) => sum + home.getBoundingClientRect().height, 0)`)
          expect(filled, `hidden ${hidden}`).toBeGreaterThan(960)
        }
      }
    } finally {
      await pin(all)
    }
  })

  it('says what to do with the weather unset', async () => {
    await harness.dashboardEval(`window.bingbong.settings.get().then((s) => window.bingbong.settings.update({ ...s, weather: { ...s.weather, city: '' } }))`)
    try {
      await waitFor(async () => ((await text('.idle-home[data-card="weather"]')) === 'Set a weather city in settings' ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
      await held('weather-unset')
    } finally {
      await harness.dashboardEval(`window.bingbong.settings.get().then((s) => window.bingbong.settings.update({ ...s, weather: { ...s.weather, city: 'London' } }))`)
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.wx-card')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    }
  })

  it('draws one Person larger, then the note with no Weigh-ins', async () => {
    await harness.dashboardEval(`window.bingbong.settings.get().then((s) => window.bingbong.settings.update({ ...s, weight: { ...s.weight, card: { ...s.weight.card, hidden: ['barun'] } } }))`)
    await waitFor(async () => ((await harness.dashboardEval<number>(`document.querySelectorAll('.weight-card-row').length`)) === 1 ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    await held('one-person')
    await harness.dashboardEval(`window.bingbong.weight.list().then(async (all) => { for (const weighIn of all) await window.bingbong.weight.remove(weighIn.at) })`)
    await waitFor(async () => ((await text('.idle-home[data-card="weight"]')) === 'Step on the scale' ? true : undefined), { timeoutMs: 5000, intervalMs: 100 })
    await held('no-weighins')
  })

  async function text(selector: string): Promise<string> {
    return harness.dashboardEval<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)
  }

  /** Wakes the dashboard and brings the Idle Screen back, so it mounts afresh and asks again (the Calendar's events, the Timer). */
  async function reenterIdle(): Promise<void> {
    await harness.clickDashboardElement('.idle-date')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    await harness.pressKey('pane', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 100 })
    await new Promise((resolve) => setTimeout(resolve, 600))
  }

  /** A state shot, held to the screen's rules. */
  async function held(name: string, scheme: 'dark' | 'light' = 'dark'): Promise<void> {
    await shoot(name, scheme)
    const geometry = await screenGeometry()
    expect(geometry.overflowing, `${name} ${scheme}`).toEqual([])
    expect(geometry.smallestText, `${name} ${scheme}`).toBeGreaterThanOrEqual(16)
  }

  async function shoot(name: string, scheme: 'dark' | 'light' = 'dark', size = { width: 1920, height: 1080 }): Promise<void> {
    await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, session)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const { data } = await harness.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, ...size, scale: 1 } }, session)
    await writeFile(join(outDir, `${name}-${scheme}.png`), Buffer.from(data, 'base64'))
    if (scheme === 'light') await harness.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, session)
  }

  /** The owner's Pinned Cards set as the settings page would. */
  async function pin(cards: string[]): Promise<void> {
    await harness.dashboardEval(`window.bingbong.settings.get().then((s) => window.bingbong.settings.update({ ...s, idleCards: ${JSON.stringify(cards)} }))`)
  }

  /** The whole screen: every card or line that cuts what it holds, any card out of its home or home out of its Column, the smallest text, each home's Column and form, the Clock Lines, the rings. */
  function screenGeometry() {
    return harness.dashboardEval<Geometry>(`(() => {
      const screen = document.querySelector('.idle-screen').getBoundingClientRect()
      const overflowing = []
      const within = (inner, outer) => inner.top >= outer.top - 1 && inner.left >= outer.left - 1 && inner.bottom <= outer.bottom + 1 && inner.right <= outer.right + 1
      for (const box of document.querySelectorAll('.idle-screen .idle-card, .idle-screen .idle-line, .idle-clock-row, .wx-band')) {
        const name = (box.closest('.idle-home')?.dataset.card ?? 'middle') + ' ' + box.className
        if (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1) overflowing.push(name + ' ' + box.scrollWidth + 'x' + box.scrollHeight + '>' + box.clientWidth + 'x' + box.clientHeight)
        if (!within(box.getBoundingClientRect(), screen)) overflowing.push(name + ' off the canvas')
        const home = box.closest('.idle-home')
        if (home && !within(box.getBoundingClientRect(), home.getBoundingClientRect())) overflowing.push(name + ' out of its home')
      }
      for (const home of document.querySelectorAll('.idle-home')) {
        if (!within(home.getBoundingClientRect(), home.closest('.idle-col').getBoundingClientRect())) overflowing.push(home.dataset.card + ' out of its Column')
      }
      const lines = document.querySelector('.idle-lines').getBoundingClientRect()
      const usage = document.querySelector('.idle-home[data-card="usage"]')
      if (usage && usage.getBoundingClientRect().top < lines.bottom - 1) overflowing.push('usage under the Clock Lines')
      for (const item of document.querySelectorAll('.usage-ring-item')) {
        const card = item.closest('.idle-card').getBoundingClientRect()
        if (!within(item.getBoundingClientRect(), card)) overflowing.push('ring ' + item.getAttribute('aria-label'))
      }
      for (const plot of document.querySelectorAll('.usage-chart-area, .weight-chart-area')) {
        if (plot.getBoundingClientRect().height < 50) overflowing.push(plot.className + ' collapsed ' + plot.getBoundingClientRect().height)
      }
      const texts = [...document.querySelectorAll('.idle-screen *')].filter((el) => el.checkVisibility() && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== ''))
      return {
        overflowing,
        smallestText: Math.min(...texts.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        homes: Object.fromEntries([...document.querySelectorAll('.idle-home')].map((home) => [home.dataset.card, home.closest('.idle-col').className.replace(/.*idle-col--/, '') + ' ' + home.dataset.form])),
        lines: document.querySelector('.idle-lines').dataset.lines.split(' '),
        rings: document.querySelectorAll('.usage-ring-item').length,
      }
    })()`)
  }
})
