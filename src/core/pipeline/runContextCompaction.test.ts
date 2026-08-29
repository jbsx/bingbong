import { describe, expect, it } from 'vitest'
import type { ToolResult } from '../ports/llm'
import type { ObservationId, ObservationRecord } from '../session/observationLedger'
import type { MemoryEntryId } from '../session/workingMemory'
import type { SessionObservation } from '../session/sessionEvidence'
import {
  COMPACTED_RESULT_PREFIX,
  compactRunContext,
  RUN_CONTEXT_COMPACTION_THRESHOLD_CHARS,
  runContextChars,
  type RunEvidenceCheckpoint,
} from './runContextCompaction'

const PAGE_URL = 'https://shop.example/acme-router'

/** A page-read-shaped ledger record: ok, text payload, observed source URL. */
function record(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    id: 'obs-1' as ObservationId,
    at: 0,
    producer: 'page_read',
    ok: true,
    payload: 'Full page text with the price.',
    sourceUrl: PAGE_URL,
    ...overrides,
  }
}

function readResult(id: string, text: string, overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    call: { id, name: 'read_page', args: {} },
    outcome: { ok: true, result: text },
    ...overrides,
  }
}

/** A live Session Observation the reference cites: text, source, provenance. */
function observation(overrides: Partial<SessionObservation> = {}): SessionObservation {
  return {
    id: 'memory-1' as MemoryEntryId,
    sessionId: 'session-1' as SessionObservation['sessionId'],
    sourceKind: 'web',
    text: 'The Acme router costs $39.',
    observedAt: 0,
    references: [{ url: PAGE_URL }],
    provenance: [{ runId: 'run-1' as SessionObservation['provenance'][number]['runId'] }],
    ...overrides,
  }
}

function checkpoint(overrides: Partial<RunEvidenceCheckpoint> = {}): RunEvidenceCheckpoint {
  return { entryId: 'memory-1' as MemoryEntryId, sourceObservationId: 'obs-1' as ObservationId, ...overrides }
}

/** The common input shape with per-test overrides. */
function input(overrides: Partial<Parameters<typeof compactRunContext>[0]> = {}) {
  return {
    toolResults: [] as readonly ToolResult[],
    observationIds: [] as readonly (ObservationId | null)[],
    records: [] as readonly ObservationRecord[],
    checkpoints: [] as readonly RunEvidenceCheckpoint[],
    resolveObservation: (): SessionObservation | null => observation(),
    thresholdChars: 1,
    ...overrides,
  }
}

/** The string content of a successful result — the reference text compacted results carry. */
function resultText(result: ToolResult): string {
  return result.outcome.ok && typeof result.outcome.result === 'string' ? result.outcome.result : ''
}

describe('runContextChars', () => {
  it('measures the serialized size of the Run model context deterministically', () => {
    const results: ToolResult[] = [
      readResult('c1', 'abc'),
      { call: { id: 'c2', name: 'click', args: { ref: 3 } }, outcome: { ok: false, error: 'nope' } },
    ]
    expect(runContextChars(results)).toBe(runContextChars(results))
    expect(runContextChars(results)).toBeGreaterThan('abc'.length)
    expect(runContextChars([])).toBe(0)
  })
})

describe('compactRunContext (#124, ADR 0028)', () => {
  it('starts only after the deterministic size threshold', () => {
    const results = [
      readResult('c1', 'x'.repeat(500)),
      readResult('c2', 'latest page state'),
    ]
    const observationIds: readonly (ObservationId | null)[] = ['obs-1' as ObservationId, 'obs-2' as ObservationId]
    const records = [
      record(),
      record({ id: 'obs-2' as ObservationId, payload: 'newer', sourceUrl: 'https://shop.example/next' }),
    ]
    const checkpoints = [checkpoint()]
    const below = compactRunContext(input({
      toolResults: results,
      observationIds,
      records,
      checkpoints,
      thresholdChars: runContextChars(results),
    }))
    expect(below).toBe(results)

    const above = compactRunContext(input({
      toolResults: results,
      observationIds,
      records,
      checkpoints,
      thresholdChars: runContextChars(results) - 1,
    }))
    expect(above).not.toBe(results)
  })

  it('returns the original context untouched with no accepted checkpoints', () => {
    const results = [readResult('c1', 'x'.repeat(500))]
    expect(compactRunContext(input({
      toolResults: results,
      observationIds: ['obs-1' as ObservationId],
      records: [record()],
      checkpoints: [],
    }))).toBe(results)
  })

  it('replaces an older checkpointed observation with its Session Evidence reference', () => {
    const older = readResult('c1', 'x'.repeat(500))
    const latest = readResult('c2', 'y'.repeat(500))
    const compacted = compactRunContext(input({
      toolResults: [older, latest],
      observationIds: ['obs-1' as ObservationId, 'obs-2' as ObservationId],
      records: [record(), record({ id: 'obs-2' as ObservationId, payload: 'newer', sourceUrl: 'https://shop.example/next' })],
      checkpoints: [checkpoint()],
    }))
    const replaced = compacted[0]!
    expect(replaced.outcome).toEqual({ ok: true, result: expect.stringContaining(COMPACTED_RESULT_PREFIX) })
    expect(resultText(replaced)).toContain('memory-1')
    expect(resultText(replaced)).toContain(PAGE_URL)
    expect(resultText(replaced)).toContain('The Acme router costs $39.')
    // The latest actionable page state stays verbatim.
    expect(compacted[1]).toBe(latest)
  })

  it('is idempotent: a second pass over its own output changes nothing', () => {
    const older = readResult('c1', 'x'.repeat(500))
    const latest = readResult('c2', 'y'.repeat(500))
    const observationIds: readonly (ObservationId | null)[] = ['obs-1' as ObservationId, 'obs-2' as ObservationId]
    const records = [record(), record({ id: 'obs-2' as ObservationId, payload: 'newer', sourceUrl: 'https://shop.example/next' })]
    const checkpoints = [checkpoint()]
    const once = compactRunContext(input({ toolResults: [older, latest], observationIds, records, checkpoints }))
    const twice = compactRunContext(input({ toolResults: once, observationIds, records, checkpoints }))
    expect(twice).toBe(once)
    // And the already-compacted pair keeps its call untouched.
    expect(twice[0]!.call).toBe(older.call)
  })

  it('keeps failures, user events, non-page tools, and uncheckpointed material verbatim', () => {
    const failed = readResult('c1', '', { outcome: { ok: false, error: 'navigation failed' } })
    const ask = { call: { id: 'c2', name: 'ask_user', args: {} }, outcome: { ok: true, result: 'the blue one' } } as ToolResult
    const uncheckpointed = readResult('c3', 'z'.repeat(500))
    const checkpointedOlder = readResult('c4', 'w'.repeat(500))
    const latest = readResult('c5', 'v'.repeat(500))
    const compacted = compactRunContext(input({
      toolResults: [failed, ask, uncheckpointed, checkpointedOlder, latest],
      observationIds: [
        'obs-1' as ObservationId,
        'obs-2' as ObservationId,
        'obs-3' as ObservationId,
        'obs-4' as ObservationId,
        'obs-5' as ObservationId,
      ],
      records: [
        record({ id: 'obs-1' as ObservationId }),
        record({ id: 'obs-2' as ObservationId, producer: 'ask_user', sourceUrl: undefined, payload: 'the blue one' }),
        record({ id: 'obs-3' as ObservationId, ok: false, sourceUrl: undefined, payload: 'navigation failed' }),
        record({ id: 'obs-4' as ObservationId, payload: 'w'.repeat(500) }),
        record({ id: 'obs-5' as ObservationId, payload: 'v'.repeat(500), sourceUrl: 'https://shop.example/now' }),
      ],
      checkpoints: [checkpoint({ sourceObservationId: 'obs-4' as ObservationId })],
    }))
    expect(compacted[0]).toBe(failed)
    expect(compacted[1]).toBe(ask)
    expect(compacted[2]).toBe(uncheckpointed)
    expect(resultText(compacted[3]!)).toContain(COMPACTED_RESULT_PREFIX)
    expect(compacted[4]).toBe(latest)
  })

  it('keeps provider-protocol validity: every call keeps exactly one paired result', () => {
    const older = readResult('c1', 'x'.repeat(500))
    const latest = readResult('c2', 'y'.repeat(500))
    const compacted = compactRunContext(input({
      toolResults: [older, latest],
      observationIds: ['obs-1' as ObservationId, 'obs-2' as ObservationId],
      records: [record(), record({ id: 'obs-2' as ObservationId, payload: 'newer', sourceUrl: 'https://shop.example/next' })],
      checkpoints: [checkpoint()],
    }))
    expect(compacted).toHaveLength(2)
    expect(compacted.map(({ call }) => call)).toEqual([older.call, latest.call])
    expect(compacted.every(({ outcome }) => 'ok' in outcome)).toBe(true)
  })

  it('falls back to the original context when no cited evidence stays live', () => {
    const older = readResult('c1', 'x'.repeat(500))
    const latest = readResult('c2', 'y'.repeat(500))
    const results = [older, latest]
    expect(compactRunContext(input({
      toolResults: results,
      observationIds: ['obs-1' as ObservationId, 'obs-2' as ObservationId],
      records: [record(), record({ id: 'obs-2' as ObservationId, payload: 'newer', sourceUrl: 'https://shop.example/next' })],
      checkpoints: [checkpoint()],
      resolveObservation: () => null,
    }))).toBe(results)
  })

  it('discloses volatility and cites every accepted entry for the observation', () => {
    const older = readResult('c1', 'x'.repeat(500))
    const latest = readResult('c2', 'y'.repeat(500))
    const compacted = compactRunContext(input({
      toolResults: [older, latest],
      observationIds: ['obs-1' as ObservationId, 'obs-2' as ObservationId],
      records: [record(), record({ id: 'obs-2' as ObservationId, payload: 'newer', sourceUrl: 'https://shop.example/next' })],
      checkpoints: [
        checkpoint(),
        checkpoint({ entryId: 'memory-2' as MemoryEntryId }),
      ],
      resolveObservation: (id) =>
        observation({
          id,
          volatile: true,
          text: 'Stock is 3 units — ' + 'long tail '.repeat(60),
        }),
    }))
    const text = resultText(compacted[0]!)
    expect(text).toContain('memory-1')
    expect(text).toContain('memory-2')
    expect(text).toContain('volatile')
    // The quoted Observation stays concise.
    expect(text.length).toBeLessThan(600)
    expect(text).not.toContain('\n')
  })

  it('defaults to the product threshold constant', () => {
    expect(RUN_CONTEXT_COMPACTION_THRESHOLD_CHARS).toBeGreaterThan(0)
  })
})
