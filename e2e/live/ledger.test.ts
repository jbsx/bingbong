import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bookkeepingBeforeAnswerOf, bookkeepingBeforeAnswerOver, bookkeepingBeforeCutOf, bookkeepingBeforeCutOver, offLanguageAnswersOver, pastTheEndReadsOf, pastTheEndReadsOver, populationOf, PRE_RULE_OFF_LANGUAGE_ANSWERS, replaySearchStreaks, restateVerifiedOrUnasked, restateVerifiedOrUnaskedMarkdown, restoreSubagentVerdicts, SEARCH_STREAK_RULE, searchLoopCountsOf, unavailableLandingsOf, type AuditAggregate, type AuditAttempt, type AuditPopulation, type AuditSetOutput } from './audit.ts'
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

  it('adds the rounds the older join missed on a Subagent’s source: baseline3 reads 3 on its initials, from 0 as written (#296)', () => {
    const aggregate = readAudit('audit-aggregate-baseline3.json') as unknown as AuditAggregate
    const initials = [1, 2, 3].flatMap((pass) => readAudit(`audit-baseline3-${pass}.json`).attempts.filter((attempt) => attempt.mechanical.relation === 'initial'))
    expect(aggregate.populations.initial.sameSourceUnsupportedRounds).toBe(0)
    const LABEL = 'Same-source unsupported rounds'
    expect(countersOf(aggregate.populations.initial, initials).find((entry) => entry.label === LABEL)!.value).toBe(3)

    // An audit written before the counter is still nothing, whatever its rounds hold.
    const before = readAudit('audit-baseline2-3.json')
    expect(before.populations.initial.sameSourceUnsupportedRounds).toBeUndefined()
    expect(countersOf(before.populations.initial, before.attempts.filter((attempt) => attempt.mechanical.relation === 'initial')).find((entry) => entry.label === LABEL)!.value).toBeNull()
  })

  it('moves that counter on no other committed family, and no other counter on any', () => {
    const moved: string[] = []
    for (const listed of committed.families) {
      for (const key of ['initial', 'followUp'] as const) {
        const attempts = listed.passes.flatMap((pass) => pass.audit?.attempts ?? []).filter((attempt) => (attempt.mechanical.relation === 'initial') === (key === 'initial'))
        const population = listed.aggregate?.audit.populations[key] ?? populationOf(key, attempts)
        const restored = attempts.map((attempt) => ({ ...attempt, mechanical: { ...attempt.mechanical, rounds: restoreSubagentVerdicts(attempt.mechanical.rounds) } }))
        const asWritten = countersOf(population, restored)
        countersOf(population, attempts).forEach((counter, index) => {
          if (counter.value !== asWritten[index]!.value) moved.push(`${listed.id} ${key}: ${counter.label} ${asWritten[index]!.value} -> ${counter.value}`)
        })
      }
    }
    expect(moved).toEqual(['baseline3 initial: Same-source unsupported rounds 0 -> 3'])
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

  it('reads the rewritten navigates to a shown address (#258), and an audit that predates the counter as not recorded', () => {
    const older = readAudit('audit-fix-257-1.json')
    const shownOf = (population: AuditSetOutput['populations']['initial']) =>
      countersOf(population, older.attempts).find((counter) => counter.label === 'Rewritten navigates to a shown address')

    expect(shownOf({ ...older.populations.initial, rewrittenShownAddresses: undefined })).toEqual({ label: 'Rewritten navigates to a shown address', judgement: false, value: null, over: null })
    expect(shownOf({ ...older.populations.initial, rewrittenShownAddresses: 4 })).toEqual({ label: 'Rewritten navigates to a shown address', judgement: false, value: 4, over: null })
  })
})

describe('the streak-rule counters (#259, ADR 0058)', () => {
  it('reads the rounds at streak 2 and 3 or beyond over the budgeted rounds, and recounts an audit that predates them under the current rule', () => {
    const older = readAudit('audit-fix-257-1.json')
    const initials = older.attempts.filter((attempt) => attempt.mechanical.relation === 'initial')
    const streakOf = (population: AuditSetOutput['populations']['initial']) =>
      countersOf(population, initials).filter((counter) => counter.label.startsWith('Search rounds at streak'))
    const budgeted = older.populations.initial.budgetedRounds

    // fix-257 was audited under the same-intent rule and carries neither
    // field: the ledger recounts its rounds by the audit's own replay, so a
    // capture under the consecutive rule compares like for like with it.
    const recounted = initials.map((attempt) => searchLoopCountsOf(replaySearchStreaks(attempt.mechanical.rounds)))
    const sum = (key: 'searchRoundsAtStreak2' | 'searchRoundsAtStreak3') => recounted.reduce((total, counts) => total + counts[key], 0)
    expect(sum('searchRoundsAtStreak2')).toBeGreaterThan(0)
    expect(streakOf(older.populations.initial)).toEqual([
      { label: 'Search rounds at streak 2 or beyond', judgement: false, value: sum('searchRoundsAtStreak2'), over: budgeted },
      { label: 'Search rounds at streak 3 or beyond', judgement: false, value: sum('searchRoundsAtStreak3'), over: budgeted },
    ])
    // Read as written once the audit carries every counter the recount stands
    // in for (#262 added the last) and its attempts were counted by the
    // rail's current rule (#289).
    const underCurrentRule: AuditAttempt[] = initials.map((attempt) => ({ ...attempt, mechanical: { ...attempt.mechanical, searchStreakRule: SEARCH_STREAK_RULE } }))
    const written = { ...older.populations.initial, searchRoundsAtStreak2: 12, searchRoundsAtStreak3: 7, unavailableLandings: { status: 0, title: 0, followedBySearch: 0 } }
    expect(countersOf(written, underCurrentRule).filter((counter) => counter.label.startsWith('Search rounds at streak'))).toEqual([
      { label: 'Search rounds at streak 2 or beyond', judgement: false, value: 12, over: budgeted },
      { label: 'Search rounds at streak 3 or beyond', judgement: false, value: 7, over: budgeted },
    ])
    // The same population over attempts no rule is recorded for is recounted, whatever it wrote.
    expect(streakOf(written)).toEqual([
      { label: 'Search rounds at streak 2 or beyond', judgement: false, value: sum('searchRoundsAtStreak2'), over: budgeted },
      { label: 'Search rounds at streak 3 or beyond', judgement: false, value: sum('searchRoundsAtStreak3'), over: budgeted },
    ])
    // The counter the ledger already compared keeps its name and its reading, whichever rule wrote it.
    expect(countersOf(older.populations.initial, initials).find((counter) => counter.label === 'Search Loop rounds by the streak rule')).toEqual({
      label: 'Search Loop rounds by the streak rule',
      judgement: false,
      value: older.populations.initial.mechanicalSearchRounds,
      over: budgeted,
    })
  })
})

describe('the checkpoint hold recount (#289)', () => {
  const valueOf = (counters: ReturnType<typeof countersOf>, label: string) => counters.find((counter) => counter.label === label)?.value

  it('restates the fix-284 Reference’s initials by the rail’s current rule: 15 at streak 2 or beyond becomes 14, 16 with its checkpoints held less its rewrites (#293), and the reviewer’s 18 stay', () => {
    const aggregate = readAudit('audit-aggregate-fix-284.json') as unknown as AuditAggregate
    const initials = [1, 2, 3].flatMap((pass) => readAudit(`audit-fix-284-${pass}.json`).attempts.filter((attempt) => attempt.mechanical.relation === 'initial'))
    const population = aggregate.populations.initial
    expect(population).toMatchObject({ mechanicalSearchRounds: 24, searchLoopRounds: 18, searchRoundsAtStreak2: 15, searchRoundsAtStreak3: 5 })

    const counters = countersOf(population, initials)
    expect(valueOf(counters, 'Search rounds at streak 2 or beyond')).toBe(14)
    expect(valueOf(counters, 'Search rounds at streak 3 or beyond')).toBe(5)
    // Pass 2, the longitude watch: round 7 heads a loop the older rule ended
    // at a checkpoint. It read 26 before #293 took the rewrites out.
    expect(valueOf(counters, 'Search Loop rounds by the streak rule')).toBe(23)
    // A judgement is never recounted.
    expect(valueOf(counters, 'Search Loop rounds')).toBe(18)
  })

  it('moves nothing but the streak-rule counters on any committed family', () => {
    // #294: and the landings followed by a search, whose wait reads the same rule.
    const STREAK_RULE_LABELS = ['Search Loop rounds by the streak rule', 'Search rounds at streak 2 or beyond', 'Search rounds at streak 3 or beyond', 'Unavailable landings followed by a search']
    for (const listed of committed.families) {
      const attempts = listed.passes.flatMap((pass) => pass.audit?.attempts ?? []).filter((attempt) => attempt.mechanical.relation === 'initial')
      const population = listed.aggregate?.audit.populations.initial ?? populationOf('initial', attempts)
      // An audit that says it counted by the current rule is read as written: mark every attempt so and compare.
      const marked = attempts.map((attempt) => ({ ...attempt, mechanical: { ...attempt.mechanical, searchStreakRule: SEARCH_STREAK_RULE } }))
      const recounted = countersOf(population, attempts)
      const asWritten = countersOf(population, marked)
      const moved = recounted.filter((counter, index) => counter.value !== asWritten[index]!.value).map((counter) => counter.label)
      for (const label of moved) expect(STREAK_RULE_LABELS, `${listed.id}: ${label}`).toContain(label)
    }
  })
})

describe('the escape recount (#293)', () => {
  const valueOf = (counters: ReturnType<typeof countersOf>, label: string) => counters.find((counter) => counter.label === label)?.value
  const STREAK_2 = 'Search rounds at streak 2 or beyond'
  const STREAK_3 = 'Search rounds at streak 3 or beyond'

  it('recounts an audit written under rule 2: fix-288-290 reads 22 and 8 on disk and 17 and 7 by the rule as it is, the reviewer’s rounds as judged', () => {
    const aggregate = readAudit('audit-aggregate-fix-288-290.json') as unknown as AuditAggregate
    const initials = [1, 2, 3].flatMap((pass) => readAudit(`audit-fix-288-290-${pass}.json`).attempts.filter((attempt) => attempt.mechanical.relation === 'initial'))
    const population = aggregate.populations.initial
    // On disk as the audit wrote it, saying which rule counted it.
    expect(initials.map((attempt) => attempt.mechanical.searchStreakRule)).toEqual(initials.map(() => 2))
    expect(SEARCH_STREAK_RULE).toBe(3)
    expect(population).toMatchObject({ searchRoundsAtStreak2: 22, searchRoundsAtStreak3: 8 })

    const counters = countersOf(population, initials)
    expect(valueOf(counters, STREAK_2)).toBe(17)
    expect(valueOf(counters, STREAK_3)).toBe(7)
    expect(valueOf(counters, 'Search Loop rounds by the streak rule')).toBe(26)
    // A judgement is never recounted.
    expect(valueOf(counters, 'Search Loop rounds')).toBe(population.searchLoopRounds)

    // The same audit, had the rule as it is counted it, is read as written.
    const underCurrentRule = initials.map((attempt) => ({ ...attempt, mechanical: { ...attempt.mechanical, searchStreakRule: SEARCH_STREAK_RULE } }))
    expect(valueOf(countersOf(population, underCurrentRule), STREAK_2)).toBe(22)
    expect(valueOf(countersOf(population, underCurrentRule), STREAK_3)).toBe(8)
  })
})

describe('the Unavailable Landing recount (#262, ADR 0060)', () => {
  it('restates fix-258-259 with its Unavailable Landings held and its rewrites no search of the loop (#293): 17/23 becomes 12/23, and the landings are counted by title only, both followed by a search (#294)', () => {
    const aggregate = readAudit('audit-aggregate-fix-258-259.json') as unknown as AuditAggregate
    const initials = [1, 2, 3].flatMap((pass) => readAudit(`audit-fix-258-259-${pass}.json`).attempts.filter((attempt) => attempt.mechanical.relation === 'initial'))
    const population = aggregate.populations.initial
    expect(population).toMatchObject({ mechanicalSearchRounds: 17, searchLoopRounds: 23, searchRoundsAtStreak2: 11, searchRoundsAtStreak3: 4 })
    expect(population.unavailableLandings).toBeUndefined()

    const counters = countersOf(population, initials)
    const valueOf = (label: string) => counters.find((counter) => counter.label === label)?.value
    // Pass 2 Voyager round 21 held: round 20 heads the streak and 23 reaches
    // 2, round 22 between them being a rewrite. Before #293 it read 18, 12 and 5.
    expect(valueOf('Search Loop rounds by the streak rule')).toBe(12)
    expect(valueOf('Search Loop rounds')).toBe(23)
    expect(valueOf('Search rounds at streak 2 or beyond')).toBe(7)
    expect(valueOf('Search rounds at streak 3 or beyond')).toBe(2)
    // The status was never in a trace: a recount counts by title and says nothing of status.
    expect(valueOf('Unavailable landings by status')).toBeNull()
    expect(valueOf('Unavailable landings by title')).toBe(2)
    // Pass 3's landing has three checkpoints between it and the search: the
    // wait holds across them as the streak does (#294), where it read 1.
    expect(valueOf('Unavailable landings followed by a search')).toBe(2)

    // An audit written with the counter, its streak counted by the rail's current rule (#289), is read as written.
    const underCurrentRule = initials.map((attempt) => ({ ...attempt, mechanical: { ...attempt.mechanical, searchStreakRule: SEARCH_STREAK_RULE } }))
    const counted = countersOf({ ...population, unavailableLandings: { status: 1, title: 0, followedBySearch: 0 } }, underCurrentRule)
    expect(counted.find((counter) => counter.label === 'Search Loop rounds by the streak rule')?.value).toBe(17)
    expect(counted.find((counter) => counter.label === 'Unavailable landings by status')?.value).toBe(1)
    expect(counted.find((counter) => counter.label === 'Search rounds at streak 2 or beyond')?.value).toBe(11)
  })
})

describe('the landing wait recount (#294)', () => {
  const FOLLOWED = 'Unavailable landings followed by a search'
  const valueOf = (counters: ReturnType<typeof countersOf>, label: string) => counters.find((counter) => counter.label === label)?.value

  it('recounts followed-by-a-search from the rounds of an audit under a streak rule below 3, and reads one under the rule as written', () => {
    const aggregate = readAudit('audit-aggregate-fix-288-290.json') as unknown as AuditAggregate
    const initials = [1, 2, 3].flatMap((pass) => readAudit(`audit-fix-288-290-${pass}.json`).attempts.filter((attempt) => attempt.mechanical.relation === 'initial'))
    expect(initials.map((attempt) => attempt.mechanical.searchStreakRule)).toEqual(initials.map(() => 2))
    const fromRounds = initials.reduce((total, attempt) => total + unavailableLandingsOf(replaySearchStreaks(attempt.mechanical.rounds)).followedBySearch.length, 0)
    const landings = aggregate.populations.initial.unavailableLandings!
    // What the file says and what its rounds say agree on this capture; a
    // count the older wait wrote is stood in for by one no round gives.
    expect(landings.followedBySearch).toBe(fromRounds)
    const written = { ...aggregate.populations.initial, unavailableLandings: { ...landings, followedBySearch: fromRounds + 5 } }

    expect(valueOf(countersOf(written, initials), FOLLOWED)).toBe(fromRounds)
    // By status and by title are the audit's own: a recount has no status to count.
    expect(valueOf(countersOf(written, initials), 'Unavailable landings by status')).toBe(landings.status)
    expect(valueOf(countersOf(written, initials), 'Unavailable landings by title')).toBe(landings.title)
    const underCurrentRule = initials.map((attempt) => ({ ...attempt, mechanical: { ...attempt.mechanical, searchStreakRule: SEARCH_STREAK_RULE } }))
    expect(valueOf(countersOf(written, underCurrentRule), FOLLOWED)).toBe(fromRounds + 5)
  })

  it('recounts over the landings the audit marked where it wrote the counter, so the row’s three counts are of one set', () => {
    const audit = readAudit('audit-fix-288-290-1.json')
    const attempt = audit.attempts.find((candidate) => candidate.mechanical.relation === 'initial')!
    expect(attempt.mechanical.unavailableLandings).toBeDefined()
    // A page the title rule would mark today and the audit did not, followed by a search.
    const base = attempt.mechanical.rounds.find((round) => round.calls.length > 0)!
    const call = base.calls[0]!
    const unmarked = { ...call, name: 'navigate', ok: true, refused: false, wall: null, url: 'https://web.archive.org/web/2013/x', title: 'Internet Archive: Temporarily Offline', resultHead: 'navigated: url=https://web.archive.org/web/2013/x', search: null, notFound: undefined, unavailable: undefined, rewritten: undefined, resultPick: undefined }
    const search = { ...unmarked, url: 'https://duckduckgo.com/?q=x', title: 'x at DuckDuckGo', search: { query: 'x', streak: 1 } }
    const rounds = [{ ...base, round: 1, calls: [unmarked] }, { ...base, round: 2, calls: [search] }]
    const wrote = { ...attempt, mechanical: { ...attempt.mechanical, rounds, unavailableLandings: { status: [], title: [], followedBySearch: [] } } }
    const population = { ...populationOf('initial', [wrote]), unavailableLandings: { status: 0, title: 0, followedBySearch: 0 } }
    expect(valueOf(countersOf(population, [wrote]), FOLLOWED)).toBe(0)
    // An audit from before the counter has the title rule read its rounds.
    const before = { ...wrote, mechanical: { ...wrote.mechanical, unavailableLandings: undefined } }
    const older = { ...population, unavailableLandings: undefined }
    expect(valueOf(countersOf(older as unknown as AuditPopulation, [before as unknown as AuditAttempt]), FOLLOWED)).toBe(1)
  })
})

describe('the consent wall and Blocked Action counters (#297)', () => {
  const CONSENT_DISMISSALS = 'Consent dismissals'
  const HAND_CONSENT_CLICKS = 'Hand consent clicks'
  const BLOCKED_ACTIONS = 'Blocked Actions'
  const POST_BLOCK_VISION = 'Vision rounds after a Blocked Action'
  const LABELS = [CONSENT_DISMISSALS, HAND_CONSENT_CLICKS, BLOCKED_ACTIONS, POST_BLOCK_VISION]

  function initialsOf(id: string): { population: AuditPopulation; attempts: AuditAttempt[] } {
    const listed = family(committed, id)
    return {
      population: listed.aggregate!.audit.populations.initial,
      attempts: listed.passes.flatMap((pass) => pass.audit?.attempts ?? []).filter((attempt) => attempt.mechanical.relation === 'initial'),
    }
  }

  function valuesOf(population: AuditPopulation, attempts: readonly AuditAttempt[]): Record<string, number | null | undefined> {
    const counters = countersOf(population, attempts)
    return Object.fromEntries(LABELS.map((label) => [label, counters.find((counter) => counter.label === label)?.value]))
  }

  it('reads the four from the aggregate, the Blocked Actions of every kind as one count', () => {
    const { population, attempts } = initialsOf('fix-284')
    expect(population.blockedOrInert).toMatchObject({ covered: 3, notShown: 0, blocked: 0, postBlockVision: 1 })
    expect(valuesOf(population, attempts)).toEqual({ [CONSENT_DISMISSALS]: 6, [HAND_CONSENT_CLICKS]: 0, [BLOCKED_ACTIONS]: 3, [POST_BLOCK_VISION]: 1 })
  })

  it('sits beside the Unavailable Landing rows, mechanical and with no denominator', () => {
    const { population, attempts } = initialsOf('fix-284')
    const counters = countersOf(population, attempts)
    const labels = counters.map((counter) => counter.label)
    const after = labels.indexOf('Unavailable landings followed by a search')
    expect(labels.slice(after + 1, after + 5)).toEqual(LABELS)
    for (const label of LABELS) expect(counters.find((counter) => counter.label === label)).toMatchObject({ judgement: false, over: null })
  })

  it('reads an audit written before the counters as not recorded, never as zero', () => {
    const { population, attempts } = initialsOf('fix-258-259')
    expect(population.consentWalls).toBeUndefined()
    expect(population.blockedOrInert).toBeUndefined()
    expect(valuesOf(population, attempts)).toEqual({ [CONSENT_DISMISSALS]: null, [HAND_CONSENT_CLICKS]: null, [BLOCKED_ACTIONS]: null, [POST_BLOCK_VISION]: null })
  })

  it('reads fix-260-262, audited before #264, with its Blocked Actions counted and its post-block vision not recorded', () => {
    const { population, attempts } = initialsOf('fix-260-262')
    expect(valuesOf(population, attempts)).toEqual({ [CONSENT_DISMISSALS]: 1, [HAND_CONSENT_CLICKS]: 3, [BLOCKED_ACTIONS]: 4, [POST_BLOCK_VISION]: null })
  })

  it('never takes the zero a sum over pre-#264 attempts writes for a count of vision rounds', () => {
    // A family with no aggregate is summed from its Passes, and the sum fills every #264 field with a zero.
    const { attempts } = initialsOf('fix-260-262')
    const summed = populationOf('initial', attempts)
    expect(summed.blockedOrInert).toMatchObject({ blocked: 4, postBlockVision: 0 })
    expect(valuesOf(summed, attempts)).toMatchObject({ [BLOCKED_ACTIONS]: 4, [POST_BLOCK_VISION]: null })
  })

  it('reads a sum over attempts of both kinds as not recorded, and a population with no attempts behind it as written', () => {
    const before = initialsOf('fix-260-262').attempts
    const { population, attempts } = initialsOf('fix-284')
    const mixed = [...before, ...attempts]
    expect(valuesOf(populationOf('initial', mixed), mixed)).toMatchObject({ [BLOCKED_ACTIONS]: 7, [POST_BLOCK_VISION]: null })
    // An aggregate none of whose Passes has an audit of its own.
    expect(valuesOf(population, [])).toMatchObject({ [BLOCKED_ACTIONS]: 3, [POST_BLOCK_VISION]: 1 })
  })

  it('shows the #263 and #264 gates on the fix-263-264 row against fix-260-262', () => {
    const row = compareFamilies(family(committed, 'fix-263-264'), family(committed, 'fix-260-262'))
    const initial = (label: string) => row.counters.find((counter) => counter.label === label)!.populations.initial
    expect(initial(HAND_CONSENT_CLICKS)).toMatchObject({ reference: { value: 3 }, subject: { value: 0 }, delta: -3 })
    expect(initial(CONSENT_DISMISSALS)).toMatchObject({ reference: { value: 1 }, subject: { value: 6 }, delta: 5 })
    expect(initial(BLOCKED_ACTIONS)).toMatchObject({ reference: { value: 4 }, subject: { value: 1 }, delta: -3 })
    // No delta against a side that never counted.
    expect(initial(POST_BLOCK_VISION)).toMatchObject({ reference: { value: null }, subject: { value: 0 }, delta: null })
  })
})

describe('the committed Round Audits', () => {
  it('lists the families in capture order, Baselines by the id convention, each with its Reference', () => {
    const ids = committed.families.map((listed) => listed.id)
    // The nine AC1 names, in capture order; a later set may follow them.
    const named = ['baseline', 'fix-236', 'fix-235', 'fix-237', 'fix-239', 'fix-240', 'fix-242', 'fix-242r', 'baseline2']
    expect(ids.filter((id) => named.includes(id))).toEqual(named)
    // The Decision Model's arms pooled by --allow-differs=routing (#274) are the one
    // committed file the ledger sets aside; any other ignored file fails here (#285).
    expect(committed.ignored).toEqual([{ name: 'audit-aggregate-jev.json', reason: 'an aggregate over more than one family (jev-on, jev-off)' }])
    // Each arm reads its whole-set values from its own aggregate, as every other family does.
    expect(family(committed, 'jev-on').aggregate?.fileName).toBe('audit-aggregate-jev-on.json')
    expect(family(committed, 'jev-off').aggregate?.fileName).toBe('audit-aggregate-jev-off.json')

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
    // #294: a Subject judged under audit-p4 against a Reference not yet re-judged under it.
    expect(markersOf({ ...base, reviewerPromptVersion: 'audit-p3' }, { ...base, reviewerPromptVersion: 'audit-p4' })).toEqual({
      every: [],
      judgement: [{ axis: 'reviewer prompt', reference: 'audit-p3', subject: 'audit-p4' }],
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

describe('reads refused as past the end (#290)', () => {
  const LABEL = 'Reads refused as past the end'
  const SIX_CAPTURES = ['fix-270', 'jev-off', 'jev-on', 'fix-281', 'fix-284', 'fix-283']
  const passesOf = (family: string): AuditSetOutput[] => [1, 2, 3].map((pass) => readAudit(`audit-${family}-${pass}.json`))
  const attemptsOf = (audits: readonly AuditSetOutput[], relation: string) =>
    audits.flatMap((audit) => audit.attempts).filter((attempt) => attempt.mechanical.relation === relation)
  const countOf = (audits: readonly AuditSetOutput[], relation: string): number => pastTheEndReadsOver(attemptsOf(audits, relation))
  const committedAggregate = (): AuditAggregate => JSON.parse(readFileSync(join(REPORTS_DIR, 'audit-aggregate-fix-284.json'), 'utf8')) as AuditAggregate

  it('recounts the six captures from the result text their rounds keep: 22 on initials, 5 on follow-ups', () => {
    const audits = SIX_CAPTURES.flatMap(passesOf)

    expect(countOf(audits, 'initial')).toBe(22)
    expect(countOf(audits, 'revised_objective')).toBe(5)
    // The gate's own column: two to five per capture's twelve initials.
    expect(SIX_CAPTURES.map((family) => countOf(passesOf(family), 'initial'))).toEqual([2, 5, 5, 4, 3, 3])
  })

  it('counts a call, not a round, and only a read_page the refusal answered', () => {
    const [round] = readAudit('audit-fix-284-3.json')
      .attempts.flatMap((attempt) => attempt.mechanical.rounds)
      .filter((candidate) => pastTheEndReadsOf([candidate]).length > 0)
    const refused = round!.calls.find((call) => call.name === 'read_page')!

    expect(pastTheEndReadsOf([{ ...round!, round: 7, calls: [refused, refused] }])).toEqual([7, 7])
    expect(pastTheEndReadsOf([{ ...round!, calls: [{ ...refused, name: 'scroll' }] }])).toEqual([])
    expect(pastTheEndReadsOf([{ ...round!, calls: [{ ...refused, resultHead: 'read_page: part must be a whole number from 1' }] }])).toEqual([])
    expect(pastTheEndReadsOf([{ ...round!, calls: [{ ...refused, resultHead: null }] }])).toEqual([])
  })

  it('recounts the Reference, written before the counter, and reads an audit that carries it as written', () => {
    const initials = attemptsOf(passesOf('fix-284'), 'initial')
    const written = committedAggregate().populations.initial
    const counterOf = (population: AuditPopulation) => countersOf(population, initials).find((counter) => counter.label === LABEL)

    expect(written.pastTheEndReads).toBeUndefined()
    expect(counterOf(written)).toEqual({ label: LABEL, judgement: false, value: 3, over: written.budgetedRounds })
    expect(counterOf({ ...written, pastTheEndReads: 1 })).toEqual({ label: LABEL, judgement: false, value: 1, over: written.budgetedRounds })
  })

  it('leaves a population rebuilt from audits written before the counter as it was committed (#285)', () => {
    const committed = committedAggregate().populations.initial
    const rebuilt = populationOf('initial', attemptsOf(passesOf('fix-284'), 'initial'))

    expect('pastTheEndReads' in rebuilt).toBe(false)
    expect(JSON.stringify({ ...rebuilt, perSet: committed.perSet })).toBe(JSON.stringify(committed))
  })
})

describe('the bookkeeping rounds right before the Answer (#288, ADR 0072)', () => {
  const LABEL = 'Bookkeeping rounds right before the Answer'
  const SIX_CAPTURES = ['fix-270', 'jev-off', 'jev-on', 'fix-281', 'fix-284', 'fix-283']
  const passesOf = (family: string): AuditSetOutput[] => [1, 2, 3].map((pass) => readAudit(`audit-${family}-${pass}.json`))
  const attemptsOf = (audits: readonly AuditSetOutput[], relation: string) =>
    audits.flatMap((audit) => audit.attempts).filter((attempt) => attempt.mechanical.relation === relation)
  const countOf = (audits: readonly AuditSetOutput[], relation: string): number => bookkeepingBeforeAnswerOver(attemptsOf(audits, relation))
  const committedAggregate = (): AuditAggregate => JSON.parse(readFileSync(join(REPORTS_DIR, 'audit-aggregate-fix-284.json'), 'utf8')) as AuditAggregate

  it('recounts the six captures from their rounds and their reviews: the table the gate was set from', () => {
    const audits = SIX_CAPTURES.flatMap(passesOf)

    // 72 initial Runs and 36 follow-ups.
    expect(attemptsOf(audits, 'initial')).toHaveLength(72)
    expect(attemptsOf(audits, 'revised_objective')).toHaveLength(36)
    expect(countOf(audits, 'initial')).toBe(103)
    expect(countOf(audits, 'revised_objective')).toBe(91)
    // Per capture: 13 to 20 on its twelve initials, 13 to 18 on its six follow-ups.
    expect(SIX_CAPTURES.map((family) => countOf(passesOf(family), 'initial'))).toEqual([13, 16, 18, 19, 20, 17])
    expect(SIX_CAPTURES.map((family) => countOf(passesOf(family), 'revised_objective'))).toEqual([13, 18, 15, 15, 16, 14])
    // In 46 of the 72 initial Runs, and never a run longer than the cap of six.
    const runs = attemptsOf(audits, 'initial').map((attempt) => bookkeepingBeforeAnswerOver([attempt]))
    expect(runs.filter((run) => run > 0)).toHaveLength(46)
    expect(Math.max(...runs)).toBe(6)
  })

  it('recounts the Reference, written before the counter, and reads an audit that carries it as written', () => {
    const initials = attemptsOf(passesOf('fix-284'), 'initial')
    const written = committedAggregate().populations.initial
    const counterOf = (population: AuditPopulation) => countersOf(population, initials).find((counter) => counter.label === LABEL)

    expect(written.bookkeepingBeforeAnswer).toBeUndefined()
    expect(counterOf(written)).toEqual({ label: LABEL, judgement: true, value: 20, over: written.budgetedRounds })
    expect(counterOf({ ...written, bookkeepingBeforeAnswer: 8 })).toEqual({ label: LABEL, judgement: true, value: 8, over: written.budgetedRounds })
  })

  it('reads the Answer Checkpoints an audit counted, and nothing from one written before them', () => {
    const initials = attemptsOf(passesOf('fix-284'), 'initial')
    const written = committedAggregate().populations.initial
    const valuesOf = (population: AuditPopulation) =>
      Object.fromEntries(
        countersOf(population, initials)
          .filter((counter) => counter.label.startsWith('Answer Checkpoints'))
          .map((counter) => [counter.label, counter.value]),
      )

    expect(valuesOf(written)).toEqual({
      'Answer Checkpoints offered': null,
      'Answer Checkpoints accepted': null,
      'Answer Checkpoints dropped': null,
    })
    const counted = valuesOf({
      ...written,
      answerCheckpoints: { answers: 9, offered: 20, accepted: 17, dropped: 3, dropReasons: { excerpt_unsupported: 2, over_cap: 1 }, notRecorded: 0 },
    })
    expect(counted).toEqual({
      'Answer Checkpoints offered': 20,
      'Answer Checkpoints accepted': 17,
      'Answer Checkpoints dropped': 3,
      'Answer Checkpoints dropped: excerpt_unsupported': 2,
      'Answer Checkpoints dropped: over_cap': 1,
    })
    // A population none of whose traces could say reads as nothing, never as zero.
    expect(
      valuesOf({ ...written, answerCheckpoints: { answers: 0, offered: 0, accepted: 0, dropped: 0, dropReasons: {}, notRecorded: written.attempts } })[
        'Answer Checkpoints offered'
      ],
    ).toEqual(null)
  })

  it('leaves a population rebuilt from audits written before the counters as it was committed (#285)', () => {
    const committed = committedAggregate().populations.initial
    const rebuilt = populationOf('initial', attemptsOf(passesOf('fix-284'), 'initial'))

    expect('bookkeepingBeforeAnswer' in rebuilt).toBe(false)
    expect('answerCheckpoints' in rebuilt).toBe(false)
    expect(JSON.stringify({ ...rebuilt, perSet: committed.perSet })).toBe(JSON.stringify(committed))
  })
})

describe('the bookkeeping rounds right before the cut (#295)', () => {
  const LABEL = 'Bookkeeping rounds right before the cut'
  const FIRST = 'Bookkeeping rounds right before the Answer'
  const SIX_CAPTURES = ['fix-270', 'jev-off', 'jev-on', 'fix-281', 'fix-284', 'fix-283']
  const passesOf = (family: string): AuditSetOutput[] => [1, 2, 3].map((pass) => readAudit(`audit-${family}-${pass}.json`))
  const attemptsOf = (audits: readonly AuditSetOutput[], relation: string) =>
    audits.flatMap((audit) => audit.attempts).filter((attempt) => attempt.mechanical.relation === relation)
  const countOf = (audits: readonly AuditSetOutput[], relation: string): number => bookkeepingBeforeCutOver(attemptsOf(audits, relation))
  const aggregateOf = (family: string): AuditAggregate => JSON.parse(readFileSync(join(REPORTS_DIR, `audit-aggregate-${family}.json`), 'utf8')) as AuditAggregate
  const everyAudit = (): AuditSetOutput[] =>
    readdirSync(REPORTS_DIR)
      .filter((name) => /^audit-(?!aggregate).*\.json$/.test(name))
      .sort()
      .map((name) => readAudit(name))

  it('recounts the case the issue names: the Pi camera initial of fix-288-290 pass 2, which the first counter reads as nothing', () => {
    const attempt = readAudit('audit-fix-288-290-2.json').attempts.find((candidate) => candidate.mechanical.attemptId === 'compatibility-pi-camera--initial')!
    const judgement = attempt.review?.judgement ?? null

    expect(attempt.mechanical.terminal?.finalizationCause).toBe('deadline_reached')
    expect(attempt.mechanical.rounds.slice(-4).map((round) => `${round.round}:${round.kind}:${round.outcome}`)).toEqual([
      '20:bookkeeping:completed',
      '21:bookkeeping:completed',
      '22:failed_round:deadline',
      '23:finalization:completed',
    ])
    expect(attempt.bookkeepingBeforeAnswer).toEqual([])
    expect(bookkeepingBeforeAnswerOf(attempt.mechanical.rounds, judgement)).toEqual([])
    expect(bookkeepingBeforeCutOf(attempt.mechanical.rounds, judgement)).toEqual([20, 21])
  })

  it('recounts the six captures the gate was set from, beside a table it leaves as written', () => {
    const audits = SIX_CAPTURES.flatMap(passesOf)

    expect(SIX_CAPTURES.map((family) => countOf(passesOf(family), 'initial'))).toEqual([0, 0, 0, 8, 2, 0])
    expect(SIX_CAPTURES.map((family) => countOf(passesOf(family), 'revised_objective'))).toEqual([0, 0, 0, 0, 0, 0])
    expect(countOf(passesOf('fix-288-290'), 'initial')).toBe(2)
    expect(countOf(passesOf('fix-288-290'), 'revised_objective')).toBe(0)
    // The first counter's table: 103 over initials and 91 over follow-ups, as #288 set its gate from.
    expect(bookkeepingBeforeAnswerOver(attemptsOf(audits, 'initial'))).toBe(103)
    expect(bookkeepingBeforeAnswerOver(attemptsOf(audits, 'revised_objective'))).toBe(91)
  })

  it('counts over every committed audit no round the first counter counts', () => {
    const attempts = everyAudit().flatMap((audit) => audit.attempts)
    const both = attempts.filter((attempt) => {
      const judgement = attempt.review?.judgement ?? null
      const first = new Set(bookkeepingBeforeAnswerOf(attempt.mechanical.rounds, judgement))
      return bookkeepingBeforeCutOf(attempt.mechanical.rounds, judgement).some((round) => first.has(round))
    })

    // Whatever the directory holds: no count is pinned here, so the next capture's audits leave this as it is.
    expect(attempts.length).toBeGreaterThan(0)
    expect(both).toEqual([])
  })

  it('recounts an audit written before the counter, reads one that carries it as written, and leaves the first counter where it was', () => {
    const initials = attemptsOf(passesOf('fix-288-290'), 'initial')
    const written = aggregateOf('fix-288-290').populations.initial
    const counterOf = (population: AuditPopulation, label: string) => countersOf(population, initials).find((counter) => counter.label === label)

    expect(written.bookkeepingBeforeAnswer).toBe(16)
    expect(written.bookkeepingBeforeCut).toBeUndefined()
    expect(counterOf(written, FIRST)).toEqual({ label: FIRST, judgement: true, value: 16, over: written.budgetedRounds })
    expect(counterOf(written, LABEL)).toEqual({ label: LABEL, judgement: true, value: 2, over: written.budgetedRounds })
    expect(counterOf({ ...written, bookkeepingBeforeCut: 5 }, LABEL)).toEqual({ label: LABEL, judgement: true, value: 5, over: written.budgetedRounds })
    expect(counterOf({ ...written, bookkeepingBeforeCut: 5 }, FIRST)).toEqual({ label: FIRST, judgement: true, value: 16, over: written.budgetedRounds })
    // Right after the first in the expander's fixed order.
    const labels = countersOf(written, initials).map((counter) => counter.label)
    expect(labels[labels.indexOf(FIRST) + 1]).toBe(LABEL)
  })

  it('is no headline metric, so nothing is gated on it', () => {
    expect(HEADLINE_METRICS.map((metric) => JSON.stringify(metric)).filter((metric) => /before the cut|bookkeepingBeforeCut/i.test(metric))).toEqual([])
  })

  it('leaves a population rebuilt from audits written before the counter as it was committed (#285)', () => {
    for (const family of ['fix-284', 'fix-288-290']) {
      const committed = aggregateOf(family).populations.initial
      const rebuilt = populationOf('initial', attemptsOf(passesOf(family), 'initial'))

      expect('bookkeepingBeforeCut' in rebuilt).toBe(false)
      expect(JSON.stringify({ ...rebuilt, perSet: committed.perSet })).toBe(JSON.stringify(committed))
    }
  })
})

describe('Off-language Answers (#286, ADR 0034)', () => {
  const LABEL = 'Off-language Answers'
  const perPassAudits = (): AuditSetOutput[] =>
    readdirSync(REPORTS_DIR)
      .filter((name) => name.startsWith('audit-') && name.endsWith('.json'))
      .sort()
      .map((name) => readAudit(name))
      // A per-Pass audit holds its attempts; an aggregate holds none.
      .filter((audit) => Array.isArray(audit.attempts))
  const attemptsOf = (audits: readonly AuditSetOutput[], relation: string) =>
    audits.flatMap((audit) => audit.attempts).filter((attempt) => attempt.mechanical.relation === relation)
  const committedAggregate = (): AuditAggregate => JSON.parse(readFileSync(join(REPORTS_DIR, 'audit-aggregate-fix-283.json'), 'utf8')) as AuditAggregate

  it('recounts every committed audit, all written before the counter: one, in the initials of fix-283', () => {
    const audits = perPassAudits()

    expect(audits.every((audit) => audit.attempts.every((attempt) => attempt.mechanical.offLanguageAnswers === undefined))).toBe(true)
    expect(offLanguageAnswersOver(audits.flatMap((audit) => audit.attempts))).toBe(1)
    expect(offLanguageAnswersOver(attemptsOf(audits, 'revised_objective'))).toBe(0)
    expect(audits.filter((audit) => offLanguageAnswersOver(audit.attempts) > 0).map((audit) => audit.provenance.setId)).toEqual(['fix-283-3'])
  })

  it('names an attempt the committed audits hold, in the round its Answer was written', () => {
    for (const known of PRE_RULE_OFF_LANGUAGE_ANSWERS) {
      const held = perPassAudits()
        .flatMap((audit) => audit.attempts)
        .filter(({ mechanical }) => mechanical.captureId === known.captureId && mechanical.attemptId === known.attemptId)
      expect(held).toHaveLength(1)
      expect(held[0]!.mechanical.rounds.at(-1)).toMatchObject({ round: known.round, kind: 'finalization', calls: [] })
    }
  })

  it('recounts the Reference, written before the counter, and reads an audit that carries it as written', () => {
    const initials = attemptsOf([1, 2, 3].map((pass) => readAudit(`audit-fix-283-${pass}.json`)), 'initial')
    const written = committedAggregate().populations.initial
    const counterOf = (population: AuditPopulation) => countersOf(population, initials).find((counter) => counter.label === LABEL)

    expect(written.offLanguageAnswers).toBeUndefined()
    expect(counterOf(written)).toEqual({ label: LABEL, judgement: false, value: 1, over: null })

    // Audited again, every attempt carries its own count and the list adds nothing.
    const counting = initials.map((attempt) => ({ ...attempt, mechanical: { ...attempt.mechanical, offLanguageAnswers: 0 } }))
    const valueOf = (population: AuditPopulation, attempts: readonly AuditAttempt[]) =>
      countersOf(population, attempts).find((counter) => counter.label === LABEL)?.value
    expect(valueOf({ ...written, offLanguageAnswers: 2 }, counting)).toBe(2)
  })

  it('loses neither kind in a population holding audits from before the counter and after it', () => {
    const initials = attemptsOf([1, 2, 3].map((pass) => readAudit(`audit-fix-283-${pass}.json`)), 'initial')
    const named = (attempt: AuditAttempt): boolean => PRE_RULE_OFF_LANGUAGE_ANSWERS.some((known) => known.captureId === attempt.mechanical.captureId)
    // Every attempt but the named one audited again, one of them holding a refused Answer.
    const mixed = initials.map((attempt, index) => (named(attempt) ? attempt : { ...attempt, mechanical: { ...attempt.mechanical, offLanguageAnswers: index === 0 ? 1 : 0 } }))
    const population = populationOf('initial', mixed)

    expect(named(initials[0]!)).toBe(false)
    expect(population.offLanguageAnswers).toBe(1)
    expect(countersOf(population, mixed).find((counter) => counter.label === LABEL)?.value).toBe(2)
    expect(offLanguageAnswersOver(mixed)).toBe(2)
  })

  it('leaves a population rebuilt from audits written before the counter as it was committed (#285)', () => {
    const rebuilt = populationOf('initial', attemptsOf([1, 2, 3].map((pass) => readAudit(`audit-fix-284-${pass}.json`)), 'initial'))
    const committed = (JSON.parse(readFileSync(join(REPORTS_DIR, 'audit-aggregate-fix-284.json'), 'utf8')) as AuditAggregate).populations.initial

    expect('offLanguageAnswers' in rebuilt).toBe(false)
    expect(JSON.stringify({ ...rebuilt, perSet: committed.perSet })).toBe(JSON.stringify(committed))
  })
})

describe('verified, or failing only on unasked facts (#287)', () => {
  const ID = 'verified_or_unasked'
  const metric = HEADLINE_METRICS.find((listed) => listed.id === ID)!
  const initialOf = (id: string, reference: string | null = null) =>
    compareFamilies(family(committed, id), reference === null ? null : family(committed, reference)).headline.find((entry) => entry.metric.id === ID)!.populations.initial

  it('sits beside verified attempts in the headline, with no direction to colour a delta by', () => {
    expect(HEADLINE_METRICS.map((listed) => listed.id).slice(0, 2)).toEqual(['verified', ID])
    expect(metric).toEqual({ id: ID, label: 'Verified, or failing only on unasked facts', direction: null, judgement: false, compare: 'share', unit: 'attempts' })
    // Every other headline metric knows which way is better.
    expect(HEADLINE_METRICS.filter((listed) => listed.direction === null).map((listed) => listed.id)).toEqual([ID])
  })

  it('reads the table #287 was decided on from the committed audits, the verified count unmoved beside it', () => {
    const table = ['baseline3', 'fix-265-267', 'fix-270', 'jev-off', 'jev-on', 'fix-281', 'fix-284', 'fix-283'].map((id) => {
      const headline = compareFamilies(family(committed, id), null).headline
      const reading = (metricId: string) => headline.find((entry) => entry.metric.id === metricId)!.populations.initial.subject.aggregate
      return [id, reading('verified'), reading(ID)]
    })
    expect(table).toEqual([
      ['baseline3', { value: 3, over: 12 }, { value: 5, over: 12 }],
      ['fix-265-267', { value: 14, over: 20 }, { value: 15, over: 20 }],
      ['fix-270', { value: 9, over: 12 }, { value: 10, over: 12 }],
      ['jev-off', { value: 9, over: 12 }, { value: 9, over: 12 }],
      ['jev-on', { value: 9, over: 12 }, { value: 10, over: 12 }],
      ['fix-281', { value: 8, over: 12 }, { value: 9, over: 12 }],
      ['fix-284', { value: 8, over: 12 }, { value: 11, over: 12 }],
      ['fix-283', { value: 9, over: 12 }, { value: 10, over: 12 }],
    ])
  })

  it('gives the per-Pass values and a delta with no colour, whichever way it moved', () => {
    const up = initialOf('fix-284', 'baseline3')
    expect(up.subject.passes.map((pass) => pass.reading)).toEqual([{ value: 3, over: 4 }, { value: 4, over: 4 }, { value: 4, over: 4 }])
    expect(up.reference?.aggregate).toEqual({ value: 5, over: 12 })
    expect(up.delta).toEqual({ value: 6, share: 50, better: null })
    expect(initialOf('baseline3', 'fix-284').delta).toEqual({ value: -6, share: -50, better: null })
    // The verified count beside it keeps its colour.
    const verified = compareFamilies(family(committed, 'fix-284'), family(committed, 'baseline3')).headline.find((entry) => entry.metric.id === 'verified')!
    expect(verified.populations.initial.delta?.better).toBe(true)
  })

  it('reads a family audited before the field as not recorded, never as zero', () => {
    for (const id of ['fix-235', 'fix-236', 'fix-237', 'fix-239']) {
      const side = initialOf(id, 'baseline')
      const initials = family(committed, id)
        .passes.flatMap((pass) => pass.audit?.attempts ?? [])
        .filter((attempt) => attempt.mechanical.relation === 'initial').length
      expect(side.subject.aggregate, id).toEqual({ value: null, over: null, notRecorded: initials })
      const read = side.subject.passes.filter((pass) => pass.state === 'value')
      expect(read.length, id).toBeGreaterThan(0)
      expect(read.every((pass) => pass.reading?.value === null && (pass.reading.notRecorded ?? 0) > 0), id).toBe(true)
      expect(side.delta, id).toEqual({ value: null, share: null, better: null })
    }
  })

  it('leaves an ungraded attempt out of both sides and says how many', () => {
    const audit = readAudit('audit-fix-284-1.json')
    const ungraded: AuditSetOutput = {
      ...audit,
      attempts: audit.attempts.map((attempt, index) => (index === 0 ? { ...attempt, mechanical: { ...attempt.mechanical, grade: null } } : attempt)),
    }
    const key = ungraded.attempts[0]!.mechanical.relation === 'initial' ? 'initial' : 'followUp'
    const readingOf = (json: AuditSetOutput) =>
      compareFamilies(family(buildLedger([file('audit-fix-284-1.json', json)]), 'fix-284'), null).headline.find((entry) => entry.metric.id === ID)!.populations[key].subject.aggregate
    const written = readingOf(audit)
    const read = readingOf(ungraded)
    expect(written.notRecorded).toBeUndefined()
    expect(read.over).toBe(written.over! - 1)
    expect(read.notRecorded).toBe(1)
  })

  it('reads one attempt in the drill-down as yes or no, and an attempt not recorded as nothing', () => {
    const eurostar = (id: string) =>
      compareFamilies(family(committed, id), null).drillDown.find((entry) => entry.huntId === 'rule-eurostar-luggage' && entry.stepId === 'initial')!.metrics
    // fix-284: no Eurostar initial was verified, and all three failed only on unasked facts.
    const yes = { value: 1, over: 1 }
    const no = { value: 0, over: 1 }
    const notRecorded = { value: null, over: null, notRecorded: 1 }
    expect(eurostar('fix-284').verified!.subject.map((cell) => cell.reading)).toEqual([no, no, no])
    expect(eurostar('fix-284')[ID]!.subject.map((cell) => cell.reading)).toEqual([yes, yes, yes])
    expect(eurostar('fix-239')[ID]!.subject.map((cell) => cell.reading)).toEqual([notRecorded, notRecorded, notRecorded])
  })
})

describe('the committed aggregates and the second reading (#287)', () => {
  const sets = committedFiles()
    .map((listed) => listed.json as AuditSetOutput)
    .filter((json) => json.kind === 'bingbong.live.round-audit')
  const aggregates = readdirSync(REPORTS_DIR).filter((name) => /^audit-aggregate.*\.json$/.test(name))

  it('carry the reading the per-Pass audits give, in the JSON and in the Markdown: restating one writes what is there', () => {
    expect(aggregates.length).toBeGreaterThan(20)
    for (const name of aggregates) {
      const text = readFileSync(join(REPORTS_DIR, name), 'utf8')
      const restated = restateVerifiedOrUnasked(JSON.parse(text) as AuditAggregate, sets)
      if (!restated.ok) throw new Error(`${name}: ${restated.errors.join('; ')}`)
      expect(`${JSON.stringify(restated.value, null, 2)}\n`, name).toBe(text)
      const markdown = readFileSync(join(REPORTS_DIR, name.replace(/\.json$/, '.md')), 'utf8')
      expect(restateVerifiedOrUnaskedMarkdown(markdown, restated.value), name).toEqual({ ok: true, value: markdown })
    }
  })

  it('print it beside the populations: fix-284 at 11 of 12, a family audited before the field as not recorded', () => {
    const markdownOf = (name: string) => readFileSync(join(REPORTS_DIR, name), 'utf8')
    expect(markdownOf('audit-aggregate-fix-284.md')).toContain('| initial | 12 | 8 | 3 | 11 of 12 | 0 |')
    expect(markdownOf('audit-aggregate-fix-239.md')).toContain('| initial | 12 | not recorded | not recorded | not recorded | 12 |')
  })
})
