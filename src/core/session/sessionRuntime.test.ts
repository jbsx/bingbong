import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import type { PipelineEvent } from '../pipeline/events'
import type {
  RunId,
  SessionId,
  SessionIdentitySource,
  SubmissionId,
} from './sessionIdentity'
import { createSessionRuntime, parseSessionContinuityBudgets } from './sessionRuntime'
import type { SessionContinuityBudgets } from './sessionRuntime'

class DeterministicIdentities implements SessionIdentitySource {
  readonly minted: string[] = []
  private submission = 0
  private run = 0
  private session = 0

  mintSubmissionId(): SubmissionId {
    const id = `submission-${++this.submission}` as SubmissionId
    this.minted.push(id)
    return id
  }

  mintRunId(): RunId {
    const id = `run-${++this.run}` as RunId
    this.minted.push(id)
    return id
  }

  mintSessionId(): SessionId {
    const id = `session-${++this.session}` as SessionId
    this.minted.push(id)
    return id
  }
}

function harness(start = 1_000) {
  const clock = new FakeClock(start)
  const identities = new DeterministicIdentities()
  const runtime = createSessionRuntime({ clock, identities })
  return { clock, identities, runtime }
}

function decision(runtime: ReturnType<typeof createSessionRuntime>) {
  const state = runtime.state()
  return { sessionId: state.sessionId!, generation: state.generation }
}

const roomyMemoryBudget = { high: 1_000, reserve: 1_100, hard: 1_200 }

function budgets(
  journal: SessionContinuityBudgets['journal'],
  memory: SessionContinuityBudgets['memory'] = roomyMemoryBudget,
): Record<string, SessionContinuityBudgets> {
  return { 'test-model': { journal, memory } }
}

async function settleMaintenance(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('session runtime', () => {
  it('starts absent without minting any identity', () => {
    const { identities, runtime } = harness()

    expect(runtime.state()).toEqual({
      phase: 'absent',
      sessionId: null,
      generation: 0,
      startedAt: null,
      acceptedRunIds: [],
      liveRunIds: [],
    })
    expect(identities.minted).toEqual([])
  })

  it('creates a Submission before admission and mints Run and Session identities only on acceptance', () => {
    const { clock, identities, runtime } = harness()

    const submission = runtime.submit()
    expect(submission).toEqual({ submissionId: 'submission-1', submittedAt: 1_000 })
    expect(identities.minted).toEqual(['submission-1'])

    clock.advance(25)
    const admission = runtime.accept(submission.submissionId)

    expect(admission).toEqual({
      accepted: true,
      submissionId: 'submission-1',
      runId: 'run-1',
      sessionId: 'session-1',
      generation: 0,
      acceptedAt: 1_025,
      createsSession: true,
      journal: [],
      memory: [],
    })
    expect(identities.minted).toEqual(['submission-1', 'session-1', 'run-1'])
    expect(runtime.state()).toEqual({
      phase: 'active',
      sessionId: 'session-1',
      generation: 0,
      startedAt: 1_025,
      acceptedRunIds: ['run-1'],
      liveRunIds: ['run-1'],
    })
  })

  it('reuses the Session across accepted Runs and finishes only known live Runs', () => {
    const { runtime } = harness()
    const first = runtime.accept(runtime.submit().submissionId)
    const second = runtime.accept(runtime.submit().submissionId)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.runId).not.toBe(first.runId)
    expect(runtime.finish(first.runId)).toBe(true)
    expect(runtime.finish(first.runId)).toBe(false)
    expect(runtime.finish('run-unknown' as RunId)).toBe(false)
    expect(runtime.state().liveRunIds).toEqual([second.runId])
    expect(runtime.state().acceptedRunIds).toEqual([first.runId, second.runId])
  })

  it('makes rejection terminal and invalidates pending submissions when a Session ends', () => {
    const { runtime } = harness()
    const rejected = runtime.submit()

    expect(runtime.reject(rejected.submissionId)).toBe(true)
    expect(runtime.reject(rejected.submissionId)).toBe(false)
    expect(() => runtime.accept(rejected.submissionId)).toThrow('unknown or already admitted')

    const admitted = runtime.accept(runtime.submit().submissionId)
    const stale = runtime.submit()
    runtime.end('reset')

    expect(() => runtime.accept(stale.submissionId)).toThrow('unknown or already admitted')
    expect(runtime.state().sessionId).not.toBe(admitted.sessionId)
  })

  it('does not expose a partial Session when identity minting fails during admission', () => {
    const clock = new FakeClock(100)
    const identities = new DeterministicIdentities()
    identities.mintRunId = () => {
      throw new Error('identity source failed')
    }
    const runtime = createSessionRuntime({ clock, identities })
    const submission = runtime.submit()

    expect(() => runtime.accept(submission.submissionId)).toThrow('identity source failed')
    expect(runtime.state()).toEqual({
      phase: 'absent',
      sessionId: null,
      generation: 0,
      startedAt: null,
      acceptedRunIds: [],
      liveRunIds: [],
    })
  })

  it('exposes deterministic expiring and extension lifecycle transitions', () => {
    const { runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)

    expect(runtime.beginExpiry()).toBe(false)
    runtime.finish(admission.runId)
    expect(runtime.beginExpiry()).toBe(true)
    expect(runtime.state().phase).toBe('expiring')
    expect(runtime.beginExpiry()).toBe(false)
    expect(runtime.extend(decision(runtime))).toBe(true)
    expect(runtime.state().phase).toBe('active')
    expect(runtime.extend(decision(runtime))).toBe(false)
  })

  it('ends exactly once using the injected clock and clears Session-owned state', () => {
    const { clock, runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)

    expect(runtime.end('lapsed')).toBeNull()
    runtime.finish(admission.runId)
    expect(runtime.end('lapsed')).toBeNull()
    runtime.beginExpiry()
    clock.advance(50)

    expect(runtime.end('lapsed')).toEqual({
      sessionId: admission.sessionId,
      generation: 0,
      reason: 'lapsed',
      startedAt: 1_000,
      endedAt: 1_050,
      acceptedRunIds: [admission.runId],
      liveRunIds: [],
    })
    expect(runtime.end('lapsed')).toBeNull()
    expect(runtime.state()).toEqual({
      phase: 'absent',
      sessionId: null,
      generation: 0,
      startedAt: null,
      acceptedRunIds: [],
      liveRunIds: [],
    })
  })

  // #96: Browser State cleanup hangs off onEnded — it must fire exactly
  // once for every end reason, never twice for the same Session.
  it('fires onEnded exactly once for every Session end reason', () => {
    for (const reason of ['lapsed', 'reset', 'app_closed', 'interrupted'] as const) {
      const ended: string[] = []
      const runtime = createSessionRuntime({
        clock: new FakeClock(1_000),
        identities: new DeterministicIdentities(),
        onEnded: (session) => ended.push(`${session.sessionId}:${session.reason}`),
      })
      const admission = runtime.accept(runtime.submit().submissionId)
      // Lapse only ends an expiring Session — the other reasons end directly.
      if (reason === 'lapsed') {
        runtime.finish(admission.runId)
        runtime.beginExpiry()
      }

      runtime.end(reason)
      runtime.end(reason)
      runtime.dispose()

      expect(ended).toEqual([`session-1:${reason}`])
    }
  })

  it('advances the reset generation before accepting work into a fresh Session', () => {
    const { runtime } = harness()
    const oldRun = runtime.accept(runtime.submit().submissionId)

    const ended = runtime.end('reset')
    const replacement = runtime.accept(runtime.submit().submissionId)

    expect(ended?.generation).toBe(0)
    expect(runtime.state().generation).toBe(1)
    expect(replacement.generation).toBe(1)
    expect(replacement.sessionId).not.toBe(oldRun.sessionId)
  })

  it('returns snapshots that cannot mutate runtime state', () => {
    const { runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)
    const snapshot = runtime.state()

    ;(snapshot.acceptedRunIds as RunId[]).push('run-forged' as RunId)
    ;(snapshot.liveRunIds as RunId[]).length = 0

    expect(runtime.state().acceptedRunIds).toEqual([admission.runId])
    expect(runtime.state().liveRunIds).toEqual([admission.runId])
  })

  it('atomically exposes each committed Run Note only to later admissions', () => {
    const { runtime } = harness()
    const first = runtime.accept(runtime.submit().submissionId)

    expect(first.journal).toEqual([])
    expect(runtime.commitRunContinuity(first.runId, 'done', 'Found two viable options.', [])).toBe('committed')
    expect(first.journal).toEqual([])
    expect(runtime.commitRunContinuity(first.runId, 'done', 'duplicate', [])).toBe('rejected')
    runtime.finish(first.runId)

    const second = runtime.accept(runtime.submit().submissionId)
    expect(second.journal).toEqual([{
      runId: first.runId,
      outcome: 'done',
      text: 'Found two viable options.',
    }])
    expect(Object.isFrozen(second.journal)).toBe(true)
    expect(Object.isFrozen(second.journal[0])).toBe(true)
  })

  it('bounds the Journal oldest-first and destroys it at Session end', () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      continuityBudgets: {
        '*': {
          journal: { high: 150, reserve: 175, hard: 200 },
          memory: { high: 4_800, reserve: 5_400, hard: 6_000 },
        },
      },
    })
    const firstNote = '1'.repeat(800)
    const secondNote = 'a'.repeat(800)
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(first.runId, 'done', firstNote, [])
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(second.runId, 'done', secondNote, [])
    runtime.finish(second.runId)

    const third = runtime.accept(runtime.submit().submissionId)
    expect(third.journal.map((entry) => entry.text)).toEqual([secondNote])
    runtime.end('app_closed')

    const fresh = runtime.accept(runtime.submit().submissionId)
    expect(fresh.journal).toEqual([])
  })

  it('selects separate Journal and Working Memory token thresholds for the active model', async () => {
    const attempts: string[] = []
    let model = 'large-model'
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: () => model,
      continuityBudgets: {
        'large-model': {
          journal: { high: 100, reserve: 110, hard: 120 },
          memory: { high: 200, reserve: 210, hard: 220 },
        },
        'small-model': {
          journal: { high: 10, reserve: 20, hard: 100 },
          memory: { high: 100, reserve: 110, hard: 120 },
        },
      },
      compactContinuity: async ({ model, journal, memory }) => {
        attempts.push(`${model}:${journal.length}:${memory.length}`)
        return { journal: journal.slice(-1), memory }
      },
    })
    const run = runtime.accept(runtime.submit().submissionId)

    runtime.commitRunContinuity(run.runId, 'done', 'j'.repeat(20), [])
    runtime.finish(run.runId)
    const next = runtime.accept(runtime.submit().submissionId)
    model = 'small-model'
    runtime.commitRunContinuity(next.runId, 'done', 'j'.repeat(44), [])
    await settleMaintenance()

    expect(attempts).toEqual(['small-model:2:0'])
  })

  it('parses model-specific continuity budgets from configuration', () => {
    expect(parseSessionContinuityBudgets(JSON.stringify({
      model: {
        journal: { high: 10, reserve: 20, hard: 30 },
        memory: { high: 40, reserve: 50, hard: 60 },
      },
    }))).toEqual({
      model: {
        journal: { high: 10, reserve: 20, hard: 30 },
        memory: { high: 40, reserve: 50, hard: 60 },
      },
    })
    expect(parseSessionContinuityBudgets(undefined)).toBeUndefined()
    expect(parseSessionContinuityBudgets('[]')).toBeUndefined()
    expect(parseSessionContinuityBudgets('not json')).toBeUndefined()
  })

  it('falls back to default budgets when the model resolver fails at construction', () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: () => {
        throw new Error('resolver down')
      },
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
    })
    const run = runtime.accept(runtime.submit().submissionId)

    expect(runtime.commitRunContinuity(run.runId, 'done', 'Works on default budgets.', [])).toBe('committed')
    expect(degraded.length).toBeGreaterThanOrEqual(1)
    expect(degraded.every((reason) => reason === 'budget_profile_invalid')).toBe(true)
    runtime.finish(run.runId)
    const next = runtime.accept(runtime.submit().submissionId)
    expect(next.journal.map(({ text }) => text)).toEqual(['Works on default budgets.'])
  })

  it('compacts oldest continuity atomically while retaining protected and recent state', async () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets({ high: 15, reserve: 80, hard: 100 }),
      recentJournalEntries: 1,
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: async ({ journal, memory }) => ({ journal: journal.slice(-1), memory }),
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(first.runId, 'done', 'old chronology'.repeat(2), [{
      op: 'add',
      entry: { kind: 'objective', subject: 'Goal', detail: 'Keep this objective.' },
    }])
    runtime.finish(first.runId)

    const second = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(second.runId, 'done', 'recent work'.repeat(4), [])
    await settleMaintenance()
    runtime.finish(second.runId)
    const third = runtime.accept(runtime.submit().submissionId)

    expect(third.journal.map(({ text }) => text)).toEqual(['recent work'.repeat(4)])
    expect(third.memory.map(({ kind, subject }) => ({ kind, subject }))).toEqual([{ kind: 'objective', subject: 'Goal' }])
    expect(degraded).toEqual([])
  })

  it('rolls back invalid compaction and does not retry while continuity remains above high water', async () => {
    const degraded: string[] = []
    let attempts = 0
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets({ high: 10, reserve: 80, hard: 100 }),
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: async () => {
        attempts += 1
        return { journal: [], memory: [] }
      },
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(first.runId, 'failed', 'Known failed approach remains relevant.', [])
    await settleMaintenance()
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(second.runId, 'done', 'More work above high water.', [])
    await settleMaintenance()

    expect(attempts).toBe(1)
    expect(degraded).toEqual(['compaction_invalid'])
    runtime.finish(second.runId)
    const third = runtime.accept(runtime.submit().submissionId)
    expect(third.journal.map(({ text }) => text)).toEqual([
      'Known failed approach remains relevant.',
      'More work above high water.',
    ])
  })

  it('rejects compaction that rewrites Journal chronology out of order', async () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets({ high: 15, reserve: 80, hard: 100 }),
      recentJournalEntries: 0,
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: async ({ journal, memory }) => ({
        journal: [...journal].reverse().map((entry, index) => ({ ...entry, text: `summary-${index}` })),
        memory,
      }),
    })
    for (const text of ['first chronology first chronology', 'second chronology second', 'third chronology third']) {
      const run = runtime.accept(runtime.submit().submissionId)
      runtime.commitRunContinuity(run.runId, 'done', text, [])
      runtime.finish(run.runId)
    }
    await settleMaintenance()

    expect(degraded).toEqual(['compaction_invalid'])
    const next = runtime.accept(runtime.submit().submissionId)
    expect(next.journal).toHaveLength(3)
  })

  it('rejects compaction that reattributes references or provenance', async () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets(
        { high: 1_000, reserve: 1_100, hard: 1_200 },
        { high: 220, reserve: 300, hard: 400 },
      ),
      recentMemoryEntries: 0,
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: async ({ journal, memory }) => ({
        journal,
        memory: [
          { ...memory[0]!, detail: 'Short A.', references: memory[1]!.references },
          { ...memory[1]!, detail: 'Short B.', references: memory[0]!.references },
        ],
      }),
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(run.runId, 'done', 'Found two candidates.', [
      ...([['Candidate A', 'https://example.com/a'], ['Candidate B', 'https://example.com/b']] as const).map(([subject, url]) => ({
        op: 'add' as const,
        entry: {
          kind: 'finding' as const,
          subject,
          detail: subject.repeat(25),
          references: [{ url }],
        },
      })),
    ])
    runtime.finish(run.runId)
    await settleMaintenance()

    expect(degraded).toEqual(['compaction_invalid'])
    const next = runtime.accept(runtime.submit().submissionId)
    expect(next.memory.map(({ detail }) => detail)).toEqual([
      'Candidate A'.repeat(25),
      'Candidate B'.repeat(25),
    ])
  })

  it('times out compaction without failing a Run or retrying immediately', async () => {
    const clock = new FakeClock()
    const degraded: string[] = []
    let attempts = 0
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets({ high: 10, reserve: 80, hard: 100 }),
      compactionTimeoutMs: 25,
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: () => {
        attempts += 1
        return new Promise(() => {})
      },
    })
    const first = runtime.accept(runtime.submit().submissionId)

    expect(runtime.commitRunContinuity(first.runId, 'done', 'Pressure without user-visible failure continues.', [])).toBe('committed')
    clock.advance(25)
    await settleMaintenance()
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(second.runId, 'done', 'Still pressured.', [])
    await settleMaintenance()

    expect(attempts).toBe(1)
    expect(degraded).toEqual(['compaction_timeout'])
  })

  it('rejects duplicate and explicitly low-priority additions first at reserve pressure', async () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets(
        { high: 1_000, reserve: 1_100, hard: 1_200 },
        { high: 10, reserve: 20, hard: 200 },
      ),
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: () => new Promise(() => {}),
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(first.runId, 'done', 'Established goal.', [{
      op: 'add',
      entry: { kind: 'objective', subject: 'Goal', detail: 'x'.repeat(120) },
    }])
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)

    expect(runtime.commitRunContinuity(second.runId, 'done', 'Pressure filtered additions.', [
      { op: 'add', entry: { kind: 'objective', subject: 'Goal', detail: 'Duplicate goal.' } },
      {
        op: 'add',
        entry: {
          kind: 'finding',
          subject: 'Weak lead',
          detail: 'Not worth retaining.',
          status: 'low_priority',
          references: [{ url: 'https://example.com/weak' }],
        },
      },
    ])).toBe('committed')
    expect(degraded).toEqual(['reserve_addition_rejected'])
    runtime.finish(second.runId)
    const third = runtime.accept(runtime.submit().submissionId)
    expect(third.memory.map(({ subject }) => subject)).toEqual(['Goal'])
  })

  it('filters duplicate and low-priority additions when their patch crosses reserve', () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets(
        { high: 1_000, reserve: 1_100, hard: 1_200 },
        { high: 60, reserve: 100, hard: 500 },
      ),
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: () => new Promise(() => {}),
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(first.runId, 'done', 'Established goal.', [{
      op: 'add',
      entry: { kind: 'objective', subject: 'Goal', detail: 'Keep it.' },
    }])
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)

    expect(runtime.commitRunContinuity(second.runId, 'done', 'Filtered crossing patch.', [
      { op: 'add', entry: { kind: 'objective', subject: 'Goal', detail: 'Duplicate.' } },
      {
        op: 'add',
        entry: {
          kind: 'finding',
          subject: 'Weak lead',
          detail: 'x'.repeat(800),
          status: 'low_priority',
          references: [{ url: 'https://example.com/weak' }],
        },
      },
      { op: 'add', entry: { kind: 'artifact', subject: 'Keep', detail: 'Retain this useful artifact.' } },
    ])).toBe('committed')
    expect(degraded).toEqual(['reserve_addition_rejected'])
    runtime.finish(second.runId)
    const next = runtime.accept(runtime.submit().submissionId)
    expect(next.memory.map(({ subject }) => subject)).toEqual(['Goal', 'Keep'])
  })

  it('omits oldest Journal chronology at hard pressure before current Working Memory', () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets(
        { high: 10, reserve: 15, hard: 20 },
        { high: 100, reserve: 110, hard: 120 },
      ),
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: () => new Promise(() => {}),
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(first.runId, 'done', 'oldest chronology'.repeat(3), [{
      op: 'add',
      entry: { kind: 'decision', subject: 'Chosen route', detail: 'Keep the current decision.' },
    }])
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(second.runId, 'done', 'newest chronology'.repeat(3), [])
    runtime.finish(second.runId)

    const third = runtime.accept(runtime.submit().submissionId)
    expect(third.journal.map(({ text }) => text)).toEqual(['newest chronology'.repeat(3)])
    expect(third.memory.map(({ subject }) => subject)).toEqual(['Chosen route'])
    expect(degraded).toContain('hard_journal_omission')
  })

  it('attempts high-water compaction before hard Journal omission', async () => {
    const degraded: string[] = []
    let attempts = 0
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets({ high: 10, reserve: 15, hard: 20 }),
      recentJournalEntries: 0,
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: async ({ journal, memory }) => {
        attempts += 1
        return { journal: [{ ...journal[0]!, text: 'milestone' }], memory }
      },
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(first.runId, 'done', 'a'.repeat(40), [])
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(second.runId, 'done', 'b'.repeat(44), [])
    await settleMaintenance()

    expect(attempts).toBe(1)
    expect(degraded).toContain('hard_journal_omission')
    runtime.finish(second.runId)
    const next = runtime.accept(runtime.submit().submissionId)
    expect(next.journal.map(({ text }) => text)).toEqual(['milestone'])
  })

  it('omits a single oversized Journal note at the hard boundary', () => {
    const degraded: string[] = []
    const runtime = createSessionRuntime({
      clock: new FakeClock(),
      identities: new DeterministicIdentities(),
      continuityModel: 'test-model',
      continuityBudgets: budgets({ high: 10, reserve: 15, hard: 20 }),
      onContinuityDegraded: ({ reason }) => degraded.push(reason),
      compactContinuity: () => new Promise(() => {}),
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.commitRunContinuity(run.runId, 'done', 'x'.repeat(84), [])
    runtime.finish(run.runId)

    const next = runtime.accept(runtime.submit().submissionId)
    expect(next.journal).toEqual([])
    expect(degraded).toContain('hard_journal_omission')
  })

  it('commits the Run Note and Working Memory atomically for only later admissions', () => {
    const { runtime } = harness()
    const first = runtime.accept(runtime.submit().submissionId)
    const patch = [{
      op: 'add' as const,
      entry: {
        kind: 'finding' as const,
        subject: 'Candidate A',
        detail: 'Candidate A is viable.',
        references: [{ url: 'https://example.com/a' }],
        subagentId: 'agent-1',
      },
    }]

    expect(runtime.commitRunContinuity(first.runId, 'done', 'Found candidate A.', patch)).toBe('committed')
    expect(first.memory).toEqual([])
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)

    expect(second.memory).toEqual([{
      id: 'memory-1',
      sessionId: first.sessionId,
      kind: 'finding',
      subject: 'Candidate A',
      detail: 'Candidate A is viable.',
      references: [{ url: 'https://example.com/a' }],
      provenance: [{ runId: first.runId, subagentId: 'agent-1' }],
    }])
    expect(Object.isFrozen(second.memory)).toBe(true)
    expect(Object.isFrozen(second.memory[0]?.references)).toBe(true)
    expect(Object.isFrozen(second.memory[0]?.provenance[0])).toBe(true)
  })

  it('rejects an entire continuity commit when a memory mutation is invalid and destroys memory at Session end', () => {
    const { runtime } = harness()
    const first = runtime.accept(runtime.submit().submissionId)

    expect(runtime.commitRunContinuity(first.runId, 'done', 'Should not commit.', [{
      op: 'update',
      id: 'memory-missing' as never,
      entry: { kind: 'decision', subject: 'Choice', detail: 'Choose A.' },
    }])).toBe('invalid_patch')
    expect(runtime.commitRunContinuity(first.runId, 'done', 'Fallback note.', [])).toBe('committed')
    runtime.finish(first.runId)
    const second = runtime.accept(runtime.submit().submissionId)
    expect(second.journal.map((entry) => entry.text)).toEqual(['Fallback note.'])
    expect(second.memory).toEqual([])

    runtime.finish(second.runId)
    runtime.end('app_closed')
    const fresh = runtime.accept(runtime.submit().submissionId)
    expect(fresh.memory).toEqual([])
  })

  it('warns once before the original deadline and lapses exactly once while idle', () => {
    const clock = new FakeClock(1_000)
    const ended: string[] = []
    const expiring: string[] = []
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      sessionWindowMs: 100,
      warningLeadMs: 20,
      onExpiring: (session) => expiring.push(`${session.sessionId}:${session.expiresAt}:${session.at}`),
      onEnded: (session) => ended.push(`${session.sessionId}:${session.reason}:${session.endedAt}`),
    })
    const first = runtime.accept(runtime.submit().submissionId)

    clock.advance(500)
    expect(runtime.state().phase).toBe('active')
    runtime.finish(first.runId)
    clock.advance(79)
    expect(runtime.state().phase).toBe('active')
    clock.advance(1)

    expect(runtime.state().phase).toBe('expiring')
    expect(expiring).toEqual(['session-1:1600:1580'])
    clock.advance(19)
    expect(runtime.state().phase).toBe('expiring')
    expect(ended).toEqual([])
    clock.advance(1)

    expect(runtime.state().phase).toBe('absent')
    expect(ended).toEqual(['session-1:lapsed:1600'])
    clock.advance(1_000)
    expect(ended).toHaveLength(1)
  })

  it('suspends an armed expiry when another Run is accepted', () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      sessionWindowMs: 100,
      warningLeadMs: 20,
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.finish(first.runId)
    clock.advance(90)
    const second = runtime.accept(runtime.submit().submissionId)

    clock.advance(100)
    expect(runtime.state().sessionId).toBe(first.sessionId)
    expect(runtime.state().liveRunIds).toEqual([second.runId])
    runtime.finish(second.runId)
    clock.advance(80)
    expect(runtime.state().phase).toBe('expiring')
    clock.advance(20)
    expect(runtime.state().phase).toBe('absent')
  })

  it('restarts the full window on explicit extension and allows repeated extensions', () => {
    const clock = new FakeClock(1_000)
    const warnings: number[] = []
    const extensions: number[] = []
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      sessionWindowMs: 100,
      warningLeadMs: 20,
      onExpiring: ({ expiresAt }) => warnings.push(expiresAt),
      onExtended: ({ expiresAt }) => extensions.push(expiresAt),
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.finish(run.runId)

    clock.advance(80)
    expect(runtime.extend(decision(runtime))).toBe(true)
    expect(extensions).toEqual([1_180])
    clock.advance(80)
    expect(warnings).toEqual([1_100, 1_180])
    expect(runtime.extend(decision(runtime))).toBe(true)
    expect(extensions).toEqual([1_180, 1_260])
    clock.advance(79)
    expect(runtime.state().phase).toBe('active')
    clock.advance(1)
    expect(warnings).toEqual([1_100, 1_180, 1_260])
  })

  it('declines immediately and silence preserves the original deadline', () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      sessionWindowMs: 100,
      warningLeadMs: 20,
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.finish(run.runId)
    clock.advance(80)

    expect(runtime.decline(decision(runtime))?.endedAt).toBe(1_080)
    expect(runtime.state().phase).toBe('absent')

    const next = runtime.accept(runtime.submit().submissionId)
    runtime.finish(next.runId)
    clock.advance(80)
    clock.advance(20)
    expect(runtime.state().phase).toBe('absent')
  })

  it('accepted work during the warning cancels the old deadline and anchors a full window at finish', () => {
    const clock = new FakeClock(1_000)
    const warnings: number[] = []
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      sessionWindowMs: 100,
      warningLeadMs: 20,
      onExpiring: ({ expiresAt }) => warnings.push(expiresAt),
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.finish(first.runId)
    clock.advance(80)

    const rejected = runtime.submit()
    runtime.reject(rejected.submissionId)
    clock.advance(10)
    const second = runtime.accept(runtime.submit().submissionId)
    clock.advance(100)
    expect(runtime.state().liveRunIds).toEqual([second.runId])

    runtime.finish(second.runId)
    clock.advance(79)
    expect(runtime.state().phase).toBe('active')
    clock.advance(1)
    expect(runtime.state().phase).toBe('expiring')
    expect(warnings).toEqual([1_100, 1_290])
  })

  it('rejects invalid timed-window configuration', () => {
    const clock = new FakeClock()
    const identities = new DeterministicIdentities()

    expect(() => createSessionRuntime({ clock, identities, sessionWindowMs: 100 })).toThrow('warningLeadMs')
    expect(() => createSessionRuntime({ clock, identities, sessionWindowMs: 100, warningLeadMs: 100 })).toThrow(
      'shorter',
    )
  })

  it('rejects stale or foreign expiry decisions inside the runtime', () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      sessionWindowMs: 100,
      warningLeadMs: 20,
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.finish(run.runId)
    clock.advance(80)

    expect(runtime.extend({ sessionId: 'session-foreign' as SessionId, generation: 0 })).toBe(false)
    expect(runtime.decline({ sessionId: run.sessionId, generation: 1 })).toBeNull()
    expect(runtime.state().phase).toBe('expiring')
  })

  it('stamps Session ownership alongside turn correlation without replacing it', () => {
    const { runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)
    const event: PipelineEvent = {
      type: 'command',
      turnId: 'turn-1',
      text: 'hello',
      at: admission.acceptedAt,
      submissionId: admission.submissionId,
      runId: admission.runId,
      sessionId: admission.sessionId,
      sessionGeneration: admission.generation,
    }

    expect(event.turnId).toBe('turn-1')
    expect(event.runId).toBe(admission.runId)
  })
})
