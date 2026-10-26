import { afterEach, describe, expect, it } from 'vitest'
import { setFaultSink, type FaultReport } from '../trace/fault'
import type { VoiceState } from './ipcChannels'
import { createEarState } from './earState'

const AT_REST: VoiceState = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }
const WOKEN: VoiceState = { ...AT_REST, listening: true, reason: 'wake' }
const READING: VoiceState = { ...AT_REST, transcribing: true }

function clock(start = 1_000): { now(): number; advance(ms: number): void } {
  let at = start
  return { now: () => at, advance: (ms) => (at += ms) }
}

describe('createEarState (#442)', () => {
  it('waits for the ear until the models that hear are in, then for the words until the transcriber is', () => {
    const ear = createEarState({ vad: true, wake: true, stt: true }, clock().now)
    expect(ear.show(AT_REST).loading).toBe('ear')
    expect(ear.modelLoaded({ model: 'vad', failed: false }).changed).toBe(false)
    expect(ear.show(AT_REST).loading).toBe('ear')
    expect(ear.modelLoaded({ model: 'wake', failed: false }).changed).toBe(true)
    expect(ear.show(AT_REST).loading).toBe('words')
    expect(ear.modelLoaded({ model: 'stt', failed: false }).changed).toBe(true)
    expect(ear.show(AT_REST)).not.toHaveProperty('loading')
  })

  it('waits for nothing a scripted or absent model would never load', () => {
    const ear = createEarState({ vad: false, wake: false, stt: false }, clock().now)
    expect(ear.show(AT_REST)).not.toHaveProperty('loading')
  })

  it('ignores the models the ear does not wait on, failed or not', () => {
    const ear = createEarState({ vad: true, wake: false, stt: false }, clock().now)
    expect(ear.modelLoaded({ model: 'smart-turn', failed: false }).changed).toBe(false)
    expect(ear.modelLoaded({ model: 'smart-turn', failed: true }).changed).toBe(false)
    expect(ear.show(AT_REST).loading).toBe('ear')
  })

  it('stamps when the phase began and keeps it while the phase holds — a held line counts from its Endpoint, through the load into its read', () => {
    const time = clock()
    const ear = createEarState({ vad: false, wake: false, stt: true }, time.now)
    expect(ear.show(AT_REST).since).toBe(1_000)
    time.advance(500)
    expect(ear.show(AT_REST).since).toBe(1_000)
    expect(ear.show(READING)).toMatchObject({ since: 1_500, loading: 'words' })
    time.advance(1_000)
    expect(ear.show(READING).since).toBe(1_500)
    time.advance(1_000)
    ear.modelLoaded({ model: 'stt', failed: false })
    expect(ear.show(READING)).toMatchObject({ since: 1_500 })
    expect(ear.show(READING)).not.toHaveProperty('loading')
  })

  it('starts a new count when the ear goes from starting to at rest', () => {
    const time = clock()
    const ear = createEarState({ vad: true, wake: false, stt: false }, time.now)
    expect(ear.show(AT_REST).since).toBe(1_000)
    time.advance(3_000)
    ear.modelLoaded({ model: 'vad', failed: false })
    expect(ear.show(AT_REST).since).toBe(4_000)
  })

  it('says it is ready only when a wake came in while the words loaded and no line is being taken (owner ruling 3)', () => {
    const quiet = createEarState({ vad: false, wake: false, stt: true }, clock().now)
    quiet.show(AT_REST)
    expect(quiet.modelLoaded({ model: 'stt', failed: false }).sayReady).toBe(false)

    const woken = createEarState({ vad: false, wake: false, stt: true }, clock().now)
    woken.show(WOKEN)
    expect(woken.modelLoaded({ model: 'stt', failed: false }).sayReady).toBe(true)

    const held = createEarState({ vad: false, wake: false, stt: true }, clock().now)
    held.show(WOKEN)
    held.show(READING)
    expect(held.modelLoaded({ model: 'stt', failed: false }).sayReady).toBe(false)

    const speaking = createEarState({ vad: false, wake: false, stt: true }, clock().now)
    speaking.show(WOKEN)
    speaking.show({ ...WOKEN, hearing: true })
    expect(speaking.modelLoaded({ model: 'stt', failed: false }).sayReady).toBe(false)
  })

  describe('a load that faults (#447)', () => {
    const faults: FaultReport[] = []
    afterEach(() => {
      setFaultSink(null)
      faults.length = 0
    })

    it('ends the Starting wait with the ear failed, a new phase stamped, and a fault record written', () => {
      setFaultSink((report) => faults.push(report))
      const time = clock()
      const ear = createEarState({ vad: true, wake: true, stt: true }, time.now)
      expect(ear.show(AT_REST)).toMatchObject({ loading: 'ear', since: 1_000 })
      time.advance(4_000)
      expect(ear.modelLoaded({ model: 'vad', failed: true }).changed).toBe(true)
      expect(ear.show(AT_REST)).toMatchObject({ loading: 'failed', since: 5_000 })
      expect(faults).toEqual([expect.objectContaining({ kind: 'fault', site: 'voice.ear.load', message: expect.stringContaining('vad') })])
      // The other models coming in do not hide that the ear cannot hear.
      ear.modelLoaded({ model: 'wake', failed: false })
      ear.modelLoaded({ model: 'stt', failed: false })
      expect(ear.show(AT_REST).loading).toBe('failed')
    })

    it('ends it the same way for the wake word and the transcriber', () => {
      for (const model of ['wake', 'stt']) {
        const ear = createEarState({ vad: true, wake: true, stt: true }, clock().now)
        ear.show(AT_REST)
        expect(ear.modelLoaded({ model, failed: true }).changed).toBe(true)
        expect(ear.show(AT_REST).loading).toBe('failed')
      }
    })

    it('clears when a later retry of the failed model succeeds, back to what is still loading or to rest', () => {
      const ear = createEarState({ vad: false, wake: false, stt: true }, clock().now)
      ear.modelLoaded({ model: 'stt', failed: true })
      expect(ear.show(AT_REST).loading).toBe('failed')
      expect(ear.modelLoaded({ model: 'stt', failed: false }).changed).toBe(true)
      expect(ear.show(AT_REST)).not.toHaveProperty('loading')
    })

    it('says the failure aloud only when a wake came in while the words loaded (owner ruling, #442 ruling 3)', () => {
      const quiet = createEarState({ vad: false, wake: false, stt: true }, clock().now)
      quiet.show(AT_REST)
      expect(quiet.modelLoaded({ model: 'stt', failed: true })).toMatchObject({ sayFailed: false, sayReady: false })

      const woken = createEarState({ vad: false, wake: false, stt: true }, clock().now)
      woken.show(WOKEN)
      expect(woken.modelLoaded({ model: 'stt', failed: true })).toMatchObject({ sayFailed: true, sayReady: false })
    })
  })
})
