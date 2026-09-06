import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { BrowserController, VisualGroundingController } from '../ports/browser'

// Issue #205, ADR 0038: an Unsettled Action and the custody it holds.
//
// Answer availability and safe resource reuse are two boundaries, not one.
// Stop (and the Finalization Allowance behind it) must be able to end the
// Run's *wait* on a browser action that will not answer — otherwise one
// uncooperative navigation postpones the Card indefinitely. Ending that
// wait proves nothing about Chromium: the tab may still be loading, the
// click may still be dispatching. So the two boundaries move apart here.
//
// The Run's side is prompt: an abandoned call rejects now, with wording
// that says the outcome is uncertain rather than undone. The resource's
// side is conservative: the browser it was acting on is *withheld* — every
// later call is refused outright, never queued — until the action is
// observed to end. Observed settlement is the only release: ADR 0038 also
// allows safe isolation, but nothing here can establish that a surface is
// gone without the action ending anyway (a destroyed webContents rejects
// what it was running, and a worker's custody dies with its spawn), so the
// conservative arm the ADR permits — continued unavailability — is what a
// never-settling action gets.
//
// Two things are deliberately not treated as an ending:
//   - a bounded adapter wait expiring (UnsettledActionError), which is the
//     wrapper giving up, not the navigation;
//   - the caller's own promise rejecting because custody abandoned it.
// An ordinary resolve or reject from the controller *is* an ending — the
// action finished, it just may have finished badly.

/**
 * A bounded wait expired with its operation still outstanding (CONTEXT.md,
 * Unsettled Action). Thrown by an adapter that gave up waiting, never by
 * one whose operation ended: `settlement` is the underlying operation's own
 * end, which custody waits for before the resource is reusable.
 */
export class UnsettledActionError extends Error {
  readonly settlement: Promise<void>

  constructor(message: string, settlement: Promise<void>) {
    super(message)
    this.name = 'UnsettledActionError'
    // Nobody is required to await this; an unhandled rejection here would
    // be the underlying operation's failure, which is settlement all the same.
    this.settlement = settlement.then(
      () => undefined,
      () => undefined,
    )
  }
}

/**
 * The Run's wait on a browser action was ended before the action was. Its
 * message is the disclosure ADR 0038 requires: the action was let go of,
 * not undone, and its outcome is unknown.
 */
export class AbandonedActionError extends Error {
  constructor(action: string) {
    super(`browser action '${action}' was abandoned before it settled; the browser may still be acting on it`)
    this.name = 'AbandonedActionError'
  }
}

/**
 * A browser resource refused because an Unsettled Action still holds it.
 * Refusal, not a queue: nothing waits here to run later against a page
 * whose state nobody can vouch for.
 */
export class WithheldResourceError extends Error {
  constructor(action: string) {
    super(
      `browser action '${action}' was refused: the browser is unavailable until an abandoned action settles`,
    )
    this.name = 'WithheldResourceError'
  }
}

/**
 * Wait `ms` for `operation`, then give up on the wait without pretending
 * the operation ended: the rejection carries the operation's own eventual
 * settlement so a holder of the resource knows when it is genuinely free.
 * A value, and an ordinary failure, pass through unchanged.
 *
 * `withDeadline` (core/ports/clock) races the same way but for a caller who
 * can shrug the work off — it answers null and drops the result. Use this
 * one where the work touched something that has to be reclaimed.
 */
export function boundedWait<T>(operation: Promise<T>, ms: number, message: string, clock: Clock = systemClock): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = clock.setTimer(ms, () => reject(new UnsettledActionError(message, settlementOf(operation))))
    operation.then(
      (value) => {
        cancel()
        resolve(value)
      },
      (error: unknown) => {
        cancel()
        reject(error)
      },
    )
  })
}

/** An operation's end, however it ends — the one thing custody waits on. */
function settlementOf(operation: Promise<unknown>): Promise<void> {
  return operation.then(
    () => undefined,
    (error: unknown) =>
      // A wrapper that gave up did not end anything; keep following the
      // operation it wrapped down to whatever actually ends.
      error instanceof UnsettledActionError ? error.settlement : undefined,
  )
}

/** Whether the browser this custody holds may be used right now. */
export type CustodyState = 'available' | 'withheld'

export interface BrowserCustody<T extends BrowserController> {
  /**
   * The only way to reach the resource: every call passes through custody,
   * so an abandoned action's page can never be acted on or read behind its
   * back.
   */
  readonly controller: T
  /**
   * End the Run's wait on everything in flight (Stop, or the Finalization
   * Allowance running out). Each waiting caller rejects with an
   * {@link AbandonedActionError} now; the resource stays withheld until
   * those actions are observed to end. Abandoning nothing withholds nothing.
   */
  abandon(): void
  state(): CustodyState
  /** Resolves once nothing abandoned is outstanding — the state's own edge. */
  settled(): Promise<void>
}

/**
 * One action custody started and has not seen end. `holding` means its
 * caller has been answered while the action itself was never observed to
 * end — by abandonment, or by an adapter that gave up its own bounded wait.
 * That, not merely being in flight, is what withholds the resource.
 */
interface Outstanding {
  readonly action: string
  holding: boolean
  reject(error: Error): void
}

/**
 * `state()` is the port's one synchronous reader. Everything else answers a
 * promise, so a withheld call rejects rather than throwing — a refusal
 * reaches every caller the way a failed action does, including the seams
 * that hand a bare `() => controller.settledState()` to a rail.
 */
const SYNCHRONOUS_READERS = ['state'] as const

/** The members of a port that answer something other than a promise. */
type NotPromising<T> = { [K in keyof T]-?: T[K] extends (...args: never[]) => Promise<unknown> ? never : K }[keyof T]

/**
 * The hand-written half of the Proxy, pinned. A port method that does not
 * answer a promise has to be named above, or custody would hand its caller
 * a promise where a value was expected — and a refusal it could not read.
 * Growing the port without listing such a method is a type error here
 * rather than a hole discovered at runtime.
 */
type PinnedSynchronousReaders = NotPromising<BrowserController & VisualGroundingController> extends
  (typeof SYNCHRONOUS_READERS)[number]
  ? true
  : never
const _synchronousReadersArePinned: PinnedSynchronousReaders = true
void _synchronousReadersArePinned

/**
 * Hold custody of a browser resource. The returned controller is the one to
 * hand out; the handle beside it is what Stop, Finalization, and Session
 * retirement act through.
 */
export function holdBrowserCustody<T extends BrowserController>(controller: T): BrowserCustody<T> {
  const outstanding = new Set<Outstanding>()
  const waiters = new Set<() => void>()

  const withheld = (): boolean => {
    for (const entry of outstanding) if (entry.holding) return true
    return false
  }

  // Drained explicitly rather than iterated: a waiter added during the
  // sweep belongs to the next release, not this one.
  function drainWaiters(): void {
    const pending = [...waiters]
    waiters.clear()
    for (const notify of pending) notify()
  }

  function track<R>(action: string, call: Promise<R>): Promise<R> {
    const entry: Outstanding = { action, holding: false, reject: () => {} }
    outstanding.add(entry)
    const end = (): void => {
      outstanding.delete(entry)
      if (!withheld()) drainWaiters()
    }
    void call.then(end, (error: unknown) => {
      // The adapter gave up its own bounded wait: the caller has an answer,
      // but nothing observed the navigation stop. Hold until it does.
      if (!(error instanceof UnsettledActionError)) return end()
      entry.holding = true
      return error.settlement.then(end)
    })
    return new Promise<R>((resolve, reject) => {
      entry.reject = reject
      // Whichever lands first wins; a promise settles once, so a late
      // result can never reach a caller custody already answered.
      call.then(resolve, reject)
    })
  }

  const guarded = new Proxy(controller, {
    // A Proxy rather than a hand-written façade: the port grows, and a
    // method that forgot to ask custody is exactly the hole #205 is about.
    get(target, property) {
      // Read against the target, not the proxy: a receiver of the proxy
      // would send any accessor that calls its own methods back through
      // this guard.
      const value = Reflect.get(target, property) as unknown
      if (typeof value !== 'function' || typeof property !== 'string') return value
      const action = property
      const method = value as (...args: unknown[]) => unknown
      if ((SYNCHRONOUS_READERS as readonly string[]).includes(action)) {
        return (...args: unknown[]): unknown =>
          // No stale page while withheld: a later Run must not read, or act
          // through, the state an abandoned action left behind.
          withheld() ? { url: null, title: null } : method.apply(target, args)
      }
      return (...args: unknown[]): unknown => {
        if (withheld()) return Promise.reject(new WithheldResourceError(action))
        let call: Promise<unknown>
        try {
          call = Promise.resolve(method.apply(target, args))
        } catch (error) {
          return Promise.reject(error)
        }
        return track(action, call)
      }
    },
  })

  return {
    controller: guarded,
    abandon() {
      for (const entry of outstanding) {
        if (entry.holding) continue
        entry.holding = true
        entry.reject(new AbandonedActionError(entry.action))
      }
    },
    state: () => (withheld() ? 'withheld' : 'available'),
    settled: () =>
      withheld() ? new Promise<void>((resolve) => waiters.add(resolve)) : Promise.resolve(),
  }
}
