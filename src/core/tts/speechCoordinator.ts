import type { AudioDucker, AudioPlayer, AudioPlayback, SpeakOutcome, SpeechSynthesizer, TtsSpeaker } from '../ports/tts'
import type { PerfTracer } from '../perf/perfTracer'

export interface SpeechCoordinatorDeps {
  synth: SpeechSynthesizer
  player: AudioPlayer
  ducker?: AudioDucker
  /**
   * Optional perf tracer (#31): each spoken line keyed to a turn id records
   * a `tts-synthesis` span (piper rendering) and a `tts-playback` span
   * (aplay speaking) — the split that makes a streaming-TTS change's value
   * measurable. Lines without a turn id (download announcements, subagent
   * lines) pass through unlogged.
   */
  tracer?: PerfTracer
}

interface QueuedSpeak {
  text: string
  turnId?: string
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
  const { synth, player, ducker, tracer } = deps
  const queue: QueuedSpeak[] = []
  let pumping = false
  // Barge-in epoch: lines from before the latest stop() never reach playback.
  let stopEpoch = 0
  let current: AudioPlayback | null = null

  /**
   * Advisory bookkeeping (#31), same stance as every perf call site: a
   * throwing tracer or sink is swallowed — the log never breaks speech.
   */
  function recordSpan(turnId: string, stage: 'tts-synthesis' | 'tts-playback', durMs: number): void {
    if (!tracer) return
    try {
      tracer.span(turnId, stage, durMs)
    } catch {
      // swallowed — see above
    }
  }

  function speak(text: string, turnId?: string): Promise<SpeakOutcome> {
    return new Promise((resolve) => {
      queue.push({ text, ...(turnId !== undefined ? { turnId } : {}), resolve })
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
        item.resolve(await speakNow(item.text, stopEpoch, item.turnId))
      }
    } finally {
      pumping = false
    }
  }

  async function speakNow(text: string, epoch: number, turnId?: string): Promise<SpeakOutcome> {
    ducker?.duck()
    try {
      const synthStart = tracer?.now()
      let wav: Uint8Array
      try {
        wav = await synth.synthesize(text)
      } finally {
        // Recorded even when piper fails — the render time was spent either way.
        if (tracer && turnId !== undefined && synthStart !== undefined) {
          recordSpan(turnId, 'tts-synthesis', tracer.now() - synthStart)
        }
      }
      // Stopped while piper rendered — never let the stale line reach playback.
      if (epoch !== stopEpoch) return { ok: true }
      const playback = player.play(wav)
      current = playback
      const playStart = tracer?.now()
      try {
        await playback.done
      } finally {
        // Natural end, barge-in, or failure — the speaking time was spent.
        if (tracer && turnId !== undefined && playStart !== undefined) {
          recordSpan(turnId, 'tts-playback', tracer.now() - playStart)
        }
      }
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
