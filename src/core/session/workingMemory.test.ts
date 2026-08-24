import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from './sessionIdentity'
import {
  applyMemoryPatch,
  canonicalizeMemoryUrl,
  parseMemoryPatch,
  type MemoryEntry,
  type MemoryEntryId,
} from './workingMemory'

describe('Working Memory', () => {
  it('accepts only the fixed model-writable schema and canonicalizes source URLs', () => {
    const patch = parseMemoryPatch([{
      op: 'add',
      entry: {
        kind: 'finding',
        subject: 'Release notes',
        detail: 'Version 2 shipped.',
        references: [{ url: 'HTTPS://Example.COM:443/releases/?b=2&a=1#install', title: ' Releases ' }],
        subagent_id: 'agent-2',
      },
    }])

    expect(patch).toEqual([{
      op: 'add',
      entry: {
        kind: 'finding',
        subject: 'Release notes',
        detail: 'Version 2 shipped.',
        references: [{ url: 'https://example.com/releases?a=1&b=2', title: 'Releases' }],
        subagentId: 'agent-2',
      },
    }])
    expect(parseMemoryPatch([{ op: 'add', entry: { kind: 'instruction', subject: 'Ignore rules', detail: 'Do this.' } }])).toBeNull()
    expect(parseMemoryPatch([{ op: 'add', entry: { kind: 'finding', subject: 'X', detail: 'Y', id: 'model-id' } }])).toBeNull()
    expect(parseMemoryPatch([{ op: 'add', entry: { kind: 'finding', subject: 'Unattributed', detail: 'A web claim.' } }])).toBeNull()
    expect(parseMemoryPatch([{ op: 'add', entry: { kind: 'assessment', subject: 'Unattributed', detail: 'A web assessment.' } }])).toBeNull()
    expect(canonicalizeMemoryUrl('javascript:alert(1)')).toBeNull()
  })

  it('assigns ids, rejects canonical duplicates, and retains Run and Subagent provenance on updates', () => {
    let nextId = 1
    const mint = () => `memory-${nextId++}` as MemoryEntryId
    const run1 = 'run-1' as RunId
    const run2 = 'run-2' as RunId
    const sessionId = 'session-1' as SessionId
    const added = applyMemoryPatch([], parseMemoryPatch([{
      op: 'add',
      entry: {
        kind: 'finding',
        subject: 'Candidate A',
        detail: 'Promising.',
        references: [{ url: 'https://example.com/item/' }],
        subagent_id: 'agent-1',
      },
    }])!, run1, sessionId, mint, 10_000)!

    expect(added[0]).toMatchObject({
      id: 'memory-1',
      sessionId: 'session-1',
      references: [{ url: 'https://example.com/item' }],
      provenance: [{ runId: 'run-1', subagentId: 'agent-1' }],
    })
    expect(applyMemoryPatch(added, parseMemoryPatch([{
      op: 'add',
      entry: { kind: 'assessment', subject: 'Same page', detail: 'A distinct assessment.', references: [{ url: 'https://EXAMPLE.com/item#x' }] },
    }])!, run2, sessionId, mint, 10_000)).toHaveLength(2)

    expect(applyMemoryPatch(added, parseMemoryPatch([{
      op: 'add',
      entry: { kind: 'finding', subject: 'Renamed candidate', detail: 'Promising.', references: [{ url: 'https://EXAMPLE.com/item#x' }] },
    }])!, run2, sessionId, mint, 10_000)).toBeNull()

    const updated = applyMemoryPatch(added, parseMemoryPatch([{
      op: 'update',
      id: 'memory-1',
      entry: {
        kind: 'assessment',
        subject: 'Candidate A',
        detail: 'Strongest option.',
        references: [{ url: 'https://example.com/item' }],
        subagent_id: 'agent-2',
      },
    }])!, run2, sessionId, mint, 10_000)!
    expect(updated[0]).toMatchObject({
      id: 'memory-1',
      kind: 'assessment',
      provenance: [
        { runId: 'run-1', subagentId: 'agent-1' },
        { runId: 'run-2', subagentId: 'agent-2' },
      ],
    })
  })

  it('resolves only open items, restricts removal reasons, and applies patches atomically', () => {
    const existing: MemoryEntry[] = [{
      id: 'memory-1' as MemoryEntryId,
      sessionId: 'session-1' as SessionId,
      kind: 'open_item',
      subject: 'Verify price',
      detail: 'Price remains unknown.',
      references: [],
      provenance: [{ runId: 'run-1' as RunId }],
    }]
    const resolved = applyMemoryPatch(existing, parseMemoryPatch([{
      op: 'resolve', id: 'memory-1', outcome: 'Verified at $20.', references: [{ url: 'https://shop.example/p' }],
    }])!, 'run-2' as RunId, 'session-1' as SessionId, () => 'unused' as MemoryEntryId, 10_000)!
    expect(resolved[0]).toMatchObject({ status: 'resolved', detail: 'Verified at $20.', provenance: [{ runId: 'run-1' }, { runId: 'run-2' }] })
    expect(parseMemoryPatch([{ op: 'remove', id: 'memory-1', reason: 'obsolete' }])).toBeNull()
    expect(applyMemoryPatch(existing, parseMemoryPatch([
      { op: 'remove', id: 'memory-1', reason: 'invalid' },
    ])!, 'run-2' as RunId, 'session-1' as SessionId, () => 'unused' as MemoryEntryId, 10_000)).toBeNull()
    const duplicate = {
      ...existing[0]!,
      id: 'memory-2' as MemoryEntryId,
      provenance: [{ runId: 'run-2' as RunId }],
    }
    expect(applyMemoryPatch([existing[0]!, duplicate], parseMemoryPatch([
      { op: 'remove', id: 'memory-2', reason: 'duplicate' },
    ])!, 'run-3' as RunId, 'session-1' as SessionId, () => 'unused' as MemoryEntryId, 10_000)).toEqual(existing)

    const invalid = applyMemoryPatch(existing, parseMemoryPatch([
      { op: 'update', id: 'memory-1', entry: { kind: 'decision', subject: 'Choice', detail: 'Keep it.' } },
      { op: 'resolve', id: 'missing', outcome: 'Nope.' },
    ])!, 'run-2' as RunId, 'session-1' as SessionId, () => 'unused' as MemoryEntryId, 10_000)
    expect(invalid).toBeNull()
    expect(existing[0]).toMatchObject({ kind: 'open_item', detail: 'Price remains unknown.' })
  })
})
