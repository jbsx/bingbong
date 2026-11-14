// A time limit on one call to BlueZ (#556). dbus-next sets no timeout on a
// method call, and on the kiosk a call BlueZ never answered held the Scale
// Listener for days: busy, discovery off, nothing logged. Every awaited call
// on the listener's road goes through here, so a call that hangs fails, and
// the failure names it.

/** A call that ran past its limit, or whose work was abandoned: never a refusal BlueZ gave. */
export class CallLimitError extends Error {}

/**
 * `call`'s answer, or a failure naming `name` once `limitMs` passes or
 * `abandoned` settles first. The call itself cannot be cancelled; its late
 * answer or failure is let fall.
 */
export function withinLimit<T>(call: Promise<T>, name: string, limitMs: number, abandoned?: Promise<unknown>): Promise<T> {
  call.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CallLimitError(`${name} timed out after ${limitMs / 1000} s`)), limitMs)
  })
  const racers: Promise<T>[] = [call, limit]
  if (abandoned !== undefined) {
    racers.push(
      abandoned.then((): never => {
        throw new CallLimitError(`${name} abandoned: the session ended`)
      }),
    )
  }
  return Promise.race(racers).finally(() => clearTimeout(timer))
}
