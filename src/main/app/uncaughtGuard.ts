/**
 * The main process's uncaught exceptions. One is known harmless and only logged:
 * undici's `assert(!this.paused)` from a socket's end, thrown when a server closes
 * a response nobody read (nodejs/undici#5360, fixed in undici 8.4.1, not in the
 * undici 7 Electron 43's Node ships). Its request is already over; the error has no
 * caller to reach, and Electron's modal over the kiosk would wait for a click.
 * Our own roads drop such bodies (`dropBody`); this catches any a library leaves.
 * Every other exception gets the dialog Electron would have shown.
 */
export function isUndiciPausedAssertion(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  const stack = error.stack ?? ''
  // Thrown from undici's own Parser.finish; the socket-end frame is named only on some Nodes (`onHttpSocketEnd` on 24, anonymous on 22).
  return code === 'ERR_ASSERTION' && /assert\(!this\.paused\)/.test(error.message) && /at Parser\.finish \([^)]*undici/.test(stack)
}

export interface UncaughtGuardDeps {
  readonly report: (where: string, error: unknown) => void
  readonly showErrorBox: (title: string, content: string) => void
}

export function createUncaughtGuard(deps: UncaughtGuardDeps): (error: unknown) => void {
  return (error) => {
    if (isUndiciPausedAssertion(error)) {
      deps.report('app.undiciPaused', error)
      return
    }
    const detail = error instanceof Error ? (error.stack ?? String(error)) : String(error)
    deps.showErrorBox('A JavaScript error occurred in the main process', `Uncaught Exception:\n${detail}`)
  }
}
