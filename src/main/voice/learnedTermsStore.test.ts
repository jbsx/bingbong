import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { seedLexiconSet } from '../moonshine/biasLexicon'
import { createLearnedTermsStore } from './learnedTermsStore'
import type { HostTraceEvent } from '../../core/trace/hostTrace'

// ADR 0022: the ledger's persistence — lexicon.json in userData. The store
// owns the file and the clock; the recurrence gate and the rejection marks
// live in core (learnedTerms.ts) and are unit-tested there. These tests pin
// the file contract: survive restart, fail closed on corruption, and the
// two manual surfaces (add clears a rejection, remove plants one).

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bingbong-lexicon-'))
  dirs.push(dir)
  return dir
}

// The same reserved set production wires — the seed can never drift from
// what the gate actually enforces.
const SEED = seedLexiconSet()

describe('learned terms store', () => {
  it('admits on recurrence and survives a restart', async () => {
    const dir = await tempDir()
    let now = 1_000
    const store = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, { now: () => now })

    store.applyProposals([{ op: 'add', suspect: 'garbled', repair: 'Linus Tech Tips' }])
    expect(store.list()).toEqual([])

    now = 2_000
    store.applyProposals([{ op: 'add', suspect: 'garbled', repair: 'linus tech tips' }])
    expect(store.list()).toEqual(['linus tech tips'])

    const reopened = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, { now: () => now })
    expect(reopened.list()).toEqual(['linus tech tips'])
    // Recurrence memory survives too: the pending miss from the first run
    // is gone (it became the admission), and a re-proposal is a touch.
    reopened.applyProposals([{ op: 'add', suspect: 'garbled', repair: 'linus tech tips' }])
    expect(reopened.list()).toEqual(['linus tech tips'])
  })

  it('fails closed to seed-only on a corrupt file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'lexicon.json'), '{ not json', 'utf8')
    const store = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, { now: () => 0 })
    expect(store.list()).toEqual([])
    // And it recovers on the next write.
    store.manualAdd('nguyen')
    expect(store.list()).toEqual(['nguyen'])
    expect(JSON.parse(await readFile(join(dir, 'lexicon.json'), 'utf8')).admitted).toHaveLength(1)
  })

  it('manual remove plants a rejection proposals cannot cross', async () => {
    const dir = await tempDir()
    const store = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, { now: () => 0 })
    store.manualAdd('nguyen')
    expect(store.list()).toEqual(['nguyen'])

    store.manualRemove('nguyen')
    expect(store.list()).toEqual([])

    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    expect(store.list()).toEqual([])

    // A manual re-add always works — the rejection clears.
    store.manualAdd('nguyen')
    expect(store.list()).toEqual(['nguyen'])
  })

  it('observes transcripts for LRU and never persists a change without one', async () => {
    const dir = await tempDir()
    let now = 1_000
    const store = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, { now: () => now })
    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    const before = await readFile(join(dir, 'lexicon.json'), 'utf8')

    now = 9_000
    store.observeTranscript('what does nguyen think')
    const after = await readFile(join(dir, 'lexicon.json'), 'utf8')
    expect(after).not.toBe(before)
    expect(JSON.parse(after).admitted[0].lastTouched).toBe(9_000)

    // A transcript with no admitted terms writes nothing.
    const untouched = after
    store.observeTranscript('nothing relevant here')
    expect(await readFile(join(dir, 'lexicon.json'), 'utf8')).toBe(untouched)
  })

  it('serves a stable bias union that only changes when the ledger does', async () => {
    const dir = await tempDir()
    const store = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, { now: () => 0 })
    const first = store.biasPhrases()
    expect(store.biasPhrases()).toBe(first) // memoized identity
    expect(first).toContain('panel') // seed vocabulary rides along

    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    const second = store.biasPhrases()
    expect(second).not.toBe(first)
    expect(second).toContain('nguyen')

    // A touch (LRU) changes bookkeeping, not the union.
    store.observeTranscript('nguyen again')
    expect(store.biasPhrases()).toBe(second)
  })

  it('notifies subscribers when the admitted list changes', async () => {
    const dir = await tempDir()
    const store = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, { now: () => 0 })
    const lists: string[][] = []
    store.onChange((terms) => lists.push([...terms]))

    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    store.applyProposals([{ op: 'add', suspect: 'g', repair: 'nguyen' }])
    store.manualRemove('nguyen')

    expect(lists).toEqual([['nguyen'], []])
  })
})

// The Learned Term records (#186, ADR 0031): the two `console.log` lines
// this store used to leave, in a file that can be read after the fact.
describe('learned term records', () => {
  async function tracingStore(now: () => number) {
    const dir = await tempDir()
    const traced: HostTraceEvent[] = []
    const store = createLearnedTermsStore(join(dir, 'lexicon.json'), SEED, {
      now,
      hostTrace: (event) => traced.push(event()),
    })
    return { store, traced }
  }

  it('records an admission when a proposal recurs, and nothing on the first miss', async () => {
    let now = 1_000
    const { store, traced } = await tracingStore(() => now)

    store.applyProposals([{ op: 'add', suspect: 'garbled', repair: 'linus tech tips' }])
    expect(traced).toEqual([])

    now = 2_000
    store.applyProposals([{ op: 'add', suspect: 'garbled', repair: 'linus tech tips' }])
    expect(traced).toEqual([{ kind: 'learned_term', source: 'proposals', admitted: ['linus tech tips'], removed: [] }])
  })

  it('records a removal a proposal made', async () => {
    let now = 1_000
    const { store, traced } = await tracingStore(() => now)
    store.applyProposals([{ op: 'add', suspect: 'garbled', repair: 'sonarr' }])
    now = 2_000
    store.applyProposals([{ op: 'add', suspect: 'garbled', repair: 'sonarr' }])
    store.applyProposals([{ op: 'remove', term: 'sonarr' }])
    expect(traced.at(-1)).toEqual({ kind: 'learned_term', source: 'proposals', admitted: [], removed: ['sonarr'] })
  })

  it('records the settings surface as a manual change', async () => {
    const { store, traced } = await tracingStore(() => 1_000)
    store.manualAdd('radarr')
    store.manualRemove('radarr')
    expect(traced).toEqual([
      { kind: 'learned_term', source: 'manual', admitted: ['radarr'], removed: [] },
      { kind: 'learned_term', source: 'manual', admitted: [], removed: ['radarr'] },
    ])
  })


  it('records nothing when a manual change alters no vocabulary', async () => {
    const { store, traced } = await tracingStore(() => 1_000)
    store.manualAdd('radarr')
    // Re-adding clears a rejection mark and admits nothing; removing a term
    // that was never admitted plants a mark and removes nothing.
    store.manualAdd('radarr')
    store.manualRemove('lidarr')
    expect(traced).toEqual([{ kind: 'learned_term', source: 'manual', admitted: ['radarr'], removed: [] }])
  })

  it('records nothing for a rejected manual term', async () => {
    const { store, traced } = await tracingStore(() => 1_000)
    expect(store.manualAdd('   ')).toBe(false)
    expect(traced).toEqual([])
  })
})
