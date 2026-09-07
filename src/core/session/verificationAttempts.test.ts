import { describe, expect, it } from 'vitest'
import {
  candidateEligibleForVerification,
  eligibleVerificationCandidates,
  MAX_RETAINED_VERIFICATION_FAILURES,
  retainedVerificationFailures,
  verificationRouteOpen,
  verificationSubject,
  type RetainedVerificationFailure,
} from './verificationAttempts'
import type { SessionCandidate, SessionEvidenceSnapshot } from './sessionEvidence'
import type { RetainedUserCorrection } from './userCorrections'
import type { CandidateDecision } from './candidateDecisions'
import type { MemoryEntryId } from './workingMemory'
import type { RunId, SessionId } from './sessionIdentity'

const id = (value: string): MemoryEntryId => value as MemoryEntryId
const run = (value: string): RunId => value as RunId

const OBJECTIVE = id('memory-objective')

function failure(over: Partial<RetainedVerificationFailure> = {}): RetainedVerificationFailure {
  return {
    route: 'vision',
    failure: 'look timed out after 8000ms',
    objectiveId: OBJECTIVE,
    runId: run('run-1'),
    failedAt: 0,
    ...over,
  }
}

function candidate(over: Partial<SessionCandidate> = {}): SessionCandidate {
  return {
    id: id('memory-9'),
    sessionId: 'session-1' as SessionId,
    subject: 'The 2019 tier list post',
    status: 'active',
    recordedAt: 0,
    supportingObservationIds: [id('memory-1')],
    references: [],
    provenance: [],
    decisions: [],
    ...over,
  }
}

function decision(over: Partial<CandidateDecision> = {}): CandidateDecision {
  return {
    status: 'rejected',
    authority: 'user',
    reason: 'not that one',
    objectiveId: OBJECTIVE,
    supportingObservationIds: [id('memory-1')],
    decidedAt: 0,
    ...over,
  }
}

function correction(over: Partial<RetainedUserCorrection> = {}): RetainedUserCorrection {
  return { text: 'not that one', runId: run('run-1'), retainedAt: 0, ...over }
}

const snapshot = (candidates: readonly SessionCandidate[]): SessionEvidenceSnapshot => ({
  observations: [],
  candidates,
  contradictions: [],
})

describe('retaining what a verification attempt mechanically observed (#212)', () => {
  it('appends failures oldest first and evicts the oldest past the bound', () => {
    let held: readonly RetainedVerificationFailure[] = []
    for (let at = 0; at < MAX_RETAINED_VERIFICATION_FAILURES + 2; at += 1) {
      held = retainedVerificationFailures(held, failure({ failedAt: at }))
    }
    expect(held).toHaveLength(MAX_RETAINED_VERIFICATION_FAILURES)
    expect(held[0]!.failedAt).toBe(2)
    expect(held.at(-1)!.failedAt).toBe(MAX_RETAINED_VERIFICATION_FAILURES + 1)
  })

  it('keeps the observed failure verbatim rather than a cause it would have to invent', () => {
    const held = retainedVerificationFailures([], failure({ failure: 'look timed out after 8000ms' }))
    expect(held[0]!.failure).toBe('look timed out after 8000ms')
  })
})

describe('which Candidate a fresh verification attempt could still resolve (#212/AC5)', () => {
  it('accepts an active Candidate under the objective in force', () => {
    expect(
      candidateEligibleForVerification(candidate(), { objectiveId: OBJECTIVE, corrections: [] }),
    ).toBe(true)
  })

  it('refuses a Candidate the user rejected for this objective', () => {
    const rejected = candidate({ decisions: [decision()] })
    expect(candidateEligibleForVerification(rejected, { objectiveId: OBJECTIVE, corrections: [] })).toBe(false)
  })

  it('accepts it again once the user themselves reopened it', () => {
    const reopened = candidate({
      decisions: [decision(), decision({ status: 'active', reason: 'try it again', decidedAt: 1 })],
    })
    expect(candidateEligibleForVerification(reopened, { objectiveId: OBJECTIVE, corrections: [] })).toBe(true)
  })

  it('ignores a rejection made for a different objective', () => {
    const elsewhere = candidate({ decisions: [decision({ objectiveId: id('memory-other') })] })
    expect(candidateEligibleForVerification(elsewhere, { objectiveId: OBJECTIVE, corrections: [] })).toBe(true)
  })

  it('refuses a Candidate the user has spoken about with nothing yet resolving it', () => {
    expect(
      candidateEligibleForVerification(candidate(), {
        objectiveId: OBJECTIVE,
        corrections: [correction({ candidateId: id('memory-9') })],
      }),
    ).toBe(false)
  })

  it('refuses a superseded Candidate and keeps an accepted one', () => {
    const superseded = candidate({ decisions: [decision({ status: 'superseded', authority: 'model' })] })
    expect(candidateEligibleForVerification(superseded, { objectiveId: OBJECTIVE, corrections: [] })).toBe(false)
    const accepted = candidate({ decisions: [decision({ status: 'accepted', authority: 'model' })] })
    expect(candidateEligibleForVerification(accepted, { objectiveId: OBJECTIVE, corrections: [] })).toBe(true)
  })

  it('lists the eligible Candidates with the subject the model reads, not the identity alone', () => {
    const eligible = eligibleVerificationCandidates(
      snapshot([candidate(), candidate({ id: id('memory-10'), decisions: [decision()] })]),
      { objectiveId: OBJECTIVE, corrections: [] },
    )
    expect(eligible).toEqual([{ candidateId: id('memory-9'), subject: 'The 2019 tier list post' }])
  })
})

describe('whether a Run may spend a verification route at all (#212/AC4, AC5)', () => {
  it('opens a route the Session has never seen fail', () => {
    expect(
      verificationRouteOpen({ failures: [], route: 'vision', objectiveId: OBJECTIVE, eligible: [], held: 0 }),
    ).toBe(true)
  })

  it('opens one fresh attempt when a retained failure leaves an eligible Candidate', () => {
    expect(
      verificationRouteOpen({
        failures: [failure()],
        route: 'vision',
        objectiveId: OBJECTIVE,
        eligible: [{ candidateId: id('memory-9'), subject: 'The 2019 tier list post' }],
        held: 2,
      }),
    ).toBe(true)
  })

  it('stays closed only when a shortlist exists and every lead on it is settled', () => {
    expect(
      verificationRouteOpen({ failures: [failure()], route: 'vision', objectiveId: OBJECTIVE, eligible: [], held: 2 }),
    ).toBe(false)
  })

  it('reopens when the Session is weighing no Candidates at all', () => {
    // Most Looks are not Candidate verification — reading a chart's
    // labels, a table, text baked into an image. A Session with no
    // shortlist has none to grow, so one transient deadline breach must
    // not disable looking for the rest of the objective.
    expect(
      verificationRouteOpen({ failures: [failure()], route: 'vision', objectiveId: OBJECTIVE, eligible: [], held: 0 }),
    ).toBe(true)
  })

  it('does not carry a failure across a replacement objective', () => {
    expect(
      verificationRouteOpen({
        failures: [failure({ objectiveId: id('memory-old') })],
        route: 'vision',
        objectiveId: OBJECTIVE,
        eligible: [],
        held: 3,
      }),
    ).toBe(true)
  })

  it('leaves a different route open — a failed Look never closes the page text', () => {
    expect(
      verificationRouteOpen({ failures: [failure()], route: 'page_text', objectiveId: OBJECTIVE, eligible: [], held: 2 }),
    ).toBe(true)
  })
})

describe('what a later Run is told about the attempt that failed (#212/AC3)', () => {
  it('quotes the observed failure and names the route, never a provider explanation', () => {
    const subject = verificationSubject({
      failures: [failure({ objectiveId: OBJECTIVE })],
      objectiveId: OBJECTIVE,
      eligible: [{ candidateId: id('memory-9'), subject: 'The 2019 tier list post' }],
      evidence: snapshot([candidate()]),
    })
    expect(subject).toEqual({
      failures: [{ route: 'vision', failure: 'look timed out after 8000ms' }],
      freshAttemptAllowed: true,
      eligible: [{ candidateId: id('memory-9'), subject: 'The 2019 tier list post' }],
    })
  })

  it('names the Candidate a failed attempt was about when the Session still holds it', () => {
    const subject = verificationSubject({
      failures: [failure({ candidateId: id('memory-9') })],
      objectiveId: OBJECTIVE,
      eligible: [],
      evidence: snapshot([candidate()]),
    })
    expect(subject!.failures[0]).toEqual({
      route: 'vision',
      failure: 'look timed out after 8000ms',
      candidateId: id('memory-9'),
      candidateSubject: 'The 2019 tier list post',
    })
    expect(subject!.freshAttemptAllowed).toBe(false)
  })

  it('is absent when this objective has seen no verification fail', () => {
    expect(
      verificationSubject({ failures: [], objectiveId: OBJECTIVE, eligible: [], evidence: undefined }),
    ).toBeNull()
  })

  it('drops failures belonging to an objective the user replaced', () => {
    expect(
      verificationSubject({
        failures: [failure({ objectiveId: id('memory-old') })],
        objectiveId: OBJECTIVE,
        eligible: [],
        evidence: undefined,
      }),
    ).toBeNull()
  })
})
