import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunId } from '../../core/session/sessionIdentity'
import type { FailureScreenshotCapture } from '../../core/trace/failureScreenshot'
import { RUN_TRACE_FILE_PREFIX } from './traceFiles'

// The failure screenshot's file (#191, ADR 0031): `run-trace-<runId>-<turnId>.png`
// beside the Run Trace's jsonl, in the same logs dir, under the same
// prefix — so the family's purge owns it and a reader finds it by the
// ids the record carries. A PNG in a jsonl line would blow the roll; a
// sibling file purges under the same 7-day rule and costs the roll
// nothing. Nothing calls this unless `BINGBONG_RUN_TRACE` is set: main
// builds the capture only beside the sink.

/** Keeps an id filename-safe; the ids are minted internally, so this only ever guards. */
function fileSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_')
}

/** Where a Run's failure screenshot goes: `<logsDir>/run-trace-<runId>-<turnId>.png`. */
export function failureScreenshotPath(logsDir: string, runId: RunId, turnId: string): string {
  return join(logsDir, `${RUN_TRACE_FILE_PREFIX}-${fileSafe(runId)}-${fileSafe(turnId)}.png`)
}

/**
 * Binds the visible tab's capture to the logs dir. Unlike the trace
 * writers this does not swallow: a capture or write that fails throws to
 * the runner, which reports it as a fault under the Run's turn — the
 * failure to capture is itself a diagnosis worth a record.
 */
export function createFailureScreenshotCapture(deps: {
  logsDir: string
  screenshot(): Promise<Uint8Array>
}): FailureScreenshotCapture {
  return async ({ runId, turnId }) => {
    const png = await deps.screenshot()
    const path = failureScreenshotPath(deps.logsDir, runId, turnId)
    mkdirSync(deps.logsDir, { recursive: true })
    writeFileSync(path, png)
    return { path, bytes: png.byteLength }
  }
}
