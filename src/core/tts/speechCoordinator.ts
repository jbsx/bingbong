import type { AudioDucker, AudioPlayer, AudioPlayback, SpeakOutcome, SpeechSynthesizer, TtsSpeaker } from '../ports/tts'

export interface SpeechCoordinatorDeps {
  synth: SpeechSynthesizer
  player: AudioPlayer
  ducker?: AudioDucker
}

interface QueuedSpeak {
  text: string
  resolve: (outcome: SpeakOutcome) => void
}

/**
 * The TtsSpeaker the pipeline and download announcements share: lines queue
 * so speech never overlaps, page audio ducks for the duration of each line,
 * and stop() (barge-in) kills the current line and drops the queue. A line
 * stopped mid-flight resolves `{ ok: true }` — being interrupted is normal,
 * not an error.
 */
export function createSpeechCoordinator(deps: SpeechCoordinatorDeps): TtsSpeaker {
  const { synth, player, ducker } = deps
  const queue: QueuedSpeak[] = []
  let pumping = false
  // Barge-in epoch: lines from before the latest stop() never reach playback.
  let stopEpoch = 0
  let current: AudioPlayback | null = null

  function speak(text: string): Promise<SpeakOutcome> {
    return new Promise((resolve) => {
      queue.push({ text, resolve })
      void pump()
    })
  }

  function stop(): void {
    stopEpoch += 1
    for (const item of queue.splice(0)) item.resolve({ ok: true })
    current?.stop()
  }

  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        item.resolve(await speakNow(item.text, stopEpoch))
      }
    } finally {
      pumping = false
    }
  }

  async function speakNow(text: string, epoch: number): Promise<SpeakOutcome> {
    ducker?.duck()
    try {
      const wav = await synth.synthesize(text)
      // Stopped while piper rendered — never let the stale line reach playback.
      if (epoch !== stopEpoch) return { ok: true }
      const playback = player.play(wav)
      current = playback
      await playback.done
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      current = null
      ducker?.restore()
    }
  }

  return { speak, stop }
}
