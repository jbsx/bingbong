import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decisionEnvKeys } from '../../core/decision/decisionRouting'

// The jev:* entry points (#338) run under plain node via type stripping, as
// `pnpm perf:report` does (#36): every runtime import on their graph must
// resolve as real ESM. Spawn each script the way the npm script does —
// candidates and case over a fixture logs dir, then replay the case it
// wrote with no key set, which must say so and ask nothing.

const script = (name: string): string => fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url))

const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

/** The env without any decision key, so a replay cannot reach the real Jev. */
function keylessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  const unset = new Set(decisionEnvKeys())
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !unset.has(key)) env[key] = value
  return env
}

function run(name: string, args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script(name), ...args], { encoding: 'utf8', env: keylessEnv() })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe.skipIf(!stripsTypes)('the jev:* scripts', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-jev-scripts-'))
    writeFileSync(
      join(dir, 'decision-1-1.jsonl'),
      [
        { type: 'decision', turnId: 't1', at: 1, source: 'spoken', transcript: 'open the latest post', reading: 'jev', verb: 'click', target: 21, targetLabel: 'Pinned', slot: null, jevAsked: true, ask: 't1' },
        { type: 'misfire', turnId: 't1', at: 2, signal: 'back', signalTurnId: 't2', withinMs: 800 },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n',
    )
    const questions = { target: { type: 'choice', instructions: 'Which element?', options: { none: null, 'ref-21': 'Pinned', 'ref-27': 'Latest' } } }
    writeFileSync(join(dir, 'asks-1-1.jsonl'), JSON.stringify({ type: 'ask', id: 't1', turnId: 't1', at: 1, kind: 'command', model: 'jev-1.14.0', state: 'the page', questions }) + '\n')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists the candidate, writes its case, and a keyless replay of it says it needs the key', () => {
    const candidates = run('jev-candidates.ts', [dir])
    expect(candidates.stderr).toBe('')
    expect(candidates.code).toBe(0)
    expect(candidates.stdout).toContain('t1  back  "open the latest post" → click "Pinned"  ask t1')

    const corpus = join(dir, 'cases')
    const made = run('jev-case.ts', ['t1', '--expect', 'target=ref-27', 'target!=ref-21', '--logs', dir, '--corpus', corpus])
    expect(made.stderr).toBe('')
    expect(made.code).toBe(0)
    expect(made.stdout).toContain(`wrote ${join(corpus, 't1.json')}`)

    const replay = run('jev-replay.ts', [corpus])
    expect(replay.code).toBe(2)
    expect(replay.stderr).toContain('jev:replay asks the real Jev and needs its key')
    expect(replay.stderr).toContain('TYPESAFE_API_KEY')
  })

  it('jev:case refuses a label the ask does not offer, and exits non-zero', () => {
    const made = run('jev-case.ts', ['t1', '--expect', 'target=ref-99', '--logs', dir, '--corpus', join(dir, 'cases')])
    expect(made.code).toBe(1)
    expect(made.stderr).toContain('"target" offers no label "ref-99"')
  })
})
