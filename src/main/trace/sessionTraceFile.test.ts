import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../../core/session/sessionIdentity'
import { createSessionRuntime } from '../../core/session/sessionRuntime'
import { FakeClock } from '../../core/testing/doubles'
import {
  evidenceAcceptedEntry,
  evidenceBroadcastEntry,
  sessionEvidenceEndEntry,
} from '../../core/trace/evidenceStoreTrace'
import { createSessionTraceWriter, RUN_TRACE_VERSION, type TraceRecord } from '../../core/trace/runTrace'
import { createJsonlRunTraceSink } from './jsonlRunTraceSink'

// The store and view records end to end (#181, ADR 0030): a real Session
// runtime, the real store, and the real rotating sink — read back off
// disk, because the file is the contract. The evidence pull's own record
// is the one seam that needs Electron; it is covered by its builder and
// by the evidence e2e suites.

const SOURCE = 'https://shop.example/acme-router'

class DeterministicIdentities implements SessionIdentitySource {
  private submissions = 0
  private runs = 0
  private sessions = 0
  mintSubmissionId = (): SubmissionId => `submission-${++this.submissions}` as SubmissionId
  mintRunId = (): RunId => `run-${++this.runs}` as RunId
  mintSessionId = (): SessionId => `session-${++this.sessions}` as SessionId
}

function traceRecords(dir: string): TraceRecord[] {
  return readdirSync(dir)
    .filter((name) => /^trace-.*\.jsonl$/.test(name))
    .sort()
    .flatMap((name) =>
      readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as TraceRecord),
    )
}

describe('the store and view records on disk', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'session-trace-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes one record per retained change, one per broadcast, and one at the end', () => {
    const clock = new FakeClock(1_000)
    const traceSession = createSessionTraceWriter({ sink: createJsonlRunTraceSink(dir), now: () => clock.now() })
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      onEvidenceChanged: (change) =>
        traceSession(() => evidenceBroadcastEntry({ change, renderers: ['dashboard', 'feed_panel'] })),
      onEvidenceAccepted: (acceptance) => traceSession(() => evidenceAcceptedEntry(acceptance)),
    })

    const admission = runtime.accept(runtime.submit().submissionId)
    const store = runtime.evidenceStore()!
    const observation = store.checkpointObservation({
      sourceKind: 'web',
      text: 'The Acme router costs $39.',
      references: [{ url: SOURCE }],
      runId: admission.runId,
    })!.observation
    store.addCandidate({
      subject: 'Acme wifi router',
      supportingObservationIds: [observation.id],
      runId: admission.runId,
    })
    // Refused: nothing reached the store, so nothing is recorded.
    store.checkpointObservation({ sourceKind: 'web', text: '', references: [], runId: admission.runId })

    const ended = runtime.end('reset')!
    traceSession(() => sessionEvidenceEndEntry(ended))

    const records = traceRecords(dir)
    expect(records.map((record) => record.kind)).toEqual([
      'evidence_accepted',
      'evidence_broadcast',
      'evidence_accepted',
      'evidence_broadcast',
      'session_evidence_end',
    ])
    for (const record of records) {
      expect(record.v).toBe(RUN_TRACE_VERSION)
      expect(record.sessionId).toBe('session-1')
      expect(record.generation).toBe(0)
      expect(record.at).toBe(1_000)
    }
    expect(records[0]).toMatchObject({
      change: 'observation',
      entryId: 'memory-1',
      merged: false,
      contradicted: [],
      counts: { observations: 1, candidates: 0, contradictions: 0 },
    })
    expect(records[2]).toMatchObject({
      change: 'candidate',
      entryId: 'memory-2',
      counts: { observations: 1, candidates: 1, contradictions: 0 },
    })
    expect(records[1]).toMatchObject({ renderers: ['dashboard', 'feed_panel'] })
    expect(records[4]).toMatchObject({
      reason: 'reset',
      counts: { observations: 1, candidates: 1, contradictions: 0 },
    })
  })

  it('records a merge and a contradiction as what they were, not as a lost Observation', () => {
    const clock = new FakeClock(1_000)
    const traceSession = createSessionTraceWriter({ sink: createJsonlRunTraceSink(dir), now: () => clock.now() })
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      onEvidenceAccepted: (acceptance) => traceSession(() => evidenceAcceptedEntry(acceptance)),
    })

    const admission = runtime.accept(runtime.submit().submissionId)
    const store = runtime.evidenceStore()!
    const web = (text: string) => ({
      sourceKind: 'web' as const,
      text,
      references: [{ url: SOURCE }],
      runId: admission.runId,
    })
    store.checkpointObservation(web('The Acme router costs $39.'))
    store.checkpointObservation(web('The Acme router costs $39.'))
    store.checkpointObservation(web('The Acme router costs $49.'))

    const records = traceRecords(dir)
    expect(records.map((record) => [record.kind, (record as { merged?: boolean }).merged])).toEqual([
      ['evidence_accepted', false],
      ['evidence_accepted', true],
      ['evidence_accepted', false],
    ])
    // The merge left the count where it was; the disagreement was retained.
    expect(records[1]).toMatchObject({
      entryId: 'memory-1',
      counts: { observations: 1, candidates: 0, contradictions: 0 },
    })
    expect(records[2]).toMatchObject({
      entryId: 'memory-2',
      contradicted: ['memory-1'],
      counts: { observations: 2, candidates: 0, contradictions: 1 },
    })
  })
})
