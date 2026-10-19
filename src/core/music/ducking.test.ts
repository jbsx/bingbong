import { describe, expect, it } from 'vitest'
import { createDucking } from './ducking'
import type { VoiceState } from '../voice/ipcChannels'

// Ducking (#344, CONTEXT.md Voice): the music drops under the ear, a
// spoken line and a ringing Timer, and comes back when the last of them
// lets go.

const closed: VoiceState = { listening: false, reason: null, monitoring: true, transcribing: false }
const open: VoiceState = { listening: true, reason: 'wake', monitoring: true, transcribing: false }
const thinking: VoiceState = { listening: false, reason: 'wake', monitoring: true, transcribing: true }

function wired() {
  const calls: boolean[] = []
  const ducking = createDucking((on) => calls.push(on))
  return { calls, ducking }
}

describe('Ducking', () => {
  it('the ear opening ducks, and the Utterance\'s end — fired or dropped — restores', () => {
    const { calls, ducking } = wired()
    ducking.voiceState(open)
    expect(calls).toEqual([true])
    ducking.voiceState(thinking)
    ducking.utteranceEnded()
    expect(calls).toEqual([true, false])
    // A Hot Listen stays open: the next speech in it ducks again, and its drop restores.
    ducking.voiceState(open)
    ducking.speechStarted()
    expect(calls).toEqual([true, false, true])
    ducking.utteranceEnded()
    ducking.voiceState(closed)
    expect(calls).toEqual([true, false, true, false])
  })

  it('a listen that closes with nothing said restores', () => {
    const { calls, ducking } = wired()
    ducking.voiceState(open)
    ducking.voiceState(closed)
    expect(calls).toEqual([true, false])
  })

  it('a spoken line and a ringing Timer duck too, and the music comes back only when the last lets go', () => {
    const { calls, ducking } = wired()
    ducking.hold('speech', true)
    ducking.hold('ring', true)
    ducking.voiceState(open)
    expect(calls).toEqual([true])
    ducking.hold('speech', false)
    ducking.utteranceEnded()
    expect(calls).toEqual([true])
    ducking.hold('ring', false)
    expect(calls).toEqual([true, false])
  })
})
