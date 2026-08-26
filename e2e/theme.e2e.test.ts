import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Theme e2e (ADR 0012, 0020): the neutral light skin, bundled Inter type
// scale and calm status indicators are asserted as computed-style
// observables on every app surface — dashboard toolbar, feed panel
// overlay, settings, idle screen, kiosk — plus the status pill text per
// state and the total absence of pulse animation. The exact px assertions
// pin the desk calibration (17px root × rem tiers) deliberately;
// everything else stays token-level. The dark pass pins ADR 0020: real
// per-mode tokens and the page-side prefers-color-scheme signal.

const CANVAS_BG = 'rgb(245, 245, 247)' // #f5f5f7
const PANEL_BG = 'rgb(255, 255, 255)' // #ffffff
const APPLE_BLUE = 'rgb(0, 113, 227)' // #0071e3 thinking/transcribing
const APPLE_PURPLE = 'rgb(175, 82, 222)' // #af52de listening/paused
const DARK_CANVAS_BG = 'rgb(30, 30, 32)' // #1e1e20

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

  it('wears neutral light tokens with bundled Inter at the desk type scale', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([{ kind: 'answer', speak: 'Done.', display: 'Done.' }]),
      },
    })
    try {
      const tokens = await harness.dashboardEval<Record<string, string>>(pageTokensScript)
      expect(tokens.bg).toBe(CANVAS_BG)
      expect(tokens.scheme).toBe('light')
      expect(tokens.font).toContain('InterVariable')
      // Desk calibration (ADR 0012): 17px root so rem sizes land
      // desk-readable.
      expect(tokens.rootSize).toBe('17px')

      // The type scale: prompt bar 0.95rem (panel-local), labels 0.9rem
      // — measured in the overlay, where typed input lives.
      const sizes = await harness.overlayEval<Record<string, string>>(`(() => {
        const px = (el) => (el ? getComputedStyle(el).fontSize : '')
        return {
          prompt: px(document.querySelector('.prompt-input')),
        }
      })()`)
      expect(sizes.prompt).toBe('16.15px')
      const labelSizes = await harness.dashboardEval<Record<string, string>>(`(() => {
        const px = (el) => (el ? getComputedStyle(el).fontSize : '')
        return {
          label: px(document.querySelector('.status-pill')),
          // No cards pending: the footer is collapsed away entirely.
          footerWhileIdle: px(document.querySelector('.dashboard-footer')),
        }
      })()`)
      expect(labelSizes.label).toBe('15.3px')
      expect(labelSizes.footerWhileIdle).toBe('')

      // The font file is bundled and actually loaded — no CDN round trip.
      const fontFaces = await harness.dashboardEval<[string, string][]>(
        `document.fonts.ready.then(() => [...document.fonts].map((f) => [f.family, f.status]))`,
      )
      expect(fontFaces).toContainEqual(['InterVariable', 'loaded'])

      // The Status Capsule sits on white.
      const capsule = await harness.dashboardEval<string>(
        `getComputedStyle(document.querySelector('.status-capsule')).backgroundColor`,
      )
      expect(capsule).toBe(PANEL_BG)
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
      expect(listeningOrb).toBe(APPLE_PURPLE)

      // Transcribing (#38): the STT window — blue orb, blue pill, never the
      // listening prompt.
      await harness.dashboardEval<string>(feedAudioScript)
      await waitForPill(harness, 'Transcribing…')
      const transcribingOrb = await harness.dashboardEval<string>(
        `getComputedStyle(document.querySelector('.status-orb')).backgroundColor`,
      )
      expect(transcribingOrb).toBe(APPLE_BLUE)

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
      expect(await harness.submitCommand('open the slow page')).toBe('submitted')

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
      await harness.clickOverlayElement('.panel-stop')
      await waitForPill(harness, 'Cancelled')
    } finally {
      await harness.quit()
    }
  })

  it('themes the feed panel overlay and the settings page', async () => {
    const harness = await startHarness({ fixture })
    try {
      // The overlay panel floats near-opaque white (ADR 0012) —
      // readability over the live page won; no dark scrim.
      await waitFor(
        async () => {
          const surface = await harness.overlayEval<string>(
            `getComputedStyle(document.querySelector('.feed-surface')).backgroundColor`,
          )
          return surface.startsWith('rgba(255, 255, 255') ? surface : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const overlayTokens = await harness.overlayEval<Record<string, string>>(pageTokensScript)
      expect(overlayTokens.scheme).toBe('light')
      expect(overlayTokens.font).toContain('InterVariable')
      expect(overlayTokens.rootSize).toBe('17px')

      // Settings: full-bleed canvas — no page card of its own.
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
      expect(settingsPanel).toBe('rgba(0, 0, 0, 0)')
    } finally {
      await harness.quit()
    }
  })

  it('wears the dark half of the sheet when the Appearance Setting says so, and signals pages', async () => {
    // ADR 0020: appearance is a main-owned Setting resolved through
    // nativeTheme — a manual `dark` re-skins every renderer's tokens
    // (engine-fed prefers-color-scheme) and flips the pane's own
    // prefers-color-scheme so pages can darken themselves.
    const harness = await startHarness({ fixture })
    try {
      // Give the pane a real page first — the prefers-color-scheme probe
      // below reads a live document, not a virgin about:blank.
      await harness.navigatePane(fixture.url('/interactive'))
      // Manual dark through the same settings seam the settings page and
      // the voice tool drive.
      await harness.dashboardEval(`window.bingbong.settings.update({ appearance: 'dark' })`)
      await waitFor(
        async () => {
          const tokens = await harness.dashboardEval<Record<string, string>>(pageTokensScript)
          return tokens.bg === DARK_CANVAS_BG && tokens.scheme === 'dark' ? tokens : undefined
        },
        { timeoutMs: 10000, intervalMs: 250 },
      )
      const dark = await harness.dashboardEval<Record<string, string>>(pageTokensScript)
      expect(dark.bg).toBe(DARK_CANVAS_BG)
      expect(dark.scheme).toBe('dark')

      // The overlay re-skins from the same shared token sheet: the
      // near-opaque surface goes dark, never a light slab in a dark app.
      await waitFor(
        async () => {
          const surface = await harness.overlayEval<string>(
            `getComputedStyle(document.querySelector('.feed-surface')).backgroundColor`,
          )
          return surface.startsWith('rgba(29, 29, 31') ? surface : undefined
        },
        { timeoutMs: 10000, intervalMs: 250 },
      )
      const overlayScheme = await harness.overlayEval<Record<string, string>>(pageTokensScript)
      expect(overlayScheme.scheme).toBe('dark')

      // The pane's pages are signalled, never restyled: the engine-level
      // media query flips, the page's own styles are untouched.
      const pageSignal = await harness.paneEval<boolean>(
        `window.matchMedia('(prefers-color-scheme: dark)').matches`,
      )
      expect(pageSignal).toBe(true)

      // Back to following the OS: system resolution restores the light
      // boot skin under Xvfb (no OS preference).
      await harness.dashboardEval(`window.bingbong.settings.update({ appearance: 'system' })`)
      await waitFor(
        async () => {
          const tokens = await harness.dashboardEval<Record<string, string>>(pageTokensScript)
          return tokens.scheme === 'light' ? tokens : undefined
        },
        { timeoutMs: 10000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })

  it('themes the idle screen and kiosk mode', async () => {
    const idleHarness = await startHarness({ fixture, wakeFromBootIdle: false })
    try {
      expect(await idleHarness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
      const idleTokens = await idleHarness.dashboardEval<Record<string, string>>(pageTokensScript)
      expect(idleTokens.bg).toBe(CANVAS_BG)
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
      expect(kioskTokens.bg).toBe(CANVAS_BG)
      expect(kioskTokens.scheme).toBe('light')
      expect(kioskTokens.font).toContain('InterVariable')
      expect(kioskTokens.rootSize).toBe('17px')
    } finally {
      await kioskHarness.quit()
    }
  })
})
