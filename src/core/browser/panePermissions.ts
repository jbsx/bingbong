// The pane's permission policy (#423). Electron grants every request a
// page makes unless the session says otherwise; the pane's session says:
// the microphone and camera (`media`) stay the wake word's and STT's, a
// notification never pops over the appliance, a page may go full screen,
// write the clipboard and lock the pointer, and anything else is denied.
// The table is a guess, picked as the cheapest to reverse: what would
// settle it is a daily site that needs camera, mic or location in the pane.

const ALLOWED: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])

/** Whether the pane grants a page this permission. */
export function panePermits(permission: string): boolean {
  return ALLOWED.has(permission)
}

/** A denied request, as the outcome line reports it. */
export function permissionDeniedLine(permission: string, origin: string): string {
  return `permission denied: ${permission} (${origin})`
}
