// The Grading Bench's fixture capture set (#228–#232), shared by the server
// suite and the page suite so both walk the same invented set: a1 answered,
// with an event tape and a failure screenshot; b1 ran and published no
// Answer; b2 was never reached; and another reviewer's finished Grade to
// compare against. Test-only, like gradingFixtures.ts: no fixture carries a
// real hunt's prompt, key or Answer.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import { digestOf } from './artifacts.ts'
import { gradesWith, type BenchEditorState, type BenchKey } from './gradingBench.ts'
import {
  LIVE_GRADING_SCHEMA_VERSION,
  LIVE_KEY_MANIFEST_KIND,
  indexAttempts,
  initializeLiveGrades,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyManifest,
} from './grades.ts'
import { attemptCapture, captureSet, notReached, sessionCapture, slotOf } from './gradingFixtures.ts'
import type { LiveAttemptCapture, LiveEventTape } from './types.ts'

export const manifest: LiveKeyManifest = {
  kind: LIVE_KEY_MANIFEST_KIND,
  schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
  keyVersion: 'k1',
  keyDigest: digestOf('the invented key document, v1'),
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

/** The manifest as `pnpm live:keys` writes it, which is what `pnpm live:report` is given. */
export const MANIFEST_TEXT = `${JSON.stringify(manifest, null, 2)}\n`

export const keys: Record<string, BenchKey> = {
  'hunt-a': {
    huntId: 'hunt-a',
    version: 1,
    requiredFacts: ['the widget code is W-1'],
    constraints: ['grade the invented cable and the code separately'],
    pitfalls: ['the superseded fixture cable'],
    uncertainties: ['the invented spec hedges on the revision'],
    sources: [{ url: 'https://spec.invalid/a', supports: 'the code and the cable' }],
    liveFacts: [],
  },
  'hunt-b': {
    huntId: 'hunt-b',
    version: 1,
    requiredFacts: ['the invented date'],
    constraints: ['a date without its source is not enough'],
    pitfalls: [],
    uncertainties: [],
    sources: [{ url: 'https://dates.invalid/', supports: 'the date' }],
    liveFacts: [],
    followUpDelta: { requiredFacts: ['the date stands'], pitfalls: [], sources: [] },
  },
}

export const TAPE_EVENTS: PipelineEvent[] = [
  { type: 'tool_call', turnId: 'turn-a1', callId: 'n1', name: 'navigate', args: { url: 'https://spec.invalid/a' }, at: 1 },
  {
    type: 'tool_result',
    turnId: 'turn-a1',
    callId: 'n1',
    name: 'navigate',
    ok: true,
    result: 'navigated: url=https://spec.invalid/a title="Widget spec"\n# Widget spec — https://spec.invalid/a\npage text:\nThe widget code is W-1.',
    at: 2,
  },
  { type: 'tool_call', turnId: 'turn-a1', callId: 'e1', name: 'record_evidence', args: { kind: 'web', observation: 'code W-1', excerpt: 'The widget code is W-1.', source_url: 'https://spec.invalid/a' }, at: 3 },
  { type: 'tool_result', turnId: 'turn-a1', callId: 'e1', name: 'record_evidence', ok: true, result: 'Session Evidence recorded: memory-1', at: 4 },
]

export const REVIEWED_AT = '2026-09-10T12:00:00.000Z'

/** A complete passing judgment of a1. */
export const passing: BenchEditorState = {
  status: 'pass',
  checks: { c1: { satisfied: true, note: 'second line' }, c2: { satisfied: true, note: '' } },
  support: [{ claim: 'the widget code', sourceUrl: 'https://spec.invalid/a', passageRef: 'fixture/keys.ts#hunt-a.sources[0]', equivalentTo: '' }],
  rationale: 'both checks met by the spec page',
}

/** A complete judgment of b1, which published no Answer. */
export const b1Unsuccessful: BenchEditorState = { status: 'unsuccessful', checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'it never answered' }

/**
 * The fixture capture set, written into `directory` as `setFile` beside its
 * Session captures: a1 answered, with an event tape and a failure screenshot;
 * b1 ran and published no Answer; b2 was never reached. A second set in the
 * same directory takes another `setId`, and keeps the same attempt ids.
 */
export function writeFixtureSet(directory: string, setFile: string, setId = 'set-1'): LiveGradingInputs {
  const tape: LiveEventTape = { attemptId: 'a1', turnId: 'turn-a1', events: TAPE_EVENTS }
  const tapeText = `${JSON.stringify(tape, null, 2)}\n`
  const screenshot = Buffer.from('not really a png')
  const a1: LiveAttemptCapture = {
    ...attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 20_000, text: 'The widget code is **W-1**.' } }),
    events: { path: 'events/a1.json', family: 'events', digest: digestOf(tapeText), bytes: Buffer.byteLength(tapeText), complete: true },
  }
  const b1 = attemptCapture({ attemptId: 'b1', huntId: 'hunt-b', order: 1, answer: null, terminal: null })
  const b2 = notReached({ attemptId: 'b2', huntId: 'hunt-b', order: 2, parentAttemptId: 'b1', reason: 'the Run never ended, so no follow-up was sent' })
  const screenshotName = 'logs/run-trace-run-a1-turn-x-1.png'
  const sessionA = sessionCapture({
    captureId: `capture-${setId}-hunt-a`,
    huntId: 'hunt-a',
    attempts: [a1],
    setId,
    artifacts: [{ path: screenshotName, family: 'screenshot', digest: digestOf(screenshot), bytes: screenshot.length, complete: true }],
  })
  const sessionB = sessionCapture({ captureId: `capture-${setId}-hunt-b`, huntId: 'hunt-b', attempts: [b1, b2], setId })
  const set = captureSet({ setId, slots: [a1, b1, b2].map(slotOf), sessions: [sessionA, sessionB] })

  writeFileSync(join(directory, setFile), `${JSON.stringify(set, null, 2)}\n`)
  for (const session of [sessionA, sessionB]) {
    mkdirSync(join(directory, session.captureId, 'events'), { recursive: true })
    mkdirSync(join(directory, session.captureId, 'logs'), { recursive: true })
    writeFileSync(join(directory, session.captureId, 'capture.json'), `${JSON.stringify(session, null, 2)}\n`)
  }
  writeFileSync(join(directory, sessionA.captureId, 'events', 'a1.json'), tapeText)
  writeFileSync(join(directory, sessionA.captureId, screenshotName), screenshot)
  return { set, sessions: [sessionA, sessionB], manifest }
}

/** Another reviewer's finished Grade: a1 a useful partial with the cable check failed, b1 unsuccessful. */
export function reviewerBGrades(inputs: LiveGradingInputs): LiveGrades {
  const { byAttemptId } = indexAttempts(inputs.sessions)
  const slotOfId = (attemptId: string) => {
    const slot = inputs.set.slots.find((candidate) => candidate.attemptId === attemptId)!
    return { slot, dispatched: byAttemptId.get(attemptId), task: manifest.tasks.find((task) => task.huntId === slot.huntId && task.stepId === slot.stepId)! }
  }
  let other: LiveGrades = initializeLiveGrades(inputs)
  for (const [attemptId, state] of [
    ['a1', { status: 'useful_partial', checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: false, note: 'mentions the old cable' } }, support: [], rationale: 'the cable slip costs the pass' }],
    ['b1', { status: 'unsuccessful', checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'no Answer' }],
  ] as const) {
    const next = gradesWith(state as BenchEditorState, slotOfId(attemptId), other, inputs, 'reviewer-b', REVIEWED_AT)
    if (!next.ok) throw new Error(next.errors.join('\n'))
    other = next.value
  }
  return other
}
