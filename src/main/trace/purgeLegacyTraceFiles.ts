import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { reportFault } from '../../core/trace/fault'

// The rename's loose end (#184): until this slice the Run Trace was
// `trace-*.jsonl` and was written unconditionally, so any machine that ran
// a #180–#183 build has files holding Evidence Checkpoint arguments,
// excerpts and graded observation heads. After the rename no family's
// pattern matches those names, and each family purges only its own prefix
// — so the 7-day window that was keeping them bounded no longer applies to
// them at all. With `BINGBONG_RUN_TRACE` unset the new sink is never even
// constructed, so its startup purge would never run either.
//
// Leaving them would break the invariant this slice exists to establish
// (ADR 0031): Session Evidence is never in an always-on store. So the old
// family is deleted outright at startup, unconditionally and regardless of
// age — nothing reads these files, and their only remaining property is
// that they are user text nobody asked to keep.

/** The retired Run Trace family: `trace-*.jsonl`, written before #184. */
export const LEGACY_TRACE_FILE_PATTERN = /^trace-.*\.jsonl$/

/**
 * Deletes every file of the retired family. Runs before either sink is
 * built and swallows every fs failure, like the sinks themselves: a logs
 * dir that cannot be read is not the app's problem at startup.
 */
export function purgeLegacyTraceFiles(logsDir: string): void {
  let names: string[]
  try {
    names = readdirSync(logsDir).filter((name) => LEGACY_TRACE_FILE_PATTERN.test(name))
  } catch (error) {
    reportFault('trace.purgeLegacyTraceFiles.list', error)
    return
  }
  for (const name of names) {
    try {
      rmSync(join(logsDir, name))
    } catch (error) {
      reportFault('trace.purgeLegacyTraceFiles.remove', error)
      // A racing deletion or an unreadable entry: nothing to recover.
    }
  }
}
