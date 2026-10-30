#!/usr/bin/env node
// `pnpm overlap:gate` (#486): the Sequence Cases (fixtures/overlap-cases/)
// run black-box on the built app, a sibling of `pnpm goal:gate`. Each point
// of each case gets a fresh app on a fresh profile — the built app launched
// the way the e2e harness launches it (e2e/electronApp.ts: X11 under the
// xvfb-run the pnpm script wraps this in, muted, never on the real display)
// — with nothing scripted: the Decision Model is each gate model in turn,
// the Planner its default. A case says what is in front of the person, the
// lines and when each arrives, and what a person sees and hears at the end;
// the gate does what a person would and reads what a person could.
//
// - typed lines go in over IPC `assistant.submit`, the Toolbar's road, so a
//   line can arrive while the one before it is still running (the CLI
//   harness chains lines one after another and is not used);
// - spoken lines are one wav on Chromium's fake mic, laid out before launch
//   (e2e/overlap/wavLayout.ts): on the wake road by default — the wake word
//   from fixtures/wake-audio, the real wake and VAD models, one Hot Listen —
//   or, with `"listen": "hotkey"`, a hotkey listen armed for each line. The
//   mic is muted while the start is set up and unmuted to begin: Chromium
//   plays the file from its start on every capture it opens;
// - a case with `"echo": true` runs in a room instead (e2e/overlap/room.ts,
//   #490): a private PulseAudio whose one device is a null sink. The app's
//   speech plays into it, the wav is played into it at the unmute, and the
//   mic is its monitor, so the app's own voice is heard live, ducking and
//   stopping as it does. Nothing reaches a speaker: the room holds no device.
//
// A time is a fixed ms, a window run at seeded points, or a point a person
// could see or hear (e2e/overlap/points.ts). A typed line at a moment
// (`after`) is sent the moment it is seen; a span (`while`), and every named
// point of a spoken case, is placed by a calibration run: the case with line
// 1 alone, per Decision Model, its timeline read from the records
// (e2e/overlap/timeline.ts). `--calibration dir` reuses a kept one.
//
// End state: the pane's URL, title and text in view and every <video> and
// <audio> over CDP; every sentence said from the `speak` records; each
// line's outcome from its `command` and `done` records, which the dashboard
// hears on the command stream. A sentence's meaning goes to the judge
// (GLM-5.3-flash through the Planner's chat adapter, as goal:gate's);
// everything else is exact (e2e/overlap/checks.ts). A wall seen before line
// 2 arrives reports `wall`, neither red nor green.
//
// Usage:
//   pnpm overlap:gate [--cases substr,…] [--models id,…] [--repeat N] [--seed N] [--points N]
//                     [--keep dir] [--calibration dir] [--planner id] [--check-state] [--with-jev]
//                     [--road pane|audio|both] [--resume]
//
// With `--keep`, every run is written as it ends and `summary.json` there
// after every point (e2e/overlap/summary.ts): each point finished, its
// verdict, and the point a host refused for credit. A refusal for credit
// (a 402 or 403, or the host's words naming credit, billing or quota; never
// a 429, which is run again) is neither red nor green: that run is kept as
// `<point>-refused`, the gate stops, and exits 3 with the table so far.
// `--resume` runs only what the summary is missing, on the same commit,
// seed, points, repeat and roads, the refused point included, and reuses the
// kept calibrations.
//
// `--road` (#509) is where a song plays: `audio` (the default, as shipped),
// `pane`, or `both`, one after the other. Each fresh profile is written the
// road's Settings toggle, off as plainly as on, so no run reads the default
// (e2e/overlap/audioRoad.ts). Whichever the road, every read takes the road's
// hidden window beside the pane, its <audio> named by the song, and the
// dashboard's Now Playing title in view. Each road has its own tables, kept
// runs (`<keep>/<road>/<case>/<model>/`) and calibrations: `--calibration dir`
// reads `<dir>/<road>/…`, so one kept before #509 is not found and is made again.
//
// The start is checked before line 1 (e2e/overlap/start.ts): the page shown,
// how many pages are behind it, a song heard on the pane or the road. A start
// the run could not put is `start not met`: it measured nothing, is never red
// and is not counted.
//
// The models are BINGBONG_GATE_MODELS (or --models), read as jev:gate reads them, each a Decision Model id
// on the env's BINGBONG_DECISION_* host; --with-jev adds Jev, the default
// endpoint, and is the only way Jev is asked. One table per model. The env
// is the root .env, which the pnpm script loads.
// Node runs this .ts directly via type stripping (#36).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CdpClient } from '../e2e/cdpClient.ts'
import { launchApp, pickFreeDebugPort, type LaunchedApp } from '../e2e/electronApp.ts'
import { checkEnd, firstMediaFrom, lineOutcomes, saidFrom, type EndState } from '../e2e/overlap/checks.ts'
import { casePoints, describePlaced, type CasePoint, type PlacedTime } from '../e2e/overlap/points.ts'
import { formatTable, measuredOn, stateDisagreements, type CaseRow, type Cell } from '../e2e/overlap/report.ts'
import { readSequenceCase, type SequenceCase } from '../e2e/overlap/sequenceCase.ts'
import { pagesBehind, startSteps, startUnmet, type SeenStart } from '../e2e/overlap/start.ts'
import { paneHeldStill, placeMs, QUIET_MS, SAMPLE_MS, spanBegun, spansOf, stageOpen, wallBefore, type MediaState, type PaneSample, type RunRecords, type Spans } from '../e2e/overlap/timeline.ts'
import { layoutWav, type WavPiece } from '../e2e/overlap/wavLayout.ts'
import { openRoom, type Room } from '../e2e/overlap/room.ts'
import { openSlowHost, SLOW_HOST_ENV_KEY, type SlowHost } from '../e2e/overlap/slowHost.ts'
import { creditRefusal, logLines } from '../e2e/overlap/refusal.ts'
import { finishedCell, readSummary, resumeFrom, withFinished, withRefused, writeSummary, SUMMARY_FILE, type Summary } from '../e2e/overlap/summary.ts'
import { isAudioSurfaceUrl, readRoads, roadSettings, SETTINGS_FILE, withRoad, type Road, type RoadRead } from '../e2e/overlap/audioRoad.ts'
import { stripMarkdownForSpeech } from '../src/core/tts/stripMarkdownForSpeech.ts'
import { DEFAULT_PIPER_VOICE } from '../src/core/tts/piperVoices.ts'
import { speechPlayerOf } from '../src/core/tts/speechPlayer.ts'
import { decisionEnvKeys, resolveDecisionRouting } from '../src/core/decision/decisionRouting.ts'
import { createPlannerLimiter } from '../src/core/planner/limiter.ts'
import { PLANNER_DEFAULT_MODEL, PLANNER_GATE_MODEL, resolvePlannerRouting } from '../src/core/planner/plannerRouting.ts'
import { readUtteranceWavPcm } from '../src/core/sttAb/utteranceWav.ts'
import { encodeUtteranceWav } from '../src/core/voice/utteranceDump.ts'
import { plannerChatClient } from '../src/main/planner/createPlannerModel.ts'
import { GATE_MODELS_ENV_KEY } from '../src/main/decision/jevCorpus.ts'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const CASES_DIR = join(REPO, 'fixtures', 'overlap-cases')
const AUDIO_DIR = join(CASES_DIR, 'audio')
const WAKE_WAV = join(REPO, 'fixtures', 'wake-audio', 'bing-bong.wav')
const BUNDLED_MODELS = join(REPO, 'models')
const CONFIG_DIR = join(homedir(), '.config', 'bingbong')
/** Parakeet and Smart Turn, as the voice e2e tests take them. */
const VOICE_MODELS = process.env.BINGBONG_VOICE_MODELS ?? join(CONFIG_DIR, 'models')
const JEV = 'jev'

/** The fake mic's silence before anything is heard: the mic is muted inside it while the start is set up. */
const LEAD_MS = 3_000
/** After the wake word, the person waits for the Hot Listen to open before line 1. */
const AFTER_WAKE_MS = 1_200
/** A hotkey listen is armed this long before its line. */
const ARM_BEFORE_MS = 400
/** Everything a run does must end within this of its last line; the wav's silent tail is longer. */
const RUN_BOUND_MS = 90_000
/** A spoken line's Endpoint comes after its audio: the run waits at least this past the last one. */
const ENDPOINT_MS = 2_500
/** A video with a source that has played nothing is still starting, for a person, this long past the last event. */
const MEDIA_START_MS = 15_000
const SETUP_BOUND_MS = 60_000
const SETTLE_MS = 2_000
/** A start's song not playing this long after its line is started by hand. */
const UNSTARTED_MS = 10_000
const CDP_BOUND_MS = 15_000
const TEXT_IN_VIEW_CHARS = 6_000
const SAMPLE_TEXT_CHARS = 400

const args = process.argv.slice(2)
const valueOf = (flag: string): string | undefined => {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}
const list = (raw: string | undefined): string[] => (raw ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '')
const whole = (flag: string, fallback: number, least: number): number => {
  const value = Number(valueOf(flag) ?? fallback)
  if (!Number.isInteger(value) || value < least) {
    console.error(`${flag} needs a whole number from ${least}, got ${valueOf(flag)}`)
    process.exit(2)
  }
  return value
}
const repeat = whole('--repeat', 1, 1)
const seed = whole('--seed', 1, 0)
const pointCount = whole('--points', 3, 1)
const only = list(valueOf('--cases'))
const keep = valueOf('--keep')
const calibrationDir = valueOf('--calibration')
const plannerModel = valueOf('--planner')
const checkState = args.includes('--check-state')
const withJev = args.includes('--with-jev')
if (args.includes('--audio-only-music')) {
  console.error('--audio-only-music is gone: every run writes its road, --road pane|audio|both (default audio)')
  process.exit(2)
}
const roads = readRoads(valueOf('--road'))
if (typeof roads === 'string') {
  console.error(roads)
  process.exit(2)
}
/** The road of the runs going now: the outer loop's. */
let road: Road = roads[0]!
const resume = args.includes('--resume')
if (resume && valueOf('--keep') === undefined) {
  console.error('--resume reads the keep dir: pass --keep dir')
  process.exit(2)
}
const models = [...list(valueOf('--models') ?? process.env[GATE_MODELS_ENV_KEY]), ...(withJev ? [JEV] : [])]
if (models.length === 0) {
  console.error('overlap:gate needs its models: set BINGBONG_GATE_MODELS or pass --models a,b')
  process.exit(2)
}
if (!existsSync(join(REPO, 'out', 'main', 'index.js'))) {
  console.error('overlap:gate runs the built app: pnpm build first (pnpm overlap:gate does)')
  process.exit(2)
}
if (keep !== undefined) mkdirSync(keep, { recursive: true })

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim() || 'unknown'
const slug = (model: string): string => model.replace(/[^\w.-]+/g, '_')

function readCases(): SequenceCase[] | string {
  const cases: SequenceCase[] = []
  for (const file of readdirSync(CASES_DIR).filter((name) => name.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b))) {
    const read = readSequenceCase(JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')), file)
    if (typeof read === 'string') return read
    for (const audio of [...read.lines.flatMap((line) => (line.audio !== undefined ? [line.audio] : [])), ...read.noise.map((item) => item.audio)]) {
      if (!existsSync(audioPath(audio))) return `${file}: no audio at ${audioPath(audio)} (pnpm overlap:audio synthesizes a stand-in)`
    }
    if (only.length === 0 || only.some((part) => read.id.includes(part))) cases.push(read)
  }
  return cases
}

/** A bare name is in fixtures/overlap-cases/audio/; a path is the repo's (an utterance dump in fixtures/stt-dumps/). */
function audioPath(audio: string): string {
  return audio.includes('/') ? join(REPO, audio) : join(AUDIO_DIR, audio)
}

function bounded<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${Math.round(ms / 1000)} s`)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

interface TargetInfo {
  readonly targetId: string
  readonly type: string
  readonly url: string
}

type Kind = 'dashboard' | 'pane' | 'audio'

/** One CDP session per target, kept while the target lives. */
function targetsOf(cdp: CdpClient) {
  const sessions = new Map<string, string>()
  const list = async (): Promise<TargetInfo[]> => (await bounded(cdp.send<{ targetInfos: TargetInfo[] }>('Target.getTargets'), CDP_BOUND_MS, 'listing the targets')).targetInfos
  /** The window takes focus, as the e2e harness gives it (Target.activateTarget): a person's window has it. */
  const activate = async (kind: Kind): Promise<void> => {
    const target = await find(kind)
    if (target !== undefined) await bounded(cdp.send('Target.activateTarget', { targetId: target.targetId }), CDP_BOUND_MS, 'activating')
  }
  // The audio road's hidden window (#502) is a page too, and never the pane.
  const find = async (kind: Kind): Promise<TargetInfo | undefined> =>
    (await list()).find((target) =>
      kind === 'dashboard'
        ? target.url.includes('out/renderer/index.html')
        : kind === 'audio'
          ? target.type === 'page' && isAudioSurfaceUrl(target.url)
          : target.type === 'page' && !target.url.includes('out/renderer') && !target.url.startsWith('devtools://') && !isAudioSurfaceUrl(target.url),
    )
  async function sessionFor(target: TargetInfo): Promise<string> {
    let sessionId = sessions.get(target.targetId)
    if (sessionId === undefined) {
      sessionId = (await bounded(cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true }), CDP_BOUND_MS, 'attaching')).sessionId
      sessions.set(target.targetId, sessionId)
    }
    return sessionId
  }
  async function evaluate<T>(kind: Kind, expression: string): Promise<T | undefined> {
    const target = await find(kind)
    if (target === undefined) return undefined
    const sessionId = await sessionFor(target)
    try {
      const response = await bounded(cdp.send<{ result?: { value?: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId), CDP_BOUND_MS, `reading the ${kind}`)
      if (response.exceptionDetails !== undefined) throw new Error(response.exceptionDetails.text)
      return response.result?.value
    } catch (error) {
      sessions.delete(target.targetId)
      throw error
    }
  }
  /** The pane's history, as the pane keeps it: what `back` steps through. */
  async function history(): Promise<{ currentIndex: number; entries: { url: string }[] } | undefined> {
    const target = await find('pane')
    if (target === undefined) return undefined
    return bounded(cdp.send<{ currentIndex: number; entries: { url: string }[] }>('Page.getNavigationHistory', {}, await sessionFor(target)), CDP_BOUND_MS, 'reading the history')
  }
  return { evaluate, activate, history }
}
type Targets = ReturnType<typeof targetsOf>

/** What the pane shows a person: the text in view, and every media element's state. */
const paneScript = (chars: number): string => `(() => {
  const out = []
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)
  let length = 0
  for (let node = walker.nextNode(); node !== null && length < ${chars}; node = walker.nextNode()) {
    const text = node.textContent.replace(/\\s+/g, ' ').trim()
    const element = node.parentElement
    if (text === '' || element === null) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    if (box.width === 0 || box.height === 0 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue
    out.push(text)
    length += text.length + 1
  }
  const media = [...document.querySelectorAll('video, audio')].map((m) => ({
    playing: !m.paused && !m.ended && m.readyState > 2,
    src: m.currentSrc || m.src || '',
    position: m.currentTime,
    volume: m.muted ? 0 : m.volume,
    loop: m.loop,
  }))
  return { url: location.href, title: document.title, text: out.join(' ').slice(0, ${chars}), media }
})()`

/** The road's window: the song it plays (its document's title, set at each load) and its element (#502). */
const ROAD_SCRIPT = `(() => ({
  title: document.title,
  media: [...document.querySelectorAll('video, audio')].map((m) => ({ playing: !m.paused && !m.ended && m.readyState > 2, src: m.currentSrc || m.src || '', position: m.currentTime, volume: m.muted ? 0 : m.volume, loop: m.loop })),
}))()`
/** The song the dashboard's toolbar shows Now Playing: its title and its channel (#502), as the line reads. */
const NOW_PLAYING_SCRIPT = `document.querySelector('.toolbar-song-line')?.textContent ?? ''`

async function readPane(targets: Targets, chars: number): Promise<Omit<PaneSample, 't'>> {
  const read = (await targets.evaluate<Omit<PaneSample, 't'>>('pane', paneScript(chars)).catch(() => undefined)) ?? { url: '(no pane)', title: '', text: '', media: [] }
  // A person hears the road's window and sees the song on the dashboard: both read beside the pane, whichever the road.
  const road = await targets.evaluate<RoadRead>('audio', ROAD_SCRIPT).catch(() => undefined)
  const nowPlaying = await targets.evaluate<string>('dashboard', NOW_PLAYING_SCRIPT).catch(() => undefined)
  return withRoad(read, road, nowPlaying)
}

/** The dashboard keeps every event of the command stream and every voice state, stamped as they arrive. */
const RECORDER = `(() => {
  if (window.__overlap) return true
  window.__overlap = { events: [], voice: [] }
  window.bingbong.assistant.onEvent((event) => window.__overlap.events.push({ t: Date.now(), event }))
  window.bingbong.voice.onState((state) => window.__overlap.voice.push({ t: Date.now(), state }))
  return true
})()`

interface VoiceRecord {
  readonly t: number
  readonly state: { readonly listening?: boolean; readonly monitoring?: boolean; readonly speaking?: boolean; readonly transcribing?: boolean; readonly hearing?: boolean; readonly micMuted?: boolean }
}

/** A live run: the app, its records, and the pane sampled in the background. */
interface Live {
  readonly app: LaunchedApp
  readonly targets: Targets
  readonly pane: PaneSample[]
  /** When the sampler's read in flight was sent, or null between reads. */
  readingSince(): number | null
  records(): Promise<RunRecords & { voice: VoiceRecord[] }>
  /** The slow host the app asks through (#504), while the switch is on. */
  readonly slow: SlowHost | null
  stop(): void
}

/** The harness-only switch (#504, README): every ask for a line after line 1 times out at the app's own timeout. */
const slowHostOn = process.env[SLOW_HOST_ENV_KEY] === '1'

async function launch(sequence: SequenceCase, model: string, profile: string, wav: string | null, room: Room | null): Promise<Live> {
  // A room run mutes Chromium so the pane's sound stays out of the room: a voice played through Chromium (#490) would be
  // muted with it, and every echo case would pass on a voice the mic never heard. That arm is the kiosk A/B's, not the gate's.
  if (room !== null && speechPlayerOf(process.env) === 'chromium') {
    throw new Error("BINGBONG_SPEECH_PLAYER=chromium: a room run mutes Chromium, so the app's voice would never reach the room (#490)")
  }
  const spoken = sequence.input === 'spoken'
  if (spoken) symlinkSync(VOICE_MODELS, join(profile, 'models'))
  writeFileSync(join(profile, SETTINGS_FILE), roadSettings(road))
  // Jev is the default endpoint: every BINGBONG_DECISION_* routing key unset, its key (TYPESAFE_API_KEY) kept — unsetting
  // that too left Jev unconfigured, so a --with-jev run asked nothing and read every line by the Local Match's guess.
  const decision = model === JEV ? Object.fromEntries(decisionEnvKeys().filter((key) => key.startsWith('BINGBONG_DECISION_')).map((key) => [key, undefined])) : { BINGBONG_DECISION_MODEL: model }
  const routing = resolveDecisionRouting({ ...process.env, ...decision })
  const slow = slowHostOn && routing.configured ? await openSlowHost(routing.endpoint.baseUrl, sequence.lines.slice(1).map((line) => line.words)) : null
  // The stand-in is the only host: no fallback reads the held line instead.
  const slowEnv = slow !== null ? { BINGBONG_DECISION_BASE_URL: slow.url, BINGBONG_DECISION_FALLBACKS: '' } : {}
  const app = await launchApp({
    // The binary itself, not the node_modules/.bin shim (the e2e harness's reason).
    electronBinary: createRequire(import.meta.url)('electron') as string,
    entry: 'out/main/index.js',
    cwd: REPO,
    debugPort: await pickFreeDebugPort(),
    userDataDir: profile,
    // In a room the mic is the room's monitor, and the pane's own sound stays muted: only the app's voice is in the room.
    args: room !== null ? ['--use-fake-ui-for-media-stream', '--mute-audio'] : wav === null ? [] : ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
    startupTimeoutMs: SETUP_BOUND_MS,
    // Piped so a kept run has the app's stdout beside its stderr.
    pipeStdio: true,
    env: {
      // The run's env is this script's own, the root .env included: the app reads no file of its own.
      BINGBONG_ENV_FILE: join(profile, 'no-env-file'),
      BINGBONG_DOWNLOADS_DIR: join(profile, 'shelf'),
      BINGBONG_CONFIRM_ANSWER: 'no',
      // No log copying, no News Desk fetch, no brief writer: a run asks only what its lines ask.
      BINGBONG_LOG_MACHINE: '',
      BINGBONG_NEWS_FIXTURE: 'http://127.0.0.1:9',
      BINGBONG_NEWS_WRITER_API_KEY_ENV: 'BINGBONG_OVERLAP_GATE_NO_NEWS_KEY',
      PULSE_SERVER: 'unix:/nonexistent',
      // The app's own Piper and voice (the profile is fresh, so they are named): speech takes as long as it does for a person.
      BINGBONG_PIPER_BIN: join(CONFIG_DIR, 'piper', 'piper', 'piper'),
      BINGBONG_PIPER_VOICE_DIR: join(CONFIG_DIR, 'voices'),
      ...decision,
      ...slowEnv,
      ...(plannerModel !== undefined ? { BINGBONG_PLANNER_MODEL: plannerModel } : {}),
      // The app's speech plays into the room through a player held to it; the room has no device to sound on.
      ...(room !== null ? { PULSE_SERVER: room.server, BINGBONG_MUTE_AUDIO: '0', BINGBONG_APLAY_BIN: room.aplay } : {}),
      ...(spoken
        ? {
            BINGBONG_WAKE_ENGINE: 'node',
            BINGBONG_VAD_MODEL: join(BUNDLED_MODELS, 'silero_vad.onnx'),
            BINGBONG_WAKE_MELSPEC_MODEL: join(BUNDLED_MODELS, 'melspectrogram.onnx'),
            BINGBONG_WAKE_EMBEDDING_MODEL: join(BUNDLED_MODELS, 'embedding_model.onnx'),
            BINGBONG_WAKE_MODEL: join(BUNDLED_MODELS, 'wake', 'bing_bong.onnx'),
            BINGBONG_WAKE_ABORT_MODEL: join(BUNDLED_MODELS, 'wake', 'stop_now.onnx'),
            BINGBONG_WAKE_HOLD_ON_MODEL: join(BUNDLED_MODELS, 'wake', 'hold_on.onnx'),
          }
        : { BINGBONG_WAKE_ENGINE: 'off' }),
    },
  }).catch(async (error: unknown) => {
    await slow?.close()
    throw error
  })
  const targets = targetsOf(app.cdp)
  // The app boots to the Idle Screen: a keydown wakes the dashboard, as any real input does; then the recorder goes in.
  const until = Date.now() + SETUP_BOUND_MS
  for (;;) {
    const ready = await targets.evaluate<boolean>('dashboard', `(window.dispatchEvent(new KeyboardEvent('keydown')), !!window.bingbong && !!document.querySelector('.url-input'))`).catch(() => false)
    if (ready === true && (await targets.evaluate<boolean>('dashboard', RECORDER).catch(() => false)) === true) break
    if (Date.now() > until) throw new Error('the dashboard never came up')
    await sleep(250)
  }
  await targets.activate('dashboard')
  const pane: PaneSample[] = []
  let sampling = true
  let reading: number | null = null
  void (async () => {
    while (sampling) {
      const t = Date.now()
      reading = t
      const read = await readPane(targets, SAMPLE_TEXT_CHARS)
      reading = null
      if (read.url !== '(no pane)') pane.push({ t, ...read })
      await sleep(SAMPLE_MS)
    }
  })()
  return {
    app,
    targets,
    pane,
    readingSince: () => reading,
    slow,
    async records() {
      const kept = await targets.evaluate<{ events: RunRecords['events']; voice: VoiceRecord[] }>('dashboard', 'window.__overlap').catch(() => undefined)
      return { events: kept?.events ?? [], voice: kept?.voice ?? [], pane }
    },
    stop() {
      sampling = false
    },
  }
}

/** The ear's dumps (BINGBONG_AUDIO_DUMP=1), by file name: what it captured, the app's own voice included (#490). */
function dumpFiles(dumpsDir: string): Record<string, Buffer> {
  if (!existsSync(dumpsDir)) return {}
  return Object.fromEntries(readdirSync(dumpsDir).filter((name) => name.endsWith('.wav')).map((name) => [name, readFileSync(join(dumpsDir, name))]))
}

function logFiles(logsDir: string): Record<string, string> {
  if (!existsSync(logsDir)) return {}
  return Object.fromEntries(readdirSync(logsDir).filter((name) => /^(perf|decision|asks)-.*\.jsonl$/.test(name)).map((name) => [name, readFileSync(join(logsDir, name), 'utf8')]))
}

const submit = (live: Live, words: string): Promise<unknown> => live.targets.evaluate('dashboard', `void window.bingbong.assistant.submit(${JSON.stringify(words)}), true`)

async function waitUntil(check: () => Promise<boolean>, boundMs: number): Promise<boolean> {
  const until = Date.now() + boundMs
  while (Date.now() < until) {
    if (await check().catch(() => false)) return true
    await sleep(250)
  }
  return false
}

const lastOf = <T>(items: readonly T[]): T | undefined => items[items.length - 1]
const playingNow = (live: Live): boolean => lastOf(live.pane)?.media.some((media) => media.playing) === true

/**
 * Waits until nothing has happened for QUIET_MS and the app is neither speaking nor running a Command begun since `from`,
 * and no turn since `from` has a stage open: an Errand's next step thinks in silence (#491).
 */
async function quiet(live: Live, from: number, notBefore: number, boundMs: number): Promise<boolean> {
  return waitUntil(async () => {
    if (Date.now() < notBefore) return false
    const records = await live.records()
    const lastEvent = lastOf(records.events)?.t ?? 0
    const voice = lastOf(records.voice)?.state
    const busy = voice?.speaking === true || voice?.transcribing === true || voice?.hearing === true
    // What a person sees has held still, with no pane read outstanding (#496 F3), and no video still starting
    // (a source, nothing played yet) unless it has sat so past MEDIA_START_MS.
    const now = Date.now()
    const latest = lastOf(live.pane)
    const still = paneHeldStill(live.pane, now, live.readingSince())
    const starting = latest?.media.some((media) => media.src !== '' && !media.playing && media.position < 0.5) === true && now - lastEvent < MEDIA_START_MS
    return !busy && still && !starting && now - lastEvent >= QUIET_MS && !stageOpen(records, from) && lineOutcomes(records, from).every((outcome) => outcome !== 'running')
  }, boundMs)
}

/** Why a start is not in front of the person; `again` when the miss was the site's or the network's, worth a rerun. */
interface Unmet {
  readonly why: string
  readonly again: boolean
}

/** What is in front of the person now: the page shown, the pages behind it, and whether a song is heard. */
async function seenStart(live: Live): Promise<SeenStart> {
  const history = await live.targets.history().catch(() => undefined)
  return { url: lastOf(live.pane)?.url ?? '(no pane)', behind: history === undefined ? [] : pagesBehind(history.entries, history.currentIndex), heard: playingNow(live) }
}

/**
 * Puts the start in front of the person, step by step (e2e/overlap/start.ts),
 * and checks it before the line asked, or before line 1: null when it is
 * there. A step that never came (a page that never loaded, a song that never
 * played) is run again; a start that came but is not what the case says (the
 * pane road's song over the page) is not.
 */
async function setUp(live: Live, sequence: SequenceCase): Promise<Unmet | null> {
  const check = async (): Promise<Unmet | null> => {
    const why = startUnmet(sequence.start, await seenStart(live))
    return why === null ? null : { why, again: false }
  }
  for (const step of startSteps(sequence.start)) {
    if ('open' in step) {
      await live.targets.evaluate('dashboard', `window.bingbong.browser.navigate(${JSON.stringify(step.open)})`)
      const host = new URL(step.open).hostname
      const landed = await waitUntil(async () => {
        const sample = lastOf(live.pane)
        return sample !== undefined && URL.canParse(sample.url) && new URL(sample.url).hostname === host && (await live.targets.evaluate<string>('pane', 'document.readyState')) === 'complete'
      }, SETUP_BOUND_MS)
      if (!landed) return { why: `the start page ${step.open} never loaded`, again: true }
    } else if ('play' in step) {
      await submit(live, `play ${step.play}`)
      // The start is a song playing, however it got there: a song that never started (YouTube's own autoplay
      // sometimes never fires on a fresh profile, 2026-10-27) is started as a person would, with the media's own play.
      if (!(await waitUntil(async () => playingNow(live), UNSTARTED_MS))) {
        console.error(`"play ${step.play}" unstarted after ${UNSTARTED_MS / 1000} s: the start presses play`)
        const press = `(() => { for (const media of document.querySelectorAll('video, audio')) if (media.paused && media.currentTime < 0.5) media.play().catch(() => {}); return true })()`
        await live.targets.evaluate('pane', press).catch(() => {})
        await live.targets.evaluate('audio', press).catch(() => {})
        if (!(await waitUntil(async () => playingNow(live), SETUP_BOUND_MS))) return { why: `"play ${step.play}" never played`, again: true }
      }
    } else {
      const unmet = await check()
      if (unmet !== null) return unmet
      const from = Date.now()
      await submit(live, step.ask)
      const asked = await waitUntil(async () => (await live.records()).events.some((record) => record.t >= from && record.event.type === 'site_question'), RUN_BOUND_MS)
      if (!asked) return { why: `"${step.ask}" never came to a question`, again: true }
    }
  }
  await quiet(live, 0, Date.now() + SETTLE_MS, SETUP_BOUND_MS)
  return sequence.start.asked === undefined ? check() : null
}

const spokenStart = (sequence: SequenceCase): number => LEAD_MS + (sequence.listen === 'wake' ? wavMs(WAKE_WAV) + AFTER_WAKE_MS : 0)
const pcmOf = (path: string): Float32Array => readUtteranceWavPcm(new Uint8Array(readFileSync(path)))
const wavMs = (path: string): number => (pcmOf(path).length / 16_000) * 1000

/** The wav for a spoken run: the wake word, line 1 at its place, every later line and noise at its ms from line 1. */
function spokenWav(sequence: SequenceCase, lineMs: readonly number[], noiseMs: readonly number[], profile: string): { path: string; lastEndMs: number } {
  const lineAt = spokenStart(sequence)
  const pieces: WavPiece[] = sequence.listen === 'wake' ? [{ pcm: pcmOf(WAKE_WAV), atMs: LEAD_MS }] : []
  sequence.lines.forEach((line, index) => {
    if (index < lineMs.length) pieces.push({ pcm: pcmOf(audioPath(line.audio!)), atMs: lineAt + lineMs[index]! })
  })
  sequence.noise.forEach((item, index) => {
    if (index < noiseMs.length) pieces.push({ pcm: pcmOf(audioPath(item.audio)), atMs: lineAt + noiseMs[index]! })
  })
  const lastEndMs = Math.max(...pieces.map((piece) => piece.atMs + (piece.pcm.length / 16_000) * 1000))
  const path = join(profile, 'fake-mic.wav')
  writeFileSync(path, encodeUtteranceWav(layoutWav(pieces, lastEndMs + RUN_BOUND_MS + 30_000)))
  return { path, lastEndMs }
}

/** The app's own voice, rendered whole, in ms: how long a sentence sounds when nothing cuts it (#490). */
const wholeMsCache = new Map<string, number>()
function wholeMs(text: string): number {
  const said = stripMarkdownForSpeech(text)
  const cached = wholeMsCache.get(said)
  if (cached !== undefined) return cached
  const out = join(mkdtempSync(join(tmpdir(), 'bingbong-overlap-whole-')), 'whole.wav')
  const voice = join(process.env.BINGBONG_PIPER_VOICE_DIR ?? join(CONFIG_DIR, 'voices'), `${DEFAULT_PIPER_VOICE}-medium.onnx`)
  const spoke = spawnSync(process.env.BINGBONG_PIPER_BIN ?? join(CONFIG_DIR, 'piper', 'piper', 'piper'), ['--model', voice, '--output_file', out], { input: said, encoding: 'utf8' })
  if (spoke.status !== 0) throw new Error(`piper could not render the app's sentence: ${spoke.stderr.slice(-300)}`)
  const wav = readFileSync(out)
  rmSync(out, { force: true })
  // A RIFF header of 44 bytes, then s16 at the rate in bytes 24–27.
  const ms = ((wav.length - 44) / 2 / wav.readUInt32LE(24)) * 1000
  wholeMsCache.set(said, ms)
  return ms
}

/** Each sentence the app began since `from`: how long it sounded, to its own `spoken`, and how long it is whole. */
function speechOf(records: RunRecords, from: number): NonNullable<EndState['speech']> {
  const later = records.events.filter((record) => record.t >= from)
  const used = new Set<number>()
  return later.flatMap((record, index) => {
    if (record.event.type !== 'speak') return []
    const ended = later.findIndex((other, at) => at > index && !used.has(at) && other.event.type === 'spoken')
    if (ended !== -1) used.add(ended)
    return [{ text: record.event.text, ms: ended === -1 ? null : later[ended]!.t - record.t, wholeMs: wholeMs(record.event.text) }]
  })
}

interface RunOutcome {
  readonly cell: Cell
  readonly lineAt: number | null
  /** Each line's ms from line 1 as it arrived. */
  readonly sentMs: readonly (number | null)[]
  readonly end: EndState | null
  readonly records: RunRecords & { voice: VoiceRecord[] }
  readonly stderr: string
  readonly stdout?: string
  /** The run's perf, decision and ask logs, by file name: `pnpm perf:report` reads them once written out. */
  readonly logs?: Readonly<Record<string, string>>
  /** What the mic heard, in a room (#490). */
  readonly roomWav?: Buffer
  /** The ear's dumps, by file name, when the run dumped (#490). */
  readonly dumps?: Readonly<Record<string, Buffer>>
  /** Why a host refused the run for credit: the run measured nothing, and the gate stops. */
  readonly refused?: string
  /** A start not met whose miss was the site's or the network's: the run is made again. */
  readonly startAgain?: boolean
}

/** A host refused for credit: the gate stops, keeping what it finished. */
class CreditRefused extends Error {}

/**
 * One run: a fresh app and profile, the start, the lines at their times,
 * then the end state. `lines` is how many of the case's lines are given
 * (a calibration gives line 1 alone); `placed` their times and the noise's,
 * already in ms for a spoken run.
 */
async function runOnce(sequence: SequenceCase, model: string, plan: { lines: number; placed: readonly (PlacedTime | null)[]; noise: readonly PlacedTime[]; spans: Spans; wall: string | null; calibrating?: boolean }, judge: (means: string, said: readonly string[]) => Promise<boolean>): Promise<RunOutcome> {
  const profile = mkdtempSync(join(tmpdir(), 'bingbong-overlap-gate-'))
  const spoken = sequence.input === 'spoken'
  const placedMs = (placed: PlacedTime | null): number | string => (placed === null ? 0 : placeMs(placed, plan.spans))
  let wav: { path: string; lastEndMs: number } | null = null
  if (spoken) {
    const lineMs = plan.placed.slice(0, plan.lines).map(placedMs)
    const noiseMs = plan.noise.map(placedMs)
    const unplaced = [...lineMs, ...noiseMs].find((ms): ms is string => typeof ms === 'string')
    if (unplaced !== undefined) {
      rmSync(profile, { recursive: true, force: true })
      // A point line 1's calibration never reached: a wall there stopped it, else line 1 never came to it.
      const cell: Cell = plan.wall !== null ? { verdict: 'wall', why: `${plan.wall} in the calibration run` } : { verdict: 'red', why: unplaced }
      return { cell, lineAt: null, sentMs: [], end: null, records: { events: [], voice: [], pane: [] }, stderr: '' }
    }
    try {
      wav = spokenWav(sequence, lineMs as number[], noiseMs as number[], profile)
    } catch (error) {
      rmSync(profile, { recursive: true, force: true })
      throw error
    }
  }
  let live: Live | null = null
  let room: Room | null = null
  try {
    if (spoken && sequence.echo) {
      room = await openRoom(join(profile, 'room'))
      room.record(join(profile, 'room.wav'))
    }
    live = await launch(sequence, model, profile, wav?.path ?? null, room)
    liveApp = live.app
    const current = live
    if (spoken) {
      const monitoring = await waitUntil(async () => lastOf((await current.records()).voice)?.state.monitoring === true || (await current.targets.evaluate<{ monitoring: boolean }>('dashboard', 'window.bingbong.voice.getState()'))?.monitoring === true, SETUP_BOUND_MS)
      if (!monitoring) throw new Error('the ear never opened')
      await current.targets.evaluate('dashboard', 'window.bingbong.voice.toggleMic()')
    }
    const unset = await setUp(current, sequence)
    const sentMs: (number | null)[] = []
    const finish = async (cell: Cell | null, lineAt: number | null, notBefore: number): Promise<RunOutcome> => {
      const from = lineAt ?? Date.now()
      if (cell === null) await quiet(current, from, notBefore, RUN_BOUND_MS)
      const records = await current.records()
      const pane = await readPane(current.targets, TEXT_IN_VIEW_CHARS)
      let end: EndState = { url: pane.url, title: pane.title, text: pane.text, media: pane.media as MediaState[], said: saidFrom(records, from), lines: lineOutcomes(records, from) }
      const firstMedia = firstMediaFrom(records.pane, from)
      if (firstMedia !== undefined) end = { ...end, firstMedia }
      // A calibration gives line 1 alone: its end is a timeline, never held against the case's expect.
      const calibrating = plan.calibrating === true
      let verdict: Cell = cell ?? { verdict: 'green' }
      if (sequence.expect.speech === 'whole') end = { ...end, speech: speechOf(records, from) }
      if (cell === null && !calibrating) {
        const why = await checkEnd(sequence.expect, end, judge)
        if (why !== null) verdict = { verdict: 'red', why }
      }
      // What the mic heard in the room, kept beside the run (#490).
      const roomWav = room !== null && existsSync(join(profile, 'room.wav')) ? join(profile, 'room.wav') : undefined
      return { cell: verdict, lineAt, sentMs, end, records, stderr: current.app.stderrTail(), stdout: current.app.stdoutRaw(), logs: logFiles(join(profile, 'logs')), ...(roomWav !== undefined ? { roomWav: readFileSync(roomWav) } : {}), dumps: dumpFiles(join(profile, 'audio-dumps')) }
    }
    if (unset !== null) {
      const wall = wallBefore(current.pane, Date.now())
      if (wall !== null) return await finish({ verdict: 'wall', why: `${wall} before line 1` }, null, 0)
      return { ...(await finish({ verdict: 'start not met', why: unset.why }, null, 0)), startAgain: unset.again }
    }
    if (spoken) {
      await current.targets.evaluate('dashboard', 'window.bingbong.voice.toggleMic()')
      const t0 = Date.now()
      // In a room the wav is heard from the unmute, as the fake mic plays its file from the capture's start.
      room?.play(wav!.path)
      const lineAt = t0 + Math.round(spokenStart(sequence))
      const lineMs = plan.placed.slice(0, plan.lines).map((placed) => placedMs(placed) as number)
      if (sequence.listen === 'hotkey') {
        for (const ms of lineMs) {
          await sleep(Math.max(0, lineAt + ms - ARM_BEFORE_MS - Date.now()))
          await current.targets.evaluate('dashboard', 'window.bingbong.voice.arm()')
        }
      }
      sentMs.push(...lineMs)
      // A wall before line 2, or before the noise in a case of one line, stopped line 1 before the case was put.
      const noiseMs = plan.noise.map((placed) => placedMs(placed) as number)
      const next = Math.min(...lineMs.slice(1), ...noiseMs)
      if (Number.isFinite(next)) {
        await sleep(Math.max(0, lineAt + next - Date.now()))
        const wall = wallBefore(current.pane, lineAt + next)
        if (wall !== null) return await finish({ verdict: 'wall', why: `${wall} before ${lineMs.length > 1 && lineMs[1] === next ? 'line 2' : 'the noise'}` }, lineAt, 0)
      }
      return await finish(null, lineAt, t0 + wav!.lastEndMs + ENDPOINT_MS)
    }
    const lineAt = Date.now()
    await submit(current, sequence.lines[0]!.words)
    sentMs.push(0)
    for (let index = 1; index < plan.lines; index++) {
      const placed = plan.placed[index]!
      let ms: number | string
      if (placed.kind === 'after') {
        const seen = await waitUntil(async () => spansOf(await current.records(), lineAt)[placed.event] !== undefined, RUN_BOUND_MS)
        ms = seen ? Date.now() - lineAt : placeMs(placed, {})
      } else if (placed.kind === 'while') {
        // The span as it begins in this run, the point inside it by its calibrated length.
        const calibrated = plan.spans[placed.span]
        let begun: number | undefined
        await waitUntil(async () => (begun = spanBegun(await current.records(), lineAt, placed.span)) !== undefined, RUN_BOUND_MS)
        ms = begun === undefined || calibrated === undefined ? placeMs(placed, begun === undefined ? {} : plan.spans) : Math.round(begun + placed.fraction * (calibrated[1] - calibrated[0]))
      } else ms = placed.ms
      if (typeof ms === 'string') {
        const wall = wallBefore(current.pane, Date.now())
        const cell: Cell = wall !== null ? { verdict: 'wall', why: `${wall} before line ${index + 1}` } : plan.wall !== null ? { verdict: 'wall', why: `${plan.wall} in the calibration run` } : { verdict: 'red', why: ms }
        return await finish(cell, lineAt, 0)
      }
      await sleep(Math.max(0, lineAt + ms - Date.now()))
      const wall = wallBefore(current.pane, Date.now())
      if (wall !== null) return await finish({ verdict: 'wall', why: `${wall} before line ${index + 1}` }, lineAt, 0)
      await submit(current, sequence.lines[index]!.words)
      sentMs.push(Date.now() - lineAt)
    }
    return await finish(null, lineAt, Date.now())
  } finally {
    if (liveApp === live?.app) liveApp = null
    live?.stop()
    await live?.app.quit().catch(() => live?.app.quit({ signal: 'SIGKILL' }).catch(() => {}))
    await room?.close()
    if (live?.slow != null) console.log(`  slow host: ${live.slow.held()} asks held, ${live.slow.passed()} passed`)
    await live?.slow?.close()
    // The app may still be letting go of its profile as it exits.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}

/** The app of the run going now, for the bound to kill. */
let liveApp: LaunchedApp | null = null

/** A run past every bound is a run that failed, never a gate that hangs. */
async function runBounded(sequence: SequenceCase, model: string, plan: Parameters<typeof runOnce>[2], judge: Parameters<typeof runOnce>[3]): Promise<RunOutcome> {
  try {
    return await bounded(runOnce(sequence, model, plan, judge), RUN_BOUND_MS * 2 + 3 * SETUP_BOUND_MS, 'the run')
  } catch (error) {
    // The run behind the bound is still going: its app is killed so the next run starts alone (goal:gate's rule, #467).
    await liveApp?.quit({ signal: 'SIGKILL' }).catch(() => {})
    return { cell: { verdict: 'red', why: `the run failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }, lineAt: null, sentMs: [], end: null, records: { events: [], voice: [], pane: [] }, stderr: '' }
  }
}

/** How many times a run that measured something else than its case is made again. */
const RERUNS = 2
/** Runs made again in this table, by why. */
const rerun = { start: 0, limited: 0 }

/** The 429s a run met, the Decision Model's host's and the Planner's, read from its decision and perf records as goal:gate reads them. */
function limitedIn(ran: RunOutcome): number {
  const records = (prefix: string): unknown[] =>
    Object.entries(ran.logs ?? {})
      .filter(([file]) => file.startsWith(prefix))
      .flatMap(([, text]) => text.split('\n').flatMap((line) => (line.trim() === '' ? [] : [JSON.parse(line) as unknown])))
  const decided = (records('decision-') as { jev?: { httpStatus?: number } }[]).filter((record) => record.jev?.httpStatus === 429).length
  const planned = (records('perf-') as { stage?: string; detail?: { httpStatus?: number } }[]).filter((span) => span.stage === 'planner-step' && span.detail?.httpStatus === 429).length
  return decided + planned
}

/**
 * One run, made again (twice at most) when it measured something other than
 * its case: a start that never came, a page or a song (YouTube on a fresh profile sometimes
 * never starts the song, 1 run in 4 with or without the ad blocker, measured
 * 2026-10-27), or a host that answered 429, the Decision Model's or the
 * Planner's (the host, not the case: goal:gate's rule).
 */
async function run(sequence: SequenceCase, model: string, plan: Parameters<typeof runOnce>[2], judge: Parameters<typeof runOnce>[3]): Promise<RunOutcome> {
  let ran = await runBounded(sequence, model, plan, judge)
  for (let tries = 0; tries < RERUNS; tries += 1) {
    // Refused for credit: never run again (the account is spent, not busy), never counted.
    const refused = refusalOf(ran)
    if (refused !== null) return { ...ran, refused }
    const unstarted = ran.cell.verdict === 'start not met' && ran.startAgain === true
    const limited = limitedIn(ran) > 0
    if (!unstarted && !limited) break
    if (limited) rerun.limited += 1
    else rerun.start += 1
    console.error(`${sequence.id} on ${model}: ${limited ? 'met a 429' : 'the start was never reached'}, run again`)
    await sleep(limited ? 10_000 * (tries + 1) : 1_000)
    ran = await runBounded(sequence, model, plan, judge)
  }
  const refused = refusalOf(ran)
  return refused === null ? ran : { ...ran, refused }
}

function refusalOf(ran: RunOutcome): string | null {
  return creditRefusal({ decision: logLines(ran.logs, 'decision-'), perf: logLines(ran.logs, 'perf-'), ...(ran.cell.verdict !== 'green' ? { why: ran.cell.why } : {}) })
}

interface Calibration {
  readonly case: string
  readonly model: string
  readonly commit: string
  readonly date: string
  readonly spans: Spans
  readonly wall: string | null
  /** Line 1's start was not met: every point of the case is `start not met` without a run (#509). */
  readonly unmet: string | null
}

/** One kept run: `<name>.json` (what the gate saw) and `<name>-logs/` (the app's own perf, decision and ask logs, for `pnpm perf:report` and `pnpm bugs:add --logs`). */
function keepRun(dir: string, name: string, head: object, ran: RunOutcome): void {
  const { logs, roomWav, dumps, ...rest } = ran
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify({ ...head, run: rest }, null, 2)}\n`)
  if (roomWav !== undefined) writeFileSync(join(dir, `${name}-room.wav`), roomWav)
  if (dumps !== undefined && Object.keys(dumps).length > 0) {
    mkdirSync(join(dir, `${name}-dumps`), { recursive: true })
    for (const [file, wav] of Object.entries(dumps)) writeFileSync(join(dir, `${name}-dumps`, file), wav)
  }
  if (logs === undefined) return
  mkdirSync(join(dir, `${name}-logs`), { recursive: true })
  for (const [file, text] of Object.entries(logs)) writeFileSync(join(dir, `${name}-logs`, file), text)
}

/** A named point needs line 1's timeline: always for a spoken case, for a typed one only to size a span. */
function needsCalibration(sequence: SequenceCase, points: readonly CasePoint[]): boolean {
  const placed = points.flatMap((point) => [...point.lines, ...point.noise]).filter((item): item is PlacedTime => item !== null)
  return placed.some((item) => item.kind === 'while' || (item.kind === 'after' && sequence.input === 'spoken'))
}

const spanWords = (spans: Spans): string =>
  Object.entries(spans)
    .map(([name, value]) => (Array.isArray(value) ? `${name} ${value[0]}–${value[1]} ms` : `${name} ${value} ms`))
    .join(', ') || 'none seen'

async function calibrate(sequence: SequenceCase, model: string, judge: Parameters<typeof runOnce>[3]): Promise<Calibration> {
  const kept = calibrationDir === undefined ? undefined : join(calibrationDir, road, sequence.id, slug(model), 'calibration.json')
  // One kept before #509 names no `unmet`: its start was met.
  if (kept !== undefined && existsSync(kept)) return { unmet: null, ...(JSON.parse(readFileSync(kept, 'utf8')) as Omit<Calibration, 'unmet'>) }
  // A resume reuses the calibration its keep dir holds, made on the same commit.
  const resumed = resume && keep !== undefined ? join(keep, road, sequence.id, slug(model), 'calibration.json') : undefined
  if (resumed !== undefined && existsSync(resumed)) {
    const calibration = { unmet: null, ...(JSON.parse(readFileSync(resumed, 'utf8')) as Omit<Calibration, 'unmet'>) }
    if (calibration.commit === commit) return calibration
  }
  const ran = await run(sequence, model, { lines: 1, placed: [null], noise: [], spans: {}, wall: null, calibrating: true }, judge)
  if (ran.refused !== undefined) {
    if (keep !== undefined) {
      mkdirSync(join(keep, road, sequence.id, slug(model)), { recursive: true })
      keepRun(join(keep, road, sequence.id, slug(model)), 'calibration-refused', { case: sequence.id, model, road, commit, refused: ran.refused }, ran)
    }
    summary = summary === null ? null : withRefused(summary, { road, model, case: sequence.id, point: null, n: 1, why: ran.refused })
    throw new CreditRefused(ran.refused)
  }
  const spans = ran.lineAt === null ? {} : spansOf(ran.records, ran.lineAt)
  const unmet = ran.cell.verdict === 'start not met' ? ran.cell.why : null
  const wall = ran.cell.verdict === 'wall' ? ran.cell.why : unmet !== null ? null : wallBefore(ran.records.pane, Number.POSITIVE_INFINITY)
  const calibration: Calibration = { case: sequence.id, model, commit, date: new Date().toISOString().slice(0, 10), spans, wall, unmet }
  if (keep !== undefined) {
    mkdirSync(join(keep, road, sequence.id, slug(model)), { recursive: true })
    keepRun(join(keep, road, sequence.id, slug(model)), 'calibration', { ...calibration, road }, ran)
  }
  console.error(`${sequence.id} on ${model}, ${road} road: calibrated — ${unmet !== null ? `start not met: ${unmet}` : spanWords(spans)}${wall !== null ? ` (${wall})` : ''}`)
  return calibration
}

const judgeRouting = resolvePlannerRouting({ ...process.env, BINGBONG_PLANNER_MODEL: PLANNER_GATE_MODEL, BINGBONG_PLANNER_THINKING: 'off' })
const judgeChat = judgeRouting.configured ? plannerChatClient(judgeRouting, createPlannerLimiter({ perSecond: judgeRouting.perSecond, inFlight: judgeRouting.inFlight })) : null

/** Whether any sentence said means `means`: the one check that is not exact, asked of the fixed judge. */
async function judgeMeaning(means: string, said: readonly string[]): Promise<boolean> {
  if (said.length === 0) return false
  if (judgeChat === null) throw new Error(`a meaning needs the judge ${PLANNER_GATE_MODEL}, which is not configured`)
  const ask = () =>
    judgeChat.complete(
      [
        { role: 'system', content: 'You read the sentences a voice appliance said aloud during one run, in order. Answer whether any one of them, or several together, says what the person was told: the meaning given. Reply with exactly one JSON object and nothing else: {"means": true | false, "why": "<one line>"}' },
        { role: 'user', content: `Meaning: ${means}\nSentences said:\n${said.map((sentence) => `- ${sentence}`).join('\n')}` },
      ],
      { temperature: 0 },
    )
  let reply = await ask()
  for (let tries = 0; reply.status === 'unavailable' && tries < 3; tries += 1) {
    await sleep(5_000 * (tries + 1))
    reply = await ask()
  }
  if (reply.status === 'unavailable') throw new Error(`the judge was unavailable: ${reply.reason}`)
  // An unreadable reply is no verdict: the run fails saying so, never a meaning missed.
  const verdict = /"means"\s*:\s*(true|false)/.exec(reply.content)?.[1]
  if (verdict === undefined) throw new Error(`the judge's reply was unreadable: ${reply.content.slice(0, 120)}`)
  return verdict === 'true'
}

const cases = readCases()
if (typeof cases === 'string') {
  console.error(`overlap:gate: ${cases}`)
  process.exit(2)
}
// Jev unconfigured would read every line by the Local Match's guess and call it a measure: never run so.
if (withJev && !resolveDecisionRouting(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BINGBONG_DECISION_')))).configured) {
  console.error('--with-jev: Jev is not configured (no TYPESAFE_API_KEY in the env)')
  process.exit(2)
}
const plannerName = `${plannerModel ?? process.env.BINGBONG_PLANNER_MODEL ?? `${PLANNER_DEFAULT_MODEL} (default)`}`
const tables: { road: Road; rows: CaseRow[] }[] = []
/** The keep dir's summary, written after every point; null without --keep. */
let summary: Summary | null = null
if (keep !== undefined) {
  const head = { commit, seed, points: pointCount, repeat, roads }
  const kept = readSummary(keep)
  if (resume) {
    const from = resumeFrom(kept, head)
    if (typeof from === 'string') {
      console.error(`--resume: ${from}`)
      process.exit(2)
    }
    summary = from
    console.error(`--resume: ${summary.finished.length} points kept in ${join(keep, SUMMARY_FILE)}`)
  } else {
    // A fresh run never writes over a kept summary: it is set aside, named by when.
    if (kept !== null) renameSync(join(keep, SUMMARY_FILE), join(keep, `summary-${kept.updated.replace(/[:.]/g, '-')}.json`))
    summary = resumeFrom(null, head) as Summary
  }
  writeSummary(keep, summary)
}
let stopped: string | null = null
console.error(`overlap:gate at ${commit}: ${roads.join(' road, then ')} road`)
roads: for (const each of roads) {
  road = each
  for (const model of models) {
    const decisionName = model === JEV ? `Jev (${resolveDecisionRouting(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BINGBONG_DECISION_')))).configured ? 'default endpoint' : 'not configured'})` : model
    const rows: CaseRow[] = []
    const spans: Record<string, string> = {}
    rerun.start = 0
    rerun.limited = 0
    cases: for (const sequence of cases) {
      const points = casePoints(sequence, { seed, points: pointCount })
      const row: { label: string; runs: Cell[] }[] = []
      const finishedAll = summary !== null && points.every((point) => Array.from({ length: repeat }, (_, i) => i + 1).every((n) => finishedCell(summary!, { road, model, case: sequence.id, point: point.index, n }) !== undefined))
      let calibration: Calibration | null = null
      if (needsCalibration(sequence, points) && !finishedAll) {
        try {
          calibration = await calibrate(sequence, model, judgeMeaning)
        } catch (error) {
          if (!(error instanceof CreditRefused)) throw error
          stopped = `${sequence.id} on ${model}, ${road} road, calibrating: ${error.message}`
          if (summary !== null) writeSummary(keep!, summary)
          break cases
        }
        spans[sequence.id] = calibration.unmet !== null ? `start not met: ${calibration.unmet}` : spanWords(calibration.spans)
      }
      const dir = keep === undefined ? undefined : join(keep, road, sequence.id, slug(model))
      for (const point of points) {
        const runs: Cell[] = []
        for (let n = 1; n <= repeat; n++) {
          const at = `${sequence.id} on ${model}, ${road} road, at ${point.label}${repeat > 1 ? ` (${n}/${repeat})` : ''}`
          const done = summary === null ? undefined : finishedCell(summary, { road, model, case: sequence.id, point: point.index, n })
          if (done !== undefined) {
            console.error(`${at}: kept from the summary, ${done.verdict}`)
            runs.push(done)
            continue
          }
          // Line 1's start could not be put in its calibration: no point of the case can be (#509).
          const ran: RunOutcome =
            calibration !== null && calibration.unmet !== null
              ? { cell: { verdict: 'start not met', why: calibration.unmet }, lineAt: null, sentMs: [], end: null, records: { events: [], voice: [], pane: [] }, stderr: '' }
              : await run(sequence, model, { lines: sequence.lines.length, placed: point.lines, noise: point.noise, spans: calibration?.spans ?? {}, wall: calibration?.wall ?? null }, judgeMeaning)
          if (ran.refused !== undefined) {
            console.error(`${at}: refused for credit — ${ran.refused}; the gate stops`)
            if (dir !== undefined) {
              mkdirSync(dir, { recursive: true })
              keepRun(dir, `p${point.index}${repeat > 1 ? `-${n}` : ''}-refused`, { case: sequence.id, model, road, point: point.index, seed, commit, refused: ran.refused }, ran)
            }
            if (summary !== null) {
              summary = withRefused(summary, { road, model, case: sequence.id, point: point.index, n, why: ran.refused })
              writeSummary(keep!, summary)
            }
            stopped = `${at}: ${ran.refused}`
            if (runs.length > 0) row.push({ label: point.label, runs })
            // A case cut before any point finished has no row: an empty row would read as through.
            if (row.length > 0) rows.push({ id: sequence.id, points: row })
            break cases
          }
          const cell = ran.cell
          console.error(`${at}: ${cell.verdict === 'green' ? 'green' : `${cell.verdict} — ${cell.why}`}`)
          if (dir !== undefined) {
            mkdirSync(dir, { recursive: true })
            const name = `p${point.index}${repeat > 1 ? `-${n}` : ''}`
            keepRun(dir, name, { case: sequence.id, model, road, point: { ...point, placed: point.lines.map((placed) => (placed === null ? null : describePlaced(placed))) }, seed, commit }, ran)
          }
          runs.push(cell)
          if (summary !== null) {
            summary = withFinished(summary, { road, model, case: sequence.id, point: point.index, n, label: point.label, cell })
            writeSummary(keep!, summary)
          }
        }
        row.push({ label: point.label, runs })
      }
      rows.push({ id: sequence.id, points: row })
    }
    tables.push({ road, rows })
    console.log(formatTable(rows, { model: decisionName, planner: plannerName, road, seed, points: pointCount, repeat, commit, spans }))
    console.log(`runs made again: ${rerun.start} whose start never came, ${rerun.limited} that met a 429`)
    console.log('')
    if (stopped !== null) break roads
  }
}
if (stopped !== null) {
  if (summary !== null && keep !== undefined) writeSummary(keep, summary)
  console.log(`stopped, refused for credit: ${stopped}`)
  console.log(`every finished point is kept${keep !== undefined ? ` in ${join(keep, SUMMARY_FILE)}; pnpm overlap:gate … --keep ${keep} --resume runs what is missing` : ' nowhere (no --keep)'}`)
  process.exit(3)
}
if (checkState) {
  const disagreements = stateDisagreements(cases, tables)
  console.log(disagreements.length === 0 ? 'state: every case agrees with the table' : `state disagrees:\n${disagreements.map((line) => `- ${line}`).join('\n')}`)
  process.exitCode = disagreements.length === 0 ? 0 : 1
} else {
  // A start not met measured nothing: only a red fails the gate.
  process.exitCode = tables.every((table) => table.rows.every((row) => measuredOn(row) !== 'red')) ? 0 : 1
}
// The gate ends here, whatever a run left open (a CDP socket, an app slow to quit, a timer): waiting on the event loop
// to drain once held two finished runs alive for 7 hours and the run queued behind them never started (#509 measure).
process.stdout.write('', () => process.exit())
