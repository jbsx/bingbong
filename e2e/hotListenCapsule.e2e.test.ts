import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { feedText } from './feed'
import { waitFor } from './waitFor'

// The Status Capsule through a Hot Listen (#472, ui.md 5): a wake opens the
// Listen, which stays open through the Task it submits and the line spoken
// after it. A running Command's stage is named, the waveform beside it
// saying the open ear will hear; while the app speaks, the ear drops what
// starts under the line, so the capsule says Speaking and invites nothing.
// Chromium's fake mic feeds the real capture graph at the mic's own pace;
// the scripts stand in for the models, one VAD score per 512-sample frame:
// speech for the wake's gate, then `navigate`, then a click on an item the
// page lacks, whose failure line goes through the scripted piper and an
// aplay held open for its playback.

const SPEECH = 0.95
const QUIET = 0.01
const frames = (prob: number, count: number): number[] => Array.from({ length: count }, () => prob)
const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

/** Every face the capsule shows: the pill's word, ` ~` with the waveform beside it, and the hint. */
const WATCH = `(() => {
  const capsule = document.querySelector('.status-capsule')
  const seen = (window.__capsuleSeen = [])
  const note = () => {
    const face = (capsule.querySelector('.status-pill')?.textContent ?? '') + (capsule.querySelector('.voice-wave') ? ' ~' : '') + ' | ' + (capsule.querySelector('.voice-hint')?.textContent ?? '')
    if (seen[seen.length - 1] !== face) seen.push(face)
  }
  note()
  new MutationObserver(note).observe(capsule, { subtree: true, childList: true, characterData: true })
  return 'watching'
})()`

describe('the Status Capsule through a Hot Listen (#472)', () => {
  let fixture: FixtureServer
  let dir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    dir = await mkdtemp(join(tmpdir(), 'bingbong-capsule-e2e-'))
    await writeFile(join(dir, 'en_GB-alba-medium.onnx'), '')
    await writeFile(join(dir, 'en_GB-alba-medium.onnx.json'), JSON.stringify({ audio: { sample_rate: 22050 } }))
  })

  afterAll(async () => {
    await fixture?.close()
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it('names the running stage beside the open ear, and says Speaking — no waveform, no "say a command" — while the app talks', async () => {
    await mkdir(dir, { recursive: true })
    const harness = await startHarness({
      fixture,
      launchArgs: FAKE_MIC,
      env: {
        BINGBONG_PIPER_VOICE_DIR: dir,
        BINGBONG_FAKE_APLAY_MS: '1500',
        BINGBONG_WAKE_ENGINE: 'node',
        BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
        BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 12), ...frames(QUIET, 40), ...frames(SPEECH, 20), ...frames(QUIET, 60), ...frames(SPEECH, 20), QUIET]),
        BINGBONG_STT_SCRIPT: JSON.stringify([`navigate ${fixture.url('/story')}`, 'click 999']),
      },
    })
    try {
      await waitFor(async () => ((await harness.dashboardEval<{ listening: boolean }>('window.bingbong.voice.getState()')).listening ? true : undefined), { timeoutMs: 30_000, intervalMs: 20 })
      await harness.dashboardEval<string>(WATCH)
      await harness.waitForPaneUrl(fixture.url('/story'))
      await waitFor(async () => ((await feedText(harness)).includes('click 999') ? true : undefined), { timeoutMs: 20_000, intervalMs: 250 })
      const seen = await waitFor(
        async () => {
          const faces = await harness.dashboardEval<string[]>('window.__capsuleSeen')
          return faces.some((face) => face.startsWith('Speaking…')) && !(faces[faces.length - 1] ?? '').startsWith('Speaking…') ? faces : undefined
        },
        { timeoutMs: 20_000, intervalMs: 100 },
      )
      console.log(`[capsule faces] ${seen.join('  →  ')}`)
      // The work is named while the Hot Listen is open, the waveform beside it: speaking now will be heard.
      expect(seen.some((face) => /^(?!Listening|Transcribing|Speaking)\S+… ~/.test(face))).toBe(true)
      // The app's own voice: Speaking, and nothing that asks for a line the ear would drop.
      const speaking = seen.filter((face) => face.startsWith('Speaking…'))
      expect(speaking.length).toBeGreaterThan(0)
      for (const face of speaking) {
        expect(face).not.toContain(' ~')
        expect(face).not.toContain('say a command')
      }
    } finally {
      await harness.quit()
    }
  }, 120_000)
})
