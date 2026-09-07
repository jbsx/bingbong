import { describe, expect, it } from 'vitest'
import {
  candidateDecisionRefusal,
  describeCandidateDecision,
  latestDecisionUnder,
  MAX_CANDIDATE_DECISIONS,
  retainedDecisions,
  type CandidateDecision,
  type ProposedCandidateDecision,
} from './candidateDecisions'
import type { MemoryEntryId } from './workingMemory'

const id = (value: string): MemoryEntryId => value as MemoryEntryId
const objectiveA = id('memory-2')
const objectiveB = id('memory-9')

function decision(fields: Partial<CandidateDecision> = {}): CandidateDecision {
  return {
    status: 'rejected',
    authority: 'model',
    reason: 'the price is above the ceiling',
    objectiveId: objectiveA,
    supportingObservationIds: [id('memory-3')],
    decidedAt: 1,
    ...fields,
  }
}

function proposed(fields: Partial<ProposedCandidateDecision> = {}): ProposedCandidateDecision {
  return {
    status: 'accepted',
    authority: 'model',
    objectiveId: objectiveA,
    supportingObservationIds: [id('memory-4')],
    ...fields,
  }
}

describe('Candidate decisions are scoped to an objective (#208, ADR 0039)', () => {
  it('reads what stands for one objective and nothing for another', () => {
    const decisions = [decision({ status: 'rejected' }), decision({ objectiveId: objectiveB, status: 'accepted' })]
    expect(latestDecisionUnder(decisions, objectiveA)?.status).toBe('rejected')
    expect(latestDecisionUnder(decisions, objectiveB)?.status).toBe('accepted')
    expect(latestDecisionUnder(decisions, id('memory-77'))).toBeNull()
    // A Session that held no user objective decides in one implicit scope
    // — and that scope is not any objective's.
    expect(latestDecisionUnder(decisions, undefined)).toBeNull()
  })

  it('refuses a status the scope already holds, and admits it under another objective', () => {
    const decisions = [decision({ status: 'rejected' })]
    expect(candidateDecisionRefusal(decisions, proposed({ status: 'rejected' }))).toBe('replayed')
    // Deciding the same way for a different objective is a new fact, not a
    // restatement: nothing had been decided for B.
    expect(candidateDecisionRefusal(decisions, proposed({ status: 'rejected', objectiveId: objectiveB }))).toBeNull()
  })

  it('refuses a reopening of a scope that decided nothing', () => {
    expect(candidateDecisionRefusal([], proposed({ status: 'active' }))).toBe('nothing_to_reopen')
    expect(candidateDecisionRefusal([decision({ objectiveId: objectiveB })], proposed({ status: 'active' })))
      .toBe('nothing_to_reopen')
  })
})

describe('a user decision stands until the user takes it back (#208, ADR 0039)', () => {
  const userRejection = [decision({ authority: 'user', reason: 'not that one — I wrote it, I did not find it' })]

  it('refuses the model reviving what the user rejected, however promising it now looks', () => {
    expect(candidateDecisionRefusal(userRejection, proposed({ status: 'accepted' }))).toBe('user_decision_stands')
    expect(candidateDecisionRefusal(userRejection, proposed({ status: 'active' }))).toBe('user_decision_stands')
    // New evidence is not authority: the model may not overturn the user
    // by finding more of its own.
    expect(
      candidateDecisionRefusal(userRejection, proposed({ status: 'accepted', supportingObservationIds: [id('memory-88')] })),
    ).toBe('user_decision_stands')
  })

  it('admits an explicit user reopening, and leaves another objective free', () => {
    expect(candidateDecisionRefusal(userRejection, proposed({ status: 'active', authority: 'user' }))).toBeNull()
    // The rejection was for A. Objective B never decided this Candidate,
    // so B is not bound by it — the Observations behind it may still be
    // useful for a different task.
    expect(candidateDecisionRefusal(userRejection, proposed({ status: 'accepted', objectiveId: objectiveB }))).toBeNull()
  })
})

describe('a model elimination is reconsiderable on new evidence (#208, ADR 0039)', () => {
  const eliminated = [decision({ supportingObservationIds: [id('memory-3'), id('memory-5')] })]

  it('refuses a reconsideration standing on the grounds it already had', () => {
    expect(
      candidateDecisionRefusal(eliminated, proposed({ status: 'active', supportingObservationIds: [id('memory-3')] })),
    ).toBe('no_new_evidence')
  })

  it('admits one citing something the elimination did not stand on', () => {
    expect(
      candidateDecisionRefusal(
        eliminated,
        proposed({ status: 'active', supportingObservationIds: [id('memory-3'), id('memory-7')] }),
      ),
    ).toBeNull()
  })

  it('lets the user overturn it with no new grounds at all', () => {
    expect(
      candidateDecisionRefusal(
        eliminated,
        proposed({ status: 'accepted', authority: 'user', supportingObservationIds: [id('memory-3')] }),
      ),
    ).toBeNull()
  })
})

describe('retained decisions preserve what they overturn (#208, ADR 0039)', () => {
  it('appends rather than rewriting, so a model elimination survives a later user rejection', () => {
    const eliminated = decision({ reason: 'out of stock' })
    const rejected = decision({ authority: 'user', status: 'rejected', reason: 'not that one', decidedAt: 2 })
    const retained = retainedDecisions([eliminated], rejected)
    expect(retained).toEqual([eliminated, rejected])
    expect(retained[0]!.authority).toBe('model')
    expect(retained[0]!.reason).toBe('out of stock')
  })

  it('keeps the most recent decisions past the bound', () => {
    let retained: CandidateDecision[] = [decision({ reason: 'first' })]
    for (let n = 2; n <= MAX_CANDIDATE_DECISIONS + 3; n += 1) {
      retained = retainedDecisions(retained, decision({ reason: `reason ${n}`, decidedAt: n }))
    }
    expect(retained).toHaveLength(MAX_CANDIDATE_DECISIONS)
    expect(retained.at(-1)!.reason).toBe(`reason ${MAX_CANDIDATE_DECISIONS + 3}`)
  })

  it('never trims away what stands for an objective, however old', () => {
    // The user's rejection for objective A, then a long run of work under
    // B. Trimming by age alone would drop the rejection off the front and
    // silently admit a revival for A — so it is kept before any history.
    const rejection = decision({ authority: 'user', reason: 'not that one', decidedAt: 1 })
    let retained: CandidateDecision[] = [rejection]
    for (let n = 2; n <= MAX_CANDIDATE_DECISIONS + 5; n += 1) {
      retained = retainedDecisions(retained, decision({
        objectiveId: objectiveB,
        status: n % 2 === 0 ? 'accepted' : 'rejected',
        reason: `reason ${n}`,
        decidedAt: n,
      }))
    }
    expect(retained).toHaveLength(MAX_CANDIDATE_DECISIONS)
    expect(latestDecisionUnder(retained, objectiveA)).toEqual(rejection)
    expect(candidateDecisionRefusal(retained, proposed({ status: 'accepted' }))).toBe('user_decision_stands')
    // And the newest history under the objective actually being worked is
    // still there — the guard is kept first, not instead.
    expect(retained.at(-1)!.reason).toBe(`reason ${MAX_CANDIDATE_DECISIONS + 5}`)
  })
})

describe('a decision reads without exposing an identity (#142, #208)', () => {
  it('names who decided and whether the objective is still the one in force', () => {
    expect(describeCandidateDecision(decision({ authority: 'user' }), objectiveA)).toBe(
      'rejected by the user for the current objective',
    )
    expect(describeCandidateDecision(decision(), objectiveB)).toBe('rejected by the assistant for an earlier objective')
    expect(describeCandidateDecision(decision({ status: 'active' }), objectiveA)).toBe(
      'reopened by the assistant for the current objective',
    )
    // Nothing to compare against: the decision still says who made it.
    expect(describeCandidateDecision(decision({ objectiveId: undefined }))).toBe('rejected by the assistant')
    expect(describeCandidateDecision(decision(), objectiveA)).not.toContain('memory-')
  })
})
