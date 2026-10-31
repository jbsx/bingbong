import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { listen } from './headlessChrome.ts'
import { startHarness, type Harness } from './harness.ts'
import { cli } from './cliSupport.ts'
import { openRoom, type Room } from './overlap/room.ts'
import { sleep, waitFor } from './waitFor.ts'

// How much of the app's own voice the echo canceller takes out of the mic
// (#490), aplay against Chromium (BINGBONG_SPEECH_PLAYER). Model-free: the
// app, with its real Piper and voice, runs in a closed room
// (e2e/overlap/room.ts: a null sink whose monitor is the mic; nothing
// reaches a speaker), opens a page whose long alert is said — a typed line, no
// model is asked — and a recorder in the dashboard takes the mic with the app's own
// capture constraints (micCapture.ts: echoCancellation on) and its capture
// context. The measure is the mic's p90 level over that line, whole and
// after the canceller's first 4 s, per arm, beside `tts-first-sound`.
//
// It runs only when asked (`pnpm speech:echo`), as it needs pulseaudio and
// the app's own Piper under ~/.config/bingbong; each arm launches the app once.
// The numbers land in BINGBONG_SPEECH_ECHO_OUT (default <tmp>/speech-echo.json).

const CONFIG_DIR = join(homedir(), '.config', 'bingbong')
const PIPER = join(CONFIG_DIR, 'piper', 'piper', 'piper')
const VOICES = join(CONFIG_DIR, 'voices')
const OUT = process.env.BINGBONG_SPEECH_ECHO_OUT ?? join(tmpdir(), 'speech-echo.json')

/** A page whose alert lasts some fifteen seconds in alba: the longest line left to say since the Page Read went. */
const PAGE = `<!doctype html><html><head><title>Lighthouse</title></head><body><main><h1>The lighthouse keeper</h1>
<script>setTimeout(() => alert('The keeper climbed the stairs at dusk, as he had every evening for thirty years. The lamp was cold, and the glass was thick with salt from the morning storm. He wiped it clean with a rag, trimmed the wick, and struck a match against the iron rail. Far out on the water a fishing boat was turning for home, its sails grey against the cloud. He lit the lamp before dark, and the beam swung out across the rocks and the harbour wall.'), 500)</script></main></body></html>`

/** micCapture.ts's captureConstraints('default') and CAPTURE_CONTEXT_OPTIONS (a renderer module, so not imported here). */
const CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const CONTEXT = { sampleRate: 16000, sinkId: { type: 'none' } }

/** The mic, as the app takes it, one level per 1024-sample block, on the page's wall clock. */
const RECORDER = `(async () => {
  if (window.__echo) return true
  const stream = await navigator.mediaDevices.getUserMedia({ audio: ${JSON.stringify(CONSTRAINTS)} })
  const ctx = new AudioContext(${JSON.stringify(CONTEXT)})
  const source = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(1024, 1, 1)
  const levels = []
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0)
    let s = 0
    for (const v of d) s += v * v
    levels.push([Date.now(), Math.sqrt(s / d.length)])
  }
  source.connect(proc)
  proc.connect(ctx.destination)
  window.__echo = { levels, stream, ctx }
  return true
})()`

interface Span {
  readonly stage: string
  readonly durMs: number
  readonly at: number
}

function spans(userDataDir: string): Span[] {
  const logs = join(userDataDir, 'logs')
  if (!existsSync(logs)) return []
  return readdirSync(logs)
    .filter((name) => name.startsWith('perf-') && name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(join(logs, name), 'utf8').split('\n'))
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Span)
}

const db = (rms: number): number => 20 * Math.log10(rms + 1e-9)
const p = (values: number[], at: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))] ?? Number.NaN
}

/** The room itself, before any canceller: the p90 level of what played into it, from its recording (s16 mono after a 44-byte header). */
function roomP90(path: string): number {
  const bytes = readFileSync(path)
  const levels: number[] = []
  for (let at = 44; at + 2048 <= bytes.length; at += 2048) {
    let sum = 0
    for (let i = at; i < at + 2048; i += 2) sum += (bytes.readInt16LE(i) / 32768) ** 2
    levels.push(db(Math.sqrt(sum / 1024)))
  }
  return p(levels, 0.9)
}

interface ArmResult {
  readonly arm: string
  /** What played into the room, uncancelled: proof the arm sounded there. */
  readonly roomP90?: number
  readonly floorP50: number
  readonly readP90: number
  readonly lateP90: number
  readonly readMs: number
  readonly firstSoundMs: number
}

async function measure(arm: 'aplay' | 'chromium', room: Room): Promise<ArmResult> {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
  })
  let harness: Harness | null = null
  try {
    harness = await startHarness({
      launchArgs: ['--browser-cli', '--use-fake-ui-for-media-stream'],
      pipeStdio: true,
      audioRoom: room.server,
      startupTimeoutMs: 60_000,
      env: {
        BINGBONG_MUTE_AUDIO: '0',
        BINGBONG_APLAY_BIN: room.aplay,
        BINGBONG_SPEECH_PLAYER: arm,
        BINGBONG_PIPER_BIN: PIPER,
        BINGBONG_PIPER_VOICE_DIR: VOICES,
      },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    await waitFor(async () => ((await harness!.dashboardEval<boolean>(RECORDER)) === true ? true : undefined), { timeoutMs: 20_000, intervalMs: 250 })
    // Piper warms (the prefetch) and the mic's quiet floor is taken.
    await sleep(4000)
    await cli(harness, `navigate http://127.0.0.1:${port}/`, /^navigated: /)
    const userDataDir = harness.userDataDir
    const playback = await waitFor(async () => spans(userDataDir).find((span) => span.stage === 'tts-playback' && span.durMs > 5000), { timeoutMs: 60_000, intervalMs: 250 })
    const firstSound = spans(userDataDir).find((span) => span.stage === 'tts-first-sound')
    await sleep(500)
    const levels = await harness.dashboardEval<[number, number][]>('window.__echo.levels')
    const from = playback.at - playback.durMs
    const during = levels.filter(([t]) => t >= from && t <= playback.at).map(([, rms]) => db(rms))
    const late = levels.filter(([t]) => t >= from + 4000 && t <= playback.at).map(([, rms]) => db(rms))
    const floor = levels.filter(([t]) => t < from - 500).map(([, rms]) => db(rms))
    return {
      arm,
      floorP50: p(floor, 0.5),
      readP90: p(during, 0.9),
      lateP90: p(late, 0.9),
      readMs: Math.round(playback.durMs),
      firstSoundMs: Math.round(firstSound?.durMs ?? Number.NaN),
    }
  } finally {
    await harness?.quit()
    server.close()
  }
}

describe.skipIf(process.env.BINGBONG_SPEECH_ECHO !== '1' || !existsSync(PIPER))("the echo canceller and the app's own voice (#490)", () => {
  const dir = mkdtempSync(join(tmpdir(), 'bingbong-speech-echo-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('takes the voice out of the mic when it plays through Chromium, and not through aplay', async () => {
    const results: ArmResult[] = []
    for (const arm of ['aplay', 'chromium'] as const) {
      // Each arm in a room of its own: the canceller starts fresh.
      const room = await openRoom(join(dir, arm))
      const recording = join(dir, `${arm}-room.wav`)
      room.record(recording)
      let result: ArmResult
      try {
        result = await measure(arm, room)
      } finally {
        await room.close()
      }
      results.push({ ...result, roomP90: roomP90(recording) })
    }
    writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`)
    console.log(results.map((r) => `${r.arm}: floor p50 ${r.floorP50.toFixed(1)} dBFS, read p90 ${r.readP90.toFixed(1)}, after 4 s ${r.lateP90.toFixed(1)}, read ${r.readMs} ms, first sound ${r.firstSoundMs} ms, room p90 ${r.roomP90?.toFixed(1)}`).join('\n'))
    const [aplay, chromium] = results as [ArmResult, ArmResult]
    // Both arms sounded in the room, and through aplay the mic heard it whole.
    expect(aplay.roomP90).toBeGreaterThan(-30)
    expect(chromium.roomP90).toBeGreaterThan(-30)
    expect(aplay.readP90).toBeGreaterThan(-30)
    // Through Chromium the canceller has its reference: at least 30 dB of it gone once it has settled.
    expect(chromium.lateP90).toBeLessThan(aplay.lateP90 - 30)
  }, 300_000)
})
