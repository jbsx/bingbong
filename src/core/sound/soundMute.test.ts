import { describe, expect, it } from 'vitest'
import { createSoundMute } from './soundMute'

describe('createSoundMute', () => {
  it('starts unmuted and flips on toggle', () => {
    const mute = createSoundMute()
    expect(mute.muted()).toBe(false)
    expect(mute.toggle()).toBe(true)
    expect(mute.muted()).toBe(true)
    expect(mute.toggle()).toBe(false)
  })

  it('tells its listeners of a change only', () => {
    const mute = createSoundMute()
    const heard: boolean[] = []
    const unsubscribe = mute.onChange((on) => heard.push(on))
    mute.set(true)
    mute.set(true)
    mute.set(false)
    unsubscribe()
    mute.set(true)
    expect(heard).toEqual([true, false])
  })
})
