import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, YOUTUBE_FIXTURE_NOTHING, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// The Peek Card goes (#470, ADR 0026 as amended): 15 s past its sentence,
// on the dashboard as over the Idle Screen. Over the Idle Screen it shows
// only a failure or "No response.", in the Weigh-in pop-up's place, a tap
// dismissing it with the screen left up, and the Voice Prompt line keeps
// the failure sentence until the next input. The fixture server stands in
// for YouTube, its search finding nothing for YOUTUBE_FIXTURE_NOTHING.

const FAILING_PLAY = `play ${YOUTUBE_FIXTURE_NOTHING}`
const LINGER_MS = 15_000

describe('peek card e2e: the card goes, and over the Idle Screen it tells a failure', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string

  const idleShown = (): Promise<boolean> => harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)
  const idleCard = (): Promise<string | null> => harness.dashboardEval<string | null>(`document.querySelector('.idle-popup-place .peek-card--idle')?.textContent ?? null`)
  const voiceLine = (): Promise<string> => harness.dashboardEval<string>(`document.querySelector('.idle-voice')?.textContent ?? ''`)
  const submit = (line: string): Promise<unknown> => harness.dashboardEval(`window.bingbong.assistant.submit(${JSON.stringify(line)})`)

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-peek-card-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      wakeFromBootIdle: false,
      launchArgs: ['--mute-audio'],
      env: {
        BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin,
        // A `play` with free words is Jev's (ADR 0079): the stand-in reads it as the Appliance Verb.
        ...decisionScript(readingOf(FAILING_PLAY)),
      },
    })
    await waitFor(async () => ((await idleShown()) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
  }, 120_000)

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('a failing `play` over the Idle Screen shows the card in the pop-up place, gone 15 s on, the Voice Prompt line keeping the sentence (AC2, AC5, AC7)', async () => {
    await submit(FAILING_PLAY)
    const shown = await waitFor(async () => (await idleCard()) ?? undefined, { timeoutMs: 20_000, intervalMs: 100 })
    const shownAt = Date.now()
    expect(shown).toContain(`“${FAILING_PLAY}”`)
    expect(shown).toContain('No videos found')
    // The sentence at status size, the dot in the failure colour.
    expect(await harness.dashboardEval<string>(`getComputedStyle(document.querySelector('.peek-card--idle .peek-sentence')).fontSize`)).toBe('65px')
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.peek-card--idle.peek-card--failed')`)).toBe(true)
    // Still there well inside its time.
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    expect(await idleCard()).not.toBeNull()

    await waitFor(async () => ((await idleCard()) === null ? true : undefined), { timeoutMs: 30_000, intervalMs: 100 })
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(LINGER_MS - 1_000)
    expect(await idleShown()).toBe(true)
    expect(await voiceLine()).toContain('No videos found')
  }, 60_000)

  it('a Timer that succeeds shows no card, and as the next input returns the Voice Prompt line to its rest hint (AC2, AC5)', async () => {
    await submit('timer 5m')
    await waitFor(async () => ((await harness.dashboardEval<string>(`window.bingbong.timer.get().then((state) => state.status)`)) === 'running' ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(await idleCard()).toBeNull()
    // Back to the rest hint — the mic-off one here, with no microphone under Xvfb.
    expect(await voiceLine()).toMatch(/^(Say “Bing Bong” or start typing|Microphone off — start typing)/)
    await submit('timer off')
    await waitFor(async () => ((await harness.dashboardEval<string>(`window.bingbong.timer.get().then((state) => state.status)`)) === 'off' ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
  }, 30_000)

  it('a tap dismisses the card and leaves the Idle Screen up, even with a page to wake to (AC3)', async () => {
    // A page in the pane, so a tap anywhere else would wake the dashboard over it.
    const page = fixture.url('/')
    await harness.paneEval(`location.href = ${JSON.stringify(page)}`).catch(() => undefined)
    await harness.waitForPaneUrl(page)
    expect(await idleShown()).toBe(true)
    await submit(FAILING_PLAY)
    await waitFor(async () => (await idleCard()) ?? undefined, { timeoutMs: 20_000, intervalMs: 100 })
    await harness.clickDashboardElement('.peek-card--idle')
    await waitFor(async () => ((await idleCard()) === null ? true : undefined), { timeoutMs: 2_000, intervalMs: 50 })
    expect(await idleShown()).toBe(true)
  }, 30_000)

  it('on the dashboard the Answer retracts 15 s on, the edge tab back in its place (AC1, AC7)', async () => {
    // When the overlay's card took its Answer and when it went, on the overlay's own clock: a poll from here sees both late.
    await harness.overlayEval(`(() => {
      window.__answer = { at: null, gone: null }
      new MutationObserver(() => {
        // A live report starts the Command this case watches; an Answer left from an earlier case is not it.
        if (document.querySelector('.peek-card--live')) window.__answer = { at: null, gone: null }
        const answer = !!document.querySelector('.peek-card--answer')
        if (answer && window.__answer.at === null) window.__answer.at = Date.now()
        if (!answer && window.__answer.at !== null && window.__answer.gone === null) window.__answer.gone = Date.now()
      }).observe(document.body, { subtree: true, childList: true, attributes: true })
    })()`)
    await submit(`navigate ${fixture.url('/')}`)
    await waitFor(async () => ((await idleShown()) ? undefined : true), { timeoutMs: 10_000, intervalMs: 100 })
    await waitFor(async () => ((await harness.overlayEval<boolean>(`!!document.querySelector('.peek-card--answer')`)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 100 })
    expect(await harness.overlayEval<boolean>(`!!document.querySelector('.peek-card--answer .peek-linger')`)).toBe(true)
    const answer = await waitFor(async () => {
      const seen = await harness.overlayEval<{ at: number | null; gone: number | null }>(`window.__answer`)
      return seen.gone !== null ? seen : undefined
    }, { timeoutMs: 30_000, intervalMs: 100 })
    expect(answer.gone! - answer.at!).toBeGreaterThanOrEqual(LINGER_MS - 200)
    expect(answer.gone! - answer.at!).toBeLessThan(LINGER_MS + 2_000)
    expect(await harness.overlayEval<boolean>(`!!document.querySelector('.feed-edge-tab')`)).toBe(true)
    // The dashboard's slot followed: no card's room is left over the pane.
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.feed-slot--collapsed') && !document.querySelector('.feed-slot--peek')`)).toBe(true)
  }, 60_000)
})
