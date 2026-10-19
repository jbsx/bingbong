import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWeighInStore } from './weighInStore'

describe('the Weigh-in store', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-weighins-'))
    path = join(dir, 'weighins.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const onDisk = (): { at: number; person: string }[] => (JSON.parse(readFileSync(path, 'utf8')) as { weighIns: { at: number; person: string }[] }).weighIns

  it('reads a file from before #351 as Jaish’s, losing nothing', () => {
    writeFileSync(path, JSON.stringify({ weighIns: [{ at: 1, kg: 84, r1: 500, r2: 500 }, { at: 2, kg: 83, r1: 0, r2: 0 }] }))
    expect(createWeighInStore(path).list()).toEqual([
      { at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' },
      { at: 2, kg: 83, r1: 0, r2: 0, person: 'jaish' },
    ])
  })

  it('moves one Weigh-in to another Person and keeps it there across a restart', () => {
    const store = createWeighInStore(path)
    store.add({ at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' })
    store.add({ at: 2, kg: 71, r1: 500, r2: 500, person: 'jaish' })
    expect(store.move(2, 'barun').map((weighIn) => weighIn.person)).toEqual(['jaish', 'barun'])
    expect(onDisk().map((weighIn) => weighIn.person)).toEqual(['jaish', 'barun'])
    expect(createWeighInStore(path).list()[1].person).toBe('barun')
  })

  it('deletes a removed Person’s Weigh-ins and nobody else’s', () => {
    const store = createWeighInStore(path)
    store.add({ at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' })
    store.add({ at: 2, kg: 71, r1: 500, r2: 500, person: 'barun' })
    store.add({ at: 3, kg: 72, r1: 500, r2: 500, person: 'barun' })
    expect(store.removePerson('barun').map((weighIn) => weighIn.at)).toEqual([1])
    expect(onDisk().map((weighIn) => weighIn.at)).toEqual([1])
  })
})
