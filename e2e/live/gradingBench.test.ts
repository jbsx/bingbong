import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import { digestOf } from './artifacts.ts'
import {
  allowedStatusesFor,
  blankEditorState,
  compareGrades,
  composeEntry,
  draftsPathFor,
  editorStateOf,
  emptyDrafts,
  evidenceTrailOf,
  gradesPathOfDrafts,
  gradesWith,
  keyViewFor,
  parseDrafts,
  reviewerRefusal,
  sanitizeEditorState,
  slotSummariesOf,
  toSaveOf,
  withDraft,
  withoutDraft,
  type BenchEditorState,
  type BenchKey,
  type BenchSlot,
} from './gradingBench.ts'
import {
  LIVE_GRADING_SCHEMA_VERSION,
  LIVE_KEY_MANIFEST_KIND,
  indexAttempts,
  initializeLiveGrades,
  keyManifestDigest,
  parseLiveGrades,
  type LiveGradeEntry,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyManifest,
  type LiveKeyTask,
} from './grades.ts'
import { attemptCapture, captureSet, notReached, sessionCapture, slotOf } from './gradingFixtures.ts'

// The Grading Bench's pure parts (#228). What is under test is what the
// bench does with a reviewer's judgment — carries it, restores it, refuses
// to write it half-done or under someone else's name, and shows it beside
// another reviewer's only after it is saved. Never whether the judgment was
// right: no code here can decide that. The facts are invented, as in the
// #226 suites, so the tests exercise the workflow rather than a pilot's key.

const KEY_DIGEST = digestOf('the invented key document, v1')

function manifest(): LiveKeyManifest {
  return {
    kind: LIVE_KEY_MANIFEST_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    keyVersion: 'k1',
    keyDigest: KEY_DIGEST,
    preparedAt: '2026-01-01',
    tasks: [
      {
        huntId: 'hunt-a',
        stepId: 'initial',
        promptVersion: 'p1',
        keyRef: 'fixture/keys.ts#hunt-a',
        checks: [
          { checkId: 'c1', description: 'names the invented widget code' },
          { checkId: 'c2', description: 'The Answer avoids: the superseded fixture cable' },
        ],
      },
      {
        huntId: 'hunt-a',
        stepId: 'follow_up',
        promptVersion: 'p1',
        keyRef: 'fixture/keys.ts#hunt-a.followUpDelta',
        checks: [{ checkId: 'd1', description: 'says the enclosure no longer fits' }],
      },
      {
        huntId: 'hunt-b',
        stepId: 'initial',
        promptVersion: 'p1',
        keyRef: 'fixture/keys.ts#hunt-b',
        checks: [{ checkId: 'c1', description: 'gives the invented date' }],
      },
      {
        huntId: 'hunt-b',
        stepId: 'follow_up',
        promptVersion: 'p1',
        keyRef: 'fixture/keys.ts#hunt-b.followUpDelta',
        checks: [{ checkId: 'd1', description: 'keeps the invented date' }],
      },
    ],
  }
}

/** a1 answered, a2 its answered follow-up; b1 ran and published no Answer, b2 was never reached. */
function fixture(): { inputs: LiveGradingInputs; grades: LiveGrades } {
  const a1 = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 20_000, text: 'The widget code is **W-1**.' } })
  const a2 = attemptCapture({
    attemptId: 'a2',
    huntId: 'hunt-a',
    stepId: 'follow_up',
    order: 1,
    relation: 'revised_objective',
    parentAttemptId: 'a1',
    acceptedAt: 50_000,
    answer: { at: 60_000, text: 'No, the enclosure no longer fits.' },
    terminal: { at: 61_000 },
  })
  const b1 = attemptCapture({ attemptId: 'b1', huntId: 'hunt-b', order: 2, answer: null, terminal: null })
  const b2 = notReached({ attemptId: 'b2', huntId: 'hunt-b', order: 3, parentAttemptId: 'b1', reason: 'the Run never ended, so no follow-up was sent' })
  const sessionA = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [a1, a2], setId: 'set-1' })
  const sessionB = sessionCapture({ captureId: 'capture-hunt-b', huntId: 'hunt-b', attempts: [b1, b2], setId: 'set-1' })
  const set = captureSet({ slots: [a1, a2, b1, b2].map(slotOf), sessions: [sessionA, sessionB] })
  const inputs: LiveGradingInputs = { set, sessions: [sessionA, sessionB], manifest: manifest() }
  return { inputs, grades: initializeLiveGrades(inputs) }
}

function benchSlot(inputs: LiveGradingInputs, attemptId: string): BenchSlot {
  const slot = inputs.set.slots.find((candidate) => candidate.attemptId === attemptId)!
  const task = inputs.manifest.tasks.find((candidate) => candidate.huntId === slot.huntId && candidate.stepId === slot.stepId)!
  return { slot, dispatched: indexAttempts(inputs.sessions).byAttemptId.get(attemptId), task }
}

function taskOf(inputs: LiveGradingInputs, attemptId: string): LiveKeyTask {
  return benchSlot(inputs, attemptId).task
}

/** A complete passing judgment of a1. */
function passingState(): BenchEditorState {
  return {
    status: 'pass',
    checks: { c1: { satisfied: true, note: 'bold code in the second line' }, c2: { satisfied: true, note: '' } },
    support: [{ claim: 'the widget code', sourceUrl: 'https://spec.invalid/a', passageRef: 'fixture/keys.ts#hunt-a.sources[0]', equivalentTo: '' }],
    rationale: 'both checks met by the spec page',
  }
}

const REVIEWED_AT = '2026-09-10T12:00:00.000Z'

function savedGrades(state: BenchEditorState = passingState(), reviewer = 'reviewer-a'): LiveGrades {
  const { inputs, grades } = fixture()
  const next = gradesWith(state, benchSlot(inputs, 'a1'), grades, inputs, reviewer, REVIEWED_AT)
  if (!next.ok) throw new Error(next.errors.join('\n'))
  return next.value
}

// ---------------------------------------------------------------------------

function call(callId: string, name: string, args: Record<string, unknown>, at: number): PipelineEvent {
  return { type: 'tool_call', turnId: 't', callId, name, args, at }
}

function ok(callId: string, name: string, result: unknown, at: number): PipelineEvent {
  return { type: 'tool_result', turnId: 't', callId, name, ok: true, result, at }
}

function failed(callId: string, name: string, error: string, at: number): PipelineEvent {
  return { type: 'tool_result', turnId: 't', callId, name, ok: false, error, at }
}

const SEARCH_RESULT = [
  'navigated: url=https://search.invalid/?q=widget title="widget at Search"',
  '# widget at Search — https://search.invalid/?q=widget',
  'viewport 985x575',
  'page text:',
  'Widget spec — spec.invalid',
].join('\n')

const READ_RESULT = [
  'dismissed consent dialog: clicked [4] "Accept"',
  '# Widget spec — https://spec.invalid/a',
  'viewport 985x575 scroll 0/4371',
  'page text:',
  'The widget code is W-1. The superseded cable is not compatible.',
].join('\n')

describe('the evidence trail of an attempt', () => {
  it('lists each navigate, read_page and look in order, with where it landed and the whole text', () => {
    const trail = evidenceTrailOf([
      { type: 'command', turnId: 't', text: 'invented', at: 1 },
      call('n1', 'navigate', { url: 'widget cable spec' }, 2),
      ok('n1', 'navigate', SEARCH_RESULT, 3),
      call('s1', 'scroll', { direction: 'down' }, 4),
      ok('s1', 'scroll', 'scrolled', 5),
      call('r1', 'read_page', {}, 6),
      ok('r1', 'read_page', READ_RESULT, 7),
      call('l1', 'look', { question: 'what does the table say?' }, 8),
      ok('l1', 'look', 'the table lists W-1', 9),
    ])

    expect(trail.steps.map((step) => [step.tool, step.outcome])).toEqual([
      ['navigate', 'loaded'],
      ['read_page', 'loaded'],
      ['look', 'loaded'],
    ])
    expect(trail.steps[0]).toMatchObject({
      requested: 'widget cable spec',
      url: 'https://search.invalid/?q=widget',
      title: 'widget at Search',
      text: SEARCH_RESULT,
    })
    expect(trail.steps[1]).toMatchObject({ url: 'https://spec.invalid/a', title: 'Widget spec', text: READ_RESULT })
    // A look names no URL of its own: it looked at the page the Run was on.
    expect(trail.steps[2]).toMatchObject({ requested: 'what does the table say?', url: 'https://spec.invalid/a', text: 'the table lists W-1' })
  })

  it('names a wall as a wall rather than as a page that loaded', () => {
    const walled = `${READ_RESULT.replace('spec.invalid/a', 'forums.invalid/t/1')}\nBLOCKER:challenge forums.invalid\nThis page is a Blocker.`
    const trail = evidenceTrailOf([call('n1', 'navigate', { url: 'https://forums.invalid/t/1' }, 1), ok('n1', 'navigate', walled, 2)])

    expect(trail.steps[0]).toMatchObject({ outcome: 'walled', wall: { signal: 'challenge', host: 'forums.invalid' }, url: 'https://forums.invalid/t/1' })
  })

  it('keeps a step that errored, and a call the tape never answered', () => {
    const trail = evidenceTrailOf([
      call('n1', 'navigate', { url: 'https://slow.invalid/' }, 1),
      failed('n1', 'navigate', 'stopped waiting for https://slow.invalid/ to load', 2),
      call('r1', 'read_page', {}, 3),
    ])

    expect(trail.steps[0]).toMatchObject({ outcome: 'errored', error: 'stopped waiting for https://slow.invalid/ to load', url: null, requested: 'https://slow.invalid/' })
    expect(trail.steps[1]).toMatchObject({ outcome: 'no_result', text: null, error: null })
  })

  it('carries what the assistant recorded as evidence, rejected entries included', () => {
    const trail = evidenceTrailOf([
      call('e1', 'record_evidence', { kind: 'web', observation: 'the code is W-1', excerpt: 'The widget code is W-1.', source_url: 'https://spec.invalid/a' }, 1),
      ok('e1', 'record_evidence', 'Session Evidence recorded: memory-1', 2),
      call('e2', 'record_evidence', { kind: 'web', observation: 'no excerpt' }, 3),
      failed('e2', 'record_evidence', 'record_evidence rejected (malformed)', 4),
    ])

    expect(trail.evidence).toEqual([
      {
        callId: 'e1',
        at: 1,
        kind: 'web',
        observation: 'the code is W-1',
        excerpt: 'The widget code is W-1.',
        sourceUrl: 'https://spec.invalid/a',
        accepted: true,
        outcome: 'Session Evidence recorded: memory-1',
      },
      { callId: 'e2', at: 3, kind: 'web', observation: 'no excerpt', excerpt: null, sourceUrl: null, accepted: false, outcome: 'record_evidence rejected (malformed)' },
    ])
  })

  it('says how many Subagents the Run spawned, because their browsing is not on this tape', () => {
    const trail = evidenceTrailOf([call('x1', 'spawn_agent', { task: 'look elsewhere' }, 1), ok('x1', 'spawn_agent', 'agent-1', 2)])
    expect(trail.subagentsSpawned).toBe(1)
    expect(trail.steps).toEqual([])
  })

  it('shows a structured result as JSON rather than dropping it', () => {
    const trail = evidenceTrailOf([call('n1', 'navigate', { url: 'https://x.invalid/' }, 1), ok('n1', 'navigate', { url: 'https://x.invalid/' }, 2)])
    expect(trail.steps[0].text).toBe('{"url":"https://x.invalid/"}')
  })
})

describe('the reviewer’s editor state', () => {
  it('starts blank: no status, every check unjudged', () => {
    const { inputs } = fixture()
    expect(blankEditorState(taskOf(inputs, 'a1'))).toEqual({
      status: null,
      checks: { c1: { satisfied: null, note: '' }, c2: { satisfied: null, note: '' } },
      support: [],
      rationale: '',
    })
  })

  it('reopens a saved entry as it was saved, and a draft over it as the draft', () => {
    const { inputs } = fixture()
    const task = taskOf(inputs, 'a1')
    const saved = savedGrades().entries.find((entry) => entry.attemptId === 'a1')!

    const reopened = editorStateOf(task, saved, undefined)
    expect(reopened.source).toBe('saved')
    expect(reopened.state).toEqual(passingState())

    const draft = { state: { ...passingState(), status: 'useful_partial' as const }, updatedAt: REVIEWED_AT }
    expect(editorStateOf(task, saved, draft)).toEqual({ state: draft.state, source: 'draft' })
  })

  it('treats a pending entry as nothing to reopen', () => {
    const { inputs, grades } = fixture()
    const task = taskOf(inputs, 'a1')
    expect(editorStateOf(task, grades.entries[0], undefined)).toEqual({ state: blankEditorState(task), source: 'blank' })
  })

  it('accepts what the page posts, filling in the checks it has not touched', () => {
    const { inputs } = fixture()
    const result = sanitizeEditorState({ status: null, checks: { c2: { satisfied: false, note: 'walked into it' } }, support: [], rationale: '' }, taskOf(inputs, 'a1'))
    expect(result).toEqual({
      ok: true,
      value: { status: null, checks: { c1: { satisfied: null, note: '' }, c2: { satisfied: false, note: 'walked into it' } }, support: [], rationale: '' },
    })
  })

  it('refuses a posted state that is not a judgment of this step', () => {
    const { inputs } = fixture()
    const task = taskOf(inputs, 'a1')
    const refused = (raw: unknown): readonly string[] => {
      const result = sanitizeEditorState(raw, task)
      return result.ok ? [] : result.errors
    }

    expect(refused({ ...passingState(), status: 'pending' }).join(' ')).toContain('status')
    expect(refused({ ...passingState(), checks: { zz: { satisfied: true, note: '' } } }).join(' ')).toContain('zz')
    expect(refused({ ...passingState(), checks: { c1: { satisfied: 'yes', note: '' } } }).join(' ')).toContain('c1')
    expect(refused({ ...passingState(), support: [{ claim: 1 }] }).join(' ')).toContain('support')
    expect(refused('not an object')).not.toEqual([])
  })
})

describe('the drafts sidecar', () => {
  const binding = { setId: 'set-1', keyManifestDigest: keyManifestDigest(manifest()), reviewer: 'reviewer-a' }

  it('sits beside the grades file, and names the grades file it sits beside', () => {
    expect(draftsPathFor('/private/pilot-2-grades-ada.json')).toBe('/private/pilot-2-grades-ada.drafts.json')
    expect(draftsPathFor('/private/grades')).toBe('/private/grades.drafts.json')
    expect(gradesPathOfDrafts('/private/pilot-2-grades-ada.drafts.json')).toBe('/private/pilot-2-grades-ada.json')
    expect(gradesPathOfDrafts('/private/pilot-2-grades-ada.json')).toBeNull()
  })

  it('replaces one attempt’s draft without touching another’s, and forgets it on request', () => {
    const one = withDraft(emptyDrafts(binding), 'a1', passingState(), REVIEWED_AT)
    const two = withDraft(one, 'a2', { status: null, checks: { d1: { satisfied: true, note: '' } }, support: [], rationale: '' }, REVIEWED_AT)
    const replaced = withDraft(two, 'a1', { ...passingState(), rationale: 'changed my mind' }, REVIEWED_AT)

    expect(replaced.drafts.a1.state.rationale).toBe('changed my mind')
    expect(replaced.drafts.a2).toEqual(two.drafts.a2)
    expect(Object.keys(withoutDraft(replaced, 'a1').drafts)).toEqual(['a2'])
  })

  it('round-trips through its own parser', () => {
    const { inputs } = fixture()
    const drafts = withDraft(emptyDrafts(binding), 'a1', passingState(), REVIEWED_AT)
    const parsed = parseDrafts(JSON.parse(JSON.stringify(drafts)), binding, (attemptId) => taskOf(inputs, attemptId))
    expect(parsed).toEqual({ ok: true, value: drafts })
  })

  it('refuses drafts written by another reviewer, for another set, or against another manifest', () => {
    const { inputs } = fixture()
    const drafts = JSON.parse(JSON.stringify(withDraft(emptyDrafts(binding), 'a1', passingState(), REVIEWED_AT)))
    const scheduled = new Set(inputs.set.slots.map((slot) => slot.attemptId))
    const errorsOf = (raw: unknown): string => {
      const parsed = parseDrafts(raw, binding, (attemptId) => (scheduled.has(attemptId) ? taskOf(inputs, attemptId) : undefined))
      return parsed.ok ? '' : parsed.errors.join(' ')
    }

    expect(errorsOf({ ...drafts, reviewer: 'reviewer-b' })).toContain('reviewer-b')
    expect(errorsOf({ ...drafts, setId: 'set-2' })).toContain('set-2')
    expect(errorsOf({ ...drafts, keyManifestDigest: digestOf('another manifest') })).toContain('manifest')
    expect(errorsOf({ ...drafts, drafts: { zz: drafts.drafts.a1 } })).toContain('zz')
  })
})

describe('whose grades file this is', () => {
  it('opens a file nobody has reviewed in, or one only this reviewer has', () => {
    expect(reviewerRefusal(fixture().grades, 'reviewer-a')).toBeNull()
    expect(reviewerRefusal(savedGrades(), 'reviewer-a')).toBeNull()
  })

  it('refuses a file another reviewer has written into', () => {
    const refusal = reviewerRefusal(savedGrades(passingState(), 'reviewer-b'), 'reviewer-a')
    expect(refusal).toContain('reviewer-b')
    expect(refusal).toContain('reviewer-a')
  })
})

describe('saving an entry', () => {
  it('writes what the reviewer judged, bound to the captured Answer, in the key’s check order', () => {
    const { inputs } = fixture()
    const composed = composeEntry(passingState(), benchSlot(inputs, 'a1'), { manifest: inputs.manifest, reviewer: 'reviewer-a', reviewedAt: REVIEWED_AT })
    const a1 = inputs.sessions[0].attempts[0]

    expect(composed).toEqual({
      ok: true,
      value: {
        attemptId: 'a1',
        huntId: 'hunt-a',
        stepId: 'initial',
        captureId: 'capture-hunt-a',
        answer: { at: a1.kind === 'attempt' && a1.finalAnswer.status === 'observed' ? a1.finalAnswer.value.at : -1, digest: digestOf('The widget code is **W-1**.') },
        keyVersion: 'k1',
        keyDigest: KEY_DIGEST,
        status: 'pass',
        checks: [{ checkId: 'c1', satisfied: true, note: 'bold code in the second line' }, { checkId: 'c2', satisfied: true }],
        support: [{ claim: 'the widget code', sourceUrl: 'https://spec.invalid/a', passageRef: 'fixture/keys.ts#hunt-a.sources[0]' }],
        rationale: 'both checks met by the spec page',
        reviewer: 'reviewer-a',
        reviewedAt: REVIEWED_AT,
      } satisfies LiveGradeEntry,
    })
    expect(parseLiveGrades(savedGrades(), inputs).ok).toBe(true)
  })

  it('never picks a status for the reviewer', () => {
    const { inputs, grades } = fixture()
    const result = gradesWith({ ...passingState(), status: null }, benchSlot(inputs, 'a1'), grades, inputs, 'reviewer-a', REVIEWED_AT)
    expect(result.ok ? [] : result.errors).toEqual(['grade for a1: choose a status — the bench never picks one'])
  })

  it('shows what else a blank judgment needs before a status is chosen, without naming a status', () => {
    const { inputs, grades } = fixture()
    const result = gradesWith(blankEditorState(taskOf(inputs, 'a1')), benchSlot(inputs, 'a1'), grades, inputs, 'reviewer-a', REVIEWED_AT)
    expect(result.ok ? [] : result.errors).toEqual([
      'grade for a1: choose a status — the bench never picks one',
      'grade for a1: a reviewed entry records no rationale',
      'grade for a1: required check(s) c1, c2 left unjudged',
    ])
  })

  it('returns the validator’s own words for the rule the record would break', () => {
    const { inputs, grades } = fixture()
    const state = { ...passingState(), checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: false, note: '' } } }
    const result = gradesWith(state, benchSlot(inputs, 'a1'), grades, inputs, 'reviewer-a', REVIEWED_AT)
    expect(result.ok ? [] : result.errors).toEqual(['grade for a1: graded pass with required check(s) c2 unsatisfied'])

    const unjudged = gradesWith({ ...passingState(), checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: null, note: '' } } }, benchSlot(inputs, 'a1'), grades, inputs, 'reviewer-a', REVIEWED_AT)
    expect(unjudged.ok ? [] : unjudged.errors).toContain('grade for a1: required check(s) c2 left unjudged')
  })

  it('limits an attempt that published no Answer to unsuccessful or help_access_blocked', () => {
    const { inputs, grades } = fixture()
    const b1 = benchSlot(inputs, 'b1')
    expect(allowedStatusesFor(b1.dispatched)).toEqual(['unsuccessful', 'help_access_blocked'])
    expect(allowedStatusesFor(benchSlot(inputs, 'a1').dispatched)).toEqual(['pass', 'useful_partial', 'help_access_blocked', 'unsuccessful'])

    const partial = gradesWith(
      { status: 'useful_partial', checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'never answered' },
      b1,
      grades,
      inputs,
      'reviewer-a',
      REVIEWED_AT,
    )
    expect(partial.ok ? [] : partial.errors).toEqual(['grade for b1: the Run published no Answer, so its status is unsuccessful or help_access_blocked'])

    const unsuccessful = gradesWith({ status: 'unsuccessful', checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'never answered' }, b1, grades, inputs, 'reviewer-a', REVIEWED_AT)
    expect(unsuccessful.ok).toBe(true)
  })

  it('refuses to review a slot nothing was dispatched into', () => {
    const { inputs, grades } = fixture()
    const b2 = benchSlot(inputs, 'b2')
    expect(allowedStatusesFor(b2.dispatched)).toEqual([])
    const result = gradesWith({ status: 'unsuccessful', checks: { d1: { satisfied: false, note: '' } }, support: [], rationale: 'x' }, b2, grades, inputs, 'reviewer-a', REVIEWED_AT)
    expect(result.ok ? '' : result.errors.join(' ')).toContain('stays pending')
  })
})

describe('what is left before a save', () => {
  // The page's to-save checklist (#232). It is the same rule the validator
  // enforces, said as work left rather than as errors, so a blank slot reads
  // as a list to do and not as a list of failures.
  const problemsFor = (state: BenchEditorState, attemptId = 'a1') => {
    const { inputs, grades } = fixture()
    const result = gradesWith(state, benchSlot(inputs, attemptId), grades, inputs, 'reviewer-a', REVIEWED_AT)
    return result.ok ? [] : result.errors
  }
  const toSave = (state: BenchEditorState, attemptId = 'a1') => toSaveOf(state, taskOf(fixture().inputs, attemptId), problemsFor(state, attemptId))

  it('lists the verdict, every check and the rationale as not done yet on a blank slot', () => {
    expect(toSave(blankEditorState(taskOf(fixture().inputs, 'a1')))).toEqual({
      ready: false,
      items: [
        { label: 'choose a verdict', short: 'verdict', done: false },
        { label: 'judge every check (0 of 2)', short: '0 of 2 checks', done: false },
        { label: 'write a rationale', short: 'rationale', done: false },
      ],
    })
  })

  it('ticks items off as the judgment fills in, and adds what a pass needs once pass is chosen', () => {
    const state: BenchEditorState = { ...passingState(), checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: null, note: '' } }, rationale: '   ' }
    expect(toSave(state).items).toEqual([
      { label: 'choose a verdict', short: 'verdict', done: true },
      { label: 'judge every check (1 of 2)', short: '1 of 2 checks', done: false },
      { label: 'write a rationale', short: 'rationale', done: false },
      { label: 'a pass needs every check satisfied', short: 'pass: checks', done: true },
      { label: 'a pass needs support for a claim', short: 'pass: support', done: true },
    ])
  })

  it('names the checks a pass cannot carry, and asks for support when there is none', () => {
    const state: BenchEditorState = { ...passingState(), checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: false, note: '' } }, support: [] }
    const result = toSave(state)
    expect(result.ready).toBe(false)
    expect(result.items.filter((item) => !item.done)).toEqual([
      { label: 'a pass needs every check satisfied (c2 is not)', short: 'pass: checks', done: false },
      { label: 'a pass needs support for a claim', short: 'pass: support', done: false },
    ])
  })

  it('asks for every support row to be finished, whatever the verdict', () => {
    const half = { claim: 'the code', sourceUrl: '', passageRef: '', equivalentTo: '' }
    const state: BenchEditorState = { ...passingState(), status: 'useful_partial', support: [half, half] }
    expect(toSave(state).items.filter((item) => !item.done)).toEqual([{ label: 'finish 2 support rows: claim, source and passage', short: 'support rows', done: false }])
  })

  it('is complete exactly when the validator would accept the save', () => {
    const { inputs } = fixture()
    const cases: Array<[BenchEditorState, string]> = [
      [blankEditorState(taskOf(inputs, 'a1')), 'a1'],
      [passingState(), 'a1'],
      [{ ...passingState(), status: null }, 'a1'],
      [{ ...passingState(), rationale: '' }, 'a1'],
      [{ ...passingState(), support: [] }, 'a1'],
      [{ ...passingState(), status: 'useful_partial', checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: false, note: '' } }, support: [] }, 'a1'],
      [{ ...passingState(), status: 'unsuccessful', support: [{ claim: '', sourceUrl: 'https://spec.invalid/a', passageRef: 'x', equivalentTo: '' }] }, 'a1'],
      [{ status: 'unsuccessful', checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'never answered' }, 'b1'],
      [{ status: null, checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'never answered' }, 'b1'],
    ]
    for (const [state, attemptId] of cases) {
      const problems = problemsFor(state, attemptId)
      const result = toSave(state, attemptId)
      expect(result.ready, JSON.stringify(state)).toBe(problems.length === 0)
      expect(result.items.every((item) => item.done), JSON.stringify(state)).toBe(problems.length === 0)
    }
  })

  it('falls back to the validator’s own words for a rule it does not list itself', () => {
    const result = toSaveOf(passingState(), taskOf(fixture().inputs, 'a1'), ['grade for a1: the graded Answer is not the Answer the capture recorded'])
    expect(result.ready).toBe(false)
    expect(result.items.filter((item) => !item.done)).toEqual([{ label: 'the graded Answer is not the Answer the capture recorded', short: 'a rule', done: false }])
  })
})

describe('another reviewer’s Grade', () => {
  it('is invisible until this reviewer’s own entry is saved', () => {
    const { inputs, grades } = fixture()
    const other = savedGrades(passingState(), 'reviewer-b').entries[0]
    expect(compareGrades(grades.entries[0], other, taskOf(inputs, 'a1'))).toBeNull()
    expect(compareGrades(undefined, other, taskOf(inputs, 'a1'))).toBeNull()
  })

  it('is shown after save as a per-check agree/disagree with both notes, and status and rationale side by side', () => {
    const { inputs } = fixture()
    const own = savedGrades().entries[0]
    const otherState: BenchEditorState = {
      status: 'useful_partial',
      checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: false, note: 'mentions the old cable' } },
      support: [],
      rationale: 'the cable slip costs the pass',
    }
    const other = savedGrades(otherState, 'reviewer-b').entries[0]
    const comparison = compareGrades(own, other, taskOf(inputs, 'a1'))

    expect(comparison).toEqual({
      otherPending: false,
      reviewer: 'reviewer-b',
      status: { own: 'pass', other: 'useful_partial', agree: false },
      rationale: { own: 'both checks met by the spec page', other: 'the cable slip costs the pass' },
      checks: [
        { checkId: 'c1', description: 'names the invented widget code', own: { satisfied: true, note: 'bold code in the second line' }, other: { satisfied: true, note: '' }, agree: true },
        { checkId: 'c2', description: 'The Answer avoids: the superseded fixture cable', own: { satisfied: true, note: '' }, other: { satisfied: false, note: 'mentions the old cable' }, agree: false },
      ],
      support: { own: own.support, other: [] },
      agreements: 1,
      disagreements: 1,
    })
  })

  it('says so when the other reviewer has not graded the slot', () => {
    const { inputs, grades } = fixture()
    const own = savedGrades().entries[0]
    expect(compareGrades(own, grades.entries[0], taskOf(inputs, 'a1'))).toEqual({ otherPending: true, reviewer: null })
  })
})

describe('the sidebar', () => {
  it('lists every slot in schedule order with its state, and the reason a slot was not reached', () => {
    const { inputs } = fixture()
    const grades = savedGrades()
    const drafts = withDraft(
      emptyDrafts({ setId: 'set-1', keyManifestDigest: grades.keyManifestDigest, reviewer: 'reviewer-a' }),
      'b1',
      blankEditorState(taskOf(inputs, 'b1')),
      REVIEWED_AT,
    )
    const reordered = { ...inputs, set: { ...inputs.set, slots: [...inputs.set.slots].reverse() } }

    expect(slotSummariesOf(reordered, grades, drafts).map((slot) => [slot.attemptId, slot.state, slot.status, slot.reason])).toEqual([
      ['a1', 'graded', 'pass', null],
      ['a2', 'pending', 'pending', null],
      ['b1', 'drafted', 'pending', null],
      ['b2', 'not_reached', 'pending', 'the Run never ended, so no follow-up was sent'],
    ])
  })

  it('marks a graded slot with an unsaved draft over it', () => {
    const grades = savedGrades()
    const drafts = withDraft(emptyDrafts({ setId: 'set-1', keyManifestDigest: grades.keyManifestDigest, reviewer: 'reviewer-a' }), 'a1', passingState(), REVIEWED_AT)
    const a1 = slotSummariesOf(fixture().inputs, grades, drafts)[0]
    expect([a1.state, a1.unsavedDraft]).toEqual(['graded', true])
  })
})

describe('the key beside the Answer', () => {
  const key: BenchKey = {
    huntId: 'hunt-a',
    version: 1,
    requiredFacts: ['the widget code is W-1'],
    constraints: ['grade the cable and the code separately'],
    pitfalls: ['the superseded fixture cable'],
    uncertainties: [],
    sources: [{ url: 'https://spec.invalid/a', supports: 'the code' }],
    liveFacts: [],
    followUpDelta: { requiredFacts: ['the enclosure no longer fits'], pitfalls: [], sources: [{ url: 'https://spec.invalid/enclosure', supports: 'the lid' }] },
  }

  it('offers the step’s own sources first for support, each with a findable passage reference', () => {
    const { inputs } = fixture()
    const followUp = benchSlot(inputs, 'a2')
    const view = keyViewFor(key, followUp.slot, followUp.task)

    expect(view.constraints).toEqual(['grade the cable and the code separately'])
    expect(view.followUpDelta).toEqual(key.followUpDelta)
    expect(view.pickSources).toEqual([
      { url: 'https://spec.invalid/enclosure', supports: 'the lid', passageRef: 'fixture/keys.ts#hunt-a.followUpDelta.sources[0]' },
      { url: 'https://spec.invalid/a', supports: 'the code', passageRef: 'fixture/keys.ts#hunt-a.sources[0]' },
    ])

    const initial = benchSlot(inputs, 'a1')
    expect(keyViewFor(key, initial.slot, initial.task).pickSources).toEqual([
      { url: 'https://spec.invalid/a', supports: 'the code', passageRef: 'fixture/keys.ts#hunt-a.sources[0]' },
    ])
  })
})
