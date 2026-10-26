import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startElevenLabsStandIn, type EarStandIn } from './elevenLabsStandIn'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The cloud ear (#463): `sttEngine` elevenlabs against a stand-in socket,
// with the #442 recipe — Chromium's fake mic feeding the real capture
// graph, the scripts standing in for the wake and the VAD, the scripted
// transcriber standing in for the Parakeet behind the cloud. A wake, quiet
// in the open listen, then an Utterance: the socket opens at the wake, its
// partial reaches the Hearing phase, and its committed words fire the
// Command; a server fault hands the same Utterance to Parakeet instead.

const SPEECH = 0.95
const QUIET = 0.01
const frames = (prob: number, count: number): number[] => Array.from({ length: count }, () => prob)

const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

function earEnv(standIn: EarStandIn): Record<string, string> {
  return {
    BINGBONG_WAKE_ENGINE: 'node',
    BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
    // Speech for the wake's gate, ~2 s quiet in the open listen, then the Utterance.
    BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 12), ...frames(QUIET, 60), ...frames(SPEECH, 40), QUIET]),
    // The Parakeet behind the cloud: heard only when the cloud cannot.
    BINGBONG_STT_SCRIPT: JSON.stringify(['reload']),
    BINGBONG_STT_ENGINE: 'elevenlabs',
    ELEVENLABS_API_KEY: 'stand-in-key',
    BINGBONG_ELEVENLABS_URL: standIn.url,
  }
}

async function jsonl<T>(harness: Harness, prefix: string): Promise<T[]> {
  const logsDir = join(harness.userDataDir, 'logs')
  const files = (await readdir(logsDir).catch(() => [] as string[])).filter((name) => name.startsWith(prefix))
  return (await Promise.all(files.map((name) => readFile(join(logsDir, name), 'utf8'))))
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T)
}

interface Decision {
  type: string
  source: string
  transcript: string
  verb: string
}

/** The first spoken Command's decision record. */
const spoken = (harness: Harness): Promise<Decision | undefined> => waitFor(async () => (await jsonl<Decision>(harness, 'decision-')).find((record) => record.type === 'decision' && record.source === 'spoken'), { timeoutMs: 30_000, intervalMs: 100 })

/** Stamps when the Idle Screen's said-line first shows `words` (the Hearing phase's partial). */
const watchSaid = (words: string): string => `(() => {
  window.__said = null
  new MutationObserver(() => {
    const said = document.querySelector('.idle-voice-said')?.textContent ?? ''
    if (window.__said === null && said.includes(${JSON.stringify(words)})) window.__said = said
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true })
})()`

describe('the cloud ear (#463)', () => {
  let standIn: EarStandIn

  beforeAll(async () => {
    standIn = await startElevenLabsStandIn()
  })

  afterAll(async () => {
    await standIn?.close()
  })

  it('opens at the wake, shows its partial while hearing, and fires the Command its committed words say', async () => {
    standIn.script = { partial: 'Scroll', committed: 'Scroll down.' }
    const harness = await startHarness({ wakeFromBootIdle: false, launchArgs: FAKE_MIC, env: earEnv(standIn) })
    try {
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })
      await harness.dashboardEval(watchSaid('Scroll'))
      const decision = await spoken(harness)
      expect(decision).toMatchObject({ transcript: 'Scroll down.', verb: 'scroll_down' })
      // The partial reached the Hearing phase as Parakeet's do (ADR 0094).
      expect(await harness.dashboardEval<string | null>('window.__said')).toContain('Scroll')
      const session = standIn.sessions.at(-1)!
      expect(session.headers['xi-api-key']).toBe('stand-in-key')
      const query = new URL(session.url, 'ws://x').searchParams
      expect(query.get('model_id')).toBe('scribe_v2_realtime')
      expect(query.get('commit_strategy')).toBe('manual')
      expect(query.getAll('keyterms').length).toBeGreaterThan(0)
      expect(query.getAll('keyterms').length).toBeLessThanOrEqual(50)
      // Opened at the wake (grill ruling 7): well before the Utterance's first audio, the ~2 s of quiet between.
      expect(session.firstAudioAt! - session.openedAt).toBeGreaterThan(1_000)
      // Only the Utterance left the machine: its ~1.3 s of speech, the pre-roll and the tail, at 16 kHz × 2 bytes.
      expect(session.audioBytes).toBeGreaterThan(1.2 * 32_000)
      expect(session.audioBytes).toBeLessThan(2.5 * 32_000)
      expect(session.committed).toBe(true)
    } finally {
      await harness.quit()
    }
  }, 90_000)

  it('hands the Utterance to Parakeet when the server faults, and records the fault', async () => {
    standIn.script = { partial: 'Scroll', error: 'stand-in quota' }
    const harness = await startHarness({ wakeFromBootIdle: false, launchArgs: FAKE_MIC, env: earEnv(standIn) })
    try {
      const decision = await spoken(harness)
      // The scripted Parakeet's words, not the cloud's: the Transcribing count carried on to a Command.
      expect(decision).toMatchObject({ transcript: 'reload', verb: 'reload' })
      const faults = await waitFor(async () => {
        const found = (await jsonl<{ site?: string; message?: string }>(harness, 'faults-')).filter((fault) => fault.site === 'voice.ear.cloud')
        return found.length > 0 ? found : undefined
      }, { timeoutMs: 5_000, intervalMs: 100 })
      expect(JSON.stringify(faults[0])).toContain('quota_exceeded')
    } finally {
      await harness.quit()
    }
  }, 90_000)
})
