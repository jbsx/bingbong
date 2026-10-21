import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AskRecord } from '../../core/decision/askRecord'
import { reportFault } from '../../core/trace/fault'
import { createJsonlSink, LOG_MAX_AGE_MS, type JsonlSinkOptions } from '../logs/jsonlSink'
import { ASK_FILE_PATTERN } from '../perf/perfFiles'

// The asks sidecar (#338): every Jev call's whole ask — its state text and
// questions — in asks-*.jsonl beside the decision log, which names each ask
// by id and so stays small. The same rolling, purging and
// failure-swallowing sink the decision log rides; `pnpm jev:candidates` and
// `pnpm jev:case` read it. An ask's image (the Mark Ask's, #382) is saved
// in ask-images/ beside it, named by the ask's id, and purged on the same
// seven days.

/** The folder under the logs dir an ask's images are saved in. */
export const ASK_IMAGES_DIR = 'ask-images'

export interface AskLogSink {
  write(record: AskRecord): void
  /** Save an ask's image; answers the file, relative to the logs dir, or null when it could not be written. */
  saveImage(id: string, bytes: Uint8Array): string | null
}

export function createAskLogSink(logsDir: string, options: JsonlSinkOptions = {}): AskLogSink {
  const sink = createJsonlSink<AskRecord>(logsDir, { prefix: 'asks', pattern: ASK_FILE_PATTERN }, options)
  const now = options.now ?? (() => Date.now())
  const maxAgeMs = options.maxAgeMs ?? LOG_MAX_AGE_MS
  const dir = join(logsDir, ASK_IMAGES_DIR)

  function purge(): void {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (now() - statSync(path).mtimeMs > maxAgeMs) rmSync(path, { force: true })
    }
  }

  return {
    write: (record) => sink.write(record),
    saveImage(id, bytes) {
      try {
        mkdirSync(dir, { recursive: true })
        purge()
        const file = `${id.replace(/[^\w.-]/g, '_')}.jpg`
        writeFileSync(join(dir, file), bytes)
        return `${ASK_IMAGES_DIR}/${file}`
      } catch (error) {
        reportFault('run.askLogSink.saveImage', error)
        return null
      }
    },
  }
}
