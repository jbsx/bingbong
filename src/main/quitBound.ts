// The quit is bounded (#434): from the first `before-quit`, whatever holds it
// (a hook that takes the quit over, a promise a hook left running, Chromium
// waiting on a renderer) has QUIT_BOUND_MS, then the app exits anyway and the
// overrun is a fault naming the last quit step reached. By kind: every hook,
// every machine. The kiosk unit's TimeoutStopSec sits above it
// (scripts/kiosk-install.sh), so systemd's SIGKILL is never the way out.
//
// A quit is the app's own when its code asked for it (`quitFromApp`): only
// that quit may be taken over by a hook (night dim's restore). A quit from
// the OS (a SIGTERM from systemd, which Electron turns into the same
// before-quit) runs no takeover: the next boot puts back what it would have.

/** The whole quit's bound, from the first before-quit to app.exit. A guess (#434): the kiosk's quit record settles it. */
export const QUIT_BOUND_MS = 5000

export interface QuitBoundDeps {
  boundMs: number
  /** Starts the one timer; the bound unrefs it so it never keeps the process up by itself. */
  setTimer(fn: () => void, ms: number): { unref?(): unknown }
  /** Ends the process now (`app.exit`). */
  exit(code: number): void
  /** Told once, when the bound passed, with how long the quit has run. */
  onPast(sinceAskedMs: number): void
  now(): number
}

export interface QuitBound {
  /** Every before-quit calls this; the first one starts the bound. */
  asked(): void
}

export function createQuitBound(deps: QuitBoundDeps): QuitBound {
  let askedAt: number | null = null
  return {
    asked() {
      if (askedAt !== null) return
      const at = deps.now()
      askedAt = at
      deps
        .setTimer(() => {
          deps.onPast(Math.round(deps.now() - at))
          deps.exit(0)
        }, deps.boundMs)
        .unref?.()
    },
  }
}

let fromApp = false

/** Marks the quit about to start as the app's own, for a road that quits by itself (the updater's quitAndInstall). */
export function markQuitFromApp(): void {
  fromApp = true
}

/** Quits because the app's own code asked: a hook may take this quit over, bounded like any. */
export function quitFromApp(app: { quit(): void }): void {
  markQuitFromApp()
  app.quit()
}

/** Whether the quit under way was asked by the app's code; false is a quit from the OS (a signal, the session). */
export function quitIsFromApp(): boolean {
  return fromApp
}
