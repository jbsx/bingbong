import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { tracedEvents } from './runTrace'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { MemoryEntryId } from '../src/core/session/workingMemory'

// Candidate decisions keep their objective and their authority (#208, ADR
// 0039), end to end: a Session sets the user's objective, records a
// Candidate, and rejects it in the user's own words. A later Run finds it
// promising again and is refused; the Evidence Browser shows who decided
// and whether that was for the objective still in force; and a Session
// Reset drops the lot, because a decision lives exactly as long as the
// Session that made it. Real main/preload/renderer boundary, real Electron
// lifecycle, scripted orchestrator — no model budget.

const COMMAND = 'find that tier list post i found last week'
const REJECTION = 'not that one, i never wrote it'
const REOPEN = 'actually show me that one again'
const REVISION = 'it was on a forum, not reddit'
const REPLACEMENT = 'forget that, book me a table for two tonight'

/** The Candidate cards' decision lines, in document order. */
const DECISION_LINES = `[...document.querySelectorAll('.evidence-card--candidate .evidence-decision')].map((el) => el.textContent)`

/** Each Candidate card's live status, from the attribute the card carries. */
const CANDIDATE_STATUSES = `[...document.querySelectorAll('.evidence-card--candidate')].map((el) => el.dataset.candidateStatus)`

/** The authoritative evidence pull, as the renderer API answers it. */
const EVIDENCE_PULL = `(async () => await window.bingbong.evidence.get())()`

/** Runs one command and waits for its answer to reach the Run Trace. */
async function submitAndRecord(app: Harness, command: string, marker: string): Promise<void> {
  expect(await app.submitCommand(command)).toBe('submitted')
  await waitFor(
    async () => (app.runTraceTranscript().includes(marker) ? true : undefined),
    { timeoutMs: 30_000, intervalMs: 250 },
  )
}

/**
 * Shows the Evidence view: the tab that switches to it lives in the
 * Activity header alone, so a panel already showing Evidence is left as
 * it is rather than clicking a control that is no longer there.
 */
async function showEvidence(app: Harness): Promise<void> {
  await waitFor(
    async () => {
      await app.ensurePanelOpen()
      const view = await app.overlayEval<string | null>(
        `document.querySelector('.feed')?.getAttribute('aria-label') ?? null`,
      )
      if (view === 'session evidence') return true
      await app.clickOverlayElement('.feed-tab--evidence')
      return undefined
    },
    { timeoutMs: 15_000, intervalMs: 200 },
  )
}

/** Polls the Evidence view until the read satisfies `settled`. */
async function readEvidenceView<T>(app: Harness, expression: string, settled: (value: T) => boolean): Promise<T> {
  await showEvidence(app)
  return waitFor(
    async () => {
      const value = await app.overlayEval<T>(expression)
      return settled(value) ? value : undefined
    },
    { timeoutMs: 15_000, intervalMs: 100 },
  )
}

describe('candidate decision scope e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('scopes a Candidate decision to its objective and authority, refuses an unauthorised revival, and drops it at Session Reset', async () => {
    const script: AssistantTurn[] = [
      // Run 1 — the user's words become a User Observation, one Candidate
      // rests on them, and the Memory Commit retains the objective those
      // same words set. Ids: memory-1 the words, memory-2 the Candidate,
      // memory-3 the objective.
      {
        kind: 'tool_calls',
        calls: [
          { id: 'e1', name: 'record_evidence', args: { kind: 'user', observation: COMMAND } },
          { id: 'c1', name: 'record_candidate', args: { subject: 'A reddit tier list post', supporting_evidence: ['memory-1'] } },
        ],
      },
      {
        kind: 'answer',
        speak: 'One option so far.',
        display: 'ONE OPTION.',
        runNote: 'Recorded one candidate for the tier list post.',
        memoryPatch: [{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Find the tier list post',
            detail: 'A post the user found last week.',
            userEvidence: ['memory-1' as MemoryEntryId],
          },
        }],
      },
      // Run 2 — the correction, in the user's own words (memory-4), and
      // the rejection recorded on their authority.
      {
        kind: 'tool_calls',
        calls: [
          { id: 'e2', name: 'record_evidence', args: { kind: 'user', observation: REJECTION } },
          { id: 'c2', name: 'record_candidate', args: {
            candidate_id: 'memory-2',
            status: 'rejected',
            reason: REJECTION,
            authority: 'user',
            supporting_evidence: ['memory-4'],
          } },
        ],
      },
      { kind: 'answer', speak: 'Dropped it.', display: 'DROPPED IT.', runNote: 'Dropped the reddit post.' },
      // Run 3 — a later Run finds it promising again. Not its decision to undo.
      {
        kind: 'tool_calls',
        calls: [{ id: 'c3', name: 'record_candidate', args: {
          candidate_id: 'memory-2',
          status: 'accepted',
          reason: 'on reflection it does match',
          supporting_evidence: ['memory-1'],
        } }],
      },
      { kind: 'answer', speak: 'Still looking.', display: 'STILL LOOKING.', runNote: 'Still looking for the post.' },
      // Run 4 — the user reopens it themselves, in their own words (memory-5).
      {
        kind: 'tool_calls',
        calls: [
          { id: 'e3', name: 'record_evidence', args: { kind: 'user', observation: REOPEN } },
          { id: 'c4', name: 'record_candidate', args: {
            candidate_id: 'memory-2',
            status: 'active',
            reason: REOPEN,
            authority: 'user',
            supporting_evidence: ['memory-5'],
          } },
        ],
      },
      { kind: 'answer', speak: 'Back on it.', display: 'BACK ON IT.', runNote: 'Reopened the reddit post.' },
      // Run 5 — a revised constraint (memory-6 the words, memory-7 the
      // constraint). It continues the same objective, so the Candidate and
      // every decision on it stay exactly where they were.
      {
        kind: 'tool_calls',
        calls: [{ id: 'e4', name: 'record_evidence', args: { kind: 'user', observation: REVISION } }],
      },
      {
        kind: 'answer',
        speak: 'Forums it is.',
        display: 'FORUMS ONLY.',
        runNote: 'Narrowed the search to forums.',
        memoryPatch: [{
          op: 'add',
          entry: {
            kind: 'constraint',
            subject: 'Where it was',
            detail: 'The user found it on a forum, not on Reddit.',
            userEvidence: ['memory-6' as MemoryEntryId],
          },
        }],
      },
      // Run 6 — a replacement objective (memory-8 the words, memory-9 the
      // objective). The new task inherits none of the old one's decisions.
      {
        kind: 'tool_calls',
        calls: [{ id: 'e5', name: 'record_evidence', args: { kind: 'user', observation: REPLACEMENT } }],
      },
      {
        kind: 'answer',
        speak: 'On it.',
        display: 'BOOKING NOW.',
        runNote: 'Switched to booking a table.',
        memoryPatch: [{
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Book a table',
            detail: 'A table for two tonight.',
            userEvidence: ['memory-8' as MemoryEntryId],
          },
        }],
      },
      // Run 7 — the Session boundary: everything the Session decided goes.
      { kind: 'tool_calls', calls: [{ id: 'r1', name: 'new_session', args: {} }] },
      { kind: 'answer', speak: 'Fresh start.', display: 'SESSION B STARTED.', runNote: 'Started a new session.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await submitAndRecord(app, COMMAND, 'ONE OPTION.')

      // Nothing has been decided yet, so the card carries no decision line.
      expect(await readEvidenceView<string[]>(app, CANDIDATE_STATUSES, (s) => s.length === 1)).toEqual(['active'])
      expect(await app.overlayEval<string[]>(DECISION_LINES)).toEqual([])

      await submitAndRecord(app, REJECTION, 'DROPPED IT.')

      // The displayed status and the decision behind it: who decided, that
      // it was for the objective still in force, and their reason — with no
      // internal identity anywhere in the visible text.
      await readEvidenceView<string[]>(app, CANDIDATE_STATUSES, (statuses) => statuses.includes('rejected'))
      const decisionLines = await app.overlayEval<string[]>(DECISION_LINES)
      expect(decisionLines).toEqual([`rejected by the user for the current objective — ${REJECTION}`])
      expect(decisionLines[0]).not.toContain('memory-')

      // The authoritative snapshot — the same one a later Run's context
      // carries — holds the decision with its objective and its authority.
      const pulled = await app.overlayEval<{
        snapshot: {
          objectiveId?: string
          candidates: { id: string; status: string; decisions: { status: string; authority: string; reason: string; objectiveId?: string }[] }[]
        }
      } | null>(EVIDENCE_PULL)
      expect(pulled?.snapshot.objectiveId).toBe('memory-3')
      expect(pulled?.snapshot.candidates).toEqual([expect.objectContaining({
        id: 'memory-2',
        status: 'rejected',
        decisions: [expect.objectContaining({
          status: 'rejected',
          authority: 'user',
          reason: REJECTION,
          objectiveId: 'memory-3',
        })],
      })])

      await submitAndRecord(app, 'keep looking', 'STILL LOOKING.')

      // The revival was refused as a recoverable tool error naming what
      // would move it, and the user's rejection is what still stands.
      const refusals = tracedEvents(app.readRunTrace(), 'tool_result')
        .filter((event) => !event.ok)
        .map((event) => event.error ?? '')
      expect(refusals.some((error) => /only the user reopens it/.test(error))).toBe(true)
      expect(await readEvidenceView<string[]>(app, CANDIDATE_STATUSES, (statuses) => statuses.length === 1))
        .toEqual(['rejected'])

      // The user reopens it themselves — the one thing that undoes their
      // own rejection — and the rejection it overturned stays on the record.
      await submitAndRecord(app, REOPEN, 'BACK ON IT.')
      await readEvidenceView<string[]>(app, CANDIDATE_STATUSES, (statuses) => statuses.includes('active'))
      expect(await app.overlayEval<string[]>(DECISION_LINES))
        .toEqual([`reopened by the user for the current objective — ${REOPEN}`])

      // Revising a constraint continues the same objective, so the
      // Candidate keeps every decision made under it.
      await submitAndRecord(app, REVISION, 'FORUMS ONLY.')
      const revised = await app.overlayEval<{
        snapshot: { objectiveId?: string; candidates: { decisions: { status: string; authority: string }[] }[] }
      } | null>(EVIDENCE_PULL)
      expect(revised?.snapshot.objectiveId).toBe('memory-3')
      expect(revised?.snapshot.candidates[0]?.decisions.map((d) => `${d.status}:${d.authority}`))
        .toEqual(['rejected:user', 'active:user'])

      // Replacing the objective is a different task: the decisions made
      // for the old one stay on the record under it, and the Candidate
      // reads as undecided here rather than as universally invalid.
      await submitAndRecord(app, REPLACEMENT, 'BOOKING NOW.')
      const replaced = await app.overlayEval<{ snapshot: { objectiveId?: string } } | null>(EVIDENCE_PULL)
      expect(replaced?.snapshot.objectiveId).toBe('memory-9')
      expect(await readEvidenceView<string[]>(app, CANDIDATE_STATUSES, (statuses) => statuses.includes('active')))
        .toEqual(['active'])
      expect(await app.overlayEval<string[]>(DECISION_LINES))
        .toEqual([`reopened by the user for an earlier objective — ${REOPEN}`])

      // Session Reset is the decision's lifetime: the replacement Session
      // starts with no Candidate, no decision, and nothing to revive.
      await submitAndRecord(app, 'forget all that — different question', 'SESSION B STARTED.')
      await waitFor(
        async () => {
          await app.ensurePanelOpen()
          const badge = await app.overlayEval<string | null>(
            `document.querySelector('.feed-tab--evidence .feed-tab-count')?.textContent ?? null`,
          )
          return badge === null ? true : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      const afterReset = await app.overlayEval<{ snapshot: { candidates: unknown[] } } | null>(EVIDENCE_PULL)
      expect(afterReset?.snapshot.candidates ?? []).toEqual([])
    } finally {
      await app.quit()
    }
  })
})
