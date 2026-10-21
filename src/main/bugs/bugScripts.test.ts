import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The bugs:* entry points (#371) run under plain node via type stripping,
// as the jev:* scripts do (#338): every runtime import on their graph must
// resolve as real ESM. Spawn each script the way the npm script does —
// candidates over a fixture logs dir, add one of them to a scratch ledger,
// then print the ledger.

const script = (name: string): string => fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url))

const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

function run(name: string, args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script(name), ...args], { encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe.skipIf(!stripsTypes)('the bugs:* scripts', () => {
  let logs: string
  let ledger: string

  beforeEach(() => {
    logs = mkdtempSync(join(tmpdir(), 'bingbong-bugs-scripts-'))
    ledger = join(logs, 'ledger')
    writeFileSync(
      join(logs, 'decision-1-1.jsonl'),
      [
        { type: 'decision', turnId: 't1', at: 1_000, source: 'spoken', transcript: 'Skip 10 seconds ahead.', reading: 'jev', verb: 'click', target: 10, slot: null, jevAsked: true },
        { type: 'decision', turnId: 't1-hop1', at: 2_000, source: 'spoken', transcript: 'Skip 10 seconds ahead.', reading: 'jev', verb: 'click', target: 10, slot: null, jevAsked: true, task: { id: 't1', hop: 1 }, ended: 'cap' },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n',
    )
  })

  afterEach(() => {
    rmSync(logs, { recursive: true, force: true })
  })

  it('lists the candidate, adds it to the ledger, lists no more, and prints the ledger', () => {
    const before = run('bugs-candidates.ts', [logs, '--ledger', ledger])
    expect(before.stderr).toBe('')
    expect(before.code).toBe(0)
    expect(before.stdout).toMatch(/^t1  \S+ \S+  "Skip 10 seconds ahead."  ended:cap\n/)

    const empty = run('bugs.ts', [ledger])
    expect(empty.code).toBe(0)
    expect(empty.stdout).toContain(`no failed lines in ${ledger}`)

    const added = run('bugs-add.ts', ['t1', '--stage', 'missing_option', '--happened', 'clicked the time display 5 times', '--meant', 'seek 10 s forward', '--logs', logs, '--ledger', ledger])
    expect(added.stderr).toBe('')
    expect(added.code).toBe(0)
    expect(added.stdout).toBe(`wrote ${join(ledger, 't1.json')}\n`)
    expect(JSON.parse(readFileSync(join(ledger, 't1.json'), 'utf8'))).toMatchObject({ turnId: 't1', transcript: 'Skip 10 seconds ahead.', stage: 'missing_option', log: 'decision-1-1.jsonl' })

    const after = run('bugs-candidates.ts', [logs, '--ledger', ledger])
    expect(after.stdout).toBe(`no failed-looking lines in ${logs} that the ledger does not hold\n`)

    const updated = run('bugs-add.ts', ['t1', '--claimed', '#371', '--ledger', ledger])
    expect(updated.code).toBe(0)
    expect(updated.stdout).toBe(`updated ${join(ledger, 't1.json')}\n`)

    const table = run('bugs.ts', [ledger])
    expect(table.stderr).toBe('')
    expect(table.code).toBe(0)
    expect(table.stdout).toContain(`1 failed lines in ${ledger}: 1 open (0 unclaimed), 0 fixed, 0 ruled`)
    expect(table.stdout).toContain('missing_option  1      1        0      0')
    expect(table.stdout).toContain('  claimed by #371')
  })

  it('refuses a bad stage and an unknown option, with the usage', () => {
    const stage = run('bugs-add.ts', ['t1', '--stage', 'vibes', '--happened', 'h', '--meant', 'm', '--logs', logs, '--ledger', ledger])
    expect(stage.code).toBe(1)
    expect(stage.stderr).toContain('bugs:add: "vibes" is not a stage')
    expect(stage.stderr).toContain('usage: pnpm bugs:add')
    const option = run('bugs-add.ts', ['t1', '--why', 'x'])
    expect(option.code).toBe(2)
    expect(option.stderr).toContain('bugs:add: unknown option --why')
  })

  it('prints the ledger and exits 1 when a file in it is not an entry', () => {
    writeFileSync(join(logs, 'bad.json'), '{"turnId":"bad"}')
    const table = run('bugs.ts', [logs])
    expect(table.code).toBe(1)
    expect(table.stderr).toContain('bugs: bad.json: not an entry: transcript is not a non-empty string')
    expect(table.stdout).toContain(`no failed lines in ${logs}`)
  })
})
