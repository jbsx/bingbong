// Launch-time configuration shared by the main process (window creation) and
// the preload (what the renderer needs to know). Kiosk mode is the appliance
// deployment from T11: fullscreen, with the idle screen's timeout tunable via
// env so e2e doesn't wait real minutes.

export const KIOSK_FLAG = '--kiosk'

/** Default inactivity timeout before the idle screen appears: 5 minutes. */
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000

export interface LaunchConfig {
  /** `--kiosk` — fullscreen window, browser pane dominant. */
  kiosk: boolean
  /** Inactivity timeout before the idle screen; BINGBONG_IDLE_TIMEOUT_MS overrides. */
  idleTimeoutMs: number
}

export function resolveLaunchConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): LaunchConfig {
  const parsed = Number(env.BINGBONG_IDLE_TIMEOUT_MS)
  return {
    kiosk: argv.includes(KIOSK_FLAG),
    idleTimeoutMs: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_TIMEOUT_MS,
  }
}
