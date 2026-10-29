import { execFile } from 'node:child_process'
import { watchUrl } from '../../core/music/youtubeSearch'

// The audio road's lookup (#502): yt-dlp resolves a video to its best
// audio-only stream's address (Opus in WebM, about 130 kbps), one process
// per song. The Player's own search picks the video first (arm B, measured
// against yt-dlp's own search on the kiosk 2026-10-28, yt-dlp 2026.10.26:
// by id p50 4.6 s, max 5.6 s; search and resolve together p50 5.9 s, max
// 7.1 s — 9 runs each). Python's start is 0.4 s of it.

/**
 * How long a lookup may take before the road falls back to the watch
 * page: about twice the slowest lookup measured on the kiosk (5.6 s) — a
 * guess past that; the `media-start` spans of the road's songs settle it.
 */
export const RESOLVE_TIMEOUT_MS = 11_000

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
}

/** What yt-dlp printed for `-O '%(available_at)s %(url)s'`: the stream, or null with no address in it. A bare address (`-g`'s shape) names no time. */
export function parseLookup(stdout: string): AudioStream | null {
  const line = stdout.trim().split('\n')[0] ?? ''
  const [first = '', second] = line.split(' ')
  const stream = second ?? first
  if (!/^https?:\/\//.test(stream)) return null
  const seconds = second === undefined || first === '' ? NaN : Number(first)
  return { stream, availableAt: Number.isFinite(seconds) ? seconds * 1000 : null }
}

/** A video's best audio-only stream; rejects on yt-dlp's failure, its time running out, or no address in what it printed. */
export function resolveAudioStream(binary: string, id: string, timeoutMs = RESOLVE_TIMEOUT_MS): Promise<AudioStream> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['--no-warnings', '--no-playlist', '-f', 'bestaudio', '-O', '%(available_at)s %(url)s', '--', watchUrl(id)], { timeout: timeoutMs }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      const stream = parseLookup(stdout)
      if (stream !== null) resolve(stream)
      else reject(new Error(`yt-dlp printed no stream for ${id}`))
    })
  })
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
