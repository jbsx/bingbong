import { readFileSync, readdirSync } from 'node:fs'
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav'
import { startFixtureServer, YOUTUBE_FIXTURE_SONG, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The Appliance Card's speed measure (#485, the rulings' T1 measure): the
// stt:gate's labelled dumps replayed through the ear along voiceChain.e2e's
// road — each dump's real audio played, at real time, into the stream the
// dashboard's mic capture opens (getUserMedia answered with it), through
// the capture worklet and the real VAD — over the page its turn was spoken
// on (fixtures/stt-labels/dump-pages.json: the YouTube stand-in's watch page
// playing, an article, or a blank pane), the page put back before every
// line, the Decision Model the root .env names (Mammoth, live). The words
// are the ear's own transcript of each dump (stt-gate.json), held 250 ms as
// the kiosk's ElevenLabs ear p50 holds them: STT is the same on every arm,
// so the cards are what the arms differ by. Measured, not asserted:
// `pnpm perf:report` reads the logs this copies to BINGBONG_APPLIANCE_SPEED.
// Opt-in:
//
//   pnpm build && BINGBONG_APPLIANCE_SPEED=/tmp/speed-S [BINGBONG_SPEED_REPEAT=3] [BINGBONG_APPLIANCE_CARD=off|BINGBONG_APPLIANCE_ASKS=parallel] \
//     xvfb-run -a -s '-screen 0 1280x800x24' vitest run --config vitest.e2e.config.ts e2e/applianceSpeed.e2e.test.ts

const out = process.env.BINGBONG_APPLIANCE_SPEED
const repeat = Number(process.env.BINGBONG_SPEED_REPEAT ?? 3)
const only = process.env.BINGBONG_SPEED_ONLY
const debug = process.env.BINGBONG_SPEED_DEBUG
const repoRoot = process.cwd()
const RATE = 16_000
/** How long a line's turn is given to settle before the page is put back for the next. */
const SETTLE_MS = 12_000
/** The kiosk's ElevenLabs ear, p50 (reliability.md's budget). */
const STT_MS = 250
/** Lines per launch: a fresh profile now and then, as the kiosk's day has restarts. */
const BATCH = 30

type Page = 'watch' | 'article' | 'blank'

interface Line {
  readonly dump: string
  readonly heard: string
  readonly page: Page
}

/** The root .env's Decision Model settings, and the key they name: the live host the measure asks. */
async function decisionEnv(): Promise<Record<string, string>> {
  const text = await readFile(join(repoRoot, '.env'), 'utf8').catch(() => '')
  const env = Object.fromEntries(
    text
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1]!, match[2]!.replace(/^["']|["']$/g, '')]),
  )
  const decision = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('BINGBONG_DECISION_')))
  const keyName = decision.BINGBONG_DECISION_API_KEY_ENV
  return { ...decision, ...(keyName !== undefined && env[keyName] !== undefined ? { [keyName]: env[keyName] } : {}) }
}

/** The arm under measure, as the app reads it. */
const armEnv = (): Record<string, string> =>
  Object.fromEntries(['BINGBONG_APPLIANCE_CARD', 'BINGBONG_APPLIANCE_ASKS', 'BINGBONG_APPLIANCE_WEB'].flatMap((key) => (process.env[key] !== undefined ? [[key, process.env[key]!]] : [])))

function linesOf(): Line[] {
  const heard = JSON.parse(readFileSync(join(repoRoot, 'fixtures/stt-labels/stt-gate.json'), 'utf8')) as Record<string, { heard: string }>
  const pages = JSON.parse(readFileSync(join(repoRoot, 'fixtures/stt-labels/dump-pages.json'), 'utf8')) as Record<string, { page: Page }>
  const dumps = readdirSync(join(repoRoot, 'fixtures/stt-dumps')).filter((name) => name.endsWith('.wav')).sort()
  const lines = dumps.flatMap((dump) => (heard[dump] !== undefined && heard[dump].heard.trim() !== '' && pages[dump] !== undefined ? [{ dump, heard: heard[dump].heard, page: pages[dump].page }] : []))
  return only !== undefined ? lines.slice(0, Number(only)) : lines
}

/** The stand-in mic (in the dashboard): getUserMedia answers a stream each line is played into, at real time. */
const STAND_IN_MIC = `(() => {
  const context = new AudioContext({ sampleRate: ${RATE} })
  // A capture's stop ends its tracks for good: each opening gets a stream of its own, and the line plays into the latest.
  let mic = context.createMediaStreamDestination()
  navigator.mediaDevices.getUserMedia = async () => {
    mic = context.createMediaStreamDestination()
    return mic.stream
  }
  window.__speedPlay = async (b64) => {
    await context.resume()
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const pcm = new Float32Array(bytes.buffer)
    const buffer = context.createBuffer(1, pcm.length, ${RATE})
    buffer.copyToChannel(pcm, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(mic)
    return new Promise((resolve) => {
      source.onended = () => resolve('played')
      source.start()
    })
  }
  return 'ready'
})()`

describe.skipIf(!out)('the Appliance Card speed replay (#485)', () => {
  const cleanup: (() => Promise<void>)[] = []
  afterAll(async () => {
    for (const step of cleanup.reverse()) await step().catch(() => {})
  })

  const batches = out === undefined ? [] : (['watch', 'article', 'blank'] as const).flatMap((page) => {
    const lines = linesOf().filter((line) => line.page === page)
    const all = Array.from({ length: repeat }, () => lines).flat()
    return Array.from({ length: Math.ceil(all.length / BATCH) }, (_, k) => ({ page, k, schedule: all.slice(k * BATCH, (k + 1) * BATCH) }))
  })
  for (const { page, k, schedule } of batches) {
    it(`replays the dumps spoken over a ${page} page, batch ${k + 1}`, async () => {
      const userDataDir = await mkdtemp(join(tmpdir(), `bingbong-e2e-speed-${page}-`))
      const fixture: FixtureServer = await startFixtureServer()
      cleanup.push(() => rm(userDataDir, { recursive: true, force: true }), () => fixture.close())
      let harness: Harness | undefined
      try {
        harness = await startHarness({
          userDataDir,
          fixture,
          env: {
            ...(await decisionEnv()),
            ...armEnv(),
            BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin,
            // No wake word: every line is a hotkey listen, armed before it is spoken.
            BINGBONG_WAKE_ENGINE: 'off',
            BINGBONG_VAD_MODEL: join(repoRoot, 'models/silero_vad.onnx'),
            BINGBONG_STT_SCRIPT: JSON.stringify(schedule.map((line) => ({ text: line.heard, delayMs: STT_MS }))),
          },
          startupTimeoutMs: 60_000,
        })
        const app = harness
        const home = page === 'watch' ? `https://www.youtube.com/watch?v=${YOUTUBE_FIXTURE_SONG.id}` : page === 'article' ? fixture.url('/story') : 'about:blank'
        const reactions = async (): Promise<number> => {
          const files = (await readdir(join(userDataDir, 'logs')).catch(() => [] as string[])).filter((name) => name.startsWith('perf-'))
          const text = (await Promise.all(files.map((name) => readFile(join(userDataDir, 'logs', name), 'utf8')))).join('')
          return text.split('\n').filter((line) => line.includes('"stage":"reaction"')).length
        }
        await app.dashboardEval(STAND_IN_MIC)
        for (const line of schedule) {
          // A line that brought up the Idle Screen is put back as the harness wakes the boot's: any key.
          await app.dashboardEval(`(window.dispatchEvent(new KeyboardEvent('keydown')), true)`)
          await app.navigatePane(home)
          // The page drawn and, on the watch page, its song under way.
          await new Promise((resolve) => setTimeout(resolve, 2_000))
          const before = await reactions()
          await app.dashboardEval('window.bingbong.voice.arm()')
          await waitFor(async () => ((await app.dashboardEval<{ listening: boolean; loading?: string }>('window.bingbong.voice.getState()')).listening ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
          // The capture opened on the stand-in, and the ear past its loads, before the line is spoken.
          await waitFor(async () => ((await app.dashboardEval<{ loading?: string }>('window.bingbong.voice.getState()')).loading === undefined ? true : undefined), { timeoutMs: 30_000, intervalMs: 100 }).catch(() => undefined)
          await new Promise((resolve) => setTimeout(resolve, 300))
          const speech = readUtteranceWavPcm(new Uint8Array(await readFile(join(repoRoot, 'fixtures/stt-dumps', line.dump))))
          // The line, then the silence its Endpoint is heard in.
          const pcm = new Float32Array(speech.length + Math.round(2 * RATE))
          pcm.set(speech)
          await app.dashboardEval(`window.__speedPlay(${JSON.stringify(Buffer.from(pcm.buffer).toString('base64'))})`)
          const reacted = await waitFor(async () => ((await reactions()) > before ? true : undefined), { timeoutMs: SETTLE_MS, intervalMs: 200 }).catch(() => false)
          if (debug !== undefined) await appendFile(debug, `${page}-${k + 1} ${line.dump} ${JSON.stringify(line.heard)} reacted=${String(reacted)} ${JSON.stringify(await app.dashboardEval('window.bingbong.voice.getState()'))}\n`)
          // The Task's own hops and its speech end before the page is put back.
          await new Promise((resolve) => setTimeout(resolve, 1_500))
        }
      } finally {
        await harness?.quit()
        await mkdir(out!, { recursive: true })
        await cp(join(userDataDir, 'logs'), join(out!, `${page}-${k + 1}`), { recursive: true }).catch(() => {})
      }
    }, 3_600_000)
  }
})
