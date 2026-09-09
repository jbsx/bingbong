import { describe, expect, it } from 'vitest'
import { parseLiveKeyManifest } from './grades.ts'
import { liveWebHunts } from './hunts.ts'
import { keyManifestOf } from './keys.ts'
import { buildLiveKeyManifest, keyCorpusDigest, keyVersionLabel, liveFactsToRecheck } from './keyManifest.ts'
import { plannedSlots } from './pass.ts'

// Composition, and only composition. `keys.ts` describes one hunt to the
// grader; the offline commands read one manifest for a whole capture set. The
// risk this covers is a pass that is captured and then turns out to be
// ungradeable — a slot with no task, or a task deriving its own check ids.

const CORPUS = liveWebHunts()
const [PI, WATCH] = CORPUS

describe('buildLiveKeyManifest', () => {
  it('produces a manifest the grading path accepts', () => {
    const parsed = parseLiveKeyManifest(buildLiveKeyManifest())
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true)
  })

  it('covers the scheduled population slot for slot, in schedule order', () => {
    const manifest = buildLiveKeyManifest()
    const planned = plannedSlots().map((slot) => `${slot.huntId}/${slot.stepId}`)
    expect(manifest.tasks.map((task) => `${task.huntId}/${task.stepId}`)).toEqual(planned)
    expect(manifest.tasks).toHaveLength(6)
  })

  it('derives no check of its own — the tasks are the per-hunt manifests', () => {
    // The property that matters: one answer to "what is check fact-03". If
    // this module ever grew its own derivation, a grade naming a check id
    // would mean two different things depending on who wrote it.
    const composed = buildLiveKeyManifest()
    const fromKeys = CORPUS.flatMap((hunt) => keyManifestOf(hunt.id).tasks)
    expect(composed.tasks).toEqual(fromKeys)
  })

  it('composing one hunt reproduces that hunt’s own manifest', () => {
    const one = buildLiveKeyManifest({ hunts: [PI] })
    const direct = keyManifestOf(PI.id)
    expect(one.tasks).toEqual(direct.tasks)
    expect(one.keyVersion).toBe(direct.keyVersion)
    expect(one.preparedAt).toBe(direct.preparedAt)
  })

  it('refuses to describe an empty population', () => {
    expect(() => buildLiveKeyManifest({ hunts: [] })).toThrow(/at least one hunt/)
  })

  it('dates itself from the keys, never from the clock', () => {
    const manifest = buildLiveKeyManifest()
    const newest = CORPUS.map((hunt) => keyManifestOf(hunt.id).preparedAt).sort().at(-1)
    expect(manifest.preparedAt).toBe(newest)
  })
})

describe('the composed key identity', () => {
  it('names every merged key’s version, so revising one invalidates stale reviews', () => {
    const versions = CORPUS.map((hunt) => keyManifestOf(hunt.id).keyVersion)
    expect(keyVersionLabel()).toBe(versions.join('.'))
    // Four keys, four versions — not one number standing in for all of them.
    expect(keyVersionLabel().split('.')).toHaveLength(4)
  })

  it('identifies which keys were merged, not the order they were listed in', () => {
    expect(keyCorpusDigest([PI, WATCH])).toBe(keyCorpusDigest([WATCH, PI]))
    expect(keyCorpusDigest([PI])).not.toBe(keyCorpusDigest([PI, WATCH]))
    expect(keyCorpusDigest()).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('binds the manifest to the keys it describes', () => {
    const manifest = buildLiveKeyManifest()
    expect(manifest.keyDigest).toBe(keyCorpusDigest())
    expect(manifest.keyVersion).toBe(keyVersionLabel())
  })
})

describe('what a pre-capture recheck owes', () => {
  it('names the hunt whose key claims a fact that can move', () => {
    const pending = liveFactsToRecheck()
    expect(pending.map((entry) => entry.huntId)).toEqual(['rule-eurostar-luggage'])
    expect(pending[0]!.liveFacts.length).toBeGreaterThan(0)
  })
})
