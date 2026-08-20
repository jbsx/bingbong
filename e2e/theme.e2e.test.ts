import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Theme e2e (#50): the gruvbox light skin, bundled Inter type scale and
// calm status indicators are asserted as computed-style observables on
// every app surface — dashboard, feed panel overlay, settings, idle screen,
// kiosk — plus the status pill text per state and the total absence of
// pulse animation. The exact px assertions pin the #49 calibration (22px
// root × rem tiers) deliberately; everything else stays token-level.

const GRUVBOX_BG = 'rgb(251, 241, 199)' // #fbf1c7
const GRUVBOX_PANEL = 'rgb(235, 219, 178)' // #ebdbb2
const GRUVBOX_BLUE = 'rgb(7, 102, 120)' // #076678 thinking/transcribing
const GRUVBOX_PURPLE = 'rgb(143, 63, 113)' // #8f3f71 listening/paused

const pageTokensScript = `(() => ({
  bg: getComputedStyle(document.body).backgroundColor,
  scheme: getComputedStyle(document.documentElement).colorScheme,
  font: getComputedStyle(document.body).fontFamily,
  rootSize: getComputedStyle(document.documentElement).fontSize,
}))()`

const armScript = `(async () => {
  await window.bingbong.voice.arm()
  return 'armed'
})()`

const feedAudioScript = `(() => {
  for (let i = 0; i < 60; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
  return 'fed'
})()`

/** One utterance of VAD probabilities: pre-roll silence, speech, trailing silence. */
function vadScript(speechFrames = 8): string {
  return JSON.stringify([
    ...Array.from({ length: 6 }, () => 0.01),
    ...Array.from({ length: speechFrames }, () => 0.95),
    ...Array.from({ length: 40 }, () => 0.01),
  ])
}

async function pillText(harness: Harness): Promise<string> {
  return harness.dashboardEval<string>(`document.querySelector('.status-pill')?.textContent ?? ''`)
}

async function waitForPill(harness: Harness, text: string): Promise<void> {
  await waitFor(async () => ((await pillText(harness)) === text ? text : undefined), {
    timeoutMs: 20000,
    intervalMs: 250,
  })
}

describe('dashboard theme e2e (#50)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('wears gruvbox light tokens with bundled Inter at the couch type scale', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([{ kind: 'answer', speak: 'Done.', display: 'Done.' }]),
      },
    })
    try {
      const tokens = await harness.dashboardEval<Record<string, string>>(pageTokensScript)
      expect(tokens.bg).toBe(GRUVBOX_BG)
      expect(tokens.scheme).toBe('light')
      expect(tokens.font).toContain('InterVariable')
      // Calibration (#49): 22px root so rem sizes land couch-readable.
      expect(tokens.rootSize).toBe('22px')

      // The type scale: conversation 1.4rem (~31px), labels 1.1rem, detail 1rem.
      const sizes = await harness.dashboardEval<Record<string, string>>(`(() => {
        const px = (el) => (el ? getComputedStyle(el).fontSize : '')
        return {
          conversation: px(document.querySelector('.command-input')),
          label: px(document.querySelector('.dashboard-header h1')),
          detail: px(document.querySelector('.dashboard-footer')),
        }
      })()`)
      expect(sizes.conversation).toBe('30.8px')
      expect(sizes.label).toBe('24.2px')
      expect(sizes.detail).toBe('24.2px')

      // The font file is bundled and actually loaded — no CDN round trip.
      const fontFaces = await harness.dashboardEval<[string, string][]>(
        `document.fonts.ready.then(() => [...document.fonts].map((f) => [f.family, f.status]))`,
      )
      expect(fontFaces).toContainEqual(['InterVariable', 'loaded'])

      // Panels sit on gruvbox light1.
      const panel = await harness.dashboardEval<string>(
        `getComputedStyle(document.querySelector('.browser-chrome')).backgroundColor`,
      )
      expect(panel).toBe(GRUVBOX_PANEL)
    } finally {
      await harness.quit()
    }
  })

  it('names each state with a still pill; no pulse animation survives anywhere', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([{ kind: 'answer', speak: 'Done.', display: 'Done.' }]),
        // A held transcript widens the STT window so the transcribing pill
        // is observable — the real engine spends seconds there.
        BINGBONG_STT_SCRIPT: JSON.stringify([{ text: 'say done', delayMs: 1500 }]),
        BINGBONG_VAD_SCRIPT: vadScript(),
      },
    })
    try {
      // Idle at boot: the pill names the state, the orb is a still dot.
      await waitForPill(harness, 'Idle')
      const calm = await harness.dashboardEval<{
        pulseClasses: number
        pulseKeyframes: string
        orbAnimation: string
        orbStill: boolean
      }>(`(() => {
        const frames = []
        for (const sheet of document.styleSheets) {
          let rules
          try { rules = sheet.cssRules } catch { continue }
          for (const rule of rules) if (rule instanceof CSSKeyframesRule) frames.push(rule.name)
        }
        const orb = document.querySelector('.status-orb')
        const animation = orb ? getComputedStyle(orb).animationName : 'no-orb'
        return {
          pulseClasses: document.querySelectorAll('[class*="pulse"]').length,
          pulseKeyframes: frames.filter((name) => /pulse|bounce/i.test(name)).join(','),
          orbAnimation: animation,
          orbStill: orb !== null && getComputedStyle(orb).animation === 'none',
        }
      })()`)
      expect(calm.pulseClasses).toBe(0)
      expect(calm.pulseKeyframes).toBe('')
      expect(calm.orbAnimation).toBe('none')
      expect(calm.orbStill).toBe(true)

      // Listening: armed and held — purple orb, purple pill.
      await harness.dashboardEval<string>(armScript)
      await waitForPill(harness, 'Listening…')
      const listeningOrb = await harness.dashboardEval<string>(
        `getComputedStyle(document.querySelector('.status-orb')).backgroundColor`,
      )
      expect(listeningOrb).toBe(GRUVBOX_PURPLE)

      // Transcribing (#38): the STT window — blue orb, blue pill, never the
      // listening prompt.
      await harness.dashboardEval<string>(feedAudioScript)
      await waitForPill(harness, 'Transcribing…')
      const transcribingOrb = await harness.dashboardEval<string>(
        `getComputedStyle(document.querySelector('.status-orb')).backgroundColor`,
      )
      expect(transcribingOrb).toBe(GRUVBOX_BLUE)

      // The run settles back to idle.
      await waitForPill(harness, 'Idle')
    } finally {
      await harness.quit()
    }
  })

  it('shows Acting… with a quiet text spinner while a slow page loads, then Cancelled on stop', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/slow') } }] },
      { kind: 'answer', speak: 'Slow page opened.', display: 'Opened the slow page.' },
    ]
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      expect(await harness.dashboardEval<string>(commandBoxScript('open the slow page'))).toBe('submitted')

      // The /slow fixture holds the tool open: the pill names the state and
      // the chrome shows a text spinner — never a sliding bar.
      await waitForPill(harness, 'Acting…')
      await waitFor(
        async () => {
          const spinner = await harness.dashboardEval<{ tag: string; text: string } | null>(
            `(() => {
              const el = document.querySelector('.chrome-loading')
              return el ? { tag: el.tagName, text: el.textContent ?? '' } : null
            })()`,
          )
          return spinner && spinner.tag === 'SPAN' && spinner.text.length > 0 ? spinner : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // Stop mid-run: the pill names the cancellation — red, still.
      await harness.clickDashboardElement('.assistant-stop')
      await waitForPill(harness, 'Cancelled')
    } finally {
      await harness.quit()
    }
  })

  it('themes the feed panel overlay and the settings page', async () => {
    const harness = await startHarness({ fixture })
    try {
      // The overlay panel floats on gruvbox light1 — translucent overlay
      // mode reads as the same warm panel, not a dark scrim.
      await waitFor(
        async () => {
          const surface = await harness.overlayEval<string>(
            `getComputedStyle(document.querySelector('.feed-surface')).backgroundColor`,
          )
          return surface.startsWith('rgba(235, 219, 178') ? surface : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const overlayTokens = await harness.overlayEval<Record<string, string>>(pageTokensScript)
      expect(overlayTokens.scheme).toBe('light')
      expect(overlayTokens.font).toContain('InterVariable')
      expect(overlayTokens.rootSize).toBe('22px')

      // Settings: a gruvbox panel page.
      await harness.clickDashboardElement('.settings-toggle')
      await waitFor(
        () =>
          harness.dashboardEval<boolean>(
            `!!document.querySelector('.settings-page')`,
          ),
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const settingsPanel = await harness.dashboardEval<string>(
        `getComputedStyle(document.querySelector('.settings-page')).backgroundColor`,
      )
      expect(settingsPanel).toBe(GRUVBOX_PANEL)
    } finally {
      await harness.quit()
    }
  })

  it('themes the idle screen and kiosk mode', async () => {
    const idleHarness = await startHarness({ fixture, wakeFromBootIdle: false })
    try {
      expect(await idleHarness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
      const idleTokens = await idleHarness.dashboardEval<Record<string, string>>(pageTokensScript)
      expect(idleTokens.bg).toBe(GRUVBOX_BG)
      expect(idleTokens.scheme).toBe('light')
      expect(idleTokens.font).toContain('InterVariable')
      const clockFont = await idleHarness.dashboardEval<string>(
        `getComputedStyle(document.querySelector('.idle-clock')).fontFamily`,
      )
      expect(clockFont).toContain('InterVariable')
    } finally {
      await idleHarness.quit()
    }

    const kioskHarness = await startHarness({
      fixture,
      launchArgs: ['--kiosk'],
      env: { BINGBONG_IDLE_TIMEOUT_MS: '60000' },
    })
    try {
      await waitFor(
        () => kioskHarness.dashboardEval<boolean>(`!!document.querySelector('.dashboard--kiosk')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const kioskTokens = await kioskHarness.dashboardEval<Record<string, string>>(pageTokensScript)
      expect(kioskTokens.bg).toBe(GRUVBOX_BG)
      expect(kioskTokens.scheme).toBe('light')
      expect(kioskTokens.font).toContain('InterVariable')
      expect(kioskTokens.rootSize).toBe('22px')
    } finally {
      await kioskHarness.quit()
    }
  })
})
