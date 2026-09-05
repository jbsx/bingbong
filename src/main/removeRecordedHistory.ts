import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { reportFault } from '../core/trace/fault'

// Recorded History's loose end (#188, ADR 0031). The store was write-only:
// nothing rendered it, and everything it held is in the Run Trace with
// more fidelity — so it was retired rather than widened. What it leaves
// behind on every machine that ran an earlier build is `history.db` and
// its WAL/SHM siblings, holding Session text (commands, answers, spoken
// lines, heard utterances) that nobody asked to keep and nothing can now
// read.
//
// So the file family is deleted outright at startup, unconditionally and
// regardless of age, exactly as the retired `trace-*.jsonl` family is
// (#184): an always-on store of Session text must not linger past the
// code that wrote it (ADR 0028).

/** The retired store and the two files SQLite's WAL mode keeps beside it. */
export const RECORDED_HISTORY_FILES = ['history.db', 'history.db-wal', 'history.db-shm'] as const

/**
 * Deletes the retired store from a profile directory. Swallows every fs
 * failure the way the log sinks do — a profile that cannot be written is
 * not something startup can fix, and never a reason not to boot.
 */
export function removeRecordedHistory(userDataDir: string): void {
  for (const name of RECORDED_HISTORY_FILES) {
    const path = join(userDataDir, name)
    try {
      if (existsSync(path)) rmSync(path)
    } catch (error) {
      reportFault('history.removeRecordedHistory', error)
      // A racing deletion or a locked file: nothing to recover, and the
      // next launch tries again.
    }
  }
}
