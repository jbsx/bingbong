import type { AudioPlayback, AudioPlayer } from '../../core/ports/tts'
import type { Timer } from '../../core/timer/timer'
import { reportFault } from '../../core/trace/fault'

/**
 * The alarm (CONTEXT.md, Timer), played back to back while the Timer rings
 * and cut the moment it stops ringing. A player that fails is reported and
 * not retried for that ring: the Idle Screen still shows the Timer is done.
 */
export function attachTimerAlarm(timer: Timer, player: AudioPlayer, wav: Uint8Array): () => void {
  let playing: AudioPlayback | null = null
  let ring = 0

  function play(mine: number): void {
    if (mine !== ring) return
    const playback = player.play(wav)
    playing = playback
    playback.done.then(
      () => {
        if (playing === playback) play(mine)
      },
      (error: unknown) => {
        if (playing === playback) playing = null
        reportFault('timer.alarm', error)
      },
    )
  }

  return timer.onChange((state) => {
    ring += 1
    const stopping = playing
    playing = null
    stopping?.stop()
    if (state.status === 'ringing') play(ring)
  })
}
