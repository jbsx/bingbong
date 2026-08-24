// Launch-time configuration shared by the main process (window creation) and
// the preload (what the renderer needs to know). Kiosk mode is the appliance
// deployment from T11: fullscreen, with the idle screen's timeout tunable via
// env so e2e doesn't wait real minutes.

import { SESSION_WINDOW_MS } from '../session/sessionMemory'

export const KIOSK_FLAG = '--kiosk'

/** Default inactivity timeout before the idle screen appears: 5 minutes. */
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_SESSION_WARNING_MS = 5 * 60 * 1000

export interface LaunchConfig {
  /** `--kiosk` — fullscreen window, browser pane dominant. */
  kiosk: boolean
  /** Inactivity timeout before the idle screen; BINGBONG_IDLE_TIMEOUT_MS overrides. */
  idleTimeoutMs: number
  /**
   * The Session Window (#70): while an Active Session exists (newest run
   * finished within it, or a run in progress) the idle timeout never swaps
   * the dashboard away. BINGBONG_SESSION_WINDOW_MS overrides — the same e2e
   * knob the live store and boot hydration read.
   */
  sessionWindowMs: number
  /** Lead time before Session expiry; BINGBONG_SESSION_WARNING_MS overrides. */
  sessionWarningMs: number
}

export function resolveLaunchConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): LaunchConfig {
  const parsedIdle = Number(env.BINGBONG_IDLE_TIMEOUT_MS)
  const parsedWindow = Number(env.BINGBONG_SESSION_WINDOW_MS)
  const sessionWindowMs = Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : SESSION_WINDOW_MS
  const parsedWarning = Number(env.BINGBONG_SESSION_WARNING_MS)
  const fallbackWarning = DEFAULT_SESSION_WARNING_MS < sessionWindowMs
    ? DEFAULT_SESSION_WARNING_MS
    : sessionWindowMs / 6
  const sessionWarningMs = Number.isFinite(parsedWarning) && parsedWarning > 0 && parsedWarning < sessionWindowMs
    ? parsedWarning
    : fallbackWarning
  return {
    kiosk: argv.includes(KIOSK_FLAG),
    idleTimeoutMs: Number.isFinite(parsedIdle) && parsedIdle > 0 ? parsedIdle : DEFAULT_IDLE_TIMEOUT_MS,
    sessionWindowMs,
    sessionWarningMs,
  }
}
