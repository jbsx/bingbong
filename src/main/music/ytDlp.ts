import { execFile } from 'node:child_process'
import { watchUrl } from '../../core/music/youtubeSearch'

// The audio road's lookup (#502): yt-dlp resolves a video to its best
// audio-only stream's address (Opus in WebM, about 130 kbps), one process
// per song. The Player's own search picks the video first (arm B, measured
// against yt-dlp's own search on the kiosk 2026-10-28, yt-dlp 2026.10.26:
// by id p50 4.6 s, max 5.6 s; search and resolve together p50 5.9 s, max
// 7.1 s — 9 runs each). Python's start is 0.4 s of it.
//
// The `visionos` client alone answers first (#516): from a kiosk shell on
// 2026-10-30, 14 songs, median 2.18 s and max 2.87 s against the default
// clients' 4.77 s and 5.77 s, every stream past its `available_at` already
// and no deno run. YouTube can change that without notice, so the default
// clients stand behind it, and `media-start` shows which answered.

/**
 * How long a lookup may take before the road falls back to the watch
 * page: about twice the slowest lookup measured on the kiosk (5.6 s) — a
 * guess past that; the `media-start` spans of the road's songs settle it.
 */
export const RESOLVE_TIMEOUT_MS = 11_000

/**
 * How long of that the `visionos` client has before the default clients
 * are asked: a guess, about twice its slowest from a kiosk shell (2.87 s);
 * the `media-start` spans settle it.
 */
const FIRST_TRY_MS = 5_000

const VISIONOS_ARGS = ['--extractor-args', 'youtube:skip=hls,dash;player_client=visionos']

/** Which of yt-dlp's clients answered a lookup (#516). */
type LookupClient = 'visionos' | 'default'

/** One of yt-dlp's step lines, and when it came (ms after the ask): where a lookup's time went. */
export interface LookupStep {
  readonly at: number
  readonly step: string
}

/** What `media-start` keeps of a lookup (#516). */
export interface LookupRecord {
  readonly client: LookupClient
  readonly steps: readonly LookupStep[]
  /** The first ask's failure, the default clients having answered; null when it answered. */
  readonly failedFirst: { readonly why: string; readonly ms: number; readonly steps: readonly LookupStep[] } | null
}

/**
 * A video's audio stream (#502): its address, and when YouTube serves it.
 * yt-dlp 2026.10.26's streams answer 403 until their `available_at`, about
 * 2.7 s after the lookup on every client that returns one (measured
 * 2026-10-29, note on #502), so the element is handed the address only then.
 */
export interface AudioStream {
  readonly stream: string
  /** When the stream is served (epoch ms); null when yt-dlp names no time. */
  readonly availableAt: number | null
  /** How it was found (#516); absent where no yt-dlp ran. */
  readonly asked?: LookupRecord
}

/** What yt-dlp printed for `-O '%(available_at)s %(url)s'`, its step lines beside it: the stream, or null with no address in it. A bare address (`-g`'s shape) names no time. */
export function parseLookup(stdout: string): AudioStream | null {
  for (const line of stdout.split('\n')) {
    if (line.startsWith('[')) continue
    const [first = '', second] = line.trim().split(' ')
    const stream = second ?? first
    if (!/^https?:\/\//.test(stream)) continue
    const seconds = second === undefined || first === '' ? NaN : Number(first)
    return { stream, availableAt: Number.isFinite(seconds) ? seconds * 1000 : null }
  }
  return null
}

/** One ask that failed: why, and the steps it got through. */
class LookupFailure extends Error {
  constructor(
    readonly why: string,
    readonly steps: readonly LookupStep[],
  ) {
    super(why)
  }
}

/** A step line as `media-start` keeps it: no video id, no address. */
const stepOf = (line: string, id: string): string => line.replace(` ${id}:`, '').replace(/:? *https?:\/\/\S+/, '')

/**
 * One yt-dlp process. `--no-quiet` keeps its step lines coming beside `-O`
 * (it flushes each, and `--verbose`'s version probes would cost time), each
 * timed as it arrives; the printed address is only named as a step.
 */
function ask(binary: string, id: string, clientArgs: readonly string[], timeoutMs: number): Promise<{ stream: AudioStream; steps: readonly LookupStep[] }> {
  return new Promise((resolve, reject) => {
    const from = Date.now()
    const steps: LookupStep[] = []
    let partial = ''
    const child = execFile(binary, ['--no-warnings', '--no-playlist', '--no-quiet', ...clientArgs, '-f', 'bestaudio', '-O', '%(available_at)s %(url)s', '--', watchUrl(id)], { timeout: timeoutMs }, (error, stdout, stderr) => {
      steps.push({ at: Date.now() - from, step: 'exit' })
      if (error !== null) {
        const said = stderr.trim().split('\n').at(-1) ?? ''
        reject(new LookupFailure(error.killed === true ? 'ran out of time' : said || error.message, steps))
        return
      }
      const stream = parseLookup(stdout)
      if (stream !== null) resolve({ stream, steps })
      else reject(new LookupFailure('printed no address', steps))
    })
    child.stdout?.on('data', (chunk: string) => {
      const lines = (partial + chunk).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines) if (line.trim() !== '') steps.push({ at: Date.now() - from, step: line.startsWith('[') ? stepOf(line, id) : 'printed' })
    })
  })
}

/** A video's best audio-only stream by yt-dlp's default clients alone: what the #503 self-check asks, since a fallback would hide a yt-dlp that fails. */
export async function askDefaultClients(binary: string, id: string, timeoutMs: number): Promise<AudioStream> {
  const { stream, steps } = await ask(binary, id, [], timeoutMs)
  return { ...stream, asked: { client: 'default', steps, failedFirst: null } }
}

/**
 * A video's best audio-only stream: `visionos` first, then once by the
 * default clients with what the bound has left. Rejects on both failing,
 * the time running out, or no address in what either printed.
 */
export async function resolveAudioStream(binary: string, id: string, timeoutMs = RESOLVE_TIMEOUT_MS, firstTryMs = FIRST_TRY_MS): Promise<AudioStream> {
  const from = Date.now()
  let first: LookupFailure
  try {
    const { stream, steps } = await ask(binary, id, VISIONOS_ARGS, Math.min(firstTryMs, timeoutMs))
    return { ...stream, asked: { client: 'visionos', steps, failedFirst: null } }
  } catch (error) {
    first = error instanceof LookupFailure ? error : new LookupFailure(String(error), [])
  }
  const ms = Date.now() - from
  try {
    // execFile reads a timeout of 0 as none.
    const { stream, steps } = await ask(binary, id, [], Math.max(1, timeoutMs - ms))
    return { ...stream, asked: { client: 'default', steps, failedFirst: { why: first.why, ms, steps: first.steps } } }
  } catch (error) {
    throw new Error(`yt-dlp found no stream for ${id}: visionos: ${first.why}; default: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** A yt-dlp build's version (`2026.10.26`), as `--version` prints it; rejects when it cannot be run. */
export function ytDlpVersion(binary: string, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['--version'], { timeout: timeoutMs }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolve(stdout.trim())
    })
  })
}
