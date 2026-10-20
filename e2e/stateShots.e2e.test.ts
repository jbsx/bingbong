import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { promptBarScript } from './scripts'
import { sleep, waitFor } from './waitFor'
import { brotherWeighIns, standInWeighIns, TWO_PEOPLE, weighInsFile } from './weighIns'

// The states' screenshot review (#359, ADR 0078): the
// round-6 state list replayed against the fixture server at the
// appliance's 1920×1080, in dark and light — the same Commands in the same
// order as the shots the F1 theme was drawn over, then Settings section by
// section, the Weight page, a Weigh-in over the pane, and an Utterance
// being taken over a page with a Page Term on it. Each state is one PNG of
// the whole screen (the dashboard, the pane and the panel are separate
// native views, so the X root is grabbed, not one view), named like the
// round-6 shots, into BINGBONG_STATE_SHOT_DIR (default a temp folder). In
// every state the app's own surfaces must set no text under 16 px, clip or
// overflow none of it, and draw none of it in #fff — the page in the pane
// is not ours and is not read. It runs in every `pnpm test:e2e` — the owner's
// ruling (2026-10-20): the e2e is the source of truth, no screenshot is
// reviewed by hand — on an X screen of its own at the appliance's size, since
// the suite's is a desk's; `pnpm shot:states` runs it alone.

const OUT = process.env.BINGBONG_STATE_SHOT_DIR ?? join(tmpdir(), 'bingbong-state-shots')
const WIDTH = 1920
const HEIGHT = 1080

/** The appliance's screen: an Xvfb of its own, whatever size the suite's display is. */
let screen: { display: string; xvfb: ChildProcess } | null = null

async function startScreen(): Promise<{ display: string; xvfb: ChildProcess }> {
  // -displayfd: the server picks a free display and writes its number to stdout.
  const xvfb = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', `${WIDTH}x${HEIGHT}x24`, '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'ignore'] })
  const number = await new Promise<string>((resolve, reject) => {
    xvfb.stdout?.once('data', (chunk: Buffer) => resolve(chunk.toString().trim()))
    xvfb.once('error', reject)
    xvfb.once('exit', (code) => reject(new Error(`Xvfb exited with ${String(code)}`)))
  })
  return { display: `:${number}`, xvfb }
}

/** A command run against the appliance's screen. */
function onScreen(command: string): void {
  execSync(command, { env: { ...process.env, DISPLAY: screen?.display } })
}

/** What breaks the theme's floor on the surface it runs in: small, clipped, off-screen or #fff text. */
const CHECK_SCRIPT = `(() => {
  const issues = []
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className !== '' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()
    const words = (el.value || el.placeholder || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
    return cls + ' "' + words + '"'
  }
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg, option, .feed-sr, .weight-chart-y-size')) continue
    const field = (el instanceof HTMLInputElement && ['text', 'search', 'url', 'number', 'date', 'email', 'tel', 'password'].includes(el.type)) || el instanceof HTMLTextAreaElement
    if (el instanceof HTMLInputElement && !field) continue
    const own = field ? (el.value || el.placeholder) !== '' : [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== '')
    if (!own) continue
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    if (box.width <= 1 || box.height <= 1 || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    if (el.closest('[aria-hidden="true"]') && el.closest('.feed-surface')) continue
    if (parseFloat(style.fontSize) < 16) issues.push('under 16 px (' + style.fontSize + '): ' + name(el))
    if (style.color === 'rgb(255, 255, 255)') issues.push('#fff: ' + name(el))
    const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip'
    const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip'
    // The live words in the capsule grow without bound and ellipsize by design (#331): the one clip allowed.
    if (!field && clipsX && el.scrollWidth > el.clientWidth + 1 && !el.matches('.voice-hint--listening')) issues.push('clipped across: ' + name(el))
    if (!field && clipsY && el.scrollHeight > el.clientHeight + 1) issues.push('clipped down: ' + name(el))
    if (box.right > innerWidth + 1 || box.left < -1) issues.push('off the surface: ' + name(el))
    // Words squeezed into a column a few letters wide, wrapping down the screen.
    if (!field && box.width < 80 && box.height > parseFloat(style.fontSize) * 6) issues.push('squeezed: ' + name(el))
  }
  return issues
})()`

/** A Weigh-in stepping on and settling on the stand-in scale (the frames weight.e2e reads). */
const STEPPING_ON = [
  '120f1558c6f738c1a43f013f01046c',
  '140b150000010000000035',
  '+600',
  '100b1502fd00000000002f',
  '100b151ddd00000000002a',
  '100b15208a0000000000da',
  '100b151fae0000000000fd',
  '+400',
  '100b151f9001020001f4d7',
  '100b151f9001020001f4d7',
  '100b151f9001020001f4d7',
  '+4000',
  '100b15112b00000000006c',
  '100b150000000000000030',
].join('\n')

const SPEECH = 0.95
const QUIET = 0.01
/** The Utterance taken over /empty-main, whose "Fixture Museums" link is a Page Term — words no Command reads. */
const WORDS = 'what about the Fixture Museums collections'
const frames = (value: number, count: number): number[] => Array.from({ length: count }, () => value)

type Theme = 'dark' | 'light'

interface Run {
  harness: Harness
  fixture: FixtureServer
  userDataDir: string
  theme: Theme
  /** Every state's failures, by state, asserted once the whole walk is shot. */
  issues: Map<string, string[]>
}

async function launch(theme: Theme, env: Record<string, string> = {}): Promise<Run> {
  const fixture = await startFixtureServer()
  const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-state-shot-'))
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ appearance: theme, weather: { city: 'London', units: 'metric' }, weight: TWO_PEOPLE }), 'utf8')
  await writeFile(join(userDataDir, 'weighins.json'), weighInsFile([...standInWeighIns(), ...brotherWeighIns()]), 'utf8')
  const harness = await startHarness({
    fixture,
    userDataDir,
    launchArgs: ['--mute-audio'],
    // A wake ear that never fires, so the Voice Prompt waits for "Bing Bong" as the appliance does.
    env: { DISPLAY: screen?.display, BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, BINGBONG_WAKE_ENGINE: 'node', BINGBONG_WAKE_SCRIPT: '[0.01]', BINGBONG_VAD_SCRIPT: '[0.01]', BINGBONG_STT_SCRIPT: '[]', ...env },
  })
  // The window at the appliance's size: Electron has no Browser.setWindowBounds, the X server has.
  onScreen(`xdotool search --onlyvisible --name '.*' windowmove %@ 0 0 windowsize %@ ${WIDTH} ${HEIGHT}`)
  const width = await waitFor(async () => {
    const inner = await harness.dashboardEval<number>('innerWidth')
    return inner > WIDTH - 40 ? inner : undefined
  }, { timeoutMs: 10_000, intervalMs: 100 }).catch(async () => harness.dashboardEval<number>('innerWidth'))
  expect(width, 'the window at the appliance width').toBeGreaterThan(WIDTH - 40)
  await sleep(800)
  return { harness, fixture, userDataDir, theme, issues: new Map() }
}

async function close(run: Run): Promise<void> {
  await run.harness.quit().catch(() => {})
  await run.fixture.close().catch(() => {})
}

/** The whole screen as it shows, and what breaks the floor on each of the app's surfaces in it. */
async function shoot(run: Run, state: string): Promise<void> {
  await sleep(500)
  mkdirSync(OUT, { recursive: true })
  onScreen(`xwd -root -silent | ffmpeg -loglevel error -y -f xwd_pipe -i - '${join(OUT, `${run.theme}-${state}.png`)}'`)
  const found: string[] = []
  const surfaces: [string, (expression: string) => Promise<string[]>][] = [
    ['dashboard', (expression) => run.harness.dashboardEval<string[]>(expression)],
    ['panel', (expression) => run.harness.overlayEval<string[]>(expression)],
  ]
  for (const [surface, evaluate] of surfaces) {
    // A surface that cannot be read is a failure too: the guard never passes on what it did not check.
    for (const issue of await evaluate(CHECK_SCRIPT).catch((error: unknown) => [`not read: ${String(error)}`])) found.push(`${surface}: ${issue}`)
  }
  // The pop-up's own view is read only while the pop-up is in it, not riding the open panel's top.
  const riding = await run.harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--open .weighin-popup')`).catch(() => false)
  if (!riding && (await run.harness.weighInEval<boolean>(`!!document.querySelector('.weighin-popup')`).catch(() => false))) {
    for (const issue of await run.harness.weighInEval<string[]>(CHECK_SCRIPT).catch((error: unknown) => [`not read: ${String(error)}`])) found.push(`weigh-in: ${issue}`)
  }
  run.issues.set(state, found)
}

async function promptIdle(harness: Harness): Promise<void> {
  await waitFor(async () => ((await harness.overlayEval<boolean>(`!document.querySelector('.prompt-form[aria-busy]')`)) ? true : undefined), { timeoutMs: 25_000, intervalMs: 100 }).catch(() => {})
}

/** One typed Command, as the round-6 run typed it, waited out unless it is meant to be caught working. */
async function command(run: Run, line: string, settle = true): Promise<void> {
  await run.harness.ensurePanelOpen()
  await run.harness.overlayEval(promptBarScript(line))
  if (settle) await promptIdle(run.harness)
  await sleep(900)
}

const clickPanel = (run: Run, selector: string): Promise<unknown> => run.harness.overlayEval(`document.querySelector(${JSON.stringify(selector)})?.click()`)
const clickDashboard = (run: Run, selector: string): Promise<unknown> => run.harness.dashboardEval(`document.querySelector(${JSON.stringify(selector)})?.click()`)

/** The round-6 list (`current/log.txt`): the Commands in order, a shot after each state. */
async function walkTheShell(run: Run): Promise<void> {
  const { harness, fixture } = run
  await shoot(run, '06-awake')
  await harness.ensurePanelOpen()
  await shoot(run, '07-feed-empty')
  await command(run, `navigate ${fixture.url('/story')}`)
  await shoot(run, '08-page-loaded')
  await command(run, 'read')
  await shoot(run, '09-read-answer')
  await command(run, 'click 999')
  await shoot(run, '10-failure')
  await command(run, 'scroll down')
  await shoot(run, '11-scrolled')
  await command(run, 'zorblax the quux thing')
  await shoot(run, '12-unknown-command')
  await command(run, 'back')
  await shoot(run, '13-back')
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  await sleep(900)
  await shoot(run, '14-collapsed-peek')
  await harness.ensurePanelOpen()
  await clickPanel(run, '[aria-label="Dock the feed panel"]')
  await sleep(1200)
  await shoot(run, '15-docked')
  await command(run, `navigate ${fixture.url('/held-response')}`, false)
  await sleep(2500)
  await shoot(run, '16-loading')
  await clickPanel(run, '[aria-label="Stop active command"]')
  await promptIdle(harness)
  await sleep(800)
  await shoot(run, '17-stopped')
  await clickPanel(run, '[aria-label="Undock the feed panel"]')
  await sleep(800)
  await command(run, `navigate ${fixture.url('/consent-wall')}`)
  await shoot(run, '18-consent-wall')
  await command(run, `navigate ${fixture.url('/dialog-wall')}`)
  await shoot(run, '19-dialog-wall')
  await command(run, `navigate ${fixture.url('/interactive')}`)
  await command(run, 'screenshot')
  await shoot(run, '20-screenshot-cmd')
  await command(run, 'navigate http://127.0.0.1:1/nothing')
  await shoot(run, '21-nav-failed')
  await command(run, `navigate ${fixture.url('/empty-main')}`)
  await shoot(run, '22-empty-landing')
  await command(run, 'timer 25 minutes')
  await shoot(run, '23-timer')
  await command(run, 'play fixture song')
  await sleep(2500)
  await shoot(run, '24-music-playing')
  await command(run, 'pause')
  await shoot(run, '25-music-paused')

  // Settings, shut, then each section opened from the index.
  await clickDashboard(run, '.settings-toggle')
  await sleep(1000)
  await shoot(run, '27-settings')
  const links = await harness.dashboardEval<number>(`document.querySelectorAll('.settings-index-link').length`)
  for (let index = 0; index < links; index++) {
    await harness.dashboardEval(`document.querySelectorAll('.settings-index-link')[${index}].click()`)
    await sleep(600)
    await shoot(run, `28-settings-section-${String(index).padStart(2, '0')}`)
  }
  await clickDashboard(run, '.settings-toggle')
  await sleep(800)

  // The Weight page opens from the Idle Screen's Weight card.
  await harness.pressKey('pane', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
  await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.weight-card-row[data-person="jaish"]')`)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 100 }).catch(async (error: unknown) => {
    await shoot(run, 'no-weight-card')
    throw error
  })
  // Idle controls fire on pointer-down, before the press wakes the screen: the row takes that alone.
  await harness.dashboardEval(`document.querySelector('.weight-card-row[data-person="jaish"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }))`)
  await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.weight-page')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 }).catch(async (error: unknown) => {
    await shoot(run, 'no-weight-page')
    throw error
  })
  for (let step = 0; step < 3; step++) {
    await harness.dashboardEval(`(() => { const el = document.querySelector('.weight-scroll'); el.scrollTop = ${step} * (el.clientHeight - 120) })()`)
    await shoot(run, `05-weight-section-${String(step).padStart(2, '0')}`)
  }
  await harness.dashboardEval(`(() => { const el = document.querySelector('.weight-scroll'); el.scrollTop = el.scrollHeight })()`)
  await shoot(run, '04-weight-page')
  await clickDashboard(run, '.weight-back')
  await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.browser-viewport')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
  await sleep(800)

  // A Weigh-in over the pane, in its own view.
  await writeFile(join(run.userDataDir, 'scale-frames.txt'), STEPPING_ON, 'utf8')
  await waitFor(async () => ((await harness.weighInEval<boolean>(`!!document.querySelector('.weighin-popup--live')`).catch(() => false)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 50 })
  await shoot(run, '02-weighin-live')
  await waitFor(async () => ((await harness.weighInEval<boolean>(`!!document.querySelector('.weighin-popup--settled')`).catch(() => false)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 50 })
  await shoot(run, '03-weighin-settled')
}

/** An Utterance being taken over a page whose "Fixture Museums" is a Page Term: LISTENING, the live words, the quiet that ends it. */
async function walkTheVoicePrompt(run: Run): Promise<void> {
  const { harness, fixture } = run
  await command(run, `navigate ${fixture.url('/empty-main')}`)
  // Frames advance the scripts one each: the wake, then speech the endpointer never sees end. The words are no
  // Command, so nothing fires early (#326); a partial every other frame, paced so the Page Terms are in.
  const feed = (count: number): Promise<unknown> => harness.dashboardEval(`(() => { for (let i = 0; i < ${count}; i++) window.bingbong.voice.sendAudio(new Float32Array(512)) })()`)
  await feed(12)
  await waitFor(async () => ((await harness.overlayEval<boolean>(`!!document.querySelector('.voice-prompt--listening')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })
  await waitFor(
    async () => {
      await feed(2)
      return (await harness.overlayEval<boolean>(`!!document.querySelector('.voice-prompt-said em')`)) ? true : undefined
    },
    { timeoutMs: 40_000, intervalMs: 500 },
  ).catch(async (error: unknown) => {
    await shoot(run, 'no-term')
    throw error
  })
  await shoot(run, '30-listening')
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  await sleep(900)
  await shoot(run, '31-listening-collapsed')
}

function expectClean(run: Run): void {
  for (const [state, issues] of run.issues) expect.soft(issues, `${run.theme} ${state}`).toEqual([])
}

describe('the states screenshot review (#359)', () => {
  beforeAll(async () => {
    screen = await startScreen()
  })

  afterAll(() => {
    screen?.xvfb.kill()
    screen = null
  })

  for (const theme of ['dark', 'light'] as const) {
    it(`shoots every awake state, Settings and the Weight page in ${theme}`, async () => {
      const run = await launch(theme)
      try {
        await walkTheShell(run)
      } finally {
        await close(run)
      }
      expectClean(run)
    }, 400_000)

    it(`shoots the Voice Prompt taking an Utterance in ${theme}`, async () => {
      const run = await launch(theme, {
        BINGBONG_WAKE_ENGINE: 'node',
        BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
        // Two Utterances in one Hot Listen: the page collected at the first speech start comes back empty (see
        // #359's report), so the words shown are the second's, taken over the page with its Page Terms.
        BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 40), ...frames(QUIET, 40), SPEECH]),
        BINGBONG_STT_SCRIPT: JSON.stringify(['what about', { text: WORDS, partials: ['what about', 'what about the Fixture', ...frames(0, 200).map(() => WORDS)] }]),
      })
      try {
        await walkTheVoicePrompt(run)
      } finally {
        await close(run)
      }
      expectClean(run)
    }, 200_000)
  }
})
