import { describe, expect, it } from 'vitest'
import { digestOf } from './artifacts.ts'
import {
  answerBindingOf,
  initializeLiveGrades,
  keyManifestDigest,
  parseLiveGrades,
  parseLiveKeyManifest,
  type LiveGradeEntry,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyManifest,
  LIVE_GRADES_KIND,
  LIVE_GRADING_SCHEMA_VERSION,
  LIVE_KEY_MANIFEST_KIND,
} from './grades.ts'
import { attemptCapture, captureSet, notReached, sessionCapture, slotOf } from './gradingFixtures.ts'
import type { LiveAttemptCapture } from './types.ts'

// The grading records bind a reviewer's judgment to one immutable capture
// (#226). What is under test here is the binding and the completeness of
// the record — never whether the reviewer was right, which no code can
// check. The facts are invented on purpose: a suite that baked in the
// pilot's real key would be asserting the oracle, not the workflow.

function manifest(overrides: Partial<LiveKeyManifest> = {}): LiveKeyManifest {
  return {
    kind: LIVE_KEY_MANIFEST_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    keyVersion: 'k1',
    keyDigest: digestOf('the private key document, v1'),
    preparedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        huntId: 'hunt-a',
        stepId: 'initial',
        promptVersion: 'p1',
        keyRef: 'private/keys.md#hunt-a',
        checks: [
          { checkId: 'c1', description: 'names the invented widget code' },
          { checkId: 'c2', description: 'rejects the superseded fixture cable' },
        ],
        referenceSources: ['https://example.invalid/spec'],
      },
    ],
    ...overrides,
  }
}

function inputsFor(attempt: LiveAttemptCapture, extra: Partial<LiveGradingInputs> = {}): LiveGradingInputs {
  const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
  return {
    set: captureSet({ slots: [slotOf(attempt)], sessions: [session] }),
    sessions: [session],
    manifest: manifest(),
    ...extra,
  }
}

/** A fully reviewed passing entry over the given attempt. */
function passEntry(attempt: LiveAttemptCapture, overrides: Partial<LiveGradeEntry> = {}): LiveGradeEntry {
  return {
    attemptId: attempt.attemptId,
    huntId: attempt.huntId,
    stepId: attempt.stepId,
    captureId: 'capture-hunt-a',
    answer: answerBindingOf(attempt),
    keyVersion: 'k1',
    keyDigest: digestOf('the private key document, v1'),
    status: 'pass',
    checks: [
      { checkId: 'c1', satisfied: true },
      { checkId: 'c2', satisfied: true },
    ],
    support: [{ claim: 'the invented widget code', sourceUrl: 'https://example.invalid/spec', passageRef: 'S1' }],
    rationale: 'both required checks are met by the cited passages',
    reviewer: 'evaluator-1',
    reviewedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function gradesOf(entries: readonly LiveGradeEntry[], overrides: Partial<LiveGrades> = {}): LiveGrades {
  return {
    kind: LIVE_GRADES_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    setId: 'set-1',
    keyVersion: 'k1',
    keyManifestDigest: keyManifestDigest(manifest()),
    revision: 1,
    entries,
    ...overrides,
  }
}

function errorsOf(result: ReturnType<typeof parseLiveGrades>): readonly string[] {
  return result.ok ? [] : result.errors
}

describe('parseLiveKeyManifest', () => {
  it('accepts a manifest and refuses a foreign kind or version', () => {
    expect(parseLiveKeyManifest(manifest()).ok).toBe(true)
    expect(parseLiveKeyManifest({ ...manifest(), kind: 'bingbong.live.capture-set' }).ok).toBe(false)
    expect(parseLiveKeyManifest({ ...manifest(), schemaVersion: 2 }).ok).toBe(false)
  })

  it('refuses two tasks for one hunt step, and a task with duplicate check ids', () => {
    const twice = parseLiveKeyManifest({ ...manifest(), tasks: [manifest().tasks[0], manifest().tasks[0]] })
    expect(twice.ok).toBe(false)
    expect(twice.ok ? [] : twice.errors.join(' ')).toContain('hunt-a/initial')

    const duplicated = parseLiveKeyManifest({
      ...manifest(),
      tasks: [{ ...manifest().tasks[0]!, checks: [{ checkId: 'c1', description: 'one' }, { checkId: 'c1', description: 'again' }] }],
    })
    expect(duplicated.ok).toBe(false)
    expect(duplicated.ok ? [] : duplicated.errors.join(' ')).toContain('c1')
  })

  it('refuses a task with no required check — a key that asks nothing cannot be failed', () => {
    expect(parseLiveKeyManifest({ ...manifest(), tasks: [{ ...manifest().tasks[0]!, checks: [] }] }).ok).toBe(false)
  })
})

describe('initializeLiveGrades', () => {
  it('creates one pending entry per scheduled slot and never reads success from the capture', () => {
    // The Run says it finished and proposes `completed` — the strongest
    // self-declaration the app can make. Initialization must still be pending.
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      terminal: { at: 40_000, outcome: 'done', resolution: 'completed', finalizationCause: 'objective_met' },
    })
    const grades = initializeLiveGrades(inputsFor(attempt))

    expect(grades.entries).toHaveLength(1)
    const entry = grades.entries[0]!
    expect(entry.status).toBe('pending')
    expect(entry.reviewedAt).toBeNull()
    expect(entry.reviewer).toBe('')
    expect(entry.checks).toEqual([])
    expect(entry.captureId).toBe('capture-hunt-a')
    // The binding is recorded so a later review cannot silently name another Answer.
    expect(entry.answer).toEqual(answerBindingOf(attempt))
  })

  it('creates pending entries for not-reached and unaccounted slots too, with no invented capture', () => {
    const initial = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const skipped = notReached({ attemptId: 'a2', huntId: 'hunt-a', parentAttemptId: 'a1' })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [initial, skipped], setId: 'set-1' })
    const missingSlot = { ...slotOf(skipped), attemptId: 'a3', order: 2 }
    const grades = initializeLiveGrades({
      set: captureSet({ slots: [slotOf(initial), slotOf(skipped), missingSlot], sessions: [session] }),
      sessions: [session],
      manifest: manifest(),
    })

    expect(grades.entries.map((entry) => entry.attemptId)).toEqual(['a1', 'a2', 'a3'])
    expect(grades.entries.every((entry) => entry.status === 'pending')).toBe(true)
    // Neither a skipped nor an unscheduled-but-planned slot gets a capture id or an Answer.
    expect(grades.entries[1]!.captureId).toBeNull()
    expect(grades.entries[1]!.answer).toBeNull()
    expect(grades.entries[2]!.captureId).toBeNull()
  })

  it('records no Answer binding when the Run published none', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: null })
    expect(answerBindingOf(attempt)).toBeNull()
    expect(initializeLiveGrades(inputsFor(attempt)).entries[0]!.answer).toBeNull()
  })
})

describe('parseLiveGrades', () => {
  const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
  const inputs = inputsFor(attempt)

  it('accepts a complete passing review', () => {
    expect(parseLiveGrades(gradesOf([passEntry(attempt)]), inputs).ok).toBe(true)
  })

  it('refuses grades bound to another capture set or another key manifest', () => {
    expect(errorsOf(parseLiveGrades(gradesOf([passEntry(attempt)], { setId: 'set-other' }), inputs)).join(' ')).toContain('set-other')
    expect(
      errorsOf(parseLiveGrades(gradesOf([passEntry(attempt)], { keyManifestDigest: digestOf('another manifest') }), inputs)).join(' '),
    ).toContain('key manifest')
  })

  it('refuses an entry for a slot the set never scheduled, and a duplicated slot', () => {
    const unknown = parseLiveGrades(gradesOf([passEntry(attempt), passEntry(attempt, { attemptId: 'ghost' })]), inputs)
    expect(errorsOf(unknown).join(' ')).toContain('ghost')

    const duplicated = parseLiveGrades(gradesOf([passEntry(attempt), passEntry(attempt)]), inputs)
    expect(errorsOf(duplicated).join(' ')).toContain('twice')
  })

  it('refuses a reviewed entry that leaves a required check unjudged or judges one twice', () => {
    const missing = parseLiveGrades(gradesOf([passEntry(attempt, { checks: [{ checkId: 'c1', satisfied: true }] })]), inputs)
    expect(errorsOf(missing).join(' ')).toContain('c2')

    const twice = parseLiveGrades(
      gradesOf([
        passEntry(attempt, {
          checks: [
            { checkId: 'c1', satisfied: true },
            { checkId: 'c1', satisfied: true },
            { checkId: 'c2', satisfied: true },
          ],
        }),
      ]),
      inputs,
    )
    expect(errorsOf(twice).join(' ')).toContain('c1')

    const unknownCheck = parseLiveGrades(
      gradesOf([passEntry(attempt, { checks: [{ checkId: 'c1', satisfied: true }, { checkId: 'c9', satisfied: true }] })]),
      inputs,
    )
    expect(errorsOf(unknownCheck).join(' ')).toContain('c9')
  })

  it('refuses a pass that is not structurally supported', () => {
    expect(errorsOf(parseLiveGrades(gradesOf([passEntry(attempt, { support: [] })]), inputs)).join(' ')).toContain('support')
    expect(errorsOf(parseLiveGrades(gradesOf([passEntry(attempt, { reviewer: '' })]), inputs)).join(' ')).toContain('reviewer')
    expect(errorsOf(parseLiveGrades(gradesOf([passEntry(attempt, { reviewedAt: null })]), inputs)).join(' ')).toContain('reviewer')
    expect(
      errorsOf(parseLiveGrades(gradesOf([passEntry(attempt, { checks: [{ checkId: 'c1', satisfied: true }, { checkId: 'c2', satisfied: false }] })]), inputs)).join(' '),
    ).toContain('c2')
  })

  it('refuses a pass whose Answer binding is not the Answer the capture recorded', () => {
    const forged = passEntry(attempt, { answer: { at: 1, digest: digestOf('an Answer nobody observed') } })
    expect(errorsOf(parseLiveGrades(gradesOf([forged]), inputs)).join(' ')).toContain('Answer')
  })

  it('refuses a pass over an attempt that published no Answer at all', () => {
    const answerless = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: null })
    const result = parseLiveGrades(gradesOf([passEntry(answerless, { answer: null })]), inputsFor(answerless))
    expect(errorsOf(result).join(' ')).toContain('no final Answer')
  })

  it('keeps the non-pass classifications distinct and does not require them to be supported', () => {
    for (const status of ['useful_partial', 'help_access_blocked', 'unsuccessful'] as const) {
      const entry = passEntry(attempt, {
        status,
        checks: [
          { checkId: 'c1', satisfied: true },
          { checkId: 'c2', satisfied: false, note: 'the superseded cable was never rejected' },
        ],
        support: [],
      })
      const result = parseLiveGrades(gradesOf([entry]), inputs)
      expect(result.ok, `${status}: ${errorsOf(result).join(' ')}`).toBe(true)
      expect(result.ok && result.value.entries[0]!.status).toBe(status)
    }
  })

  it('accepts a pending entry that carries no review at all', () => {
    const pending = initializeLiveGrades(inputs)
    expect(parseLiveGrades(pending, inputs).ok).toBe(true)
  })

  it('accepts a claim supported by an equivalent source the key never listed', () => {
    // The key cites example.invalid/spec; the assistant found the same fact
    // on a mirror. An alternative URL is neither automatically wrong nor
    // automatically proof — the reviewer says which, and the record keeps it.
    const equivalent = passEntry(attempt, {
      support: [
        {
          claim: 'the invented widget code',
          sourceUrl: 'https://mirror.invalid/spec-copy',
          passageRef: 'M1',
          equivalentTo: 'https://example.invalid/spec',
        },
      ],
    })
    expect(parseLiveGrades(gradesOf([equivalent]), inputs).ok).toBe(true)
  })
})

describe('changed sources and key revisions', () => {
  const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })

  it('refuses a grade bound to a key version the manifest has moved past, undocumented', () => {
    const inputs = inputsFor(attempt, { manifest: manifest({ keyVersion: 'k2', keyDigest: digestOf('the private key document, v2') }) })
    const stale = gradesOf([passEntry(attempt)], { keyVersion: 'k2', keyManifestDigest: keyManifestDigest(inputs.manifest) })
    expect(errorsOf(parseLiveGrades(stale, inputs)).join(' ')).toContain('k1')
  })

  it('accepts a stale binding a documented recheck found unchanged', () => {
    const inputs = inputsFor(attempt, { manifest: manifest({ keyVersion: 'k2', keyDigest: digestOf('the private key document, v2') }) })
    const rechecked = gradesOf(
      [
        passEntry(attempt, {
          recheck: {
            priorKeyVersion: 'k1',
            newKeyVersion: 'k2',
            recheckedAt: '2026-01-03T00:00:00.000Z',
            evidence: 'both cited passages still read as they did',
            conclusion: 'unchanged',
          },
        }),
      ],
      { keyVersion: 'k2', keyManifestDigest: keyManifestDigest(inputs.manifest) },
    )
    const result = parseLiveGrades(rechecked, inputs)
    expect(result.ok, errorsOf(result).join(' ')).toBe(true)
  })

  it('refuses to let a revised key stand on the old review — the answer is re-review, not a rewrite', () => {
    const inputs = inputsFor(attempt, { manifest: manifest({ keyVersion: 'k2', keyDigest: digestOf('the private key document, v2') }) })
    const revised = gradesOf(
      [
        passEntry(attempt, {
          recheck: {
            priorKeyVersion: 'k1',
            newKeyVersion: 'k2',
            recheckedAt: '2026-01-03T00:00:00.000Z',
            evidence: 'the source now states a different figure',
            conclusion: 'revised',
          },
        }),
      ],
      { keyVersion: 'k2', keyManifestDigest: keyManifestDigest(inputs.manifest) },
    )
    expect(errorsOf(parseLiveGrades(revised, inputs)).join(' ')).toContain('re-review')
  })

  it('refuses a recheck that does not name the key it moved from and to', () => {
    const inputs = inputsFor(attempt, { manifest: manifest({ keyVersion: 'k2', keyDigest: digestOf('the private key document, v2') }) })
    const wrong = gradesOf(
      [
        passEntry(attempt, {
          recheck: {
            priorKeyVersion: 'k0',
            newKeyVersion: 'k2',
            recheckedAt: '2026-01-03T00:00:00.000Z',
            evidence: 'unrelated',
            conclusion: 'unchanged',
          },
        }),
      ],
      { keyVersion: 'k2', keyManifestDigest: keyManifestDigest(inputs.manifest) },
    )
    expect(errorsOf(parseLiveGrades(wrong, inputs)).join(' ')).toContain('k0')
  })
})
