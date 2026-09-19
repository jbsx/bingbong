import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AuditAggregate, AuditPopulation, AuditSetOutput } from './audit.ts'
import {
  HEADLINE_METRICS,
  buildLedger,
  compareFamilies,
  countersOf,
  defaultReferenceOf,
  familyIdOf,
  markersOf,
  type Ledger,
  type LedgerFamily,
  type LedgerFile,
} from './ledger.ts'

// The Fix Ledger's pure half (#251), read two ways: against the committed
// Round Audits — the acceptance criteria name their families and numbers —
// and against fixtures cut from those audits for what the committed set
// cannot show (a Pass missing, a family without an aggregate, a chosen
// Reference, each marker axis on its own).

const REPORTS_DIR = fileURLToPath(new URL('./reports/', import.meta.url))

function committedFiles(): LedgerFile[] {
  return readdirSync(REPORTS_DIR)
    .filter((name) => name.startsWith('audit-') && name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, json: JSON.parse(readFileSync(join(REPORTS_DIR, name), 'utf8')) as unknown }))
}

const committed = buildLedger(committedFiles())

function family(ledger: Ledger, id: string): LedgerFamily {
  const found = ledger.families.find((listed) => listed.id === id)
  if (found === undefined) throw new Error(`no family ${id} among ${ledger.families.map((listed) => listed.id).join(', ')}`)
  return found
}

function readAudit(name: string): AuditSetOutput {
  return JSON.parse(readFileSync(join(REPORTS_DIR, name), 'utf8')) as AuditSetOutput
}

/** A per-Pass audit cut from a committed one: its provenance moved, its attempts kept. */
function cut(name: string, provenance: Partial<AuditSetOutput['provenance']>): AuditSetOutput {
  const audit = readAudit(name)
  return { ...audit, provenance: { ...audit.provenance, ...provenance } }
}

function file(name: string, json: unknown): LedgerFile {
  return { name, json }
}

describe('bundled checkpoint rounds (#254)', () => {
  it('reads the count an audit recorded, over the budgeted rounds', () => {
    const audit = readAudit('audit-fix-252-1.json')
    const population: AuditPopulation = { ...audit.populations.initial, bundledCheckpoints: 7 }
    const counter = countersOf(population, [])!.find((entry) => entry.label === 'Bundled checkpoint rounds')!
    expect(counter.judgement).toBe(false)
    expect(counter.value).toBe(7)
    expect(counter.over).toBe(population.budgetedRounds)
  })
})

describe('same-source unsupported rounds (#257, ADR 0054)', () => {
  it('reads the count an audit recorded, over the budgeted rounds', () => {
    const audit = readAudit('audit-fix-252-1.json')
    const population: AuditPopulation = { ...audit.populations.initial, sameSourceUnsupportedRounds: 5 }
    const counter = countersOf(population, [])!.find((entry) => entry.label === 'Same-source unsupported rounds')!
    expect(counter.judgement).toBe(false)
    expect(counter.value).toBe(5)
    expect(counter.over).toBe(population.budgetedRounds)
  })
})

describe('the first token (#256, ADR 0057)', () => {
  it('reads the streaming and silent cuts over the rounds, and the latency percentiles as plain counters', () => {
    const audit = readAudit('audit-fix-252-1.json')
    const population: AuditPopulation = {
      ...audit.populations.initial,
      allowanceFinalizationRoundsStreaming: 2,
      allowanceFinalizationRoundsSilent: 1,
      allowanceFinalizationRoundsNotRecorded: 0,
      firstToken: { rounds: 40, p50: 3_900, p90: 8_100 },
    }
    const counters = countersOf(population, [])!
    expect(counters.find((entry) => entry.label === 'Finalization rounds cut after a first token')).toMatchObject({ value: 2, over: population.rounds, judgement: false })
    expect(counters.find((entry) => entry.label === 'Finalization rounds cut silent')).toMatchObject({ value: 1, over: population.rounds })
    expect(counters.find((entry) => entry.label === 'First-token latency p50 (ms)')).toMatchObject({ value: 3_900, judgement: false })
    expect(counters.find((entry) => entry.label === 'First-token latency p90 (ms)')).toMatchObject({ value: 8_100 })
  })

  it('reads the split as nothing when every cut round predates the first-token record, and as zero when there was no cut at all', () => {
    const audit = readAudit('audit-fix-252-1.json')
    // A fresh audit of old traces: the cuts are there, and none of them could say.
    const unrecorded: AuditPopulation = {
      ...audit.populations.initial,
      allowanceFinalizationRounds: 3,
      allowanceFinalizationRoundsStreaming: 0,
      allowanceFinalizationRoundsSilent: 0,
      allowanceFinalizationRoundsNotRecorded: 3,
      firstToken: { rounds: 0, p50: null, p90: null },
    }
    const counters = countersOf(unrecorded, [])!
    expect(counters.find((entry) => entry.label === 'Finalization rounds cut after a first token')!.value).toBeNull()
    expect(counters.find((entry) => entry.label === 'Finalization rounds cut silent')!.value).toBeNull()
    expect(counters.find((entry) => entry.label === 'First-token latency p50 (ms)')!.value).toBeNull()
    // No cut at all is a recorded zero on both sides of the split.
    const none: AuditPopulation = { ...unrecorded, allowanceFinalizationRounds: 0, allowanceFinalizationRoundsNotRecorded: 0 }
    expect(countersOf(none, [])!.find((entry) => entry.label === 'Finalization rounds cut after a first token')).toMatchObject({ value: 0 })
  })
})

describe('family ids', () => {
  it('strips the Pass suffix and keeps a revision letter', () => {
    expect(familyIdOf('fix-240-1')).toEqual({ family: 'fix-240', ordinal: 1 })
    expect(familyIdOf('fix-242r-3')).toEqual({ family: 'fix-242r', ordinal: 3 })
    expect(familyIdOf('baseline2-2')).toEqual({ family: 'baseline2', ordinal: 2 })
    expect(familyIdOf('pilot')).toEqual({ family: 'pilot', ordinal: null })
  })
})

describe('the rewritten Composed Address counters (#255, ADR 0055)', () => {
  it('reads the rewrites and their Off-key share, and an audit that predates them as not recorded', () => {
    const older = readAudit('audit-fix-252-1.json')
    const rewrittenOf = (population: AuditSetOutput['populations']['initial']) =>
      countersOf(population, older.attempts).filter((counter) => counter.label.startsWith('Rewritten Composed Addresses'))

    expect(rewrittenOf(older.populations.initial)).toEqual([
      { label: 'Rewritten Composed Addresses', judgement: false, value: null, over: null },
      { label: 'Rewritten Composed Addresses judged Off-key', judgement: true, value: null, over: null },
    ])
    expect(rewrittenOf({ ...older.populations.initial, rewrittenComposedAddresses: 4, rewrittenComposedAddressesOffKey: 1 })).toEqual([
      { label: 'Rewritten Composed Addresses', judgement: false, value: 4, over: null },
      { label: 'Rewritten Composed Addresses judged Off-key', judgement: true, value: 1, over: null },
    ])
  })
})

describe('the committed Round Audits', () => {
  it('lists the families in capture order, Baselines by the id convention, each with its Reference', () => {
    const ids = committed.families.map((listed) => listed.id)
    // The nine AC1 names, in capture order; a later set may follow them.
    const named = ['baseline', 'fix-236', 'fix-235', 'fix-237', 'fix-239', 'fix-240', 'fix-242', 'fix-242r', 'baseline2']
    expect(ids.filter((id) => named.includes(id))).toEqual(named)
    expect(committed.ignored).toEqual([])

    const references = Object.fromEntries(committed.families.map((listed) => [listed.id, defaultReferenceOf(listed, committed)?.id ?? null]))
    expect(references.baseline).toBeNull()
    expect(references.baseline2).toBe('baseline')
    for (const id of named.filter((name) => name.startsWith('fix-'))) expect(references[id]).toBe('baseline')

    expect(family(committed, 'baseline').baseline).toBe(true)
    expect(family(committed, 'baseline2').baseline).toBe(true)
    expect(family(committed, 'fix-240').baseline).toBe(false)
    // The first Baseline's aggregate carries no family suffix; the family is read from its set ids.
    expect(family(committed, 'baseline').aggregate?.fileName).toBe('audit-aggregate.json')
    expect(family(committed, 'fix-240').passes.map((pass) => [pass.setId, pass.state, pass.fileName])).toEqual([
      ['fix-240-1', 'complete', 'audit-fix-240-1.json'],
      ['fix-240-2', 'complete', 'audit-fix-240-2.json'],
      ['fix-240-3', 'complete', 'audit-fix-240-3.json'],
    ])
    expect(family(committed, 'fix-237').passes.map((pass) => pass.state)).toEqual(['measurement_failed', 'complete', 'complete'])
  })

  it('shows fix-240 against baseline with the numbers the two aggregate audits print', () => {
    const row = compareFamilies(family(committed, 'fix-240'), family(committed, 'baseline'))
    expect(row.reference).toBe('baseline')
    const headline = Object.fromEntries(row.headline.map((entry) => [entry.metric.id, entry]))
    expect(Object.keys(headline)).toEqual(HEADLINE_METRICS.map((metric) => metric.id))

    // Off-key rounds: 80 of 252 budgeted against 55 of 225; the delta follows the share.
    const offKey = headline.off_key!.populations.initial
    expect(offKey.subject.aggregate).toEqual({ value: 80, over: 252 })
    expect(offKey.reference?.aggregate).toEqual({ value: 55, over: 225 })
    expect(offKey.delta).toEqual({ value: 25, share: 7.3, better: false })
    expect(offKey.subject.passes.map((pass) => pass.state)).toEqual(['value', 'value', 'value'])
    expect(offKey.subject.passes.map((pass) => pass.reading?.value)).toEqual([22, 42, 16])

    // answer_omitted primary verdicts: 7 against 5 of 12 judged attempts; the delta is the count.
    const omitted = headline.answer_omitted_primary!.populations.initial
    expect(omitted.subject.aggregate).toEqual({ value: 7, over: 12 })
    expect(omitted.reference?.aggregate).toEqual({ value: 5, over: 12 })
    expect(omitted.delta).toEqual({ value: 2, share: 16.7, better: false })

    const wasted = headline.rounds_wasted_primary!.populations.initial
    expect(wasted.subject.aggregate).toEqual({ value: 5, over: 12 })
    expect(wasted.reference?.aggregate).toEqual({ value: 6, over: 12 })
    expect(wasted.delta?.better).toBe(true)

    // Failed rounds are the mechanical kind count over the budgeted rounds.
    const failed = headline.failed_rounds!.populations.initial
    expect(failed.subject.aggregate).toEqual({ value: 22, over: 252 })
    expect(failed.reference?.aggregate).toEqual({ value: 23, over: 225 })
    expect(failed.delta?.better).toBe(true)

    const atBudget = headline.attempts_at_budget!.populations.initial
    expect(atBudget.subject.aggregate).toEqual({ value: 4, over: 12 })
    expect(atBudget.reference?.aggregate).toEqual({ value: 8, over: 12 })

    // Verified and checks come from the per-attempt records the aggregate does not carry.
    const verified = headline.verified!.populations.initial
    expect(verified.subject.aggregate.over).toBe(12)
    expect(verified.reference?.aggregate).toEqual({ value: 0, over: 12 })
    const checks = headline.checks!.populations.initial
    expect(checks.subject.aggregate).toEqual({ value: 150, over: 168 })
    expect(checks.reference?.aggregate).toEqual({ value: 135, over: 168 })

    const duration = headline.median_run_duration!.populations.initial
    expect(duration.subject.aggregate.over).toBeNull()
    expect(duration.subject.aggregate.value).toBeGreaterThan(0)
    expect(duration.subject.passes).toHaveLength(3)

    // The follow-up population sits beside the initial one.
    expect(headline.off_key!.populations.followUp.subject.aggregate).toEqual({ value: 8, over: 48 })

    // Nothing differs between the two: no marker anywhere.
    expect(row.markers).toEqual({ every: [], judgement: [] })
    expect(row.headline.every((entry) => entry.markers.length === 0)).toBe(true)

    // The drill-down: one row per Hunt × step, with a cell per Pass on each side.
    const camera = row.drillDown.find((entry) => entry.huntId === 'compatibility-pi-camera' && entry.stepId === 'initial')
    expect(camera).toBeDefined()
    const cameraChecks = camera!.metrics.checks!
    expect(cameraChecks.subject.map((cell) => cell.reading?.value)).toEqual([9, 9, 9])
    expect(cameraChecks.reference).toHaveLength(3)
    expect(row.drillDown.map((entry) => entry.stepId).filter((step) => step !== 'initial').length).toBeGreaterThan(0)

    // Every counter appears in the expander, and a judgement counter says so.
    const counters = Object.fromEntries(row.counters.map((counter) => [counter.label, counter]))
    // A per-round counter carries its share's denominator, the budgeted rounds; the delta stays the raw count.
    expect(counters['Search Loop rounds']!.populations.initial).toEqual({ reference: { value: 11, over: 225 }, subject: { value: 25, over: 252 }, delta: 14 })
    expect(counters['Search Loop rounds']!.judgement).toBe(true)
    expect(counters['Rounds: Acquisition without Progress']!.populations.initial.subject).toEqual({ value: 41, over: 252 })
    expect(counters['Rounds: Finalization']!.populations.initial.subject).toEqual({ value: 21, over: 273 })
    expect(counters['Useful partial attempts']!.populations.initial.subject).toEqual({ value: 10, over: null })
    expect(counters['Help-blocked attempts']).toBeDefined()
    expect(counters['Tool rounds: navigate']!.populations.initial.subject).toEqual({ value: 103, over: 247 })
    expect(counters['Finalization cause: budget_exhausted']!.populations.initial).toEqual({ reference: { value: 8, over: null }, subject: { value: 4, over: null }, delta: -4 })
  })

  it('marks fix-239 against baseline on the judgement metrics only, baseline2 on every metric, and fix-240 on none', () => {
    const p1 = compareFamilies(family(committed, 'fix-239'), family(committed, 'baseline'))
    expect(p1.markers.every).toEqual([])
    expect(p1.markers.judgement).toEqual([{ axis: 'reviewer prompt', reference: 'audit-p2', subject: 'audit-p1' }])
    for (const entry of p1.headline) expect(entry.markers.length > 0).toBe(entry.metric.judgement)
    expect(p1.headline.filter((entry) => entry.markers.length > 0).map((entry) => entry.metric.id)).toEqual(['rounds_wasted_primary', 'answer_omitted_primary', 'off_key'])

    const subspans = compareFamilies(family(committed, 'baseline2'), family(committed, 'baseline'))
    expect(subspans.markers.every).toEqual([{ axis: 'browser sub-spans', reference: 'off', subject: 'on' }])
    expect(subspans.markers.judgement).toEqual([])
    expect(subspans.headline.every((entry) => entry.markers.length === 1)).toBe(true)
    expect(subspans.counters.every((counter) => counter.markers.length === 1)).toBe(true)

    expect(compareFamilies(family(committed, 'fix-240'), family(committed, 'baseline')).markers).toEqual({ every: [], judgement: [] })
  })

  it('shows a measurement_failed Pass as such, never as a number', () => {
    const row = compareFamilies(family(committed, 'fix-237'), family(committed, 'baseline'))
    const offKey = row.headline.find((entry) => entry.metric.id === 'off_key')!
    expect(offKey.populations.initial.subject.passes.map((pass) => pass.state)).toEqual(['measurement_failed', 'value', 'value'])
    expect(offKey.populations.initial.subject.passes[0]!.reading).toBeNull()
    // The aggregate the audit produced still counts what that Pass held.
    expect(offKey.populations.initial.subject.aggregate.over).toBeGreaterThan(0)
    const voyager = row.drillDown.find((entry) => entry.huntId === 'superseded-voyager-interstellar' && entry.stepId === 'initial')!
    expect(voyager.metrics.checks!.subject.map((cell) => cell.state)).toEqual(['measurement_failed', 'value', 'value'])
    // fix-237 was audited under audit-p1: its checks are read under the older field name, and a counter it predates is not a zero.
    expect(row.headline.find((entry) => entry.metric.id === 'checks')!.populations.initial.subject.aggregate.over).toBeGreaterThan(0)
    const source = row.counters.find((counter) => counter.label === 'Attempts with search source: rail')!
    expect(source.populations.initial).toEqual({ reference: { value: 0, over: null }, subject: { value: null, over: null }, delta: null })
    // Bundled checkpoint rounds (#254): every committed audit predates the counter, so both sides read as nothing.
    const bundled = row.counters.find((counter) => counter.label === 'Bundled checkpoint rounds')!
    expect(bundled.populations.initial.reference?.value).toBeNull()
    expect(bundled.populations.initial.subject?.value).toBeNull()
    // Same-source unsupported rounds (#257): likewise, every committed audit predates the counter.
    const sameSource = row.counters.find((counter) => counter.label === 'Same-source unsupported rounds')!
    expect(sameSource.populations.initial.reference?.value).toBeNull()
    expect(sameSource.populations.initial.subject?.value).toBeNull()
    expect(row.markers.judgement).toEqual([{ axis: 'reviewer prompt', reference: 'audit-p2', subject: 'audit-p1' }])
  })

  it('compares a Baseline with no Reference against nothing', () => {
    const row = compareFamilies(family(committed, 'baseline'), null)
    expect(row.reference).toBeNull()
    for (const entry of row.headline) {
      expect(entry.populations.initial.reference).toBeNull()
      expect(entry.populations.initial.delta).toBeNull()
    }
    expect(row.markers).toEqual({ every: [], judgement: [] })
  })
})

describe('fixtures cut from the committed audits', () => {
  const baselineFiles = ['audit-baseline-1.json', 'audit-baseline-2.json', 'audit-baseline-3.json', 'audit-aggregate.json'].map((name) =>
    file(name, JSON.parse(readFileSync(join(REPORTS_DIR, name), 'utf8'))),
  )

  it('sums a family with no aggregate audit from its Passes, and says so', () => {
    const later = cut('audit-fix-240-1.json', { setId: 'fix-900-1', createdAt: '2026-09-20T10:00:00.000Z' })
    const laterToo = cut('audit-fix-240-2.json', { setId: 'fix-900-2', createdAt: '2026-09-20T11:00:00.000Z' })
    const ledger = buildLedger([...baselineFiles, file('audit-fix-900-1.json', later), file('audit-fix-900-2.json', laterToo)])
    const subject = family(ledger, 'fix-900')
    expect(subject.aggregate).toBeNull()
    expect(subject.notes).toContain('no aggregate audit: the whole-set values are summed from the Passes')
    const row = compareFamilies(subject, defaultReferenceOf(subject, ledger))
    const offKey = row.headline.find((entry) => entry.metric.id === 'off_key')!.populations.initial
    expect(offKey.subject.aggregate).toEqual({ value: 22 + 42, over: 82 + 96 })
    expect(offKey.subject.passes.map((pass) => pass.reading?.value)).toEqual([22, 42])
  })

  it('shows a Pass the aggregate names but no per-Pass audit holds as missing', () => {
    const aggregate = JSON.parse(readFileSync(join(REPORTS_DIR, 'audit-aggregate-fix-240.json'), 'utf8')) as AuditAggregate
    const ledger = buildLedger([...baselineFiles, file('audit-aggregate-fix-240.json', aggregate), file('audit-fix-240-1.json', readAudit('audit-fix-240-1.json')), file('audit-fix-240-3.json', readAudit('audit-fix-240-3.json'))])
    const subject = family(ledger, 'fix-240')
    expect(subject.passes.map((pass) => [pass.setId, pass.state, pass.fileName])).toEqual([
      ['fix-240-1', 'complete', 'audit-fix-240-1.json'],
      ['fix-240-2', 'missing', null],
      ['fix-240-3', 'complete', 'audit-fix-240-3.json'],
    ])
    const row = compareFamilies(subject, family(ledger, 'baseline'))
    const offKey = row.headline.find((entry) => entry.metric.id === 'off_key')!.populations.initial
    expect(offKey.subject.passes.map((pass) => pass.state)).toEqual(['value', 'missing', 'value'])
    // The aggregate audit's number stands; the attempt-level metrics say what they were read from.
    expect(offKey.subject.aggregate).toEqual({ value: 80, over: 252 })
    expect(subject.notes).toContain('fix-240-2 has no per-Pass audit: verified attempts, checks and run durations are read from the Passes that have one')
  })

  it('takes the Reference the caller chose, and a Baseline’s default Reference is the Baseline before it', () => {
    const second = ['audit-baseline2-1.json', 'audit-baseline2-2.json', 'audit-baseline2-3.json', 'audit-aggregate-baseline2.json'].map((name) =>
      file(name, JSON.parse(readFileSync(join(REPORTS_DIR, name), 'utf8'))),
    )
    const fix = cut('audit-fix-240-1.json', { setId: 'fix-901-1', createdAt: '2026-09-20T10:00:00.000Z' })
    const ledger = buildLedger([...baselineFiles, ...second, file('audit-fix-901-1.json', fix)])
    expect(ledger.families.map((listed) => listed.id)).toEqual(['baseline', 'baseline2', 'fix-901'])
    expect(defaultReferenceOf(family(ledger, 'fix-901'), ledger)?.id).toBe('baseline2')
    expect(defaultReferenceOf(family(ledger, 'baseline2'), ledger)?.id).toBe('baseline')
    expect(defaultReferenceOf(family(ledger, 'baseline'), ledger)).toBeNull()

    const chosen = compareFamilies(family(ledger, 'fix-901'), family(ledger, 'baseline'))
    expect(chosen.reference).toBe('baseline')
    expect(chosen.markers.every).toEqual([])
    const against2 = compareFamilies(family(ledger, 'fix-901'), family(ledger, 'baseline2'))
    expect(against2.markers.every).toEqual([{ axis: 'browser sub-spans', reference: 'on', subject: 'off' }])
  })

  it('names the axis of every marker, and the app commit never marks', () => {
    const base = readAudit('audit-baseline-1.json').provenance
    const same = { ...base, commits: ['0000000000000000000000000000000000000000'], auditCommit: '1111111111111111111111111111111111111111' }
    expect(markersOf(base, same)).toEqual({ every: [], judgement: [] })
    expect(markersOf(base, { ...base, keyVersion: '3.0.0.0' }).every).toEqual([{ axis: 'key version', reference: '2.2.2.2', subject: '3.0.0.0' }])
    expect(markersOf(base, { ...base, gradesReviewers: ['jaish'] }).every).toEqual([{ axis: 'grades reviewers', reference: 'claude-opus-5 via live:grade', subject: 'jaish' }])
    expect(markersOf(base, { ...base, roles: ['orchestrator=GLM-5.3-flash'] }).every).toEqual([
      { axis: 'routing', reference: 'orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V', subject: 'orchestrator=GLM-5.3-flash' },
    ])
    expect(markersOf(base, { ...base, reviewerPromptVersion: 'audit-p3' })).toEqual({
      every: [],
      judgement: [{ axis: 'reviewer prompt', reference: 'audit-p2', subject: 'audit-p3' }],
    })
  })

  it('ignores a file that is not a Round Audit, and says why', () => {
    const ledger = buildLedger([...baselineFiles, file('audit-notes.json', { kind: 'something-else' }), file('audit-broken.json', 'not an object')])
    expect(ledger.families.map((listed) => listed.id)).toEqual(['baseline'])
    expect(ledger.ignored).toEqual([
      { name: 'audit-broken.json', reason: 'not a Round Audit: no kind field' },
      { name: 'audit-notes.json', reason: 'not a Round Audit: kind "something-else"' },
    ])
  })

  it('notes Passes whose conditions differ from each other', () => {
    const odd = cut('audit-baseline-2.json', { reviewerPromptVersion: 'audit-p1' })
    const ledger = buildLedger([baselineFiles[0]!, file('audit-baseline-2.json', odd), baselineFiles[2]!, baselineFiles[3]!])
    expect(family(ledger, 'baseline').notes).toContain('the Passes differ on reviewer prompt: baseline-1=audit-p2, baseline-2=audit-p1, baseline-3=audit-p2')
  })
})
