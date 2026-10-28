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

/** The address of a video's best audio-only stream; rejects on yt-dlp's failure, its time running out, or no address in what it printed. */
export function resolveAudioStream(binary: string, id: string, timeoutMs = RESOLVE_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['--no-warnings', '--no-playlist', '-f', 'bestaudio', '-g', '--', watchUrl(id)], { timeout: timeoutMs }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      const stream = stdout.trim().split('\n')[0] ?? ''
      if (/^https?:\/\//.test(stream)) resolve(stream)
      else reject(new Error(`yt-dlp printed no stream for ${id}`))
    })
  })
}
