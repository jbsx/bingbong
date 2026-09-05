import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The rotating JSONL log sink: records land one JSON line per write in a
// <prefix>-*.jsonl file under the user-data logs dir. The file rolls at
// ~5 MB and files older than 7 days are purged — both checks run here, at
// startup and on every write, never on timers. Logging must never become
// the app's problem: every fs failure is swallowed (a dead logs dir
// degrades to a no-op sink).
//
// It began as #27's perf sink and is now shared with the Run Trace (#180,
// ADR 0030) — one rolling and purge policy for every diagnostic file
// family, each purging only its own prefix so the families cannot delete
// each other.

export const LOG_ROLL_BYTES = 5 * 1024 * 1024
export const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface JsonlSinkOptions {
  /** Roll to a new file once the active one reaches this size. */
  rollBytes?: number
  /** Delete this family's files whose last write is older than this. */
  maxAgeMs?: number
  /** Wall clock for file naming and the purge window (tests fake it). */
  now?: () => number
}

/** One diagnostic file family: the name it writes and the names it owns. */
export interface JsonlFileFamily {
  /** Filename prefix, e.g. 'perf' — files are `<prefix>-<stamp>-<n>.jsonl`. */
  readonly prefix: string
  /** Which names in the logs dir belong to this family, for the purge. */
  readonly pattern: RegExp
}

export interface JsonlSink<T> {
  write(record: T): void
}

export function createJsonlSink<T>(
  logsDir: string,
  family: JsonlFileFamily,
  options: JsonlSinkOptions = {},
): JsonlSink<T> {
  const rollBytes = options.rollBytes ?? LOG_ROLL_BYTES
  const maxAgeMs = options.maxAgeMs ?? LOG_MAX_AGE_MS
  const now = options.now ?? (() => Date.now())
  let activePath: string | null = null
  let activeBytes = 0

  try {
    mkdirSync(logsDir, { recursive: true })
  // eslint-disable-next-line no-restricted-syntax -- the sink itself: a fault reported here would re-enter the write that just failed
  } catch {
    return { write: () => {} }
  }

  function purge(): void {
    let names: string[]
    try {
      names = readdirSync(logsDir).filter((name) => family.pattern.test(name))
    // eslint-disable-next-line no-restricted-syntax -- the sink itself: a fault reported here would re-enter the write that just failed
    } catch {
      return
    }
    for (const name of names) {
      const path = join(logsDir, name)
      if (path === activePath) continue
      try {
        if (now() - statSync(path).mtimeMs > maxAgeMs) rmSync(path)
      // eslint-disable-next-line no-restricted-syntax -- the sink itself: a fault reported here would re-enter the write that just failed
      } catch {
        // Unreadable meta or a racing deletion: not logging's problem.
      }
    }
  }

  function ensureActiveFile(): string {
    if (activePath === null) {
      // <prefix>-<stamp>-<n>.jsonl: uniform names keep creation order sortable.
      const stamp = now()
      let n = 1
      while (existsSync(join(logsDir, `${family.prefix}-${stamp}-${n}.jsonl`))) n += 1
      activePath = join(logsDir, `${family.prefix}-${stamp}-${n}.jsonl`)
      activeBytes = 0
    }
    return activePath
  }

  // Startup check — the only other one rides writes.
  purge()

  return {
    write(record: T) {
      try {
        const line = `${JSON.stringify(record)}\n`
        appendFileSync(ensureActiveFile(), line)
        activeBytes += Buffer.byteLength(line)
        if (activeBytes >= rollBytes) activePath = null
        purge()
      // eslint-disable-next-line no-restricted-syntax -- the sink itself: a fault reported here would re-enter the write that just failed
      } catch {
        // A failed append must never break the work it is recording.
      }
    },
  }
}
