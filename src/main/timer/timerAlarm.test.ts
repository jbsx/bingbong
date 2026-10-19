import { describe, expect, it } from 'vitest'
import type { AudioPlayback, AudioPlayer } from '../../core/ports/tts'
import type { Timer, TimerState } from '../../core/timer/timer'
import { attachTimerAlarm } from './timerAlarm'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A player whose playbacks end when the test says so. */
function fakePlayer() {
  const playbacks: { finish(): void; fail(): void; stopped: boolean }[] = []
  const player: AudioPlayer = {
    play() {
      let finish!: () => void
      let fail!: () => void
      const done = new Promise<void>((resolve, reject) => {
        finish = resolve
        fail = () => reject(new Error('aplay exited with code 1'))
      })
      const entry = { finish, fail, stopped: false }
      playbacks.push(entry)
      const playback: AudioPlayback = {
        done,
        stop() {
          entry.stopped = true
          finish()
        },
      }
      return playback
    },
  }
  return { player, playbacks }
}

function fakeTimer() {
  const listeners = new Set<(state: TimerState) => void>()
  const timer = { onChange: (listener: (state: TimerState) => void) => (listeners.add(listener), () => void listeners.delete(listener)) } as unknown as Timer
  const emit = (state: TimerState): void => {
    for (const listener of listeners) listener(state)
  }
  return { timer, emit }
}

const RINGING: TimerState = { status: 'ringing', durationMs: 60_000, rangAt: 0 }

describe('attachTimerAlarm', () => {
  it('stays silent while the Timer runs', () => {
    const { player, playbacks } = fakePlayer()
    const { timer, emit } = fakeTimer()
    attachTimerAlarm(timer, player, new Uint8Array())
    emit({ status: 'running', durationMs: 60_000, endsAt: 60_000 })
    expect(playbacks).toHaveLength(0)
  })

  it('plays back to back while it rings, and cuts the burst when it stops', async () => {
    const { player, playbacks } = fakePlayer()
    const { timer, emit } = fakeTimer()
    attachTimerAlarm(timer, player, new Uint8Array())
    emit(RINGING)
    expect(playbacks).toHaveLength(1)
    playbacks[0]!.finish()
    await flush()
    expect(playbacks).toHaveLength(2)
    emit({ status: 'off' })
    expect(playbacks[1]!.stopped).toBe(true)
    await flush()
    expect(playbacks).toHaveLength(2)
  })

  it('a player that fails is not retried for that ring', async () => {
    const { player, playbacks } = fakePlayer()
    const { timer, emit } = fakeTimer()
    attachTimerAlarm(timer, player, new Uint8Array())
    emit(RINGING)
    playbacks[0]!.fail()
    await flush()
    expect(playbacks).toHaveLength(1)
  })
})
