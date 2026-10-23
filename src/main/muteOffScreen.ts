import type { App } from 'electron'

// A test or an agent driving the app must never sound on the owner's
// speakers: only the app the owner runs on their own screen plays. A muted
// run is one under xvfb-run, or one asked for with BINGBONG_MUTE_AUDIO=1 (the
// e2e harness and every agent session set it). --mute-audio silences
// Chromium's output stream while every media element's own state (muted,
// volume, paused) is untouched, so what the card reads and the media ops do
// is the same as on a real screen; speech, the chime and the alarm play to
// ALSA's null device (piperConfig's playerDevice).

/** Debian's xvfb-run hands its child XAUTHORITY=<tmp>/xvfb-run.XXXXXX/Xauthority. */
const XVFB_RUN_AUTHORITY = /\/xvfb-run\.[^/]+\/Xauthority$/

/** True under xvfb-run, or when BINGBONG_MUTE_AUDIO=1 asks for it on any display. */
export function shouldMuteAudio(env: Record<string, string | undefined>): boolean {
  if (env.BINGBONG_MUTE_AUDIO === '1') return true
  if (env.BINGBONG_MUTE_AUDIO === '0') return false
  return XVFB_RUN_AUTHORITY.test(env.XAUTHORITY ?? '')
}

/** Appends --mute-audio when the run is off screen. Must precede app ready like every appendSwitch. */
export function muteOffScreen(app: Pick<App, 'commandLine'>, env: Record<string, string | undefined>): void {
  if (shouldMuteAudio(env)) app.commandLine.appendSwitch('mute-audio')
}
