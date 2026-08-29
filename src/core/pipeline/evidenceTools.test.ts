import { describe, expect, it } from 'vitest'
import { createRecordEvidenceTool } from './evidenceTools'
import { evaluateEvidenceCheckpoint, userEvidenceCommit, webEvidenceCommit, type EvidenceCommit } from './evidenceCheckpoint'
import type { ObservationRecord } from '../session/observationLedger'
import type { RunId, SessionId } from '../session/sessionIdentity'
import type { MemoryEntryId } from '../session/workingMemory'
import { createSessionEvidence, type SessionEvidenceStore } from '../session/sessionEvidence'
import { FakeClock } from '../testing/doubles'

function storeHarness(): SessionEvidenceStore {
  let next = 0
  return createSessionEvidence({
    sessionId: 'session-1' as SessionId,
    now: () => 0,
    mintId: () => `memory-${++next}` as MemoryEntryId,
  })
}

const GROUNDED_ARGS = {
  observation: 'The Acme router costs $39.',
  source_url: 'https://shop.example/acme-router',
  excerpt: 'costs $39',
}

function contextWith(store: SessionEvidenceStore | null) {
  const records: ObservationRecord[] = [
    {
      id: 'obs-2' as ObservationRecord['id'],
      at: 0,
      producer: 'page_read',
      ok: true,
      payload: 'The Acme router costs $39.',
      sourceUrl: 'https://shop.example/acme-router',
    },
    {
      id: 'obs-3' as ObservationRecord['id'],
      at: 10,
      producer: 'ask_user',
      ok: true,
      payload: 'No, the blue one.',
    },
  ]
  const commit: EvidenceCommit | undefined = store === null ? undefined : webEvidenceCommit(() => store, 'run-1' as RunId)
  const commitUser: EvidenceCommit | undefined = store === null ? undefined : userEvidenceCommit(() => store, 'run-1' as RunId)
  return {
    clock: new FakeClock(),
    checkpointEvidence: (call: Parameters<typeof evaluateEvidenceCheckpoint>[0]) =>
      evaluateEvidenceCheckpoint(call, { records, commit, commitUser }),
  }
}

describe('record_evidence tool', () => {
  const tool = createRecordEvidenceTool()

  it('is bookkeeping: never acquisition, never history- or risk-gated', () => {
    expect(tool.acquisition).not.toBe(true)
    expect(tool.requiresHistory).not.toBe(true)
    expect(tool.assessRisk).toBeUndefined()
    expect(tool.askUser).toBeUndefined()
  })

  it('returns the Memory Entry identity on a grounded citation', async () => {
    const store = storeHarness()
    const result = await tool.execute(
      { id: 'c1', name: 'record_evidence', args: GROUNDED_ARGS },
      contextWith(store),
    )
    expect(result).toContain('memory-1')
    expect(store.snapshot().observations).toHaveLength(1)
  })

  it('fails recoverably — a tool error, never a crashed run — when the Session is absent', async () => {
    await expect(
      tool.execute({ id: 'c1', name: 'record_evidence', args: GROUNDED_ARGS }, contextWith(null)),
    ).rejects.toThrow(/no live Session/i)
  })

  it('fails recoverably when the citation is not grounded', async () => {
    const store = storeHarness()
    await expect(
      tool.execute(
        { id: 'c1', name: 'record_evidence', args: { ...GROUNDED_ARGS, excerpt: 'costs $59' } },
        contextWith(store),
      ),
    ).rejects.toThrow(/excerpt does not appear/i)
    expect(store.snapshot().observations).toEqual([])
  })

  it('checkpoints the user\'s exact words as a User Observation (#122)', async () => {
    const store = storeHarness()
    const result = await tool.execute(
      { id: 'c1', name: 'record_evidence', args: { kind: 'user', observation: 'No, the blue one.' } },
      contextWith(store),
    )
    expect(result).toContain('memory-1')
    expect(result).toMatch(/ask_user/i)
    expect(store.snapshot().observations).toEqual([expect.objectContaining({
      sourceKind: 'user',
      text: 'No, the blue one.',
      originEvent: { producer: 'ask_user', observationId: 'obs-3' },
    })])
  })

  it('fails recoverably when the user\'s words were never heard this run (#122)', async () => {
    const store = storeHarness()
    await expect(
      tool.execute(
        { id: 'c1', name: 'record_evidence', args: { kind: 'user', observation: 'the blue one, actually' } },
        contextWith(store),
      ),
    ).rejects.toThrow(/exact words/i)
    expect(store.snapshot().observations).toEqual([])
  })
})
