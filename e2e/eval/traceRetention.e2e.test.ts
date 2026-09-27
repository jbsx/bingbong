import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../../src/core/ports/llm'
import { digestOf } from '../live/artifacts'
import type { FixtureServer } from '../fixtureServer'
import { startEvaluator, type EvalReport } from './evaluator'
import type { ProductionRouting } from './routing'
import type { EvalScenario } from './scenarios'

// #280 at the real seam: a capture through the evaluator keeps its Run Trace
// after quit() deletes the profile, names it in the report, stamps each Run
// with the turn id its trace lines carry, and the Shadow Replay reads the
// kept directory as it reads a live capture. A scripted model serves the
// Run, so this spends nothing — and its report carries the scripted witness
// eval:accept refuses, which is why the routing seam is test-only.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function readingScript(readingUrl: string): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        {
          id: 'plan',
          name: 'report_run_plan',
          args: { objective: 'Read the reading fixture', headline: 'Reading the fixture page', effort_tier: 'lookup', asked_items: ['the answer'] },
        },
        { id: 'open', name: 'navigate', args: { url: readingUrl } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 'part-1', name: 'read_page', args: {} }] },
    { kind: 'answer', askedItems: [{ item: 'the answer', standing: 'stated', statement: 'stated' }], speak: 'Read.', display: 'The page was read.' },
  ]
}

const scripted = (fixture: FixtureServer): ProductionRouting => ({
  env: { BINGBONG_LLM_SCRIPT: JSON.stringify(readingScript(fixture.url('/reading'))) },
  identity: { orchestrator: { configured: false }, subagent: { configured: false }, vision: { configured: false } },
  reasoningEffort: null,
  decisionSeams: null,
})

const SCENARIO: EvalScenario = {
  id: 'trace-retention',
  kind: 'lookup',
  command: () => 'read the reading fixture',
  expectedEffort: { tier: 'lookup' },
  success: (observation) => observation.outcome === 'done',
}

async function capture(options: { reportPath: string; reportsRoot: string; tracesRoot: string }): Promise<EvalReport> {
  const evaluator = await startEvaluator({ ...options, routing: scripted, scenarioTimeoutMs: 60_000 })
  try {
    await evaluator.runScenario(SCENARIO)
    await evaluator.finish()
  } finally {
    await evaluator.quit()
  }
  return JSON.parse(readFileSync(options.reportPath, 'utf8')) as EvalReport
}

describe('eval trace retention e2e (#280)', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-eval-traces-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the Run Trace under the mirrored directory, names it in the report, and the replay counts it', { timeout: 180_000 }, async () => {
    const reportsRoot = join(dir, 'eval')
    const tracesRoot = join(reportsRoot, 'traces')
    const reportPath = join(reportsRoot, 'jev', 'off', 'pass-1-afbd1fe3.json')
    const report = await capture({ reportPath, reportsRoot, tracesRoot })

    const traceDir = join(tracesRoot, 'jev', 'off', 'pass-1--afbd1fe3')
    expect(report.aggregate).toBeDefined()
    expect(report.traces?.directory).toBe(relative(repoRoot, traceDir))
    expect(report.traces?.error).toBeUndefined()
    expect(report.traces?.failures).toEqual([])
    const traceFiles = report.traces!.files.filter((file) => file.family === 'run_trace')
    expect(traceFiles.length).toBeGreaterThan(0)
    // The digests the report names are the files on disk after quit().
    for (const file of report.traces!.files) {
      expect(digestOf(readFileSync(join(traceDir, 'logs', file.name))), file.name).toBe(file.digest)
    }
    expect(readdirSync(join(traceDir, 'logs')).sort()).toEqual(report.traces!.files.map((file) => file.name).sort())

    // The Run's turn id joins its report entry to its trace lines.
    const turnId = report.scenarios[0]!.runs[0]!.turnId
    expect(turnId).toBeTruthy()
    const lines = traceFiles.flatMap((file) =>
      readFileSync(join(traceDir, 'logs', file.name), 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as { turnId?: string }),
    )
    expect(lines.filter((line) => line.turnId === turnId).length).toBeGreaterThan(0)
    expect(report.scenarios[0]!.metrics.turnId).toBeUndefined()

    // The replay reads the kept directory with no CLI change, and asks nothing.
    const script = join(repoRoot, 'scripts', 'decision-shadow.ts')
    const replay = spawnSync(process.execPath, [script, '--dry-run', `--roots=${join(tracesRoot, 'jev', 'off')}`, '--sets=pass'], { encoding: 'utf8' })
    expect(replay.status, replay.stderr).toBe(0)
    expect(replay.stderr).toContain('1 captures, 1 runs, samples {"passage":1,"result":0,"tier":1}')

    // A second pass aimed at the same traces is refused before launch.
    rmSync(reportPath)
    await expect(capture({ reportPath, reportsRoot, tracesRoot })).rejects.toThrow(/refusing to reuse the trace directory/)
  })

  it('finalizes a capture whose archive failed, with the failure recorded in its traces', { timeout: 180_000 }, async () => {
    const reportsRoot = join(dir, 'eval-blocked')
    // A file where the traces root should be: nothing can be written under it.
    const tracesRoot = join(dir, 'blocked-traces')
    writeFileSync(tracesRoot, '')
    const reportPath = join(reportsRoot, 'pass-1-afbd1fe3.json')
    const report = await capture({ reportPath, reportsRoot, tracesRoot })

    expect(report.aggregate).toBeDefined()
    expect(report.scenarios[0]!.success).toBe(true)
    expect(report.traces?.complete).toBe(false)
    expect(report.traces?.files).toEqual([])
    expect(report.traces?.failures.length).toBeGreaterThan(0)
  })
})
