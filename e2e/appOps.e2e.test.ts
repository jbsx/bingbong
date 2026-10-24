import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// The app itself on the card (#420, ADR 0091), each line read by the
// scripted stand-in as the card offers it: the panel, the views and the
// settings change in one hop through the real fold, view channel and
// settings store, the page left as it was. Which line Jev reads as which op
// is the gate's to measure; this suite holds what each op does.

interface DecisionLine {
  readonly type: string
  readonly transcript?: string
  readonly verb?: string
  readonly ended?: string
}

interface AskLine {
  readonly state: string
  readonly questions: { readonly action: { readonly options: Record<string, string> } }
}

async function logLines<T>(userDataDir: string, prefix: string): Promise<T[]> {
  const dir = join(userDataDir, 'logs')
  const files = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.startsWith(prefix)).sort()
  const text = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('')
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
}

const LINES = {
  openSettings: 'open settings',
  weatherSettings: 'show the weather settings',
  weightPage: 'open the weight page',
  browser: 'go back to the browser',
  showPanel: 'show the activity panel',
  dock: 'dock the panel',
  wider: 'make the panel wider',
  hidePanel: 'hide the activity panel',
  adblock: 'turn off the adblocker',
  clock: 'use the 24-hour clock',
  dark: 'switch to dark mode',
  idle: 'set the idle timeout to 10 minutes',
} as const

/** What the CLI prints for an app op: its Answer. */
const ANSWERED = /^(Showing |Opened |Closed |The activity panel |Ad blocking |Clock |Appearance |Idle timeout |error:|No response)/

describe('app ops e2e (#420): the panel, the views and the settings in one hop', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string
  let pageUrl: string

  const recordsOf = async (line: string): Promise<DecisionLine[]> => (await logLines<DecisionLine>(userDataDir, 'decision-')).filter((record) => record.type === 'decision' && record.transcript === line)
  const saved = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Record<string, unknown>
  /** One line, one app op, the Task over on it, the page untouched. */
  const run = async (line: string): Promise<string> => {
    const said = await cli(harness, line, ANSWERED)
    expect(await recordsOf(line), line).toMatchObject([{ verb: 'app', ended: 'terminal' }])
    expect(await harness.paneUrl()).toBe(pageUrl)
    return said
  }
  const slotClass = (): Promise<string> => harness.dashboardEval<string>(`document.querySelector('.feed-slot')?.className ?? ''`)
  /** The panel open, as the Toolbar's toggle says it: the slot alone cannot tell an open panel from a Peek Card. */
  const panelOpen = (): Promise<boolean> => harness.dashboardEval<boolean>(`document.querySelector('.feed-panel-toggle')?.getAttribute('aria-pressed') === 'true'`)

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-app-ops-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      env: decisionScript(
        readingOf(LINES.openSettings, 'show_settings'),
        readingOf(LINES.weatherSettings, 'show_settings_weather'),
        readingOf(LINES.weightPage, 'show_weight'),
        readingOf(LINES.browser, 'show_dashboard'),
        readingOf(LINES.showPanel, 'panel_open'),
        readingOf(LINES.dock, 'panel_docked'),
        readingOf(LINES.wider, 'panel_width', { amount: 'up-step' }),
        readingOf(LINES.hidePanel, 'panel_close'),
        // A setting is two asks: the card's one `settings` line, then the settings ask's op.
        readingOf(LINES.adblock, 'settings'),
        readingOf(LINES.adblock, 'set_adblock_enabled_off'),
        readingOf(LINES.clock, 'settings'),
        readingOf(LINES.clock, 'set_time_format_24'),
        readingOf(LINES.dark, 'settings'),
        readingOf(LINES.dark, 'set_appearance_dark'),
        readingOf(LINES.idle, 'settings'),
        readingOf(LINES.idle, 'set_idle_after_minutes_10'),
      ),
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    pageUrl = fixture.url('/')
    await cli(harness, `navigate ${pageUrl}`, /^navigated: /)
    await harness.waitForPaneUrl(pageUrl)
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('"open settings" shows the Settings view, never settings.com; the card carried the app\'s ops with their state', async () => {
    expect(await run(LINES.openSettings)).toBe('Showing the Settings page.')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('section.settings-page[aria-label="settings"]')`)) ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    const ask = (await logLines<AskLine>(userDataDir, 'asks-')).filter((record) => record.state.includes(JSON.stringify(LINES.openSettings))).at(-1)!
    expect(ask.questions.action.options.show_settings).toContain('now showing the browser')
    expect(ask.questions.action.options.settings).toContain('ad blocking')
  }, 30_000)

  it('"show the weather settings" opens its section and brings it into view (to the top, as far as the page scrolls)', async () => {
    expect(await run(LINES.weatherSettings)).toBe('Showing the Settings page, at Weather.')
    await waitFor(
      async () =>
        (await harness.dashboardEval<boolean>(`(() => {
          const section = document.querySelector('section[aria-label="weather"]')
          const scroll = document.querySelector('.settings-scroll')
          if (!section || !scroll) return false
          const top = section.getBoundingClientRect().top - scroll.getBoundingClientRect().top
          // A section near the end cannot reach the top: in view, the scroll at its end, is as far as it goes.
          const atEnd = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2
          return section.querySelector('details')?.open === true && (Math.abs(top) < 40 || (atEnd && top >= 0 && top < scroll.clientHeight))
        })()`))
          ? true
          : undefined,
      { timeoutMs: 5_000, intervalMs: 100 },
    )
  }, 30_000)

  it('"open the weight page" shows it, and "go back to the browser" the pane again', async () => {
    expect(await run(LINES.weightPage)).toBe('Showing the Weight page.')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('section.weight-page')`)) ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    expect(await run(LINES.browser)).toBe('Showing the browser.')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.dashboard-browsing')`)) ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
  }, 30_000)

  it('the panel: shown, docked, made wider and hidden, each in one hop', async () => {
    expect(await run(LINES.showPanel)).toBe('Opened the activity panel.')
    await waitFor(async () => ((await panelOpen()) ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    expect(await run(LINES.dock)).toBe('The activity panel is docked beside the page.')
    await waitFor(async () => ((await slotClass()).includes('feed-slot--docked') ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    const width = (): Promise<number> => harness.dashboardEval<number>(`parseInt(document.querySelector('.dashboard-workspace').style.getPropertyValue('--feed-panel-width'), 10)`)
    const before = await width()
    expect(await run(LINES.wider)).toMatch(/^The activity panel is \d+ pixels wide\.$/)
    await waitFor(async () => ((await width()) > before ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    expect(await run(LINES.hidePanel)).toBe('Closed the activity panel.')
    await waitFor(async () => (!(await panelOpen()) ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
  }, 60_000)

  it('the settings: adblocker off, the 24-hour clock, dark mode, a 10-minute idle timeout — saved, the new value said', async () => {
    expect(await run(LINES.adblock)).toBe('Ad blocking turned off.')
    expect(await run(LINES.clock)).toBe('Clock set to 24-hour.')
    expect(await run(LINES.dark)).toBe('Appearance set to dark mode.')
    expect(await run(LINES.idle)).toBe('Idle timeout set to 10 minutes.')
    expect(await saved()).toMatchObject({ adblockEnabled: false, timeFormat: '24', appearance: 'dark', idleAfterMinutes: 10 })
  }, 60_000)
})
