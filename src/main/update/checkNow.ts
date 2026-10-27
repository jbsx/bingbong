import { reportFault } from '../../core/trace/fault'
import type { UpdateCheck } from '../../core/update/updateCheck'
import type { IdleInstall } from './idleInstall'

// An update asked for now (#422): a Release already downloaded installs at
// once — the line is itself the owner asking — and otherwise GitHub is asked
// as the hourly check asks it. A Release found but not yet downloaded keeps
// the Idle Screen's gate: a guess, the cheapest arm to reverse; the owner's
// first live "update" that lands on `downloading` settles it.

/**
 * How long the line waits on the Release feed before it says it couldn't
 * check: a feed gone (the suspended account's 404s) or a network that never
 * answers must not hold the Command. A guess, cheap to reverse; the first
 * live checks' spans settle it. The check itself runs on, and a Release it
 * finds late downloads and installs at the Idle Screen as the hourly one's.
 */
export const CHECK_NOW_WAIT_MS = 8_000

/** What asking for a newer Release answered: whether one is, and its version. */
export interface ReleaseCheck {
  readonly available: boolean
  readonly version: string
}

export interface CheckNowDeps {
  readonly gate: Pick<IdleInstall, 'ready' | 'installNow'>
  readonly runningVersion: string
  /** Asks for a newer Release, its download starting when there is one; null where the updater is inactive; rejects when the check fails. */
  check(): Promise<ReleaseCheck | null>
  /** How long to wait on `check` before the line reads it as failed; CHECK_NOW_WAIT_MS by default. */
  readonly waitMs?: number
}

const TIMED_OUT = Symbol('timed out')

/** The check, or TIMED_OUT once the wait is up. */
async function withinWait<T>(work: Promise<T>, waitMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const out = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), waitMs)
  })
  try {
    return await Promise.race([work, out])
  } finally {
    clearTimeout(timer)
  }
}

export function createCheckNow(deps: CheckNowDeps): () => Promise<UpdateCheck> {
  const installing = (): UpdateCheck | null => {
    const ready = deps.gate.ready()
    return ready === null ? null : { kind: 'installing', version: ready, install: () => deps.gate.installNow() }
  }
  return async () => {
    const downloaded = installing()
    if (downloaded !== null) return downloaded
    let found: ReleaseCheck | null | typeof TIMED_OUT
    try {
      found = await withinWait(deps.check(), deps.waitMs ?? CHECK_NOW_WAIT_MS)
    } catch {
      return { kind: 'failed' }
    }
    if (found === TIMED_OUT) {
      // A feed that never answers leaves a trace, as one that errors does through the updater's own fault.
      reportFault('update.checkNow', new Error(`no answer from the Release feed in ${deps.waitMs ?? CHECK_NOW_WAIT_MS} ms`))
      return installing() ?? { kind: 'failed' }
    }
    if (found === null) return { kind: 'unavailable' }
    // A download that landed while the check was out is installed, as one there before it.
    return installing() ?? (found.available ? { kind: 'downloading', version: found.version } : { kind: 'current', version: deps.runningVersion })
  }
}
