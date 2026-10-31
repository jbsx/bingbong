// The audio road's yt-dlp (#502). Whether the road is taken is the
// `audioOnlyMusic` setting's, read at each song (owner, 2026-10-28: "make
// this a toggle in the settings panel"), on by default since 78aed4f0. yt-dlp
// is acceptable now, not for distribution (owner's ruling 2). The env names
// only which yt-dlp the road runs: a path to a build, else the one on PATH.
// The switch words it carried before the setting (`on`, `off`, …) name the
// one on PATH. It must be current: on 2026-10-28 the kiosk's 2026.10.26
// served whole streams, open-ended ranges too (YouTube's TVHTML5 client),
// where a 2026.07.04 build's streams were refused (403) past their first
// 512 KB.

export const AUDIO_ROAD_ENV = 'BINGBONG_AUDIO_ROAD'

/** The yt-dlp on PATH. */
export const YT_DLP = 'yt-dlp'

/** The yt-dlp the audio road runs: the env's path, else the one on PATH. */
export function audioRoadBinary(env: Record<string, string | undefined>): string {
  const value = env[AUDIO_ROAD_ENV]?.trim() ?? ''
  return value === '' || /^(on|off|1|0|true|false|yes|no)$/i.test(value) ? YT_DLP : value
}

/** Turns off the app's own yt-dlp (#503): the e2e harness sets it, so no launch downloads a build. */
export const YT_DLP_UPDATE_ENV = 'BINGBONG_YTDLP_UPDATE'

/**
 * Whether the app keeps its own yt-dlp current (#503) while the road's
 * setting is on: not where the env names a build (that build is the
 * owner's pin), nor where it turns the updater off.
 */
export function appYtDlpKept(env: Record<string, string | undefined>): boolean {
  if (/^(off|0|false|no)$/i.test(env[YT_DLP_UPDATE_ENV]?.trim() ?? '')) return false
  return audioRoadBinary(env) === YT_DLP
}
