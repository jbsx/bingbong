import { describe, expect, it } from 'vitest'
import { blankEditorState, emptyDrafts, gradesWith, withDraft } from './gradingBench.ts'
import {
  LIVE_GRADING_SCHEMA_VERSION,
  LIVE_KEY_MANIFEST_KIND,
  indexAttempts,
  initializeLiveGrades,
  keyManifestDigest,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyManifest,
} from './grades.ts'
import { attemptCapture, captureSet, sessionCapture, slotOf } from './gradingFixtures.ts'
import {
  captureSetsIn,
  gradesFileNameFor,
  preselectedSetFile,
  resolveGradesFile,
  reviewerCaution,
  reviewerSlug,
  type RootFile,
  type SetupSet,
} from './gradingSetup.ts'

// The Grading Bench's setup page (#229): what the bench proposes from its two
// fixed roots before the reviewer confirms. Everything here is a decision
// over files already read — which sets are offered, which grades file a
// reviewer resumes, and when the bench refuses to pick one — so each rule is
// tested as a function. The facts are invented, as in every grading suite.

const REVIEWED_AT = '2026-09-10T12:00:00.000Z'

function manifest(keyVersion = 'k1'): LiveKeyManifest {
  return {
    kind: LIVE_KEY_MANIFEST_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    keyVersion,
    keyDigest: `sha256:${'1'.repeat(64)}`,
    preparedAt: '2026-01-01',
    tasks: [
      { huntId: 'hunt-a', stepId: 'initial', promptVersion: 'p1', keyRef: 'fixture/keys.ts#hunt-a', checks: [{ checkId: 'c1', description: 'names the invented widget code' }] },
      { huntId: 'hunt-a', stepId: 'follow_up', promptVersion: 'p1', keyRef: 'fixture/keys.ts#hunt-a.followUpDelta', checks: [{ checkId: 'd1', description: 'says the enclosure no longer fits' }] },
    ],
  }
}

/** A set of two answered slots: a1, and its follow-up a2. */
function inputsFor(setId: string, keyVersion: string): LiveGradingInputs {
  const a1 = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
  const a2 = attemptCapture({ attemptId: 'a2', huntId: 'hunt-a', stepId: 'follow_up', order: 1, relation: 'revised_objective', parentAttemptId: 'a1', acceptedAt: 50_000, answer: { at: 60_000, text: 'invented follow-up answer' }, terminal: { at: 61_000 } })
  const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [a1, a2], setId })
  return { set: captureSet({ setId, slots: [a1, a2].map(slotOf), sessions: [session] }), sessions: [session], manifest: manifest(keyVersion) }
}

/** A grades file whose slots are saved in order by the reviewers named: a1 by the first, a2 by the second. */
function gradedBy(reviewers: readonly string[], { setId = 'set-1', keyVersion = 'k1' } = {}): LiveGrades {
  const inputs = inputsFor(setId, keyVersion)
  const { byAttemptId } = indexAttempts(inputs.sessions)
  let grades = initializeLiveGrades(inputs)
  reviewers.forEach((reviewer, index) => {
    const slot = inputs.set.slots[index]
    const task = inputs.manifest.tasks[index]
    const state = { status: 'unsuccessful' as const, checks: { [task.checks[0].checkId]: { satisfied: false, note: '' } }, support: [], rationale: 'invented' }
    const next = gradesWith(state, { slot, dispatched: byAttemptId.get(slot.attemptId), task }, grades, inputs, reviewer, REVIEWED_AT)
    if (!next.ok) throw new Error(next.errors.join('\n'))
    grades = next.value
  })
  return grades
}

function draftsBy(reviewer: string, { setId = 'set-1', keyVersion = 'k1' } = {}) {
  const binding = { setId, keyManifestDigest: keyManifestDigest(manifest(keyVersion)), reviewer }
  return withDraft(emptyDrafts(binding), 'a1', blankEditorState(manifest(keyVersion).tasks[0]), REVIEWED_AT)
}

/** A file as the server reads it back: its name, and its JSON — undefined for a file that did not parse. */
function file(name: string, value: unknown): RootFile {
  return { name, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }
}

describe('the grades file a reviewer is given', () => {
  it('is named <setId>-grades-<reviewer slug>.json', () => {
    expect(gradesFileNameFor('pilot-2', 'Ada Lovelace')).toBe('pilot-2-grades-ada-lovelace.json')
  })

  it('slugs a name to lowercase, each run outside [a-z0-9] one dash, with none at either end', () => {
    expect(reviewerSlug('jaish')).toBe('jaish')
    expect(reviewerSlug('Ada  O’Brien--Smith')).toBe('ada-o-brien-smith')
    expect(reviewerSlug('claude-opus-5 (AI reviewer, not a human)')).toBe('claude-opus-5-ai-reviewer-not-a-human')
  })

  it('gives a name with no letter or digit a slug of its own rather than an empty one', () => {
    const slug = reviewerSlug('李明')
    expect(slug).toMatch(/^reviewer-[0-9a-f]{12}$/)
    expect(reviewerSlug('王芳')).not.toBe(slug)
  })

  it('is a new file under that name when nothing in the private root is the reviewer’s', () => {
    const privateFiles = [file('key-manifest.json', manifest()), file('set-1-grades-grace.json', gradedBy(['Grace'])), file('notes.json', undefined)]
    expect(resolveGradesFile({ setId: 'set-1', reviewer: 'Ada', manifest: manifest(), privateFiles })).toEqual({
      ok: true,
      value: { name: 'set-1-grades-ada.json', resumed: false },
    })
  })

  it('resumes the reviewer’s own file for the set by what it holds, whatever it is called', () => {
    const privateFiles = [file('pilot-grades.json', gradedBy(['Ada'])), file('set-2-grades-ada.json', gradedBy(['Ada'], { setId: 'set-2' }))]
    expect(resolveGradesFile({ setId: 'set-1', reviewer: 'Ada', manifest: manifest(), privateFiles })).toEqual({
      ok: true,
      value: { name: 'pilot-grades.json', resumed: true },
    })
  })

  it('resumes by a drafts sidecar bound to the reviewer before anything was saved', () => {
    const privateFiles = [file('mine.drafts.json', draftsBy('Ada'))]
    expect(resolveGradesFile({ setId: 'set-1', reviewer: 'Ada', manifest: manifest(), privateFiles })).toEqual({
      ok: true,
      value: { name: 'mine.json', resumed: true },
    })
  })

  it('resumes an unclaimed file already at the derived name — one nobody has saved a Grade into', () => {
    const privateFiles = [file('set-1-grades-ada.json', gradedBy([]))]
    expect(resolveGradesFile({ setId: 'set-1', reviewer: 'Ada', manifest: manifest(), privateFiles })).toEqual({
      ok: true,
      value: { name: 'set-1-grades-ada.json', resumed: true },
    })
  })
})

describe('a grades file the bench refuses to pick', () => {
  const resolve = (privateFiles: readonly RootFile[], reviewer = 'Ada') => resolveGradesFile({ setId: 'set-1', reviewer, manifest: manifest(), privateFiles })
  const errorsOf = (result: ReturnType<typeof resolve>): string => (result.ok ? '' : result.errors.join(' '))

  it('is either of two files that both hold the reviewer’s work on the set', () => {
    const result = resolve([file('first.json', gradedBy(['Ada'])), file('second.drafts.json', draftsBy('Ada'))])
    expect(result.ok).toBe(false)
    expect(errorsOf(result)).toContain('first.json')
    expect(errorsOf(result)).toContain('second.json')
  })

  it('is not a grades file beside its own sidecar, which is one file’s work', () => {
    expect(resolve([file('first.json', gradedBy(['Ada'])), file('first.drafts.json', draftsBy('Ada'))])).toEqual({ ok: true, value: { name: 'first.json', resumed: true } })
  })

  it('is a file of the reviewer’s that mixes in another reviewer', () => {
    const result = resolve([file('shared.json', gradedBy(['Ada', 'Grace']))])
    expect(result.ok).toBe(false)
    expect(errorsOf(result)).toContain('Grace')
  })

  it('is a file bound to an older key than the current one, which live:report’s documented recheck resolves', () => {
    const stale = resolve([file('set-1-grades-ada.json', gradedBy(['Ada'], { keyVersion: 'k0' }))])
    expect(stale.ok).toBe(false)
    expect(errorsOf(stale)).toMatch(/k0.*k1/)
    expect(errorsOf(stale)).toContain('recheck')

    expect(resolve([file('mine.drafts.json', draftsBy('Ada', { keyVersion: 'k0' }))]).ok).toBe(false)
  })

  it('is the derived name when it already holds someone else’s work, or something that is not a grades file', () => {
    // "ada lovelace" slugs as "Ada Lovelace" does: the name is taken, not theirs to share.
    const taken = resolve([file('set-1-grades-ada-lovelace.json', gradedBy(['ada lovelace']))], 'Ada Lovelace')
    expect(taken.ok).toBe(false)
    expect(errorsOf(taken)).toContain('ada lovelace')

    expect(resolve([file('set-1-grades-ada.drafts.json', draftsBy('ada'))]).ok).toBe(false)
    expect(resolve([file('set-1-grades-ada.json', undefined)]).ok).toBe(false)
    expect(resolve([file('set-1-grades-ada.json', gradedBy([], { setId: 'set-9' }))]).ok).toBe(false)
  })
})

describe('the capture sets the setup page offers', () => {
  /** The set record of a fixture set, created at the given hour of an invented day. */
  function setRecord(setId: string, hour: number, overrides: Partial<ReturnType<typeof captureSet>> = {}) {
    return { ...inputsFor(setId, 'k1').set, createdAt: `2026-09-10T${String(hour).padStart(2, '0')}:00:00.000Z`, ...overrides }
  }

  it('lists every capture set in the root by its kind, newest first, and skips everything else', () => {
    const listed = captureSetsIn([
      file('pilot-1.json', setRecord('pilot-1', 8)),
      file('preflight-2026-09-10.json', { kind: 'bingbong.live.source-preflight', observedAt: '2026-09-10', observations: [] }),
      file('pilot-2.json', setRecord('pilot-2', 9)),
      file('torn.json', undefined),
    ])
    expect(listed).toEqual([
      { file: 'pilot-2.json', setId: 'pilot-2', createdAt: '2026-09-10T09:00:00.000Z', mode: 'measured', state: 'complete', slots: 2, refusals: [] },
      { file: 'pilot-1.json', setId: 'pilot-1', createdAt: '2026-09-10T08:00:00.000Z', mode: 'measured', state: 'complete', slots: 2, refusals: [] },
    ])
  })

  it('lists a verification-mode or incomplete set with the reason it cannot be started', () => {
    const [interrupted, rehearsal, running] = captureSetsIn([
      file('rehearsal.json', setRecord('rehearsal', 9, { mode: 'verification' })),
      file('interrupted.json', setRecord('interrupted', 10, { state: 'interrupted', stateReason: 'the evaluator stopped the pass' })),
      file('running.json', setRecord('running', 8, { state: 'in_progress' })),
    ])
    expect(rehearsal.refusals.join(' ')).toContain('verification')
    expect(interrupted.refusals.join(' ')).toContain('interrupted')
    expect(interrupted.refusals.join(' ')).toContain('the evaluator stopped the pass')
    expect(running.refusals.join(' ')).toContain('in_progress')
  })

  it('lists a capture set that does not validate, or shares its id with another, as one that cannot be started', () => {
    const listed = captureSetsIn([
      file('broken.json', { kind: 'bingbong.live.capture-set', setId: 'broken' }),
      file('pilot-2.json', setRecord('pilot-2', 9)),
      file('pilot-2-copy.json', setRecord('pilot-2', 9)),
    ])
    expect(listed.find((set) => set.file === 'broken.json')).toMatchObject({ setId: 'broken', slots: null })
    expect(listed.find((set) => set.file === 'broken.json')!.refusals.join(' ')).toContain('does not validate')
    for (const name of ['pilot-2.json', 'pilot-2-copy.json']) {
      expect(listed.find((set) => set.file === name)!.refusals.join(' ')).toContain('more than one')
    }
  })
})

describe('the set the setup page preselects', () => {
  function offered(file: string, hour: number, progress: SetupSet['progress'], refusals: readonly string[] = []): SetupSet {
    return {
      file,
      setId: file.replace('.json', ''),
      createdAt: `2026-09-10T${String(hour).padStart(2, '0')}:00:00.000Z`,
      mode: 'measured',
      state: 'complete',
      slots: 6,
      refusals,
      gradesFile: refusals.length > 0 ? null : { name: `${file.replace('.json', '')}-grades-ada.json`, resumed: false },
      progress,
    }
  }
  const untouched = { graded: 0, drafted: 0, pending: 6, notReached: 0 }
  const finished = { graded: 5, drafted: 0, pending: 0, notReached: 1 }

  it('is the newest set that can be started where the reviewer still has ungraded slots', () => {
    const sets = [
      offered('rehearsal.json', 12, null, ['a verification-mode set']),
      offered('pilot-3.json', 11, finished),
      offered('pilot-1.json', 8, untouched),
      offered('pilot-2.json', 9, untouched),
    ]
    expect(preselectedSetFile(sets)).toBe('pilot-2.json')
    // A draft is ungraded work too, and a slot nothing was dispatched into is never gradeable.
    expect(preselectedSetFile([...sets, offered('pilot-4.json', 10, { graded: 5, drafted: 1, pending: 0, notReached: 0 })])).toBe('pilot-4.json')
  })

  it('is nothing when no set that can be started has an ungraded slot left', () => {
    expect(preselectedSetFile([offered('pilot-3.json', 11, finished), offered('rehearsal.json', 12, null, ['a verification-mode set'])])).toBeNull()
  })
})

describe('the reviewer’s name', () => {
  const privateFiles = [
    file('set-1-grades-grace.json', gradedBy(['Grace'])),
    file('set-2-grades-hopper.drafts.json', draftsBy('Hopper', { setId: 'set-2' })),
    file('set-3-pending.json', gradedBy([], { setId: 'set-3' })),
  ]

  it('is flagged when it has no grades or drafts in the private root while other names have some', () => {
    const caution = reviewerCaution('grace', privateFiles)
    expect(caution).toContain('Grace')
    expect(caution).toContain('Hopper')
  })

  it('is not flagged when it has grades or drafts, or when no one has any yet', () => {
    expect(reviewerCaution('Grace', privateFiles)).toBeNull()
    expect(reviewerCaution('Hopper', privateFiles)).toBeNull()
    expect(reviewerCaution('Ada', [file('set-3-pending.json', gradedBy([], { setId: 'set-3' })), file('key-manifest.json', manifest())])).toBeNull()
  })
})
