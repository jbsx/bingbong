import { describe, expect, it } from 'vitest'
import { createStreamMemory, keptUntil } from './streamMemory'

const SIX_HOURS_S = 6 * 3600
const NOW = 1_793_000_000_000
const address = (query: string): string => `https://rr1.googlevideo.com/videoplayback?${query}&sig=x`

describe('a remembered stream address (#516)', () => {
  it('lasts until a minute before it expires less the track it must carry', () => {
    expect(keptUntil(address('expire=1793021600&dur=200.5'))).toBe(1_793_021_600_000 - 200_500 - 60_000)
    expect(keptUntil(address('expire=1793021600'))).toBe(1_793_021_600_000 - 60_000)
  })

  it('an address naming no expiry is not kept', () => {
    expect(keptUntil('https://stream.example/aaaaaaaaaaa')).toBeNull()
    expect(keptUntil(address('expire=soon'))).toBeNull()
    expect(keptUntil('not an address')).toBeNull()
    const memory = createStreamMemory()
    memory.keep('a', { stream: 'https://stream.example/a', availableAt: null })
    expect(memory.recall('a', NOW)).toBeNull()
  })

  it('an address that fails to parse is a value, not a fault: no expiry, and not kept', () => {
    expect(keptUntil('')).toBeNull()
    expect(keptUntil('//rr1.googlevideo.com/videoplayback?expire=1793021600')).toBeNull()
    const memory = createStreamMemory()
    memory.keep('a', { stream: 'not an address?expire=1793021600', availableAt: null })
    expect(memory.recall('a', NOW)).toBeNull()
  })

  it('a kept address comes back by its video until its time is up', () => {
    const memory = createStreamMemory()
    const stream = { stream: address(`expire=${NOW / 1000 + SIX_HOURS_S}&dur=240`), availableAt: NOW }
    memory.keep('a', stream)
    expect(memory.recall('a', NOW + 1_000)).toEqual(stream)
    expect(memory.recall('b', NOW + 1_000)).toBeNull()
    expect(memory.recall('a', NOW + (SIX_HOURS_S - 240 - 60) * 1000 - 1)).toEqual(stream)
    expect(memory.recall('a', NOW + (SIX_HOURS_S - 240 - 60) * 1000)).toBeNull()
  })

  it('a forgotten address is gone', () => {
    const memory = createStreamMemory()
    memory.keep('a', { stream: address(`expire=${NOW / 1000 + SIX_HOURS_S}`), availableAt: null })
    memory.forget('a')
    expect(memory.recall('a', NOW)).toBeNull()
  })

  it('what it keeps is the address alone: how an earlier lookup went is not this play’s', () => {
    const memory = createStreamMemory()
    const stream = { stream: address(`expire=${NOW / 1000 + SIX_HOURS_S}`), availableAt: NOW }
    const looked = { ...stream, asked: { client: 'visionos' } }
    memory.keep('a', looked)
    expect(memory.recall('a', NOW)).toEqual(stream)
  })
})
