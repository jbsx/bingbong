import { describe, expect, it } from 'vitest'
import { createDucking, duckInTurn } from './ducking'
import type { VoiceState } from '../voice/ipcChannels'

// Ducking (#344, CONTEXT.md Voice): the music drops under the ear, a
// spoken line and a ringing Timer, and comes back when the last of them
// lets go.

const closed: VoiceState = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }
const open: VoiceState = { listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false }
const thinking: VoiceState = { listening: false, reason: 'wake', monitoring: true, transcribing: true, hearing: false }

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

describe('the Player and the pane, ducked as one (#461)', () => {
  /** A duck that resolves only when told: what ran, in order, and the ones still held open. */
  function deferred(name: string, log: string[]) {
    const waiting: (() => void)[] = []
    const duck = (on: boolean): Promise<void> => {
      log.push(`${name} ${on ? 'down' : 'up'}`)
      return new Promise((resolve) => waiting.push(() => { log.push(`${name} ${on ? 'down' : 'up'} done`); resolve() }))
    }
    return { duck, settle: () => waiting.splice(0).forEach((resolve) => resolve()) }
  }

  it('both lower at once; the release puts the Player\'s song back before the pane lets go of the rest', async () => {
    const log: string[] = []
    const player = deferred('player', log)
    const pane = deferred('pane', log)
    const duck = duckInTurn(player.duck, pane.duck)
    duck(true)
    duck(false)
    await Promise.resolve()
    expect(log).toEqual(['player down', 'pane down'])
    player.settle()
    pane.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log.slice(4)).toEqual(['player up'])
    player.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log.slice(5)).toEqual(['player up done', 'pane up'])
  })

  it('a duck that fails leaves the next one to run', async () => {
    const calls: string[] = []
    const duck = duckInTurn(
      async (on) => {
        calls.push(`player ${on}`)
        if (on) throw new Error('page gone')
      },
      async (on) => void calls.push(`pane ${on}`),
    )
    duck(true)
    duck(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual(['player true', 'pane true', 'player false', 'pane false'])
  })
})
