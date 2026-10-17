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
    expect(stdout).not.toContain('reaction (Endpoint to first effect)')
  })

  it('prints the Reaction p50/p95 per verb and the decisions line from the two families (#324)', () => {
    const reaction = (turnId: string, verb: string, durMs: number): string =>
      JSON.stringify({ ...span(turnId, 'reaction', durMs), detail: { verb, effect: 'settled', reading: 'local_match', source: 'spoken' } })
    writeFileSync(
      join(dir, 'perf-1-1.jsonl'),
      [reaction('turn-1', 'open', 420), reaction('turn-2', 'open', 610), reaction('turn-3', 'click', 180)].join('\n') + '\n',
    )
    const decision = (turnId: string, reading: string, jevAsked: boolean, latencyMs?: number): string =>
      JSON.stringify({
        type: 'decision',
        turnId,
        at: NOW,
        source: 'spoken',
        transcript: 'open youtube',
        reading,
        verb: 'open',
        target: null,
        slot: 'youtube',
        jevAsked,
        ...(latencyMs !== undefined ? { jev: { model: 'jev-1.14.0', latencyMs, confidence: { verb: 0.9, target: 0.4, slot: 0.7 }, probabilities: { verb: {}, target: {}, slot: {} } } } : {}),
      })
    writeFileSync(
      join(dir, 'decision-1-1.jsonl'),
      [
        decision('turn-1', 'local_match', false),
        decision('turn-2', 'jev', true, 230),
        decision('turn-3', 'local_match', false),
        JSON.stringify({ type: 'misfire', turnId: 'turn-2', at: NOW, signal: 'back', signalTurnId: 'turn-3', withinMs: 900 }),
        '{"type":"decision","turnId":"torn"',
      ].join('\n') + '\n',
    )

    const stdout = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })

    expect(stdout).toContain('decision files 1')
    expect(stdout).toContain('reaction (Endpoint to first effect), by verb:')
    expect(stdout).toMatch(/^all\s+3\s+420ms\s+610ms\s+610ms$/m)
    expect(stdout).toMatch(/^open\s+2\s+420ms\s+610ms\s+610ms$/m)
    expect(stdout).toMatch(/^click\s+1\s+180ms\s+180ms\s+180ms$/m)
    expect(stdout).toContain(
      'decisions: 3 commands | jev asked 1 (33%), answered 1, latency p50 230ms p95 230ms | local match 2, jev 1, best guess 0 | misfires 1 (back 1)',
    )
  })

  it('prints the Early Fire share and lead, and the Reaction split by Early Fire (#326)', () => {
    const reaction = (turnId: string, durMs: number, leadMs?: number): string =>
      JSON.stringify({ ...span(turnId, 'reaction', durMs), detail: { verb: 'scroll_down', effect: 'scroll', reading: 'local_match', source: 'spoken', ...(leadMs !== undefined ? { earlyFire: true, leadMs } : {}) } })
    writeFileSync(join(dir, 'perf-1-1.jsonl'), [reaction('turn-1', 0, 350), reaction('turn-2', 0, 450), reaction('turn-3', 240)].join('\n') + '\n')
    const decision = (turnId: string, extra: Record<string, unknown>): string =>
      JSON.stringify({ type: 'decision', turnId, at: NOW, source: 'spoken', transcript: 'scroll down', reading: 'local_match', verb: 'scroll_down', target: null, slot: null, jevAsked: false, ...extra })
    writeFileSync(
      join(dir, 'decision-1-1.jsonl'),
      [decision('turn-1', { earlyFire: { partial: 'scroll down', leadMs: 350 } }), decision('turn-2', { earlyFire: { partial: 'scroll down', leadMs: 450 } }), decision('turn-3', { partialCalls: 1 })].join('\n') + '\n',
    )

    const stdout = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })

    expect(stdout).toContain('reaction by Early Fire:')
    expect(stdout).toMatch(/^early\s+2\s+0ms\s+0ms\s+0ms$/m)
    expect(stdout).toMatch(/^endpoint\s+1\s+240ms\s+240ms\s+240ms$/m)
    expect(stdout).toContain('early fire: 2 of 3 spoken (67%), lead p50 350ms p95 450ms | jev calls per spoken utterance 0.33 (1 on partials)')
  })

  it('exits 0 against an empty logs dir', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })

    expect(stdout).toContain(`no perf spans found (files 0, skipped lines 0)`)
  })
})
