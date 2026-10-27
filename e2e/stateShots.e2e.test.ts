import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EAR_FAILED, EAR_FAILED_LINE, EAR_FAILED_MORE, REST_HINT } from '../src/core/voice/voiceHint'
import { colourFloor } from './colourFloor'
import { startFixtureServer, YOUTUBE_FIXTURE_NOTHING, type FixtureServer } from './fixtureServer'
import { decisionScript, HUB_TASK_LINE, hubTaskReadings, readingOf } from './scriptedJev'
import { startHarness, type Harness } from './harness'
import { promptBarScript } from './scripts'
import { startUsageStandIn, type UsageStandIn } from './usageStandIn'
import { sleep, waitFor } from './waitFor'
import { brotherWeighIns, standInWeighIns, TWO_PEOPLE, weighInsFile } from './weighIns'

// The states' screenshot review (#359, ADR 0078): the
// round-6 state list replayed against the fixture server at the
// appliance's 1920×1080, in dark and light — the same Commands in the same
// order as the shots the F1 theme was drawn over, then Now Playing's card on
// the Idle Screen in each of its states (#365), Settings section by
// section, the Weight page, a Weigh-in over the pane, and an Utterance
// being taken over a page with a Page Term on it. Each state is one PNG of
// the whole screen (the dashboard, the pane and the panel are separate
// native views, so the X root is grabbed, not one view), named like the
// round-6 shots, into BINGBONG_STATE_SHOT_DIR (default a temp folder). In
// every state the app's own surfaces must set no text under 16 px, clip or
// overflow none of it, and in dark stand on the pure black ground — the
// page in the pane is not ours and is not read — and hold the colour floor
// (#437, `colourFloor.ts`): 7:1 in dark, two typefaces, the accent only on
// what is live while nothing runs, no colour in the accent's or the
// failure's hue but those two; and on the dashboard the Toolbar's controls
// share the band's centre and the pane is flat and edge to edge (#453,
// SHELL_SCRIPT). It runs in every `pnpm test:e2e` — the owner's
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

/** What breaks the theme's floor on the surface it runs in: small, clipped or off-screen text, or in dark a ground that is not pure black. */
const CHECK_SCRIPT = `(() => {
  const issues = []
  if (matchMedia('(prefers-color-scheme: dark)').matches) {
    // The ground and every panel on it: any opaque surface larger than a control.
    for (const el of [document.body, ...document.querySelectorAll('body *')]) {
      const box = el.getBoundingClientRect()
      const ground = getComputedStyle(el).backgroundColor
      if ((el === document.body || box.width * box.height > 40000) && /^rgb\\(/.test(ground) && ground !== 'rgb(0, 0, 0)') issues.push('ground not black (' + ground + '): ' + (el.className || el.tagName))
    }
  }
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className !== '' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()
    const words = (el.value || el.placeholder || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
    return cls + ' "' + words + '"'
  }
  const contentWidth = (el) => el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight)
  // The glance surface (#436): every status item at 65 px, read from 2 m — the Turn Card's stage word among them (#474).
  for (const el of document.querySelectorAll('.status-pill, .run-hint, .idle-voice-hint, .idle-voice-state, .voice-prompt-state, .turn-stage-word')) {
    // The panel's TRANSCRIBING steps down to 40 px where 65 px would not fit its width (#447): the panel only, never the Idle Screen or the Toolbar.
    const floor = el.matches('.voice-prompt--transcribing .voice-prompt-state') && contentWidth(el.closest('.voice-prompt')) <= 540 ? 40 : 65
    if (el.getBoundingClientRect().width > 1 && parseFloat(getComputedStyle(el).fontSize) < floor) issues.push('status under ' + floor + ' px (' + getComputedStyle(el).fontSize + '): ' + name(el))
  }
  // The panel's state word and a wait's seconds (#447): whole and inside the Voice Prompt's own box, at whatever width the panel is.
  for (const el of document.querySelectorAll('.voice-prompt-state, .voice-prompt .ear-wait-tail')) {
    const prompt = el.closest('.voice-prompt')
    const box = el.getBoundingClientRect()
    if (prompt === null || box.width <= 1) continue
    const outer = prompt.getBoundingClientRect()
    const pad = getComputedStyle(prompt)
    if (box.right > outer.right - parseFloat(pad.paddingRight) + 1 || box.left < outer.left + parseFloat(pad.paddingLeft) - 1) issues.push('out of the Voice Prompt (' + Math.round(box.left) + '..' + Math.round(box.right) + ' in ' + Math.round(outer.left) + '..' + Math.round(outer.right) + '): ' + name(el))
    if (el.getClientRects().length > 1 || box.height > parseFloat(getComputedStyle(el).fontSize) * 1.6) issues.push('broken across lines: ' + name(el))
  }
  // A run's wait (#462): in the Capsule's face, its seconds whole, inside the Capsule and the screen and under
  // nothing; the detail gives way wholly before the stage's words, and fills the room before it ellipsizes.
  const sans = (family) => family.replace(/["'\\s]/g, '')
  for (const hint of document.querySelectorAll('.run-hint')) {
    if (hint.getBoundingClientRect().width <= 1) continue
    if (sans(getComputedStyle(hint).fontFamily) !== sans(getComputedStyle(document.documentElement).getPropertyValue('--font-sans'))) issues.push('run hint not in the sans (' + getComputedStyle(hint).fontFamily + '): ' + name(hint))
    const capsule = hint.closest('.status-capsule') ?? hint.parentElement
    const outer = capsule.getBoundingClientRect()
    const pad = getComputedStyle(capsule)
    const pill = capsule.querySelector('.status-pill')
    if (pill !== null && pill.getBoundingClientRect().right > outer.right - parseFloat(pad.paddingRight) + 1) issues.push('state word out of the Capsule: ' + name(pill))
    const tail = hint.querySelector('.run-hint-tail')
    const box = tail === null ? null : tail.getBoundingClientRect()
    if (box === null || box.width <= 1) { issues.push('run hint without its seconds: ' + name(hint)); continue }
    if (box.right > outer.right - parseFloat(pad.paddingRight) + 1 || box.left < outer.left + parseFloat(pad.paddingLeft) - 1) issues.push('seconds out of the Capsule (' + Math.round(box.left) + '..' + Math.round(box.right) + ' in ' + Math.round(outer.left) + '..' + Math.round(outer.right) + '): ' + name(tail))
    if (box.right > hint.getBoundingClientRect().right + 1 || tail.scrollWidth > Math.ceil(box.width) + 1) issues.push('seconds cut: ' + name(tail))
    if (box.right > innerWidth + 1 || box.left < -1 || box.bottom > innerHeight + 1 || box.top < -1) issues.push('seconds off the surface: ' + name(tail))
    const top = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
    if (top === null || !tail.contains(top)) issues.push('seconds covered by ' + (top === null ? 'nothing drawn' : name(top)) + ': ' + name(tail))
    const detail = hint.querySelector('.run-hint-detail')
    const clipped = (el) => el.scrollWidth > el.clientWidth + 1
    if (detail !== null && detail.getBoundingClientRect().width > 1 && [...hint.querySelectorAll('.run-hint-stage')].some(clipped)) issues.push('stage words cut before the detail: ' + name(hint))
    if (detail !== null && clipped(detail) && hint.getBoundingClientRect().right < outer.right - parseFloat(pad.paddingRight) - 2) issues.push('detail cut with room to spare: ' + name(hint))
  }
  // The type ladder (#436): four sizes on a surface, the display numerals (data-display) apart.
  const sizes = new Set()
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
    if (!el.closest('[data-display]')) sizes.add(style.fontSize + ' ' + name(el))
    const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip'
    const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip'
    // The live words and the kept result in the capsule (#331, #436), a stage's long detail and then its words beside its seconds (#428, #462), the words an ear's wait is on beside its seconds (#442), a long address after its host (#453), and a Turn Card history row's text (#474), ellipsize by design: the clips allowed.
    if (!field && clipsX && el.scrollWidth > el.clientWidth + 1 && !el.matches('.voice-hint--listening, .voice-hint--result, .run-hint-detail, .run-hint-stage, .ear-wait-object, .url-display, .turn-step-text')) issues.push('clipped across: ' + name(el))
    // The Ledger Strip's words row (#475) holds two lines and cuts a longer Answer there: the Feed holds the rest.
    if (!field && clipsY && el.scrollHeight > el.clientHeight + 1 && !el.matches('.peek-card--band .turn-words')) issues.push('clipped down: ' + name(el))
    if (box.right > innerWidth + 1 || box.left < -1) issues.push('off the surface: ' + name(el))
    // Words squeezed into a column a few letters wide, wrapping down the screen; a label set vertical on purpose (the Feed's edge tab) is not.
    if (!field && !style.writingMode.startsWith('vertical') && box.width < 80 && box.height > parseFloat(style.fontSize) * 6) issues.push('squeezed: ' + name(el))
  }
  const ladder = new Map()
  for (const entry of sizes) {
    const size = entry.slice(0, entry.indexOf(' '))
    if (!ladder.has(size)) ladder.set(size, entry.slice(entry.indexOf(' ') + 1))
  }
  if (ladder.size > 4) issues.push('more than 4 type sizes: ' + [...ladder].map(([size, first]) => size + ' ' + first).join(', '))
  return issues
})()`

/**
 * The Feed read from the chair (#454): with Details off no run detail, time or action line is drawn, and every word
 * in the panel's Feed and Voice Prompt is Inter at 16 px or more — an Answer's own code blocks aside, which are the
 * page's words, not the panel's.
 */
const FEED_CHECK = `(() => {
  const issues = []
  const feed = document.querySelector('.feed')
  if (feed === null) return issues
  const drawn = (el) => { const box = el.getBoundingClientRect(); return el.getClientRects().length > 0 && box.width > 1 && box.height > 1 && getComputedStyle(el).visibility !== 'hidden' }
  const name = (el) => (typeof el.className === 'string' && el.className !== '' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()) + ' "' + (el.value || el.placeholder || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40) + '"'
  if (!feed.classList.contains('feed--details')) {
    for (const el of feed.querySelectorAll('.feed-run, .feed-time, .feed-action')) if (drawn(el)) issues.push('a Detail drawn with Details off: ' + name(el))
  }
  for (const el of feed.querySelectorAll('*')) {
    if (el.closest('svg, .feed-sr, .feed-markdown pre, .feed-markdown code')) continue
    if (feed.classList.contains('feed--details') && el.closest('.feed-detail')) continue
    const field = el instanceof HTMLInputElement && el.type === 'text'
    const own = field ? (el.value || el.placeholder) !== '' : [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== '')
    if (!own || !drawn(el)) continue
    const style = getComputedStyle(el)
    if (parseFloat(style.fontSize) < 16) issues.push('Feed text under 16 px (' + style.fontSize + '): ' + name(el))
    if (!style.fontFamily.startsWith('InterVariable')) issues.push('Feed text not in Inter (' + style.fontFamily + '): ' + name(el))
  }
  return issues
})()`

/**
 * The shell's grid and frame (#453), on the dashboard while the Toolbar is up: every Toolbar control's vertical
 * centre within 1 px of the band's, and the pane flat and edge to edge — from x=0 to the window's right edge (or
 * the docked panel's left), down to the window's foot — with no element around it painting a border, a radius,
 * an outline or a shadow. The band's own bottom hairline is the pane's only edge, and it is the band's.
 */
const SHELL_SCRIPT = `(() => {
  const issues = []
  const band = document.querySelector('.toolbar')
  if (band === null) return issues
  const middle = (box) => (box.top + box.bottom) / 2
  const centre = middle(band.getBoundingClientRect())
  for (const el of band.querySelectorAll('.status-capsule, .toolbar-widget, .chrome-button, .url-form')) {
    const box = el.getBoundingClientRect()
    if (box.width <= 1) continue
    const off = middle(box) - centre
    if (Math.abs(off) > 1) issues.push('off the band centre by ' + off.toFixed(1) + ' px: ' + el.className.split(' ').slice(0, 2).join('.') + ' ' + (el.getAttribute('aria-label') ?? ''))
  }
  const viewport = document.querySelector('.browser-viewport')
  if (viewport === null) return issues
  const pane = viewport.getBoundingClientRect()
  const docked = document.querySelector('.feed-slot--docked:not(.feed-slot--collapsed):not(.feed-slot--peek):not(.feed-slot--hidden)')
  const right = docked === null ? innerWidth : docked.getBoundingClientRect().left
  if (Math.abs(pane.left) > 0.5) issues.push('pane not at the left edge: ' + pane.left)
  if (Math.abs(pane.right - right) > 0.5) issues.push('pane not to the right edge (' + pane.right + ', want ' + right + ')')
  if (Math.abs(pane.bottom - innerHeight) > 0.5) issues.push('pane not to the foot (' + pane.bottom + ', want ' + innerHeight + ')')
  if (Math.abs(pane.top - band.getBoundingClientRect().bottom) > 0.5) issues.push('pane not under the band (' + pane.top + ')')
  for (let el = viewport; el !== null && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el)
    const painted = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => parseFloat(style['border' + side + 'Width']) > 0 && style['border' + side + 'Style'] !== 'none')
    if (painted.length > 0) issues.push('a border around the pane (' + painted.join(', ') + '): ' + (el.className || el.tagName))
    if (parseFloat(style.borderTopLeftRadius) > 0 || parseFloat(style.borderBottomRightRadius) > 0) issues.push('a radius around the pane: ' + (el.className || el.tagName))
    if (style.boxShadow !== 'none') issues.push('a shadow around the pane: ' + (el.className || el.tagName))
    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) issues.push('an outline around the pane: ' + (el.className || el.tagName))
    if (el !== viewport && el.matches('.dashboard-browsing, .browser-pane') && ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style['padding' + side]) > 0)) issues.push('an inset around the pane: ' + el.className)
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
/** Chromium's fake mic: with no capture device the mic's open fails, which closes the listen at once (#444). */
const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const frames = (value: number, count: number): number[] => Array.from({ length: count }, () => value)

type Theme = 'dark' | 'light'

interface Run {
  harness: Harness
  fixture: FixtureServer
  usage: UsageStandIn
  userDataDir: string
  theme: Theme
  /** The theme, and the window's size when it is not the appliance's: what each shot's file and failures are named by. */
  label: string
  /** Every state's failures, by state, asserted once the whole walk is shot. */
  issues: Map<string, string[]>
  /** The live-tinted surfaces each state showed (#449), so the floor is known to have read them. */
  tinted: Map<string, string[]>
}

/** A window size the walk runs at: the appliance's, or a laptop's (#447). */
interface Size {
  width: number
  height: number
}
const APPLIANCE: Size = { width: WIDTH, height: HEIGHT }

async function launch(theme: Theme, env: Record<string, string> = {}, launchArgs: string[] = [], size: Size = APPLIANCE): Promise<Run> {
  const fixture = await startFixtureServer()
  // The owner's two providers, so the Idle Screen's middle Column is laid out as on the appliance.
  const usage = await startUsageStandIn(2)
  const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-state-shot-'))
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ appearance: theme, weather: { city: 'London', units: 'metric' }, usageDashboard: usage.settings, weight: TWO_PEOPLE }), 'utf8')
  await writeFile(join(userDataDir, 'weighins.json'), weighInsFile([...standInWeighIns(), ...brotherWeighIns()]), 'utf8')
  await writeFile(calendarFile(userDataDir), JSON.stringify({ events: [] }), 'utf8')
  const harness = await startHarness({
    fixture,
    userDataDir,
    launchArgs: ['--mute-audio', ...launchArgs],
    // A wake ear that never fires, so the Voice Prompt waits for "Bing Bong" as the appliance does.
    env: { DISPLAY: screen?.display, BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, BINGBONG_WAKE_ENGINE: 'node', BINGBONG_WAKE_SCRIPT: '[0.01]', BINGBONG_VAD_SCRIPT: '[0.01]', BINGBONG_STT_SCRIPT: '[]', BINGBONG_CALENDAR_FIXTURE: calendarFile(userDataDir), ...env },
  })
  // The window at the appliance's size: Electron has no Browser.setWindowBounds, the X server has.
  onScreen(`xdotool search --onlyvisible --name '.*' windowmove %@ 0 0 windowsize %@ ${size.width} ${size.height}`)
  const width = await waitFor(async () => {
    const inner = await harness.dashboardEval<number>('innerWidth')
    return Math.abs(inner - size.width) < 40 ? inner : undefined
  }, { timeoutMs: 10_000, intervalMs: 100 }).catch(async () => harness.dashboardEval<number>('innerWidth'))
  expect(Math.abs(width - size.width), `the window at ${size.width} px wide`).toBeLessThan(40)
  await sleep(800)
  const label = size === APPLIANCE ? theme : `${theme}-${size.width}x${size.height}`
  return { harness, fixture, usage, userDataDir, theme, label, issues: new Map(), tinted: new Map() }
}

async function close(run: Run): Promise<void> {
  await run.harness.quit().catch(() => {})
  await run.fixture.close().catch(() => {})
  await run.usage.close().catch(() => {})
  // The profile was passed in, so the harness leaves it: each launch would strand ~224 MB in /tmp.
  await rm(run.userDataDir, { recursive: true, force: true }).catch(() => {})
}

/** The Calendar's stand-in source (re-read on every ask): empty until a state fills it. */
const calendarFile = (userDataDir: string): string => join(userDataDir, 'calendar.json')

/** The whole screen as it shows, and what breaks the floor on each of the app's surfaces in it; `rest` while nothing runs, no Utterance is taken and no Weigh-in is live. */
async function shoot(run: Run, state: string, rest = true): Promise<void> {
  await sleep(500)
  mkdirSync(OUT, { recursive: true })
  onScreen(`xwd -root -silent | ffmpeg -loglevel error -y -f xwd_pipe -i - '${join(OUT, `${run.label}-${state}.png`)}'`)
  const found: string[] = []
  const tinted: string[] = []
  // While the Idle Screen is up the panel's view is hidden (its slot unmounted): what the overlay page lays out then, in
  // the last bounds it had, is seen by no one and is not read.
  const idleUp = await run.harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`).catch(() => false)
  const surfaces: [string, (expression: string) => Promise<string[]>][] = [
    ['dashboard', (expression) => run.harness.dashboardEval<string[]>(expression)],
    ...(idleUp ? [] : [['panel', (expression: string) => run.harness.overlayEval<string[]>(expression)] as [string, (expression: string) => Promise<string[]>]]),
  ]
  // A surface that cannot be read is a failure too: the guard never passes on what it did not check.
  const read = async (surface: string, evaluate: (expression: string) => Promise<string[]>): Promise<void> => {
    for (const script of [CHECK_SCRIPT, colourFloor(rest)]) {
      for (const issue of await evaluate(script).catch((error: unknown) => [`not read: ${String(error)}`])) found.push(`${surface}: ${issue}`)
    }
    tinted.push(...(await evaluate(LIVE_TINTED).catch((error: unknown) => (found.push(`${surface}: tint not read: ${String(error)}`), []))))
  }
  for (const [surface, evaluate] of surfaces) await read(surface, evaluate)
  for (const issue of await run.harness.overlayEval<string[]>(FEED_CHECK).catch((error: unknown) => [`not read: ${String(error)}`])) found.push(`panel: ${issue}`)
  for (const issue of await run.harness.dashboardEval<string[]>(SHELL_SCRIPT).catch((error: unknown) => [`shell not read: ${String(error)}`])) found.push(`dashboard: ${issue}`)
  // The pop-up's own view is read only while the pop-up is in it, not riding the open panel's top.
  const riding = await run.harness.overlayEval<boolean>(`!!document.querySelector('.overlay-chrome--open .weighin-popup')`).catch(() => false)
  if (!riding && (await run.harness.weighInEval<boolean>(`!!document.querySelector('.weighin-popup')`).catch(() => false))) {
    await read('weigh-in', (expression) => run.harness.weighInEval<string[]>(expression))
  }
  run.issues.set(state, found)
  run.tinted.set(state, tinted)
}

/** The first class of each live-tinted element on show: the surfaces the floor's tint rule read in a state. */
const LIVE_TINTED = `[...document.querySelectorAll('.live-tint')].filter((el) => el.getBoundingClientRect().width > 1).map((el) => el.classList[0])`

/** The tinted surfaces a state must show (#449): the floor passing them is only proof if they were there. */
function expectTinted(run: Run, state: string, surfaces: string[]): void {
  expect.soft(run.tinted.get(state), `${run.theme} ${state}: the live-tinted surfaces read`).toEqual(expect.arrayContaining(surfaces))
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

/** A failure's Answer names the line that would have worked and never the model that reads the words (#438, principles 9 and 10). */
async function expectNextLine(run: Run, state: string): Promise<void> {
  const answer = await run.harness.overlayEval<string>(`[...document.querySelectorAll('.feed-entry--assistant')].at(-1)?.textContent ?? ''`)
  expect.soft(answer, `${run.theme} ${state}: the Answer says what to say next`).toMatch(/Try “[^”]+”\./)
  expect.soft(answer, `${run.theme} ${state}: the Answer never names the model`).not.toMatch(/jev/i)
}

/** The round-6 list (`current/log.txt`): the Commands in order, a shot after each state. */
/** The Ledger Strip's face (#475): its `data-state`, '' while no band shows. */
function bandFace(harness: Harness): Promise<string> {
  return harness.overlayEval<string>(`document.querySelector('.peek-card--band')?.dataset.state ?? ''`)
}

async function walkTheShell(run: Run): Promise<void> {
  const { harness, fixture } = run
  await shoot(run, '06-awake')
  // One wording for the rest state on every surface (#437, principle 9): the capsule, the empty Feed, the Prompt Bar.
  expect.soft(await harness.dashboardEval<string>(`document.querySelector('.voice-hint--monitoring')?.textContent ?? ''`), `${run.theme} 06-awake: the capsule's rest hint`).toBe(REST_HINT)
  await harness.ensurePanelOpen()
  await shoot(run, '07-feed-empty')
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.feed-empty')?.textContent ?? ''`), `${run.theme} 07-feed-empty: the Feed's rest hint`).toBe(REST_HINT)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.prompt-input')?.placeholder ?? ''`), `${run.theme} 07-feed-empty: the Prompt Bar's one placeholder (#455)`).toBe('Type a command')
  await command(run, `navigate ${fixture.url('/story')}`)
  await shoot(run, '08-page-loaded')
  await command(run, 'read')
  await shoot(run, '09-read-answer')
  // The one Details switch (#454): off by default; on, every entry's time and action line is drawn, and the choice is kept.
  const detailsDrawn = `[...document.querySelectorAll('.feed-time, .feed-action')].filter((el) => el.getClientRects().length > 0).length`
  expect.soft(await harness.overlayEval<number>(detailsDrawn), `${run.theme} 09-read-answer: no Detail drawn by default`).toBe(0)
  await clickPanel(run, '.feed-details-toggle')
  await sleep(300)
  expect.soft(await harness.overlayEval<number>(detailsDrawn), `${run.theme} 09c-read-answer-details: the times and action lines drawn`).toBeGreaterThan(2)
  expect.soft(await harness.overlayEval<string | null>(`localStorage.getItem('bingbong.feedDetails')`), `${run.theme}: the switch is kept`).toBe('on')
  await shoot(run, '09c-read-answer-details')
  await clickPanel(run, '.feed-details-toggle')
  await sleep(300)
  // The panel shut, the capsule keeps the sentence the read said (#436), until the next input.
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  const kept = await waitFor(async () => {
    const words = await harness.dashboardEval<string>(`document.querySelector('.status-capsule')?.textContent ?? ''`)
    return /lighthouse/i.test(words) ? words : undefined
  }, { timeoutMs: 10_000, intervalMs: 100 }).catch(async () => harness.dashboardEval<string>(`document.querySelector('.status-capsule')?.textContent ?? ''`))
  expect.soft(kept, 'the capsule keeps the read sentence with the panel shut').toMatch(/lighthouse/i)
  await shoot(run, '09b-read-answer-panel-shut')
  await command(run, 'click 999')
  await shoot(run, '10-failure')
  await expectNextLine(run, '10-failure')
  await command(run, 'scroll down')
  await shoot(run, '11-scrolled')
  await command(run, 'zorblax the quux thing')
  await shoot(run, '12-unknown-command')
  await expectNextLine(run, '12-unknown-command')
  await command(run, 'back')
  await shoot(run, '13-back')
  // The Peek Card in its Ledger Strip form (#475): a Command run with the panel collapsed ends on the band's Done face — the end in words, the journey's rows beside it.
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  await sleep(900)
  await harness.dashboardEval(`void window.bingbong.assistant.submit(${JSON.stringify(`navigate ${fixture.url('/story')}`)})`)
  await waitFor(async () => ((await bandFace(harness)) === 'done' ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 }).catch(async (error: unknown) => {
    await shoot(run, 'no-peek-done')
    throw error
  })
  await shoot(run, '14-collapsed-peek')
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-stage-word')?.textContent ?? ''`), `${run.theme} 14-collapsed-peek: the end in words`).toBe('Done')
  expect.soft(await harness.overlayEval<string[]>(`[...document.querySelectorAll('.peek-card--band .turn-step:not(.turn-step--blank) .turn-step-label')].map((el) => el.textContent)`), `${run.theme} 14-collapsed-peek: the journey's rows`).toEqual(expect.arrayContaining(['Read as', 'Opening', 'Done']))
  // A typed line whose page is held, on the band (#475): the response holds the navigate itself, so Opening is the wait
  // that shows — the action's word, its host, its seconds — and Loading passes in a blink before the end; every face's
  // geometry is read as it passes. The line is fired, not waited out: `submit` settles at the Command's end.
  await harness.overlayEval(BAND_GEOMETRY)
  await harness.dashboardEval(`void window.bingbong.assistant.submit(${JSON.stringify(`navigate ${fixture.url('/held-response')}`)})`)
  await waitFor(async () => ((await bandFace(harness)) === 'acting' ? true : undefined), { timeoutMs: 20_000, intervalMs: 50 }).catch(async (error: unknown) => {
    await shoot(run, 'no-peek-opening')
    throw error
  })
  // Past the stage's stuck bound (#442), as 16-loading is shot.
  await sleep(3_000)
  // The Capsule beside it (#480): the run hint has the Capsule's room and the rest hint is not drawn beside it; the
  // floor's run-hint checks hold its host whole while it fits. Read before the shot, as the band's words are.
  expect.soft(await harness.dashboardEval<boolean>(`!!document.querySelector('.status-capsule .voice-hint')`), `${run.theme} 14b-collapsed-peek-opening: no rest hint beside the run`).toBe(false)
  expect.soft(await harness.dashboardEval<string>(`document.querySelector('.status-capsule .run-hint')?.textContent ?? ''`), `${run.theme} 14b-collapsed-peek-opening: the host, its stage and its seconds`).toMatch(/^127\.0\.0\.1 · (still acting · )?\d+s$/)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-stage')?.textContent ?? ''`), `${run.theme} 14b-collapsed-peek-opening: the action's word, its wait and its seconds`).toMatch(/^Opening…still acting · [1-9]s$/)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-words')?.textContent ?? ''`), `${run.theme} 14b-collapsed-peek-opening: the host`).toBe('127.0.0.1')
  await shoot(run, '14b-collapsed-peek-opening', false)
  await waitFor(async () => ((await bandFace(harness)) === 'done' ? true : undefined), { timeoutMs: 40_000, intervalMs: 50 }).catch(async (error: unknown) => {
    await shoot(run, 'no-peek-held-done')
    throw error
  })
  const bandFaces = await harness.overlayEval<Record<string, unknown>>(`window.__faces`)
  expect.soft(Object.keys(bandFaces), `${run.theme}: the faces the band passed through on the held page`).toEqual(expect.arrayContaining(['thinking', 'acting', 'loading', 'done']))
  for (const key of Object.keys(bandFaces)) expect.soft(bandFaces[key], `${run.theme}: the band's geometry at ${key} against done`).toEqual(bandFaces['done'])
  SHELL_BAND_DONE.set(run.theme, bandFaces['done'])
  await harness.ensurePanelOpen()
  await clickPanel(run, '[aria-label="Dock the feed panel"]')
  await sleep(1200)
  await shoot(run, '15-docked')
  await command(run, `navigate ${fixture.url('/held-response')}`, false)
  await sleep(2500)
  await shoot(run, '16-loading', false)
  // The Feed draws no wash (#454): the working Command's words step up instead, and the run detail is behind Details.
  expectTinted(run, '16-loading', ['status-capsule'])
  // The wait names its stage and host in the Feed's words (#438), never the raw line; held past its stuck bound
  // (#442) it says which wait it is before the seconds.
  const waiting = await harness.dashboardEval<string>(`document.querySelector('.toolbar .status-capsule')?.textContent ?? ''`)
  expect.soft(waiting, `${run.theme} 16-loading: the capsule names the stage and host`).toMatch(/^(Opening…127\.0\.0\.1 · (still acting · )?|Loading…127\.0\.0\.1 · (page still loading · )?)\d+s/)
  await clickPanel(run, '[aria-label="Stop active command"]')
  await promptIdle(harness)
  await sleep(800)
  await shoot(run, '17-stopped')
  await clickPanel(run, '[aria-label="Undock the feed panel"]')
  await sleep(800)
  await command(run, `navigate ${fixture.url('/consent-wall')}`)
  await shoot(run, '18-consent-wall')
  await expectNextLine(run, '18-consent-wall')
  await command(run, `navigate ${fixture.url('/dialog-wall')}`)
  await shoot(run, '19-dialog-wall')
  await expectNextLine(run, '19-dialog-wall')
  await command(run, `navigate ${fixture.url('/interactive')}`)
  await command(run, 'screenshot')
  await shoot(run, '20-screenshot-cmd')
  await command(run, 'navigate http://127.0.0.1:1/nothing')
  await shoot(run, '21-nav-failed')
  await expectNextLine(run, '21-nav-failed')
  await command(run, `navigate ${fixture.url('/empty-main')}`)
  await shoot(run, '22-empty-landing')
  // A Task walked to a sure yes (#375): the Capsule's bar full where the Task left it, the Feed's lines read closer, no closer, closer.
  await command(run, `navigate ${fixture.url('/hub-index')}`)
  await command(run, HUB_TASK_LINE)
  await shoot(run, '22-task-progress')
  await command(run, 'timer 25 minutes')
  await shoot(run, '23-timer')
  await command(run, 'play fixture song')
  await sleep(2500)
  await shoot(run, '24-music-playing')
  await command(run, 'pause')
  await shoot(run, '25-music-paused')
  await walkTheIdleMusic(run)

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
  await shoot(run, '02-weighin-live', false)
  await waitFor(async () => ((await harness.weighInEval<boolean>(`!!document.querySelector('.weighin-popup--settled')`).catch(() => false)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 50 })
  await shoot(run, '03-weighin-settled')
}

/**
 * Now Playing on the Idle Screen (#365): its full card playing, paused and
 * ended under the clock and two Clock Lines, then its smaller one under a
 * Timer with Up Next and the Last Page. The verbs are submitted as the
 * card's controls submit them, keeping the screen up.
 */
async function walkTheIdleMusic(run: Run): Promise<void> {
  const { harness } = run
  const submit = (line: string): Promise<unknown> => harness.dashboardEval(`window.bingbong.assistant.submit(${JSON.stringify(line)})`)
  const shown = (selector: string): Promise<true> =>
    waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 100 }).catch(async (error: unknown) => {
      await shoot(run, `no-${selector.replace(/\W+/g, '-')}`)
      throw error
    })
  const idle = async (): Promise<void> => {
    await harness.pressKey('pane', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
    await shown('.idle-screen')
  }
  const wake = async (): Promise<void> => {
    await tapIdleAwake(run)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 }).catch(async (error: unknown) => {
      await shoot(run, 'no-wake')
      throw error
    })
  }

  await command(run, 'timer off')
  await command(run, 'play')
  await idle()
  await shown('.idle-music-card--full.idle-music-card--playing')
  await shoot(run, '26-idle-music-playing')
  expect.soft(await harness.dashboardEval<string>(`document.querySelector('.idle-voice')?.textContent ?? ''`), `${run.theme} 26-idle-music-playing: the Idle Screen's rest hint`).toBe(REST_HINT)
  await submit('pause')
  await shown('.idle-music-card--full.idle-music-card--paused')
  await shoot(run, '26-idle-music-paused')
  // The song runs out: a `skip` with nothing queued leaves it playing (d4c123e), so it resumes in its last second.
  await harness.paneEval(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = Math.max(0, v.duration - 1) })()`)
  await submit('play')
  await shown('.idle-music-card--full.idle-music-card--ended')
  await shoot(run, '26-idle-music-ended')

  // An entry under way, so Up Next takes a Clock Line; the Calendar asks again as the screen mounts afresh.
  const now = Date.now()
  await writeFile(calendarFile(run.userDataDir), JSON.stringify({ events: [{ id: 'standup', source: 'stand-in', title: 'Stand-up', start: now - 10 * 60_000, end: now + 50 * 60_000, allDay: false }] }), 'utf8')
  await submit('play')
  await submit('timer 25 minutes')
  await wake()
  await idle()
  await shown('.idle-upnext')
  await shown('.idle-music-card--small.idle-music-card--playing')
  await shoot(run, '26-idle-music-small')

  await submit('timer off')
  await writeFile(calendarFile(run.userDataDir), JSON.stringify({ events: [] }), 'utf8')
  await wake()
  await sleep(800)
}

/** An Utterance being taken over a page whose "Fixture Museums" is a Page Term: "Listening…", the live words, the quiet that ends it. */
async function walkTheVoicePrompt(run: Run): Promise<void> {
  const { harness, fixture } = run
  await command(run, `navigate ${fixture.url('/empty-main')}`)
  // The page is in while the ear still loads; once it is in, the mic's frames advance the scripts one each, at its
  // pace: the wake, then speech the endpointer never sees end. The words are no Command, so nothing fires early (#326).
  if (!(await harness.overlayEval<boolean>(`!!document.querySelector('.voice-prompt--starting')`))) {
    await shoot(run, 'no-ear-starting')
    expect.fail('the ear still loading once the page is in: BINGBONG_VAD_LOAD_MS ran out before the walk had its page')
  }
  await waitFor(async () => ((await harness.overlayEval<boolean>(`!!document.querySelector('.voice-prompt--listening')`)) ? true : undefined), { timeoutMs: 30_000, intervalMs: 100 })
  // "Listening…" held to the glance floor (#436) as soon as it shows, before any words come.
  await shoot(run, '29-listening', false)
  expectTinted(run, '29-listening', ['status-capsule', 'voice-prompt'])
  // One state, one face (#454, ui.md 9): the Capsule's word, in Inter (FEED_CHECK) at the glance floor (CHECK_SCRIPT).
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.voice-prompt-state')?.textContent ?? ''`), `${run.theme} 29-listening: the Capsule's word`).toBe('Listening…')
  await waitFor(async () => ((await harness.overlayEval<boolean>(`!!document.querySelector('.voice-prompt-said em')`)) ? true : undefined), { timeoutMs: 25_000, intervalMs: 100 }).catch(async (error: unknown) => {
    await shoot(run, 'no-term')
    throw error
  })
  await shoot(run, '30-listening', false)
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  await sleep(900)
  await shoot(run, '31-listening-collapsed', false)
  // A typed line run in the Hot Listen (#472's form, #480): the live words give way wholly before the run's host does.
  await held(run, '31b-listening-collapsed-opening', async () => {
    expect.soft(await harness.dashboardEval<boolean>(`!!document.querySelector('.status-capsule .voice-wave')`), `${run.theme} 31b-listening-collapsed-opening: the ear still open beside the run`).toBe(true)
    expect.soft(await harness.dashboardEval<boolean>(`!!document.querySelector('.status-capsule .voice-hint--listening')`), `${run.theme} 31b-listening-collapsed-opening: the live words beside the run`).toBe(true)
  })
}

/**
 * A typed line whose page is held (#480), fired from the dashboard so the panel stays as it is — `submit` settles only
 * at the Command's end — shot past the stage's stuck bound (#442) as 16-loading is, then stopped.
 */
async function held(run: Run, state: string, during: () => Promise<void>): Promise<void> {
  const { harness, fixture } = run
  await harness.dashboardEval(`void window.bingbong.assistant.submit(${JSON.stringify(`navigate ${fixture.url('/held-response')}`)})`)
  await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.status-capsule .run-hint')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 50 }).catch(async (error: unknown) => {
    await shoot(run, `no-${state}`)
    throw error
  })
  await sleep(3_000)
  // Read before the shot: the floor's reads take seconds, and the held page lets go at 12 s.
  await during()
  await shoot(run, state, false)
  await harness.dashboardEval(`window.bingbong.assistant.abort()`)
  await waitFor(async () => ((await harness.dashboardEval<boolean>(`!document.querySelector('.status-capsule .run-hint')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 }).catch(() => {})
  await sleep(800)
}

/**
 * A tap that wakes the Idle Screen to the page under it. While a Turn Card (#474) is up it covers the date, and a tap on
 * the card only closes it, keeping the Idle Screen up by design: the tap goes to its scrim, beside the card, instead.
 */
async function tapIdleAwake(run: Run): Promise<void> {
  const { harness } = run
  const scrim = await harness.dashboardEval<boolean>(`document.elementFromPoint(8, 8)?.classList.contains('turn-scrim') ?? false`)
  if (scrim) await harness.clickDashboardAt(8, 8)
  else await harness.clickDashboardElement('.idle-date')
}

/**
 * The ear's waits narrated (#442): the cold start — the scripted VAD "loading"
 * — on the Voice Prompt, the Capsule and the Idle Screen, never inviting
 * speech; a line taken while the transcriber still loads, held and said so;
 * then a slow read, Transcribing with the words and their count, on the
 * Capsule and the Voice Prompt.
 */
async function walkTheEarWaits(run: Run): Promise<void> {
  const { harness } = run
  const shown = async (evaluate: (expression: string) => Promise<boolean>, selector: string, state: string, timeoutMs = 15_000): Promise<void> => {
    await waitFor(async () => ((await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) ? true : undefined), { timeoutMs, intervalMs: 100 }).catch(async (error: unknown) => {
      await shoot(run, `no-${state}`)
      throw error
    })
  }
  const onDashboard = (expression: string): Promise<boolean> => harness.dashboardEval<boolean>(expression)
  const onPanel = (expression: string): Promise<boolean> => harness.overlayEval<boolean>(expression)
  const words = (evaluate: (expression: string) => Promise<string>, selector: string): Promise<string> => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)

  // The cold start: the Voice Prompt in the open panel, the Capsule with the panel shut, the Idle Screen.
  await harness.ensurePanelOpen()
  await shown(onPanel, '.voice-prompt--starting', 'ear-starting')
  expect.soft(await words((e) => harness.overlayEval<string>(e), '.voice-prompt'), 'the Voice Prompt names the ear loading and its seconds').toMatch(/Starting.*loading the ear · \d+s/)
  expect.soft(await harness.overlayEval<string>('document.body.innerText'), 'nothing in the panel invites speech').not.toMatch(/Bing Bong|\bsay\b/i)
  expect.soft(await words((e) => harness.dashboardEval<string>(e), '.status-capsule'), 'nor in the Capsule').not.toMatch(/Ready|Bing Bong/)
  await shoot(run, '32-ear-starting')
  // A typed line goes on while the ear loads; its page is what a tap on the Idle Screen wakes to.
  await command(run, `navigate ${run.fixture.url('/story')}`)
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  await shown(onDashboard, '.voice-hint--starting', 'ear-starting-capsule')
  expect.soft(await words((e) => harness.dashboardEval<string>(e), '.status-capsule'), 'the Capsule says Starting, the ear loading and its seconds').toMatch(/Starting….*loading the ear · \d+s/)
  await shoot(run, '33-ear-starting-capsule')
  await harness.pressKey('pane', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
  await shown(onDashboard, '.idle-voice--starting', 'ear-starting-idle')
  expect.soft(await words((e) => harness.dashboardEval<string>(e), '.idle-voice'), 'the Idle Voice Line never says Bing Bong while the ear cannot hear').toMatch(/^loading the ear · \d+sStarting…$/)
  await shoot(run, '34-ear-starting-idle')

  // The ear hears: from here the mic's frames play the script over the Idle Screen, which stays up through
  // them — the wake, then a line taken while the transcriber still loads, held: the ear still starting, its
  // words and their count.
  await shown(onDashboard, '.idle-voice--listening, .idle-voice--hearing', 'woken', 30_000)
  await shown(onDashboard, '.idle-voice--starting', 'held')
  await sleep(2_200)
  expect.soft(await words((e) => harness.dashboardEval<string>(e), '.idle-voice'), 'a held line is the ear still starting, its words and its count climbing').toMatch(/^“what about” · [2-9]sStarting…$/)
  await shoot(run, '35-ear-held-idle')
  // Read once the transcriber is in; the Hot Listen listens again.
  await shown(onDashboard, '.idle-voice--listening', 'listening-again', 30_000)

  // The second line of the Hot Listen, read slowly: the Idle Screen, then — a tap wakes the page under it —
  // the Capsule and the Voice Prompt, each with the words and their count.
  await shown(onDashboard, '.idle-voice--transcribing', 'transcribing-idle', 30_000)
  await sleep(2_200)
  expect.soft(await words((e) => harness.dashboardEval<string>(e), '.idle-voice'), 'the Idle Voice Line carries the words being read and their seconds').toMatch(/^“zorblax the quux” · [2-9]sTranscribing…$/)
  await shoot(run, '36-transcribing-idle')
  await tapIdleAwake(run)
  await shown(onDashboard, '.voice-hint--transcribing', 'transcribing-capsule')
  expect.soft(await words((e) => harness.dashboardEval<string>(e), '.voice-hint'), 'the Capsule carries them').toMatch(/^“zorblax the quux” · \d+s$/)
  await shoot(run, '37-transcribing-capsule')
  await harness.ensurePanelOpen()
  await shown(onPanel, '.voice-prompt--transcribing', 'transcribing-prompt')
  expect.soft(await words((e) => harness.overlayEval<string>(e), '.voice-prompt-said'), 'and so does the Voice Prompt').toMatch(/^“zorblax the quux” · \d+s$/)
  await shoot(run, '38-transcribing-voice-prompt')
}

/**
 * The ear's cold start ending in a fault (#447): the scripted VAD's load
 * fails, and the Starting wait ends — on the Voice Prompt, the Capsule and
 * the Idle Screen — with what did not start and what to do, the count
 * gone, and the fault in the fault log.
 */
async function walkTheEarFailing(run: Run): Promise<void> {
  const { harness } = run
  const until = async (evaluate: (expression: string) => Promise<boolean>, expression: string, state: string): Promise<void> => {
    await waitFor(async () => ((await evaluate(expression)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 }).catch(async (error: unknown) => {
      await shoot(run, `no-${state}`)
      throw error
    })
  }
  const onDashboard = (expression: string): Promise<boolean> => harness.dashboardEval<boolean>(expression)
  const onPanel = (expression: string): Promise<boolean> => harness.overlayEval<boolean>(expression)

  await harness.ensurePanelOpen()
  await until(onPanel, `document.querySelector('.voice-prompt-said')?.textContent === ${JSON.stringify(EAR_FAILED_LINE)}`, 'ear-failed')
  expect.soft(await harness.overlayEval<boolean>(`!!document.querySelector('.ear-wait, .voice-prompt--starting')`), 'the Voice Prompt counts no more').toBe(false)
  expect.soft(await harness.overlayEval<string>('document.body.innerText'), 'nothing in the panel invites speech').not.toMatch(/Bing Bong|\bsay\b/i)
  await shoot(run, '39-ear-failed')
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  await until(onDashboard, `!!document.querySelector('.voice-hint--failed')`, 'ear-failed-capsule')
  expect.soft(await harness.dashboardEval<string>(`document.querySelector('.status-capsule')?.textContent ?? ''`), 'the Capsule says it too, never Ready').toBe(`${EAR_FAILED}${EAR_FAILED_MORE}`)
  await shoot(run, '40-ear-failed-capsule')
  await harness.pressKey('pane', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
  await until(onDashboard, `!!document.querySelector('.idle-voice--failed')`, 'ear-failed-idle')
  expect.soft(await harness.dashboardEval<string>(`document.querySelector('.idle-voice')?.textContent ?? ''`), 'and the Idle Voice Line, no count').toBe(EAR_FAILED_LINE)
  await shoot(run, '41-ear-failed-idle')
  // The outcome holds: nothing climbs back into a wait.
  await sleep(2_000)
  expect.soft(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-voice--failed')`), 'the line holds').toBe(true)
  const logs = join(run.userDataDir, 'logs')
  const faults = (await readdir(logs)).filter((file) => file.startsWith('faults-'))
  const records = (await Promise.all(faults.map((file) => readFile(join(logs, file), 'utf8')))).join('').split('\n').filter((line) => line.includes('"voice.ear.load"'))
  expect.soft(records.length, 'the fault record is written').toBeGreaterThan(0)
}

/**
 * The Turn Card (#474) through a spoken line over the Idle Screen: the wake with the live words, the transcript held
 * so Transcribing shows, the reading held so Thinking shows with its seconds, then the end — "No response" for a line
 * read as no Command — and a typed failure's Failed; each state shot and held to the floor, the geometry read at each
 * and compared: nothing on the card moves between states.
 */
async function walkTheTurnCard(run: Run): Promise<void> {
  const { harness } = run
  const onDashboard = <T,>(expression: string): Promise<T> => harness.dashboardEval<T>(expression)
  const shown = (state: string): Promise<true> =>
    waitFor(async () => ((await onDashboard<string | null>(`document.querySelector('.turn-card')?.dataset.state ?? null`)) === state ? true : undefined), { timeoutMs: 40_000, intervalMs: 50 }).catch(async (error: unknown) => {
      await shoot(run, `no-turn-${state}`, false)
      throw error
    })
  const geometry = (): Promise<unknown> =>
    onDashboard(`(() => {
      const card = document.querySelector('.turn-card')
      const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }
      return { card: r(card), cells: [...card.querySelectorAll('.turn-rail-cell')].map(r), wordLeft: r(card.querySelector('.turn-stage-word'))[0], markRight: r(card.querySelector('.turn-stage-mark'))[2], words: r(card.querySelector('.turn-words')), rows: [...card.querySelectorAll('.turn-step')].map(r) }
    })()`)
  const seen = new Map<string, unknown>()
  const shot = async (state: string, file: string): Promise<void> => {
    await shown(state)
    seen.set(state, await geometry())
    await shoot(run, file, false)
    // The panel's overlay view is hidden under the Idle Screen and sized for the collapsed edge tab; the Peek Card it
    // draws there for the line is off that surface — the dashboard's own card over the screen, not the Turn Card's doing.
    run.issues.set(file, (run.issues.get(file) ?? []).filter((issue) => !issue.startsWith('panel: off the surface: .peek-')))
  }
  await harness.pressKey('pane', { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 /* Ctrl */ | 8 /* Shift */ })
  await waitFor(async () => ((await onDashboard<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 100 })
  // The mic's frames play the script: the wake, then the line.
  await shot('listening', '42-turn-listening')
  expect.soft(await onDashboard<string>(`document.querySelector('.turn-stage-word')?.textContent ?? ''`), `${run.theme} 42-turn-listening: the Capsule's word`).toBe('Listening…')
  await shot('transcribing', '43-turn-transcribing')
  expect.soft(await onDashboard<string>(`document.querySelector('.turn-words')?.textContent ?? ''`), `${run.theme} 43-turn-transcribing: the words being read, whole`).toBe('“what a lovely”')
  await shot('thinking', '44-turn-thinking')
  expect.soft(await onDashboard<string>(`document.querySelector('.turn-card')?.textContent ?? ''`), `${run.theme} 44-turn-thinking: the Heard row and the words`).toContain('Heard“what a lovely day”')
  await shot('dropped', '45-turn-no-response')
  expect.soft(await onDashboard<string>(`document.querySelector('.turn-stage-word')?.textContent ?? ''`), `${run.theme} 45-turn-no-response: the end in words`).toBe('No response')
  // A typed failure over the screen: the next line's card.
  await onDashboard(`window.bingbong.assistant.submit('play ${YOUTUBE_FIXTURE_NOTHING}')`)
  await shot('failed', '46-turn-failed')
  expect.soft(await onDashboard<string>(`document.querySelector('.turn-words')?.textContent ?? ''`), `${run.theme} 46-turn-failed: the failure sentence`).toContain('No videos found')
  const reference = seen.get('listening')
  for (const [state, read] of seen) expect.soft(read, `${run.theme} the Turn Card at ${state} sits where it sat at listening`).toEqual(reference)
}


/** The shell walk's band at Done, by theme: the Ledger walk's faces are held to it, so the seven faces are one series (#475). */
const SHELL_BAND_DONE = new Map<string, unknown>()

/** What a band's face stands on (#475): the rail's cells, the stage word's left edge, the mark's right edge, the words row, the hint and the history's rows, rounded to the pixel. */
const BAND_GEOMETRY = `(() => {
  window.__faces = {}
  window.__band = { heardAt: null, heardShownAt: null, wakeAt: null, wakeShownAt: null }
  window.bingbong.voice.onHeard(() => { if (window.__band.heardAt === null) window.__band.heardAt = Date.now() })
  window.bingbong.voice.onState((state) => { if (state.listening && window.__band.wakeAt === null) window.__band.wakeAt = Date.now() })
  const rect = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }
  const grab = () => {
    const card = document.querySelector('.peek-card--band')
    if (card === null) return
    if (window.__band.wakeShownAt === null) window.__band.wakeShownAt = Date.now()
    if (window.__band.heardShownAt === null && [...card.querySelectorAll('.turn-step-label')].some((el) => el.textContent === 'Heard')) window.__band.heardShownAt = Date.now()
    // The last render of each face wins: the band's first paints come while the native view still has the edge tab's bounds.
    const face = card.dataset.state
    if (face === undefined) return
    window.__faces[face] = {
      card: rect(card),
      cells: [...card.querySelectorAll('.turn-rail-cell')].map(rect),
      wordLeft: rect(card.querySelector('.turn-stage-word'))[0],
      markRight: rect(card.querySelector('.turn-stage-mark'))[2],
      words: rect(card.querySelector('.turn-words')),
      rows: [...card.querySelectorAll('.turn-step')].map(rect),
      hint: rect(card.querySelector('.peek-open-hint')),
    }
  }
  new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  grab()
})()`

/**
 * The Ledger Strip (#475): a spoken line over the dashboard with the panel collapsed — the wake, the partial, the
 * Endpoint and the read, then the Command's stages and its end. Each face is shot where it holds still, and every
 * face's geometry is read as it passes: nothing on the band moves between states. The typed line whose page is
 * held (Opening, Loading) is in the shell walk.
 */
async function walkTheLedger(run: Run): Promise<void> {
  const { harness, fixture } = run
  const untilFace = async (want: string, state: string, timeoutMs = 30_000): Promise<void> => {
    await waitFor(async () => ((await bandFace(harness)) === want ? true : undefined), { timeoutMs, intervalMs: 50 }).catch(async (error: unknown) => {
      await shoot(run, `no-${state}`)
      throw error
    })
  }

  await command(run, `navigate ${fixture.url('/story')}`)
  await clickPanel(run, '[aria-label="Collapse the feed panel"]')
  await sleep(600)
  await harness.overlayEval(BAND_GEOMETRY)
  // The ear still loading once the page is in (BINGBONG_VAD_LOAD_MS), so the mic's frames play the script only now.
  expect.soft(await harness.dashboardEval<boolean>(`!!document.querySelector('.voice-hint--starting')`), `${run.theme}: the ear still loading once the page is in`).toBe(true)
  await untilFace('listening', 'ledger-listening', 40_000)
  await waitFor(async () => ((await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-words')?.textContent ?? ''`)).includes(LEDGER_PARTIAL) ? true : undefined), { timeoutMs: 20_000, intervalMs: 50 }).catch(async (error: unknown) => {
    await shoot(run, 'no-ledger-partial')
    throw error
  })
  await shoot(run, '42-ledger-listening', false)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-stage-word')?.textContent ?? ''`), `${run.theme} 42-ledger-listening: the Capsule's word`).toBe('Listening…')
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-words')?.textContent ?? ''`), `${run.theme} 42-ledger-listening: the live partial, whole`).toBe(`“${LEDGER_PARTIAL}…”`)
  await untilFace('transcribing', 'ledger-transcribing')
  await sleep(1_200)
  await shoot(run, '43-ledger-transcribing', false)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-stage')?.textContent ?? ''`), `${run.theme} 43-ledger-transcribing: the word and its seconds`).toMatch(/^Transcribing…[1-9]s$/)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-words')?.textContent ?? ''`), `${run.theme} 43-ledger-transcribing: the last words`).toBe(`“${LEDGER_PARTIAL}”`)
  // The read's sentence, held by the scripted player (LEDGER_ENV), so Speaking is a face that holds still.
  await untilFace('speaking', 'ledger-speaking')
  await sleep(1_200)
  // Read before the shot, as the band's words are: the held sentence ends three seconds on.
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-stage')?.textContent ?? ''`), `${run.theme} 43b-ledger-speaking: the word and its seconds`).toMatch(/^Speaking…[0-9]s$/)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-words')?.textContent ?? ''`), `${run.theme} 43b-ledger-speaking: the sentence as the words`).toMatch(/^The lighthouse\s+The keeper climbed/)
  await shoot(run, '43b-ledger-speaking', false)
  await untilFace('done', 'ledger-done')
  await shoot(run, '44-ledger-done')
  const rows = await harness.overlayEval<string[]>(`[...document.querySelectorAll('.peek-card--band .turn-step:not(.turn-step--blank)')].map((row) => row.querySelector('.turn-step-label').textContent + ': ' + row.querySelector('.turn-step-text').textContent)`)
  expect.soft(rows.some((row) => row.startsWith('Reading: the page')), `${run.theme} 44-ledger-done: the action's row`).toBe(true)
  expect.soft(rows.some((row) => row.startsWith('Done: ')), `${run.theme} 44-ledger-done: the end row`).toBe(true)
  expect.soft(await harness.overlayEval<string>(`document.querySelector('.peek-card--band .turn-words')?.textContent ?? ''`), `${run.theme} 44-ledger-done: the Answer as the words`).toMatch(/lighthouse/i)

  // Nothing moved (#474's rule, #475): every face's rail cells, stage word, mark, words row, hint and history rows at the same pixels.
  const faces = await harness.overlayEval<Record<string, unknown>>(`window.__faces`)
  const seen = Object.keys(faces)
  // Thinking and Acting are not demanded here: the stand-in reads at once and the fixture's read is a blink, so they
  // can share a paint; the action's own row is asserted above, the shell walk's typed line holds Thinking, Opening and
  // Loading, and the fold's tests hold every row. Speaking is held by the scripted player.
  expect.soft(seen, `${run.theme}: the faces the band passed through`).toEqual(expect.arrayContaining(['listening', 'transcribing', 'speaking', 'done']))
  for (const key of seen) expect.soft(faces[key], `${run.theme}: the band's geometry at ${key} against listening`).toEqual(faces['listening'])
  // One series across both walks: the shell walk's held page (Thinking, Opening, Loading) stood where this line stands.
  const shellDone = SHELL_BAND_DONE.get(run.theme)
  if (shellDone !== undefined) expect.soft(faces['done'], `${run.theme}: the band's geometry at done against the shell walk's held page`).toEqual(shellDone)
  // The receipt (ui.md 1): the band within 100 ms of the wake's state and the Heard row within 100 ms of the heard event, on this renderer's clock.
  const band = await harness.overlayEval<{ heardAt: number | null; heardShownAt: number | null; wakeAt: number | null; wakeShownAt: number | null }>(`window.__band`)
  expect.soft(band.wakeShownAt! - band.wakeAt!, `${run.theme}: the band after the wake`).toBeLessThanOrEqual(100)
  expect.soft(band.heardShownAt! - band.heardAt!, `${run.theme}: the Heard row after the heard event`).toBeLessThanOrEqual(100)
}

/** The Ledger walk's line (#475): Jev's, so it waits for its Endpoint — `read` alone is the grammar's and fires on its partial (#326). */
const LEDGER_LINE = 'read the page'
/** Its last partial, short of the line: a partial that reads as the line would fire on it through the stand-in too. */
const LEDGER_PARTIAL = 'read the pa'

/** The Ledger walk's ear (#475): the wake, a second of quiet, the line spoken over six seconds, then quiet; read in four seconds. Its sentence plays for three seconds. */
const LEDGER_ENV: Record<string, string> = {
  BINGBONG_FAKE_APLAY_MS: '3000',
  BINGBONG_WAKE_ENGINE: 'node',
  BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
  BINGBONG_VAD_LOAD_MS: '20000',
  BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 12), ...frames(QUIET, 30), ...frames(SPEECH, 200), QUIET]),
  BINGBONG_STT_SCRIPT: JSON.stringify([{ text: LEDGER_LINE, delayMs: 4_000, partials: ['re', 'read th', ...frames(0, 300).map(() => LEDGER_PARTIAL)] }]),
}

function expectClean(run: Run): void {
  for (const [state, issues] of run.issues) expect.soft(issues, `${run.label} ${state}`).toEqual([])
}

/**
 * The ear's waits (#442): the wake, quiet in the open listen, a line (held behind the transcriber still loading),
 * then about 15 s of quiet — the hold, and the dashboard woken — and a second line of the same Hot Listen, read slowly.
 */
const EAR_WAITS_ENV: Record<string, string> = {
  BINGBONG_WAKE_ENGINE: 'node',
  BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
  BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 12), ...frames(QUIET, 60), ...frames(SPEECH, 40), ...frames(QUIET, 466), ...frames(SPEECH, 40), QUIET]),
  // The ear "loads" long enough to be read three ways, and the transcriber after it long enough to hold a line.
  BINGBONG_VAD_LOAD_MS: '20000',
  BINGBONG_STT_LOAD_MS: '15000',
  BINGBONG_STT_SCRIPT: JSON.stringify([
    { text: '', partials: ['what about'] },
    { text: '', delayMs: 14_000, partials: ['zorblax the quux'] },
  ]),
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
      // A line with free words is Jev's (ADR 0079): the stand-in reads the nonsense line as no Command, `play fixture song` as the Appliance Verb, and the hub Task hop by hop (#375).
      const run = await launch(theme, decisionScript(readingOf('zorblax the quux thing'), readingOf('play fixture song'), ...hubTaskReadings()))
      try {
        await walkTheShell(run)
      } finally {
        await close(run)
        // Every state shot before a walk that died is still held to the floor.
        expectClean(run)
      }
    }, 400_000)

    it(`shoots the ear's waits — starting, held behind its load, transcribing — in ${theme}`, async () => {
      const run = await launch(theme, EAR_WAITS_ENV, FAKE_MIC)
      try {
        await walkTheEarWaits(run)
      } finally {
        await close(run)
        expectClean(run)
      }
    }, 200_000)

    it(`shoots the ear failing to start in ${theme}`, async () => {
      // The fake mic's first frames start the scripted VAD's load, which fails after it: the ear's cold start ending in a fault.
      const run = await launch(theme, { BINGBONG_VAD_LOAD_MS: '3000', BINGBONG_VAD_LOAD_FAIL: '1' }, FAKE_MIC)
      try {
        await walkTheEarFailing(run)
      } finally {
        await close(run)
        expectClean(run)
      }
    }, 120_000)

    it(`shoots the Ledger Strip through a spoken line in ${theme}`, async () => {
      // A voice for the scripted piper (e2e/bin), so the read's sentence is spoken and its Speaking face is drawn.
      const voices = await mkdtemp(join(tmpdir(), 'bingbong-e2e-ledger-voices-'))
      await writeFile(join(voices, 'en_GB-alba-medium.onnx'), '')
      await writeFile(join(voices, 'en_GB-alba-medium.onnx.json'), JSON.stringify({ audio: { sample_rate: 22050 } }))
      const run = await launch(theme, { ...LEDGER_ENV, BINGBONG_PIPER_VOICE_DIR: voices, ...decisionScript(readingOf(LEDGER_LINE, 'read')) }, FAKE_MIC)
      try {
        await walkTheLedger(run)
      } finally {
        await close(run).finally(() => rm(voices, { recursive: true, force: true }).catch(() => {}))
        expectClean(run)
      }
    }, 200_000)

    it(`shoots the Voice Prompt taking an Utterance in ${theme}`, async () => {
      // Chromium's fake mic, as the ear's waits use; the ear "loads" until the walk has its page, so the VAD
      // script starts only once the page is in. Its partials come at the mic's pace, inside the 30 s utterance cap.
      const run = await launch(
        theme,
        {
          BINGBONG_WAKE_ENGINE: 'node',
          BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
          BINGBONG_VAD_LOAD_MS: '20000',
          // Two Utterances in one Hot Listen: the page collected at the first speech start comes back empty (see
          // #359's report), so the words shown are the second's, taken over the page with its Page Terms.
          BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 40), ...frames(QUIET, 40), SPEECH]),
          BINGBONG_STT_SCRIPT: JSON.stringify(['what about', { text: WORDS, partials: ['what about', 'what about the Fixture', ...frames(0, 200).map(() => WORDS)] }]),
        },
        FAKE_MIC,
      )
      try {
        await walkTheVoicePrompt(run)
      } finally {
        await close(run)
        // Every state shot before a walk that died is still held to the floor.
        expectClean(run)
      }
    }, 200_000)
  }

  for (const theme of ['dark', 'light'] as const) {
    it(`shoots the Turn Card through a spoken line and a typed failure in ${theme}`, async () => {
      // The wake, quiet, then a line no grammar reads; its transcript and its reading each held long enough to shoot. The
      // partials stay short of the whole line: a partial that is the whole line is asked of the stand-in and would take its one reading.
      const run = await launch(
        theme,
        {
          BINGBONG_WAKE_ENGINE: 'node',
          BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
          // The ear "loads" until the walk has the Idle Screen up; the line is spoken long enough for its listening shot.
          BINGBONG_VAD_LOAD_MS: '12000',
          BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 12), ...frames(QUIET, 60), ...frames(SPEECH, 90), QUIET]),
          BINGBONG_STT_SCRIPT: JSON.stringify([{ text: 'what a lovely day', delayMs: 2_500, partials: ['what a', 'what a lovely'] }]),
          ...decisionScript(readingOf('what a lovely day', 'none', { delayMs: 3_000 }), readingOf(`play ${YOUTUBE_FIXTURE_NOTHING}`)),
        },
        FAKE_MIC,
      )
      try {
        await walkTheTurnCard(run)
      } finally {
        await close(run)
        expectClean(run)
      }
    }, 200_000)
  }

  // A laptop's window (#447): the panel's state word and the seconds held inside it at 1280×800 too; the theme moves no box.
  it('shoots the ear\'s waits at 1280×800 in dark', async () => {
    const run = await launch('dark', EAR_WAITS_ENV, FAKE_MIC, { width: 1280, height: 800 })
    try {
      await walkTheEarWaits(run)
    } finally {
      await close(run)
      expectClean(run)
    }
  }, 200_000)
})
