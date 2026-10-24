import type { UpdateCheck } from '../../core/update/updateCheck'
import type { IdleInstall } from './idleInstall'

// An update asked for now (#422): a Release already downloaded installs at
// once — the line is itself the owner asking — and otherwise GitHub is asked
// as the hourly check asks it. A Release found but not yet downloaded keeps
// the Idle Screen's gate: a guess, the cheapest arm to reverse; the owner's
// first live "update" that lands on `downloading` settles it.

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
}

export function createCheckNow(deps: CheckNowDeps): () => Promise<UpdateCheck> {
  const installing = (): UpdateCheck | null => {
    const ready = deps.gate.ready()
    return ready === null ? null : { kind: 'installing', version: ready, install: () => deps.gate.installNow() }
  }
  return async () => {
    const downloaded = installing()
    if (downloaded !== null) return downloaded
    let found: ReleaseCheck | null
    try {
      found = await deps.check()
    } catch {
      return { kind: 'failed' }
    }
    if (found === null) return { kind: 'unavailable' }
    // A download that landed while the check was out is installed, as one there before it.
    return installing() ?? (found.available ? { kind: 'downloading', version: found.version } : { kind: 'current', version: deps.runningVersion })
  }
}
