import { describe, expect, it } from 'vitest'
import {
  createVerificationRail,
  verificationRouteOf,
  VERIFICATION_NOTHING_ELIGIBLE_REFUSAL,
  VERIFICATION_ROUTE_SPENT_REFUSAL,
} from './verificationRail'
import type { RetainedVerificationFailure, VerificationCandidate } from '../session/verificationAttempts'
import type { ToolCall } from '../ports/llm'
import type { MemoryEntryId } from '../session/workingMemory'
import type { RunId } from '../session/sessionIdentity'

const id = (value: string): MemoryEntryId => value as MemoryEntryId
const OBJECTIVE = id('memory-objective')

const look: ToolCall = { id: 'l1', name: 'look', args: {} }
const read: ToolCall = { id: 'r1', name: 'read_page', args: {} }

const usesVision = (name: string): boolean => name === 'look'

const failed = (error = 'look timed out after 8000ms') => ({ ok: false as const, error })
const succeeded = { ok: true as const, result: 'a screenshot of a tier list' }

function retained(over: Partial<RetainedVerificationFailure> = {}): RetainedVerificationFailure {
  return {
    route: 'vision',
    failure: 'look timed out after 8000ms',
    objectiveId: OBJECTIVE,
    runId: 'run-1' as RunId,
    failedAt: 0,
    ...over,
  }
}

const candidate: VerificationCandidate = { candidateId: id('memory-9'), subject: 'The 2019 tier list post' }

describe('which route a call spends (#212)', () => {
  it('reads the catalog flag rather than the tool name', () => {
    expect(verificationRouteOf(look, usesVision)).toBe('vision')
    expect(verificationRouteOf(read, usesVision)).toBeNull()
    // A tool named nothing like `look` that reaches the vision model is
    // still on the vision route — the flag decides, as the Vision Budget's does.
    expect(verificationRouteOf({ id: 'x', name: 'inspect_image', args: {} }, () => true)).toBe('vision')
  })
})

describe('a failed check is not sent again in the same Run (#212/AC4)', () => {
  it('passes the first attempt and refuses the second', () => {
    const rail = createVerificationRail()
    expect(rail.gate('vision')).toEqual({ ok: true })
    expect(rail.observe('vision', failed())).toEqual({ route: 'vision', failure: 'look timed out after 8000ms' })
    expect(rail.gate('vision')).toEqual({ ok: false, reason: VERIFICATION_ROUTE_SPENT_REFUSAL })
  })

  it('names the different route and the honest ending, never the route being unavailable', () => {
    // The distinction ADR 0040 insists on: one attempt establishes that
    // one attempt failed. A refusal saying vision is unavailable is what
    // makes a run stop looking at anything at all.
    expect(VERIFICATION_ROUTE_SPENT_REFUSAL).toContain('read_page')
    expect(VERIFICATION_ROUTE_SPENT_REFUSAL).toContain('still unverified')
    expect(VERIFICATION_ROUTE_SPENT_REFUSAL).not.toMatch(/unavailable|broken|offline/i)
    // And it closes the two escapes the policy rules out (#212/AC6).
    expect(VERIFICATION_ROUTE_SPENT_REFUSAL).toContain('Do not ask the user to make the check for you')
    expect(VERIFICATION_ROUTE_SPENT_REFUSAL).toContain('do not collect more candidates behind it')
  })

  it('leaves every other route open — a spent Look never closes the page', () => {
    const rail = createVerificationRail()
    rail.observe('vision', failed())
    expect(rail.gate(null)).toEqual({ ok: true })
    expect(rail.gate('page_text')).toEqual({ ok: true })
  })

  it('spends nothing on a successful attempt', () => {
    const rail = createVerificationRail()
    expect(rail.observe('vision', succeeded)).toBeNull()
    expect(rail.gate('vision')).toEqual({ ok: true })
  })

  it('retains the first failure only, so one spent route is one retained record', () => {
    const rail = createVerificationRail()
    expect(rail.observe('vision', failed())).not.toBeNull()
    expect(rail.observe('vision', failed('look timed out after 8000ms'))).toBeNull()
  })

  it('does not count its own refusal as a second spent attempt', () => {
    const rail = createVerificationRail()
    rail.observe('vision', failed())
    expect(rail.observe('vision', failed(VERIFICATION_ROUTE_SPENT_REFUSAL))).toBeNull()
  })
})

describe('a later Run reopens the route only for something it could settle (#212/AC5)', () => {
  it('opens a fresh attempt when an eligible Candidate is on record', () => {
    const rail = createVerificationRail({
      retainedFailures: () => [retained()],
      eligibleCandidates: () => [candidate],
      objectiveId: () => OBJECTIVE,
    })
    expect(rail.gate('vision')).toEqual({ ok: true })
  })

  it('refuses when the Session spent the route and nothing is left to settle', () => {
    const rail = createVerificationRail({
      retainedFailures: () => [retained()],
      eligibleCandidates: () => [],
      objectiveId: () => OBJECTIVE,
    })
    expect(rail.gate('vision')).toEqual({ ok: false, reason: VERIFICATION_NOTHING_ELIGIBLE_REFUSAL })
  })

  it('closes the fresh attempt again once it has failed too', () => {
    const rail = createVerificationRail({
      retainedFailures: () => [retained()],
      eligibleCandidates: () => [candidate],
      objectiveId: () => OBJECTIVE,
    })
    expect(rail.gate('vision')).toEqual({ ok: true })
    rail.observe('vision', failed('look timed out after 8000ms'))
    // A second failure is answered by a different route or the
    // limitation — never by a third request down the same one.
    expect(rail.gate('vision')).toEqual({ ok: false, reason: VERIFICATION_ROUTE_SPENT_REFUSAL })
  })

  it('reads the eligible set live, so a lead found mid-Run can still be checked', () => {
    let found: VerificationCandidate[] = []
    const rail = createVerificationRail({
      retainedFailures: () => [retained()],
      eligibleCandidates: () => found,
      objectiveId: () => OBJECTIVE,
    })
    expect(rail.gate('vision')).toEqual({ ok: false, reason: VERIFICATION_NOTHING_ELIGIBLE_REFUSAL })
    found = [candidate]
    expect(rail.gate('vision')).toEqual({ ok: true })
  })

  it('ignores a failure retained under an objective the user replaced', () => {
    const rail = createVerificationRail({
      retainedFailures: () => [retained({ objectiveId: id('memory-old') })],
      eligibleCandidates: () => [],
      objectiveId: () => OBJECTIVE,
    })
    expect(rail.gate('vision')).toEqual({ ok: true })
  })

  it('falls back to this Run’s own spend when no Session answers', () => {
    const rail = createVerificationRail({ retainedFailures: () => [] })
    expect(rail.gate('vision')).toEqual({ ok: true })
    rail.observe('vision', failed())
    expect(rail.gate('vision')).toEqual({ ok: false, reason: VERIFICATION_ROUTE_SPENT_REFUSAL })
  })
})
