import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from '../../core/perf/perfTracer'

// The #36 regression pin: `pnpm perf:report` runs this entry point under
// plain node via type stripping, so every runtime import in its transitive
// graph must resolve as real ESM — extensionless relative imports (fine
// when electron-vite bundles src/) crash with ERR_MODULE_NOT_FOUND here.
// Spawn the actual script against a fixture logs dir, the same way the
// npm script does, and pin the report it prints (the stt p50/p95/max row
// the Moonshine latency target is verified against).

const SCRIPT = fileURLToPath(new URL('../../../scripts/perf-report.ts', import.meta.url))
const NOW = 1_700_000_000_000

const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major > 22 || (major === 22 && minor >= 18)

function span(turnId: string, stage: string, durMs: number): PerfSpanRecord {
  return { turnId, stage, durMs, at: NOW, t: 1 }
}

function summary(turnId: string, durMs: number, stages: Record<string, { count: number; durMs: number }>): string {
  return JSON.stringify({ turnId, stage: 'summary', durMs, at: NOW, t: 2, detail: { stages } })
}

describe.skipIf(!stripsTypes)('perf:report script', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-perf-script-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 and prints per-stage stats, including the stt row', () => {
    writeFileSync(
      join(dir, 'perf-1-1.jsonl'),
      [
        JSON.stringify(span('turn-1', 'stt', 100)),
        JSON.stringify(span('turn-1', 'llm', 400)),
        JSON.stringify(span('turn-1', 'tts', 150)),
        summary('turn-1', 650, {
          stt: { count: 1, durMs: 100 },
          llm: { count: 1, durMs: 400 },
          tts: { count: 1, durMs: 150 },
        }),
        JSON.stringify(span('turn-2', 'stt', 200)),
        summary('turn-2', 200, { stt: { count: 1, durMs: 200 } }),
      ].join('\n') + '\n',
    )
    writeFileSync(
      join(dir, 'perf-2-1.jsonl'),
      JSON.stringify(span('turn-3', 'stt', 300)) + '\n' + '{"turnId":"torn","stage":"stt",',
    )

    const stdout = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })

    expect(stdout).toContain(`perf report: ${dir}`)
    expect(stdout).toContain('files 2 | turns 3 (2 summarized) | spans 5 | skipped lines 1')
    expect(stdout).toMatch(/^stt\s+3\s+200ms\s+300ms\s+300ms\s+600ms$/m)
    expect(stdout).toContain('summary self-check: 2/2 match')
  })

  it('exits 0 against an empty logs dir', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })

    expect(stdout).toContain(`no perf spans found (files 0, skipped lines 0)`)
  })
})
