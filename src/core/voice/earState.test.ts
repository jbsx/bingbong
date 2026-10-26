import { describe, expect, it } from 'vitest'
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

  it('takes no failed load, and ignores the models the ear does not wait on', () => {
    const ear = createEarState({ vad: true, wake: false, stt: false }, clock().now)
    expect(ear.modelLoaded({ model: 'vad', failed: true }).changed).toBe(false)
    expect(ear.modelLoaded({ model: 'smart-turn', failed: false }).changed).toBe(false)
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
})
