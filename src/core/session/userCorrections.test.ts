import { describe, expect, it } from 'vitest'
import {
  correctionAffects,
  correctionsHandedOn,
  correctionsInForce,
  userCorrectionSubjects,
  type RetainedUserCorrection,
} from './userCorrections'
import type { SessionEvidenceSnapshot } from './sessionEvidence'
import type { MemoryEntryId } from './workingMemory'
import type { RunId, SessionId } from './sessionIdentity'

const id = (value: string): MemoryEntryId => value as MemoryEntryId
const run = (value: string): RunId => value as RunId

function correction(over: Partial<RetainedUserCorrection> = {}): RetainedUserCorrection {
  return {
    text: 'not that one; keep looking',
    runId: run('run-1'),
    retainedAt: 0,
    ...over,
  }
}

function evidence(candidates: SessionEvidenceSnapshot['candidates']): SessionEvidenceSnapshot {
  return { observations: [], candidates, contradictions: [] }
}

function candidate(over: Partial<SessionEvidenceSnapshot['candidates'][number]> = {}) {
  return {
    id: id('memory-9'),
    sessionId: 'session-1' as SessionId,
    subject: 'The 2019 tier list post',
    status: 'active' as const,
    recordedAt: 0,
    supportingObservationIds: [id('memory-1')],
    references: [],
    provenance: [],
    decisions: [],
    ...over,
  }
}

describe('handing a correction on (#218, ADR 0043)', () => {
  it('hands words left by an earlier Run to the Run being admitted, stamped with it', () => {
    const left = correction({ text: 'not that one; keep looking', runId: run('run-2'), candidateId: id('memory-9') })

    expect(correctionsHandedOn([left], run('run-3'), undefined)).toEqual([{ ...left, handedTo: run('run-3') }])
  })

  it('never hands words on a second time: what the last Run was handed lapses when the next is admitted', () => {
    const left = correction({ text: 'not that one; keep looking', runId: run('run-2'), candidateId: id('memory-9') })
    const handedOnce = correctionsHandedOn([left], run('run-3'), undefined)
    // run-3 ended without grounding the words, and run-4 is being admitted
    // with its own: the debt lapses rather than riding a second Run.
    const ownOfThree = correction({ text: 'open the second result', runId: run('run-3'), retainedAt: 5 })

    expect(correctionsHandedOn([...handedOnce, ownOfThree], run('run-4'), undefined)).toEqual([
      { ...ownOfThree, handedTo: run('run-4') },
    ])
  })

  it('carries at most one correction into any admission, however many Runs fell back in a row', () => {
    let held: readonly RetainedUserCorrection[] = []
    for (let at = 2; at <= 8; at += 1) {
      held = correctionsHandedOn(held, run(`run-${at}`), undefined)
      held = [...held, correction({ text: `command ${at}`, runId: run(`run-${at}`), retainedAt: at })]
    }

    const admitted = correctionsHandedOn(held, run('run-9'), undefined)
    expect(admitted).toEqual([expect.objectContaining({ text: 'command 8', runId: run('run-8'), handedTo: run('run-9') })])
  })

  it('lets words retired with their task lapse instead of carrying them for the rest of the Session', () => {
    const retired = correction({ text: 'not that one', runId: run('run-2'), objectiveId: id('memory-objective-a') })
    const live = correction({ text: 'keep going', runId: run('run-2'), objectiveId: id('memory-objective-b'), retainedAt: 5 })

    expect(correctionsHandedOn([retired, live], run('run-3'), id('memory-objective-b'))).toEqual([
      { ...live, handedTo: run('run-3') },
    ])
  })
})

describe('the task a correction belongs to (#211, ADR 0039)', () => {
  it('keeps an unscoped correction in force whatever the objective is', () => {
    const unscoped = correction()

    expect(correctionsInForce([unscoped], id('memory-2'))).toEqual([unscoped])
    expect(correctionsInForce([unscoped], undefined)).toEqual([unscoped])
  })

  it('retires a correction whose objective was replaced', () => {
    const scoped = correction({ objectiveId: id('memory-2') })

    expect(correctionsInForce([scoped], id('memory-2'))).toEqual([scoped])
    expect(correctionsInForce([scoped], id('memory-7'))).toEqual([])
  })
})

describe('which Candidate a correction is about (#211, ADR 0039)', () => {
  it('reports the Candidate an unresolved correction names', () => {
    expect(correctionAffects([correction({ candidateId: id('memory-9') })], id('memory-9'))).toBe(true)
  })

  it('reports nothing about a Candidate no correction names', () => {
    expect(correctionAffects([correction({ candidateId: id('memory-9') })], id('memory-10'))).toBe(false)
    expect(correctionAffects([correction()], id('memory-9'))).toBe(false)
  })
})

describe('the corrections a later Run receives (#211, ADR 0039)', () => {
  it('quotes the words and names the Candidate they were spoken about', () => {
    const subjects = userCorrectionSubjects(
      [correction({ candidateId: id('memory-9') })],
      evidence([candidate()]),
    )

    expect(subjects).toEqual([
      { text: 'not that one; keep looking', candidateId: id('memory-9'), candidateSubject: 'The 2019 tier list post' },
    ])
  })

  it('quotes a correction that named no Candidate', () => {
    expect(userCorrectionSubjects([correction({ text: 'only posts from 2023' })], evidence([]))).toEqual([
      { text: 'only posts from 2023' },
    ])
  })

  it('keeps the words when the Candidate they named is no longer held', () => {
    // The Session cannot produce the subject, but the user still said
    // this: dropping the words would be the erasure #211 exists to stop.
    expect(userCorrectionSubjects([correction({ candidateId: id('memory-9') })], evidence([]))).toEqual([
      { text: 'not that one; keep looking', candidateId: id('memory-9') },
    ])
  })
})
