import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startEvaluator } from './evaluator'
import type { ProductionRouting } from './routing'
import { retainTraces, traceDirFor } from './traceRetention'

// #280: an eval capture keeps its Run Trace. The profile is deleted at
// quit(), so the logs family is copied out first, beside nothing the pool
// readers see — under e2e/eval/traces/, mirroring the report's own path.

const COMMIT = 'afbd1fe3'.padEnd(40, '0')

describe('traceDirFor', () => {
  const roots = { reportsRoot: '/repo/e2e/eval', tracesRoot: '/repo/e2e/eval/traces' }

  it('mirrors a pool pass, splitting its commit off as the replay names a capture', () => {
    expect(traceDirFor('/repo/e2e/eval/jev/on/pass-1-afbd1fe3.json', COMMIT, roots)).toBe('/repo/e2e/eval/traces/jev/on/pass-1--afbd1fe3')
    expect(traceDirFor('/repo/e2e/eval/pools/candidate/pass-3-0123abcd.json', COMMIT, roots)).toBe('/repo/e2e/eval/traces/pools/candidate/pass-3--0123abcd')
  })

  it('names a report without a commit by the commit it was captured on', () => {
    expect(traceDirFor('/repo/e2e/eval/delegation/pass-4.json', COMMIT, roots)).toBe('/repo/e2e/eval/traces/delegation/pass-4--afbd1fe3')
    expect(traceDirFor('/repo/e2e/eval/report-280.json', COMMIT, roots)).toBe('/repo/e2e/eval/traces/report-280--afbd1fe3')
  })

  it('refuses a report outside the reports root, whose traces could mirror nothing', () => {
    expect(() => traceDirFor('/elsewhere/pass-1-afbd1fe3.json', COMMIT, roots)).toThrow(/must live under \/repo\/e2e\/eval/)
    expect(() => traceDirFor('/repo/e2e/eval/traces/pass-1-afbd1fe3.json', COMMIT, roots)).toThrow(/inside the traces root/)
  })
})

describe('retainTraces', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-trace-retention-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function logs(files: Record<string, string>): string {
    const logsDir = join(dir, 'profile', 'logs')
    mkdirSync(logsDir, { recursive: true })
    for (const [name, text] of Object.entries(files)) writeFileSync(join(logsDir, name), text)
    return logsDir
  }

  it('copies the logs family redacted, names each file with its bytes and digest, and flags a torn tail', () => {
    const logsDir = logs({
      'run-trace-2026-09-27.jsonl': '{"kind":"pipeline_event","turnId":"t1","key":"sk-secret-value"}\n{"kind":"pipe',
      'perf-2026-09-27.jsonl': '{"name":"llm_round"}\n',
      'settings.json': '{"apiKey":"sk-secret-value"}',
    })
    const traceDir = join(dir, 'traces', 'pass-1--afbd1fe3')
    const traces = retainTraces(logsDir, traceDir, { secrets: ['sk-secret-value'], finished: true, relativeTo: dir })
    expect(traces.directory).toBe('traces/pass-1--afbd1fe3')
    expect(traces.files.map((file) => [file.name, file.complete])).toEqual([
      ['perf-2026-09-27.jsonl', true],
      ['run-trace-2026-09-27.jsonl', false],
    ])
    const trace = traces.files[1]!
    const written = readFileSync(join(traceDir, 'logs', 'run-trace-2026-09-27.jsonl'), 'utf8')
    expect(written).toBe('{"kind":"pipeline_event","turnId":"t1","key":"[redacted]"}\n')
    expect(trace.bytes).toBe(Buffer.byteLength(written))
    expect(trace.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(trace.note).toBe('torn final line dropped')
    // Only diagnostic families are copied: a profile's settings hold keys.
    expect(() => readFileSync(join(traceDir, 'logs', 'settings.json'))).toThrow()
    expect(traces.complete).toBe(false)
    expect(traces).not.toHaveProperty('error')
  })

  it('reads a clean archive of a finished pass as complete, and an empty logs directory as a valid outcome', () => {
    const clean = retainTraces(logs({ 'run-trace-2026-09-27.jsonl': '{"kind":"x"}\n' }), join(dir, 'a'), { finished: true, relativeTo: dir })
    expect(clean.complete).toBe(true)
    const none = retainTraces(join(dir, 'no-such-profile', 'logs'), join(dir, 'b'), { finished: true, relativeTo: dir })
    expect(none).toEqual({ directory: 'b', complete: true, files: [], failures: [] })
  })

  it('flags the traces of a pass that never finished as incomplete, whatever the files say', () => {
    const traces = retainTraces(logs({ 'run-trace-2026-09-27.jsonl': '{"kind":"x"}\n' }), join(dir, 'a'), { finished: false, relativeTo: dir })
    expect(traces.complete).toBe(false)
    expect(traces.note).toBe('the pass did not finish: these are the traces it wrote before it stopped')
  })

  it('records a failed archive instead of throwing, redacted', () => {
    const logsDir = logs({ 'run-trace-2026-09-27.jsonl': '{"kind":"x"}\n' })
    // A file where the trace directory's parent should be: nothing can be written under it.
    writeFileSync(join(dir, 'blocked'), '')
    const traces = retainTraces(logsDir, join(dir, 'blocked', 'pass-1--afbd1fe3'), { finished: true, relativeTo: dir })
    expect(traces.complete).toBe(false)
    expect(traces.files).toEqual([])
    expect(traces.failures).toHaveLength(1)
    expect(traces.failures[0]!.name).toBe('run-trace-2026-09-27.jsonl')
  })
})

describe('startEvaluator trace refusal', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-trace-refusal-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a capture whose trace directory already exists, before any launch', async () => {
    const reportsRoot = join(dir, 'eval')
    const tracesRoot = join(reportsRoot, 'traces')
    const reportPath = join(reportsRoot, 'jev', 'on', 'pass-1-afbd1fe3.json')
    mkdirSync(join(tracesRoot, 'jev', 'on', 'pass-1--afbd1fe3'), { recursive: true })
    // No routing is ever resolved and no app launched: the refusal comes first.
    const routing = (): ProductionRouting => {
      throw new Error('routing was composed: the refusal came too late')
    }
    await expect(startEvaluator({ reportPath, reportsRoot, tracesRoot, routing })).rejects.toThrow(
      /refusing to reuse the trace directory .*pass-1--afbd1fe3/,
    )
  })
})
