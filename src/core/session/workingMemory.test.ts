import { describe, expect, it } from 'vitest'
import type { RunId, SessionId } from './sessionIdentity'
import {
  applyMemoryPatch,
  canonicalizeMemoryUrl,
  currentUserObjective,
  hasUserAuthority,
  parseMemoryPatch,
  userConstraintsFor,
  type MemoryEntry,
  type MemoryEntryId,
  type MemoryPatchGrounding,
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

  describe('user authority over the objective (#206, ADR 0039)', () => {
    const run = (n: number) => `run-${n}` as RunId
    const sessionId = 'session-1' as SessionId
    /** The Session grounded these two identities in the user's own words. */
    const grounding: MemoryPatchGrounding = {
      isUserObservation: (id) => id === 'memory-user-1' || id === 'memory-user-2',
    }

    function minter() {
      let next = 1
      return () => `memory-${next++}` as MemoryEntryId
    }

    /**
     * The state a first Run leaves: the user's objective and one user
     * constraint on it, plus the Session's id source, so a follow-up Run
     * in the same scenario mints identities the first Run has not used.
     */
    function establishedObjective(mint: () => MemoryEntryId = minter()): MemoryEntry[] {
      const memory = applyMemoryPatch([], parseMemoryPatch([
        {
          op: 'add',
          entry: {
            kind: 'objective',
            subject: 'Find the tier list post',
            detail: 'A post the user found earlier.',
            user_evidence: ['memory-user-1'],
          },
        },
        {
          op: 'add',
          entry: {
            kind: 'constraint',
            subject: 'Authorship',
            detail: 'The user found the post; they did not write it.',
            user_evidence: ['memory-user-1'],
          },
        },
      ])!, run(1), sessionId, mint, 100_000, grounding)
      expect(memory).not.toBeNull()
      return memory!
    }

    it('refuses the scoping fields on kinds that carry no user authority', () => {
      expect(parseMemoryPatch([{
        op: 'add',
        entry: {
          kind: 'assessment',
          subject: 'Authorship',
          detail: 'The user wrote the post.',
          references: [{ url: 'https://example.com/p' }],
          user_evidence: ['memory-user-1'],
        },
      }])).toBeNull()
      expect(parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'objective', subject: 'X', detail: 'Y', objective_id: 'memory-1' },
      }])).toBeNull()
      expect(parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'constraint', subject: 'X', detail: 'Y', user_evidence: [] },
      }])).toBeNull()
    })

    it('reserves the retirement status, so no patch can retire the objective by writing the word', () => {
      expect(parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'objective', subject: 'Find the post', detail: 'A post the user found.', status: 'superseded' },
      }])).toBeNull()
      expect(parseMemoryPatch([{
        op: 'update',
        id: 'memory-1',
        entry: {
          kind: 'objective',
          subject: 'Find the post',
          detail: 'A post the user found.',
          status: 'superseded',
          user_evidence: ['memory-user-1'],
        },
      }])).toBeNull()
      // Only these two kinds reserve it — nothing else reads the word.
      expect(parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'decision', subject: 'Old plan', detail: 'Abandoned.', status: 'superseded' },
      }])).not.toBeNull()
    })

    it('grants user authority only for cited User Observations the Session actually holds', () => {
      const patch = parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'objective', subject: 'Find the post', detail: 'A post the user found.', user_evidence: ['memory-user-9'] },
      }])!
      // The citation names nothing the Session grounded in the user's words.
      expect(applyMemoryPatch([], patch, run(1), sessionId, minter(), 100_000, grounding)).toBeNull()
      // And with nothing to check against, the claim is refused outright
      // rather than quietly admitted as the model's own.
      expect(applyMemoryPatch([], parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'objective', subject: 'Find the post', detail: 'A post the user found.', user_evidence: ['memory-user-1'] },
      }])!, run(1), sessionId, minter(), 100_000)).toBeNull()
    })

    it('binds a constraint to the objective in force and refuses one with no objective to bind to', () => {
      const memory = establishedObjective()
      expect(memory.map(({ id, kind, objectiveId }) => [id, kind, objectiveId])).toEqual([
        ['memory-1', 'objective', undefined],
        ['memory-2', 'constraint', 'memory-1'],
      ])
      expect(hasUserAuthority(memory[0]!)).toBe(true)
      expect(userConstraintsFor(memory, 'memory-1' as MemoryEntryId).map(({ id }) => id)).toEqual(['memory-2'])

      expect(applyMemoryPatch([], parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'constraint', subject: 'Authorship', detail: 'Found, not written.', user_evidence: ['memory-user-1'] },
      }])!, run(1), sessionId, minter(), 100_000, grounding)).toBeNull()
    })

    it('refuses a model summary that would rewrite or delete what the user set', () => {
      const memory = establishedObjective()
      // The failure ADR 0039 was written for: an ungrounded rewrite of the
      // user's own constraint, offered as an ordinary update.
      expect(applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'update',
        id: 'memory-2',
        entry: { kind: 'constraint', subject: 'Authorship', detail: 'The user authored the post.' },
      }])!, run(2), sessionId, minter(), 100_000, grounding)).toBeNull()
      // Nor by demoting it to a kind that carries no user authority.
      expect(applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'update',
        id: 'memory-2',
        entry: { kind: 'assessment', subject: 'Authorship', detail: 'The user authored it.', references: [{ url: 'https://example.com/p' }] },
      }])!, run(2), sessionId, minter(), 100_000, grounding)).toBeNull()
      expect(applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'remove', id: 'memory-1', reason: 'invalid',
      }])!, run(2), sessionId, minter(), 100_000, grounding)).toBeNull()
    })

    it('continues the same objective when the user revises a constraint', () => {
      const memory = establishedObjective()
      const revised = applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'update',
        id: 'memory-2',
        entry: {
          kind: 'constraint',
          subject: 'Authorship',
          detail: 'The user found it on a forum, not on Reddit.',
          user_evidence: ['memory-user-2'],
        },
      }])!, run(2), sessionId, minter(), 100_000, grounding)!

      // Same objective, same constraint identity, both still the user's —
      // and the words that established the constraint stay cited beside
      // the words that revised it.
      expect(currentUserObjective(revised)?.id).toBe('memory-1')
      expect(revised[1]).toMatchObject({
        id: 'memory-2',
        objectiveId: 'memory-1',
        userEvidenceIds: ['memory-user-1', 'memory-user-2'],
        detail: 'The user found it on a forum, not on Reddit.',
      })
    })

    it('retires the old objective when the user replaces it, and hands the new one no constraints', () => {
      const mint = minter()
      const memory = establishedObjective(mint)
      const replaced = applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'add',
        entry: {
          kind: 'objective',
          subject: 'Book a table',
          detail: 'A different task entirely.',
          user_evidence: ['memory-user-2'],
        },
      }])!, run(2), sessionId, mint, 100_000, grounding)!

      expect(replaced[0]).toMatchObject({ id: 'memory-1', kind: 'objective', status: 'superseded' })
      expect(currentUserObjective(replaced)?.id).toBe('memory-3')
      // The retired objective keeps its constraint; the replacement
      // inherits none of them.
      expect(userConstraintsFor(replaced, 'memory-1' as MemoryEntryId).map(({ id }) => id)).toEqual(['memory-2'])
      expect(userConstraintsFor(replaced, 'memory-3' as MemoryEntryId)).toEqual([])
    })

    it('refuses a replacement that only re-cites the words the objective already stands on', () => {
      const mint = minter()
      const memory = establishedObjective(mint)

      // A rewording of the same task, offered as a new objective. Admitting
      // it would retire the user's objective and drop every constraint on
      // the model's say-so — an ambiguous transition resolved silently,
      // which is exactly what ADR 0039 says to clarify instead.
      expect(applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'add',
        entry: {
          kind: 'objective',
          subject: 'Locate the tier list post',
          detail: 'The same task, said differently.',
          user_evidence: ['memory-user-1'],
        },
      }])!, run(2), sessionId, mint, 100_000, grounding)).toBeNull()

      // New words from the user do establish a different task.
      const replaced = applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'objective', subject: 'Book a table', detail: 'A different task.', user_evidence: ['memory-user-2'] },
      }])!, run(2), sessionId, mint, 100_000, grounding)!
      expect(currentUserObjective(replaced)?.subject).toBe('Book a table')
    })

    it('binds a constraint listed before the objective it belongs to', () => {
      // Patch order is the model's business, not a trap: the constraint
      // binds to the objective the finished patch leaves in force.
      const memory = applyMemoryPatch([], parseMemoryPatch([
        {
          op: 'add',
          entry: { kind: 'constraint', subject: 'Authorship', detail: 'Found, not written.', user_evidence: ['memory-user-1'] },
        },
        {
          op: 'add',
          entry: { kind: 'objective', subject: 'Find the post', detail: 'A post the user found.', user_evidence: ['memory-user-1'] },
        },
      ])!, run(1), sessionId, minter(), 100_000, grounding)!

      expect(memory.map(({ id, kind, objectiveId }) => [id, kind, objectiveId])).toEqual([
        ['memory-1', 'constraint', 'memory-2'],
        ['memory-2', 'objective', undefined],
      ])
      // With no objective anywhere in the patch there is still nothing to
      // scope it to, and the patch is refused whole.
      expect(applyMemoryPatch([], parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'constraint', subject: 'Authorship', detail: 'Found, not written.', user_evidence: ['memory-user-1'] },
      }])!, run(1), sessionId, minter(), 100_000, grounding)).toBeNull()
    })

    it("leaves the model's own constraints unscoped", () => {
      const mint = minter()
      const memory = establishedObjective(mint)
      const withModelConstraint = applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'constraint', subject: 'Search scope', detail: 'Only the first two pages.' },
      }])!, run(2), sessionId, mint, 100_000, grounding)!

      // Scope is what tells a replacement objective which constraints it
      // does not inherit; the model's own working constraints are not in
      // that conversation, so they carry none.
      expect(withModelConstraint[2]!.kind).toBe('constraint')
      expect(withModelConstraint[2]).not.toHaveProperty('objectiveId')
      expect(withModelConstraint[2]).not.toHaveProperty('userEvidenceIds')
      expect(userConstraintsFor(withModelConstraint, 'memory-1' as MemoryEntryId).map(({ id }) => id)).toEqual(['memory-2'])
    })

    it('leaves the user objective in force when the model records an objective of its own', () => {
      const mint = minter()
      const memory = establishedObjective(mint)
      const withModelObjective = applyMemoryPatch(memory, parseMemoryPatch([{
        op: 'add',
        entry: { kind: 'objective', subject: 'Search old.reddit', detail: 'My plan for this run.' },
      }])!, run(2), sessionId, mint, 100_000, grounding)!

      expect(withModelObjective[0]).toEqual(memory[0])
      expect(hasUserAuthority(withModelObjective[2]!)).toBe(false)
      expect(currentUserObjective(withModelObjective)?.id).toBe('memory-1')
    })
  })
})
