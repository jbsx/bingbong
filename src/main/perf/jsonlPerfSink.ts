import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PerfSink, PerfSpanRecord } from '../../core/perf/perfTracer'

// The rotating JSONL sink half of #27's tracer: span records land one JSON
// line per finished stage in a perf-*.jsonl file under the user-data logs
// dir. The file rolls at ~5 MB and files older than 7 days are purged —
// both checks run here, at startup and on every write, never on timers.
// Logging must never become the app's problem: every fs failure is
// swallowed (a dead logs dir degrades to a no-op sink).

export const PERF_ROLL_BYTES = 5 * 1024 * 1024
export const PERF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const PERF_FILE_PATTERN = /^perf-.*\.jsonl$/

export interface JsonlPerfSinkOptions {
  /** Roll to a new file once the active one reaches this size. */
  rollBytes?: number
  /** Delete perf files whose last write is older than this. */
  maxAgeMs?: number
  /** Wall clock for file naming and the purge window (tests fake it). */
  now?: () => number
}

export function createJsonlPerfSink(logsDir: string, options: JsonlPerfSinkOptions = {}): PerfSink {
  const rollBytes = options.rollBytes ?? PERF_ROLL_BYTES
  const maxAgeMs = options.maxAgeMs ?? PERF_MAX_AGE_MS
  const now = options.now ?? (() => Date.now())
  let activePath: string | null = null
  let activeBytes = 0

  try {
    mkdirSync(logsDir, { recursive: true })
  } catch {
    return { write: () => {} }
  }

  function purge(): void {
    let names: string[]
    try {
      names = readdirSync(logsDir).filter((name) => PERF_FILE_PATTERN.test(name))
    } catch {
      return
    }
    for (const name of names) {
      const path = join(logsDir, name)
      if (path === activePath) continue
      try {
        if (now() - statSync(path).mtimeMs > maxAgeMs) rmSync(path)
      } catch {
        // Unreadable meta or a racing deletion: not logging's problem.
      }
    }
  }

  function ensureActiveFile(): string {
    if (activePath === null) {
      // perf-<stamp>-<n>.jsonl: uniform names keep creation order sortable.
      const stamp = now()
      let n = 1
      while (existsSync(join(logsDir, `perf-${stamp}-${n}.jsonl`))) n += 1
      activePath = join(logsDir, `perf-${stamp}-${n}.jsonl`)
      activeBytes = 0
    }
    return activePath
  }

  // Startup check — the only other one rides writes.
  purge()

  return {
    write(record: PerfSpanRecord) {
      try {
        const line = `${JSON.stringify(record)}\n`
        appendFileSync(ensureActiveFile(), line)
        activeBytes += Buffer.byteLength(line)
        if (activeBytes >= rollBytes) activePath = null
        purge()
      } catch {
        // A failed append must never break the stage it is measuring.
      }
    },
  }
}
