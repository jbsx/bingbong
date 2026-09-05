import type { AudioDucker, AudioPlayer, AudioPlayback, SpeakOutcome, SpeechSynthesizer, TtsSpeaker } from '../ports/tts'
import type { PerfTracer } from '../perf/perfTracer'
import type { HostTraceWriter } from '../trace/hostTrace'
import { tracedText, TRACE_SPOKEN_LINE_MAX_CHARS } from '../trace/voiceTrace'
import { reportFault } from '../trace/fault'

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
  /**
   * The Host Trace writer (#186, ADR 0031): records the exact text handed
   * to the synthesizer, and every line barge-in dropped. Speech is the
   * last transformation in a long chain — a line that reads wrong aloud
   * is diagnosed by what piper was actually given, not by the answer it
   * came from. Absent unless the developer set `BINGBONG_HOST_TRACE`.
   */
  hostTrace?: HostTraceWriter
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
  const { synth, player, ducker, tracer, hostTrace } = deps
  const queue: QueuedSpeak[] = []
  let pumping = false
  // Barge-in epoch: lines from before the latest stop() never reach playback.
  let stopEpoch = 0
  let current: AudioPlayback | null = null
  // The line playback owns right now (#186), so a barge-in can say what
  // it cut off rather than only that it cut something.
  let speaking: { text: string; turnId?: string } | null = null

  /**
   * Advisory bookkeeping (#31), same stance as every perf call site: a
   * throwing tracer or sink is swallowed — the log never breaks speech.
   */
  function recordSpan(turnId: string, stage: 'tts-synthesis' | 'tts-playback', durMs: number): void {
    if (!tracer) return
    try {
      tracer.span(turnId, stage, durMs)
    } catch (error) {
      reportFault('tts.speech.span', error, { turnId })
      // swallowed — see above
    }
  }

  /** One line the barge-in dropped, and where it was when the stop reached it. */
  function traceDropped(text: string, stage: 'queued' | 'synthesized' | 'speaking', turnId?: string): void {
    hostTrace?.(() => ({
      kind: 'tts_dropped',
      ...tracedText(text, TRACE_SPOKEN_LINE_MAX_CHARS),
      stage,
      ...(turnId !== undefined ? { turnId } : {}),
    }))
  }

  function speak(text: string, turnId?: string): Promise<SpeakOutcome> {
    return new Promise((resolve) => {
      queue.push({ text, ...(turnId !== undefined ? { turnId } : {}), resolve })
      void pump()
    })
  }

  function stop(): void {
    stopEpoch += 1
    for (const item of queue.splice(0)) {
      // Never synthesized: the stop reached it while it waited its turn.
      traceDropped(item.text, 'queued', item.turnId)
      item.resolve({ ok: true })
    }
    if (current !== null && speaking !== null) traceDropped(speaking.text, 'speaking', speaking.turnId)
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
    // The exact text piper is given (#186) — recorded before synthesis, so
    // a line that never comes back still leaves the ask behind.
    hostTrace?.(() => ({
      kind: 'tts_line',
      ...tracedText(text, TRACE_SPOKEN_LINE_MAX_CHARS),
      ...(turnId !== undefined ? { turnId } : {}),
    }))
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
      if (epoch !== stopEpoch) {
        traceDropped(text, 'synthesized', turnId)
        return { ok: true }
      }
      const playback = player.play(wav)
      current = playback
      speaking = { text, ...(turnId !== undefined ? { turnId } : {}) }
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
      speaking = null
      ducker?.restore()
    }
  }

  return { speak, stop }
}
