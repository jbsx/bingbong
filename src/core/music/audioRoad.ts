// The audio road's switch (#502, owner's ruling 2): yt-dlp is acceptable
// now, not for distribution, so the road is off unless the env turns it
// on — the root `.env` does, a distributed build does not — and with it
// off every play opens the watch page as before. The value names the
// yt-dlp to run: `on` for the one on PATH, else a path to another build.
// It must be current: on 2026-10-28 the kiosk's 2026.10.26 served whole
// streams, open-ended ranges too (YouTube's TVHTML5 client), where a
// 2026.07.04 build's streams were refused (403) past their first 512 KB.

export const AUDIO_ROAD_ENV = 'BINGBONG_AUDIO_ROAD'

/** The yt-dlp the audio road runs; null while the road is off (unset, empty, `off`, `0`, `false`). */
export function audioRoadBinary(env: Record<string, string | undefined>): string | null {
  const value = env[AUDIO_ROAD_ENV]?.trim() ?? ''
  if (value === '' || /^(off|0|false|no)$/i.test(value)) return null
  return /^(on|1|true|yes)$/i.test(value) ? 'yt-dlp' : value
}
