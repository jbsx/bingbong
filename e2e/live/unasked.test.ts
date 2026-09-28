import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ROUNDS_HEADING, VERIFIED_OR_UNASKED_HEADING, type AuditAggregate, type AuditPopulation } from './audit.ts'

// `pnpm live:unasked` (#287) as a real Node subprocess, over one committed
// family copied to a scratch directory with the reading taken out: the
// command has to write back the files that are committed, byte for byte,
// which is what "no existing counter moves" means for a file on disk. The
// reading's rules are under `audit.test.ts`; the committed aggregates are
// pinned to it in `ledger.test.ts`.

const REPORTS_DIR = fileURLToPath(new URL('./reports/', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../../scripts/live-unasked.ts', import.meta.url))
const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)
const FAMILY = ['audit-fix-284-1.json', 'audit-fix-284-2.json', 'audit-fix-284-3.json']
const AGGREGATE = 'audit-aggregate-fix-284'

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
  } catch (error) {
    const failed = error as { status: number | null; stdout: string; stderr: string }
    return { status: failed.status, stdout: failed.stdout, stderr: failed.stderr }
  }
}

/** The committed aggregate as it was before the reading: the field out of every population, the section out of the Markdown. */
function withoutTheReading(): { json: string; markdown: string } {
  const aggregate = JSON.parse(readFileSync(join(REPORTS_DIR, `${AGGREGATE}.json`), 'utf8')) as AuditAggregate
  const strip = <P extends AuditPopulation>(population: P): P => {
    const copy: { verifiedOrUnasked?: unknown } & P = { ...population }
    delete copy.verifiedOrUnasked
    return copy
  }
  for (const key of ['initial', 'followUp'] as const) {
    const population = aggregate.populations[key]
    Object.assign(aggregate.populations, { [key]: { ...strip(population), perSet: population.perSet.map((entry) => ({ setId: entry.setId, population: strip(entry.population) })) } })
  }
  const lines = readFileSync(join(REPORTS_DIR, `${AGGREGATE}.md`), 'utf8').split('\n')
  const from = lines.indexOf(VERIFIED_OR_UNASKED_HEADING)
  const to = lines.indexOf(TOOL_ROUNDS_HEADING)
  return { json: `${JSON.stringify(aggregate, null, 2)}\n`, markdown: [...lines.slice(0, from), ...lines.slice(to)].join('\n') }
}

describe.skipIf(!stripsTypes)('pnpm live:unasked', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bingbong-unasked-'))
    for (const name of FAMILY) copyFileSync(join(REPORTS_DIR, name), join(root, name))
    const before = withoutTheReading()
    expect(before.json).not.toContain('verifiedOrUnasked')
    expect(before.markdown).not.toContain('unasked')
    writeFileSync(join(root, `${AGGREGATE}.json`), before.json)
    writeFileSync(join(root, `${AGGREGATE}.md`), before.markdown)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const written = (name: string) => readFileSync(join(root, name), 'utf8')
  const committed = (name: string) => readFileSync(join(REPORTS_DIR, name), 'utf8')

  it('writes the reading into the aggregate and its Markdown and moves nothing else, and a second run writes nothing', () => {
    const first = run([`--reports=${root}`])
    expect(first.stderr).toBe('')
    expect(first.stdout).toContain(`${AGGREGATE}.json: initial 8 verified + 3 = 11 of 12; follow-up 5 verified + 0 = 5 of 6`)
    expect(first.stdout).toContain('live:unasked wrote 2 file(s) over 1 aggregate audit(s)')
    expect(written(`${AGGREGATE}.json`)).toBe(committed(`${AGGREGATE}.json`))
    expect(written(`${AGGREGATE}.md`)).toBe(committed(`${AGGREGATE}.md`))
    // The per-Pass audits are read, never written.
    for (const name of FAMILY) expect(written(name)).toBe(committed(name))
    expect(readdirSync(root).sort()).toEqual([...FAMILY, `${AGGREGATE}.json`, `${AGGREGATE}.md`].sort())

    expect(run([`--reports=${root}`]).stdout).toContain('live:unasked wrote 0 file(s) over 1 aggregate audit(s)')
  })

  it('says what it would write on a dry run, and writes nothing', () => {
    const before = written(`${AGGREGATE}.json`)
    const dry = run([`--reports=${root}`, '--dry-run'])
    expect(dry.stdout).toContain('live:unasked would write 2 file(s) over 1 aggregate audit(s)')
    expect(written(`${AGGREGATE}.json`)).toBe(before)
  })

  it('writes nothing when an aggregate names a Pass with no audit beside it', () => {
    rmSync(join(root, FAMILY[1]!))
    const before = written(`${AGGREGATE}.json`)
    const refused = run([`--reports=${root}`])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain(`${AGGREGATE}.json cannot be restated — nothing was written`)
    expect(refused.stderr).toContain('capture set fix-284-2 has no per-Pass audit to read its attempts from')
    expect(written(`${AGGREGATE}.json`)).toBe(before)
  })

  it('refuses an unknown option before reading anything', () => {
    const refused = run(['--nope=1'])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('unexpected argument "--nope=1"')
  })
})
