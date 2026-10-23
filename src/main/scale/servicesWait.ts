// The wait for a connected scale's GATT services (#397): BlueZ answers
// Connect before ServicesResolved turns true, so the session polls it. A
// woken scale is awake only briefly, so a link that drops mid-resolve ends
// the wait at once instead of holding the session until the timeout: the
// next advert can then retry while the scale is still awake.

export interface ServicesWaitOptions {
  /** How long the services may take to resolve after Connect returns. */
  readonly timeoutMs?: number
  /** How often ServicesResolved is read. */
  readonly intervalMs?: number
}

/** Resolves once `resolved` answers true; throws when `dropped` settles first or the timeout passes. */
export async function waitForServices(
  resolved: () => Promise<boolean>,
  dropped: Promise<void>,
  options: ServicesWaitOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const intervalMs = options.intervalMs ?? 200
  const drop = dropped.then((): never => {
    throw new Error('the scale disconnected before its services resolved')
  })
  // A drop after the services resolved is the session's business, not this wait's.
  drop.catch(() => undefined)
  const deadline = Date.now() + timeoutMs
  while (!(await Promise.race([resolved(), drop]))) {
    if (Date.now() > deadline) throw new Error('the scale’s services did not resolve')
    await Promise.race([new Promise((resolve) => setTimeout(resolve, intervalMs)), drop])
  }
}
