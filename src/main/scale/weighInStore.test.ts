import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseLog, replay } from '../../core/scale/weighInLog'
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

  describe('the Weigh-in Log', () => {
    const logPath = (): string => join(dir, 'weighin-events.jsonl')
    const logged = (): ReturnType<typeof parseLog> => parseLog(readFileSync(logPath(), 'utf8'))

    it('appends one line per change, the add carrying the scale frame as hex', () => {
      let t = 100
      const store = createWeighInStore(path, logPath(), () => t++)
      store.add({ at: 1, kg: 84, r1: 500, r2: 510, person: 'jaish' }, Uint8Array.from([0x10, 0x0b, 0x01, 0x20, 0xd0]))
      store.add({ at: 2, kg: 71, r1: 0, r2: 0, person: 'jaish' })
      store.move(2, 'barun')
      store.remove(1)
      store.removePerson('barun')
      const { events, skipped } = logged()
      expect(skipped).toBe(0)
      expect(events).toEqual([
        { v: 1, t: 100, op: 'add', weighIn: { at: 1, kg: 84, r1: 500, r2: 510, person: 'jaish' }, frame: '100b0120d0' },
        { v: 1, t: 101, op: 'add', weighIn: { at: 2, kg: 71, r1: 0, r2: 0, person: 'jaish' } },
        { v: 1, t: 102, op: 'move', at: 2, from: 'jaish', to: 'barun' },
        { v: 1, t: 103, op: 'remove', at: 1 },
        { v: 1, t: 104, op: 'removePerson', person: 'barun' },
      ])
      expect(replay(events)).toEqual([])
      expect(onDisk()).toEqual([])
    })

    it('logs nothing for a change that changes nothing', () => {
      const store = createWeighInStore(path, logPath())
      store.add({ at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' })
      store.add({ at: 1, kg: 99, r1: 500, r2: 500, person: 'jaish' })
      store.move(1, 'jaish')
      store.move(9, 'barun')
      store.remove(9)
      store.removePerson('barun')
      expect(logged().events).toHaveLength(1)
    })

    it('starts the log from an existing weighins.json, each Weigh-in a seeded add', () => {
      writeFileSync(path, JSON.stringify({ weighIns: [{ at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' }, { at: 2, kg: 71, r1: 0, r2: 0, person: 'barun' }] }))
      createWeighInStore(path, logPath(), () => 50)
      expect(logged().events).toEqual([
        { v: 1, t: 50, op: 'add', weighIn: { at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' }, seeded: true },
        { v: 1, t: 50, op: 'add', weighIn: { at: 2, kg: 71, r1: 0, r2: 0, person: 'barun' }, seeded: true },
      ])
      // A restart seeds nothing twice.
      expect(createWeighInStore(path, logPath()).list().map((weighIn) => weighIn.at)).toEqual([1, 2])
      expect(logged().events).toHaveLength(2)
    })

    it('rebuilds a corrupt weighins.json from the log instead of starting afresh', () => {
      const store = createWeighInStore(path, logPath())
      store.add({ at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' })
      store.add({ at: 2, kg: 83, r1: 500, r2: 500, person: 'jaish' })
      writeFileSync(path, '{"weighIns": [{"at": 1, "kg"')
      const reopened = createWeighInStore(path, logPath())
      expect(reopened.list().map((weighIn) => weighIn.at)).toEqual([1, 2])
      expect(onDisk().map((weighIn) => weighIn.at)).toEqual([1, 2])
      reopened.add({ at: 3, kg: 82, r1: 500, r2: 500, person: 'jaish' })
      expect(onDisk().map((weighIn) => weighIn.at)).toEqual([1, 2, 3])
    })

    it('skips a line cut short and starts the next line on its own', () => {
      const store = createWeighInStore(path, logPath())
      store.add({ at: 1, kg: 84, r1: 500, r2: 500, person: 'jaish' })
      writeFileSync(logPath(), `${readFileSync(logPath(), 'utf8')}{"v":1,"t":5,"op":"add","weighIn":{"at":2`)
      const reopened = createWeighInStore(path, logPath())
      expect(reopened.list().map((weighIn) => weighIn.at)).toEqual([1])
      reopened.add({ at: 3, kg: 82, r1: 500, r2: 500, person: 'jaish' })
      const { events, skipped } = logged()
      expect(skipped).toBe(1)
      expect(events.map((event) => (event.op === 'add' ? event.weighIn.at : null))).toEqual([1, 3])
      expect(createWeighInStore(path, logPath()).list().map((weighIn) => weighIn.at)).toEqual([1, 3])
    })
  })
})
