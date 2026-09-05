import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunId } from '../../core/session/sessionIdentity'
import { createFailureScreenshotCapture, failureScreenshotPath } from './failureScreenshotFile'
import { RUN_TRACE_FAMILY_PATTERN, RUN_TRACE_FILE_PATTERN, RUN_TRACE_SCREENSHOT_PATTERN, traceFamilyOf } from './traceFiles'

// The failure screenshot's file (#191): a PNG beside the trace, under the
// family's prefix so the purge owns it, and outside the record pattern
// so the reader never parses it as lines.

describe('the failure screenshot file (#191)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-failure-shot-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the capture as run-trace-<runId>-<turnId>.png beside the trace and reports its size', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const capture = createFailureScreenshotCapture({ logsDir: join(dir, 'logs'), screenshot: async () => png })

    const captured = await capture({ runId: 'run-7' as RunId, turnId: 'turn-9' })

    expect(captured).toEqual({ path: join(dir, 'logs', 'run-trace-run-7-turn-9.png'), bytes: 7 })
    expect(new Uint8Array(readFileSync(captured.path))).toEqual(png)
  })

  it('lets a capture that throws reach the caller — the runner reports it as a fault', async () => {
    const capture = createFailureScreenshotCapture({
      logsDir: dir,
      screenshot: () => Promise.reject(new Error('page is gone')),
    })

    await expect(capture({ runId: 'run-7' as RunId, turnId: 'turn-9' })).rejects.toThrow('page is gone')
  })

  it('names a file the family purge owns and the record reader ignores', () => {
    const name = failureScreenshotPath(dir, 'run-7' as RunId, 'turn-9').slice(dir.length + 1)

    expect(RUN_TRACE_SCREENSHOT_PATTERN.test(name)).toBe(true)
    expect(RUN_TRACE_FAMILY_PATTERN.test(name)).toBe(true)
    expect(RUN_TRACE_FILE_PATTERN.test(name)).toBe(false)
    expect(traceFamilyOf(name)).toBeNull()
    // The records themselves are still the family's, on both patterns.
    expect(RUN_TRACE_FAMILY_PATTERN.test('run-trace-1700000000000-1.jsonl')).toBe(true)
    expect(traceFamilyOf('run-trace-1700000000000-1.jsonl')).toBe('run')
  })

  it('keeps an id that is not filename-safe from escaping the logs dir', () => {
    const path = failureScreenshotPath(dir, '../run' as RunId, 'turn/9')

    expect(path.startsWith(dir)).toBe(true)
    expect(path.slice(dir.length + 1)).toBe('run-trace-.._run-turn_9.png')
  })
})
