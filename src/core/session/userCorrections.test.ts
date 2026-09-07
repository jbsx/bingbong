import { describe, expect, it } from 'vitest'
import {
  correctionAffects,
  correctionsInForce,
  MAX_RETAINED_CORRECTIONS,
  retainedCorrections,
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

describe('retaining what the user said (#211, ADR 0039)', () => {
  it('keeps each correction in the order it was spoken', () => {
    const first = correction({ text: 'not that one' })
    const second = correction({ text: 'only posts from 2023', candidateId: id('memory-9') })

    expect(retainedCorrections(retainedCorrections([], first), second)).toEqual([first, second])
  })

  it('keeps both when the user speaks twice about one Candidate', () => {
    // "not that one; keep looking" then "keep going" is a rejection and
    // a nudge, not a restatement: treating the newer as the newer
    // wording would erase the decision the first one carried.
    const older = correction({ text: 'not that one; keep looking', candidateId: id('memory-9') })
    const newer = correction({ text: 'keep going', candidateId: id('memory-9'), retainedAt: 5 })

    expect(retainedCorrections([older], newer)).toEqual([older, newer])
  })

  it('keeps both when neither named a Candidate', () => {
    const older = correction({ text: 'only posts from 2023' })
    const newer = correction({ text: 'make that 2024', retainedAt: 5 })

    expect(retainedCorrections([older], newer)).toEqual([older, newer])
  })

  it('keeps corrections about different Candidates apart', () => {
    const aboutA = correction({ text: 'not that one', candidateId: id('memory-9') })
    const aboutB = correction({ text: 'nor that one', candidateId: id('memory-10') })

    expect(retainedCorrections([aboutA], aboutB)).toEqual([aboutA, aboutB])
  })

  it('drops the oldest past the bound rather than growing without limit', () => {
    let held: readonly RetainedUserCorrection[] = []
    for (let at = 0; at <= MAX_RETAINED_CORRECTIONS; at += 1) {
      held = retainedCorrections(held, correction({ text: `correction ${at}`, candidateId: id(`memory-${at}`) }))
    }

    expect(held).toHaveLength(MAX_RETAINED_CORRECTIONS)
    expect(held[0]!.text).toBe('correction 1')
    expect(held.at(-1)!.text).toBe(`correction ${MAX_RETAINED_CORRECTIONS}`)
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
