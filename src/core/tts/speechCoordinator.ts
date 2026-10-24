import type { AudioDucker, AudioStream, AudioStreamPlayer, SpeakOptions, SpeakOutcome, SpeechSynthesizer, TtsSpeaker } from '../ports/tts'
import type { PerfTracer } from '../perf/perfTracer'
import { reportFault } from '../trace/fault'
import { splitSentences } from './sentences'

export interface SpeechCoordinatorDeps {
  synth: SpeechSynthesizer
  player: AudioStreamPlayer
  ducker?: AudioDucker
  /**
   * Optional perf tracer (#31, #327): each spoken text keyed to a turn id
   * records a `tts-synthesis` span per sentence (the render, with the
   * sentence's index and the engine that said it, #412), a `tts-first-sound` span from the speak call to the
   * first sample handed to the player, and a `tts-playback` span (aplay
   * speaking). Texts without a turn id (download announcements) pass
   * through unlogged.
   */
  tracer?: PerfTracer
}

interface QueuedSpeak {
  text: string
  options: SpeakOptions
  /** Monotonic ms of the speak call, when traced: where `tts-first-sound` opens. */
  calledAt?: number
  /** The engine that said the first sentence (#412), carried on `tts-first-sound`. */
  engine?: string
  resolve: (outcome: SpeakOutcome) => void
}

/**
 * The TtsSpeaker the runner and download announcements share: texts queue
 * so speech never overlaps, and each is spoken sentence by sentence (#327)
 * — the first sentence is handed to playback as soon as it is synthesized,
 * the next is synthesized while it plays, and all of them play through one
 * playback stream, so there is no start gap between them. Page audio ducks
 * for the whole text. stop() (barge-in, a later Command) kills the stream
 * and drops the queue; a sentence still being synthesized is discarded and
 * the ones after it are never synthesized. A text stopped mid-flight
 * resolves `{ ok: true }` — being interrupted is normal, not an error.
 */
export function createSpeechCoordinator(deps: SpeechCoordinatorDeps): TtsSpeaker {
  const { synth, player, ducker, tracer } = deps
  const queue: QueuedSpeak[] = []
  let pumping = false
  // Barge-in epoch: sentences from before the latest stop() never reach playback.
  let stopEpoch = 0
  let current: AudioStream | null = null

  /**
   * Advisory bookkeeping (#31), same stance as every perf call site: a
   * throwing tracer or sink is swallowed — the log never breaks speech.
   */
  function recordSpan(turnId: string | undefined, stage: string, durMs: number, detail?: Record<string, unknown>): void {
    if (!tracer || turnId === undefined) return
    try {
      tracer.span(turnId, stage, durMs, detail)
    } catch (error) {
      reportFault('tts.speechCoordinator.recordSpan', error, { turnId })
      // swallowed — see above
    }
  }

  function speak(text: string, options: SpeakOptions = {}): Promise<SpeakOutcome> {
    return new Promise((resolve) => {
      const calledAt = tracer?.now()
      queue.push({ text, options, ...(calledAt !== undefined ? { calledAt } : {}), resolve })
      void pump()
    })
  }

  function stop(): void {
    stopEpoch += 1
    for (const item of queue.splice(0)) {
      // Never synthesized: the stop reached it while it waited its turn.
      item.resolve({ ok: true, stopped: true })
    }
    current?.stop()
  }

  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        item.resolve(await speakNow(item, stopEpoch))
      }
    } finally {
      pumping = false
    }
  }

  /** The first sample went to the player: the Reaction hook, and the first-sound span. */
  function firstSound(item: QueuedSpeak): void {
    if (tracer && item.calledAt !== undefined) recordSpan(item.options.turnId, 'tts-first-sound', tracer.now() - item.calledAt, item.engine === undefined ? undefined : { engine: item.engine })
    try {
      item.options.onFirstSound?.()
    } catch (error) {
      reportFault('tts.speechCoordinator.onFirstSound', error)
    }
  }

  async function speakNow(item: QueuedSpeak, epoch: number): Promise<SpeakOutcome> {
    const sentences = splitSentences(item.text)
    if (sentences.length === 0) return { ok: true }
    const { turnId } = item.options
    ducker?.duck()
    let stream: AudioStream | null = null
    let playStart: number | undefined
    let failure: string | null = null
    try {
      for (let index = 0; index < sentences.length; index++) {
        const synthStart = tracer?.now()
        let wav: Uint8Array
        try {
          wav = await synth.synthesize(sentences[index]!)
        } catch (err) {
          failure = err instanceof Error ? err.message : String(err)
          break
        } finally {
          // Recorded even when piper fails — the render time was spent either way.
          if (tracer && synthStart !== undefined) {
            const engine = synth.lastEngine?.() ?? undefined
            if (index === 0 && engine !== undefined) item.engine = engine
            recordSpan(turnId, 'tts-synthesis', tracer.now() - synthStart, { index, spawns: synth.spawnCount?.() ?? null, ...(engine === undefined ? {} : { engine }) })
          }
        }
        // Stopped while piper rendered — never let a stale sentence reach playback.
        if (epoch !== stopEpoch) return { ok: true, stopped: true }
        if (stream === null) {
          stream = player.open({ onFirstSample: () => firstSound(item) })
          current = stream
          playStart = tracer?.now()
        }
        stream.write(wav)
      }
      if (stream === null) return failure === null ? { ok: true } : { ok: false, error: failure }
      // A sentence that failed to render ends the text: what was rendered still plays.
      stream.end()
      try {
        await stream.done
      } finally {
        // Natural end, barge-in, or failure — the speaking time was spent.
        if (tracer && playStart !== undefined) recordSpan(turnId, 'tts-playback', tracer.now() - playStart)
      }
      if (epoch !== stopEpoch) return { ok: true, stopped: true }
      return failure === null ? { ok: true } : { ok: false, error: failure }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      if (current === stream) current = null
      ducker?.restore()
    }
  }

  return { speak, stop }
}
