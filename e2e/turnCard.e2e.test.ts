import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PEEK_CARD_LINGER_MS as LINGER_MS } from '../src/core/panel/peekCardState'
import { startFixtureServer, YOUTUBE_FIXTURE_NOTHING } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// The Turn Card (#474): a spoken line over the Idle Screen shows its whole
// journey on one centred card — the live words in full, the Heard row as
// the transcript lands, every stage with its seconds, the reading, the end
// and the Answer — and nothing on it moves between states. Chromium's fake
// mic feeds the real capture graph; the scripts stand in for the models: a
// wake, quiet, then two Utterances in one Hot Listen. The first, a line no
// grammar reads, is held by the stand-in's reading so Thinking shows and
// ends on "No response"; the second, a `play` the fixture YouTube finds
// nothing for, ends on Failed with its sentence. Each transcript is held
// 1.5 s so Transcribing shows. A line's acting is over in milliseconds
// here, and a failure's `done` follows its `speak` in the same tick (the
// sentence sounds after, under Failed, as the Peek Card shows its Answer),
// so Acting and Speaking are read when a frame caught them, never
// required; Done is the Peek Card e2e's Timer. The partials stay short of
// the whole line: a partial that is the whole line is asked of the
// stand-in and would take the line's one reading.

const SPEECH = 0.95
const QUIET = 0.01
const frames = (prob: number, count: number): number[] => Array.from({ length: count }, () => prob)
const NONE = 'what a lovely day'
const PLAY = `play ${YOUTUBE_FIXTURE_NOTHING}`
const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

const ear = {
  BINGBONG_WAKE_ENGINE: 'node',
  BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
  // The ear "loads" long enough for the watch to be in place before it can hear.
  BINGBONG_VAD_LOAD_MS: '5000',
  BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 12), ...frames(QUIET, 60), ...frames(SPEECH, 40), ...frames(QUIET, 220), ...frames(SPEECH, 40), QUIET]),
  BINGBONG_STT_SCRIPT: JSON.stringify([
    { text: NONE, delayMs: 1_500, partials: ['what a', 'what a lovely'] },
    { text: PLAY, delayMs: 1_500, partials: ['play', 'play nothing at'] },
  ]),
  BINGBONG_FAKE_APLAY_MS: '2000',
  // The first line read as none after 2 s, the second as the Appliance Verb.
  ...decisionScript(readingOf(NONE, 'none', { delayMs: 2_000 }), readingOf(PLAY)),
}

/**
 * Samples the linger bar's drawn length (its scaleX) every 100 ms with the time, and when the card left the screen,
 * both on the renderer's clock.
 */
const LINGER_WATCH = `(() => {
  window.__linger = { samples: [], closedAt: null }
  const timer = setInterval(() => {
    const at = performance.timeOrigin + performance.now()
    if (!document.querySelector('.turn-card')) { window.__linger.closedAt = at; clearInterval(timer); return }
    const bar = document.querySelector('.turn-linger')
    if (!bar) return
    const transform = getComputedStyle(bar).transform
    const scale = transform === 'none' ? 1 : Number(transform.slice(transform.indexOf('(') + 1).split(',')[0])
    window.__linger.samples.push([at, scale])
  }, 100)
})()`

/**
 * Records, on every change of the card, the first geometry seen for each of its states: the rail cells, the stage
 * word's left edge, the mark's right edge, the words row and the six history rows — and when the card first showed,
 * against when this renderer learned the ear opened (#441's recipe), both on the renderer's clock.
 */
const WATCH = `(() => {
  window.__turn = { shownAt: null, listenAt: null, heardAt: null, heardShownAt: null, states: {}, order: [], partials: [] }
  window.bingbong.voice.onState((state) => { if (state.listening && window.__turn.listenAt === null) window.__turn.listenAt = performance.timeOrigin + performance.now() })
  window.bingbong.voice.onHeard(() => { if (window.__turn.heardAt === null) window.__turn.heardAt = performance.timeOrigin + performance.now() })
  const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }
  const grab = () => {
    const card = document.querySelector('.turn-card')
    if (!card) return
    if (window.__turn.shownAt === null) window.__turn.shownAt = performance.timeOrigin + performance.now()
    if (window.__turn.heardShownAt === null && (card.textContent ?? '').includes('Heard“')) window.__turn.heardShownAt = performance.timeOrigin + performance.now()
    const words = card.querySelector('.turn-words')?.textContent ?? ''
    if (card.dataset.state === 'listening' && words.startsWith('“') && !window.__turn.partials.includes(words)) window.__turn.partials.push(words)
    const state = card.dataset.state
    if (window.__turn.states[state]) return
    window.__turn.states[state] = {
      cells: [...card.querySelectorAll('.turn-rail-cell')].map(r),
      wordLeft: r(card.querySelector('.turn-stage-word'))[0],
      markRight: r(card.querySelector('.turn-stage-mark'))[2],
      words: r(card.querySelector('.turn-words')),
      rows: [...card.querySelectorAll('.turn-step')].map(r),
      text: card.textContent,
    }
    window.__turn.order.push(state)
  }
  new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  grab()
  window.__turn.trace = []
  setInterval(() => { const s = document.querySelector('.turn-card')?.dataset.state ?? '-'; const last = window.__turn.trace.at(-1); if (last?.s !== s) window.__turn.trace.push({ s, t: Math.round(performance.now()) }) }, 50)
})()`

interface Seen {
  shownAt: number | null
  listenAt: number | null
  heardAt: number | null
  heardShownAt: number | null
  states: Record<string, { cells: number[][]; wordLeft: number; markRight: number; words: number[]; rows: number[][]; text: string }>
  order: string[]
  partials: string[]
}

describe('the Turn Card (#474): spoken lines over the Idle Screen', () => {
  it('shows every step of each line on one card whose geometry never moves, and goes 15 s after the line is over', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-turn-card-'))
    const fixture = await startFixtureServer()
    const harness: Harness = await startHarness({ userDataDir, fixture, wakeFromBootIdle: false, launchArgs: ['--mute-audio', ...FAKE_MIC], env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...ear } })
    try {
      const onDashboard = <T,>(expression: string): Promise<T> => harness.dashboardEval<T>(expression)
      await waitFor(async () => ((await onDashboard<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })
      expect(await onDashboard<boolean>(`!!document.querySelector('.turn-card')`)).toBe(false)
      await onDashboard(WATCH)
      // The wake: the card is up as soon as the ear opens (AC1), on the listening state.
      const { shownAt, listenAt } = await waitFor(async () => {
        const turn = await onDashboard<Seen>('window.__turn')
        return turn.shownAt !== null && turn.listenAt !== null ? turn : undefined
      }, { timeoutMs: 40_000, intervalMs: 20 })
      console.log(`[turn card] shown ${(shownAt! - listenAt!).toFixed(0)} ms after the renderer learned the ear opened`)
      // The receipt (ui.md 1): the card is on screen within 100 ms of the renderer learning the ear opened.
      expect(shownAt! - listenAt!).toBeLessThan(100)
      // The Status Capsule no longer floats over the Idle Screen (AC6).
      expect(await onDashboard<boolean>(`!!document.querySelector('.idle-screen .status-capsule')`)).toBe(false)

      // Both lines run: the Failed state is the last the second reaches.
      const seen = await waitFor(async () => {
        const turn = await onDashboard<Seen>('window.__turn')
        return turn.states.failed !== undefined ? turn : undefined
      }, { timeoutMs: 60_000, intervalMs: 100 }).catch(async (error: unknown) => {
        const turn = await onDashboard<Seen>('window.__turn')
        console.log(`[turn card] no failed: states ${turn.order.join(' → ')}; card now: ${await onDashboard<string>(`document.querySelector('.turn-card')?.textContent ?? '(none)'`)}; voice ${JSON.stringify(await onDashboard('window.bingbong.voice.getState()'))}`)
        throw error
      })
      console.log(`[turn card] states in order: ${seen.order.join(' → ')}`)
      // The transcript's receipt (AC1): the Heard row within 100 ms of the renderer learning the `heard` event.
      console.log(`[turn card] Heard row ${(seen.heardShownAt! - seen.heardAt!).toFixed(0)} ms after the renderer learned the transcript`)
      expect(seen.heardShownAt! - seen.heardAt!).toBeLessThan(100)
      console.log(`[turn card] trace: ${JSON.stringify(await onDashboard('window.__turn.trace'))}`)
      for (const [state, geometry] of Object.entries(seen.states)) console.log(`[turn card] ${state}: ${geometry.text}`)

      // The live partials drawn in full, never cut (AC1): each line's last partial, whole.
      expect(seen.partials).toContain('“what a lovely…”')
      expect(seen.partials).toContain('“play nothing at…”')
      // The transcript in the Heard row and the words row (AC1); Thinking with the heard words and its seconds (AC2); read as
      // no Command and ended on "No response" (AC3); the play's reading, its failure while it sounds, and Failed (AC2, AC3, AC4).
      expect(seen.states.transcribing?.text).toContain('Transcribing…')
      expect(seen.states.transcribing?.text).toContain('“what a lovely”')
      expect(seen.states.thinking?.text).toMatch(new RegExp(`Thinking…\\d+s“${NONE}”`))
      expect(seen.states.thinking?.text).toContain(`Heard“${NONE}”`)
      expect(seen.states.dropped?.text).toContain('Read asno Command')
      expect(seen.states.dropped?.text).toContain('No response')
      if (seen.states.speaking !== undefined) expect(seen.states.speaking.text).toContain('Speaking…')
      if (seen.states.acting !== undefined) expect(seen.states.acting.text).toContain('Playing…')
      expect(seen.states.failed?.text).toContain(`Heard“${PLAY}”`)
      expect(seen.states.failed?.text).toContain('Read asplay')
      expect(seen.states.failed?.text).toContain('SpeakingNo videos found')
      expect(seen.states.failed?.text).toContain('FailedNo videos found')
      // The first line's rows are not on the second's card (AC4: a new line restarts it).
      expect(seen.states.failed?.text).not.toContain(NONE)
      for (const state of ['listening', 'transcribing', 'thinking', 'dropped', 'failed']) expect(seen.order, `the ${state} state was drawn`).toContain(state)

      // Nothing moves between states (AC5): the rail cells, the stage word's left, the mark's right and the rows at one position.
      const reference = seen.states.listening!
      for (const [state, geometry] of Object.entries(seen.states)) {
        expect(geometry.cells, `${state}: the rail cells`).toEqual(reference.cells)
        expect(geometry.wordLeft, `${state}: the stage word's left edge`).toBe(reference.wordLeft)
        expect(geometry.markRight, `${state}: the mark's right edge`).toBe(reference.markRight)
        expect(geometry.words, `${state}: the words row`).toEqual(reference.words)
        expect(geometry.rows, `${state}: the history rows`).toEqual(reference.rows)
      }
      expect(reference.rows).toHaveLength(6)

      // The card goes 15 s after the later of done and the last sentence spoken (AC4), the Idle Screen left up.
      const doneAt = Date.now()
      await onDashboard(LINGER_WATCH)
      await new Promise((resolve) => setTimeout(resolve, 10_000))
      expect(await onDashboard<boolean>(`!!document.querySelector('.turn-card--failed')`)).toBe(true)
      await waitFor(async () => ((await onDashboard<boolean>(`!document.querySelector('.turn-card')`)) ? true : undefined), { timeoutMs: 30_000, intervalMs: 100 })
      expect(Date.now() - doneAt).toBeGreaterThanOrEqual(LINGER_MS - 2_000)
      expect(await onDashboard<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
      // The bar drains to the close, not ahead of it: each drawn length is the time then left over the linger, across the
      // card's once-a-second re-renders. The bound is a guess at a frame's and a sample's slack (0.05 of 15 s is 750 ms).
      const linger = await waitFor(async () => {
        const seenLinger = await onDashboard<{ samples: [number, number][]; closedAt: number | null }>('window.__linger')
        return seenLinger.closedAt !== null ? seenLinger : undefined
      }, { timeoutMs: 2_000, intervalMs: 50 })
      expect(linger.samples.length).toBeGreaterThan(20)
      const worst = Math.max(...linger.samples.map(([at, scale]) => Math.abs(scale - (linger.closedAt! - at) / LINGER_MS)))
      console.log(`[turn card] linger bar off its close by at most ${worst.toFixed(3)} of its length over ${String(linger.samples.length)} samples`)
      expect(worst).toBeLessThan(0.05)
    } finally {
      await harness.quit()
      await fixture.close().catch(() => {})
      if (process.env.BINGBONG_KEEP_PROFILE) console.log(`[turn card] profile kept at ${userDataDir}`)
      else await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 180_000)
})
