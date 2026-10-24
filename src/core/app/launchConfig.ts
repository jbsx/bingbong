// Launch-time configuration shared by the main process (window creation) and
// the preload (what the renderer needs to know). Kiosk mode is the appliance
// deployment: fullscreen, with the idle screen's timeout tunable via env so
// e2e doesn't wait real minutes.

export const KIOSK_FLAG = '--kiosk'
/** The same switch in the environment, which the updater's relaunch keeps when it drops argv (#419). */
export const KIOSK_ENV = 'BINGBONG_KIOSK'

/**
 * The app's version, handed to the preload by main as `--bingbong-version=…`:
 * only `app.getVersion()` knows it, since the Release stamps it at packaging
 * (`extraMetadata.version`), not in package.json.
 */
export const APP_VERSION_FLAG = '--bingbong-version='

/** The version main handed the preload, or '' in a window it did not. */
export function appVersionFromArgv(argv: readonly string[]): string {
  const arg = argv.find((a) => a.startsWith(APP_VERSION_FLAG))
  return arg === undefined ? '' : arg.slice(APP_VERSION_FLAG.length)
}

/** Default inactivity timeout before the idle screen appears: 5 minutes. */
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000

export interface LaunchConfig {
  /** `--kiosk` or BINGBONG_KIOSK=1 — fullscreen window, browser pane dominant. */
  kiosk: boolean
  /** Inactivity timeout before the idle screen; BINGBONG_IDLE_TIMEOUT_MS overrides. */
  idleTimeoutMs: number
}

export function resolveLaunchConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): LaunchConfig {
  const parsedIdle = Number(env.BINGBONG_IDLE_TIMEOUT_MS)
  return {
    kiosk: argv.includes(KIOSK_FLAG) || env[KIOSK_ENV] === '1',
    idleTimeoutMs: Number.isFinite(parsedIdle) && parsedIdle > 0 ? parsedIdle : DEFAULT_IDLE_TIMEOUT_MS,
  }
}
