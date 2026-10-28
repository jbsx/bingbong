import type { AudioStream, AudioStreamPlayer, SpeakOptions, SpeakOutcome, SpeechSynthesizer, TtsSpeaker } from '../ports/tts'
import type { PerfTracer } from '../perf/perfTracer'
import { reportFault } from '../trace/fault'
import { splitSentences } from './sentences'
import { parseWav } from './wav'
import { DUCK_SHARE } from '../music/ducking'

export interface SpeechCoordinatorDeps {
  synth: SpeechSynthesizer
  player: AudioStreamPlayer
  /**
   * Optional perf tracer (#31, #327): each spoken text keyed to a turn id
   * records a `tts-synthesis` span per sentence (piper rendering, with the
   * sentence's index), a `tts-first-sound` span from the speak call to the
   * first sample handed to the player, and a `tts-playback` span (aplay
   * speaking). Texts without a turn id (download announcements) pass
   * through unlogged.
   */
  tracer?: PerfTracer
  /** Monotonic ms, for what has sounded (#490); `performance.now` when absent. */
  now?: () => number
}

/** A sentence handed to playback (#490): its words, when it was written, how long it sounds. */
interface Written {
  text: string
  writtenAt: number
  ms: number
}

/** A sentence that sounded, or began to (#490): from when, for how long, and the moment it was cut, if it was. */
interface Sounded {
  text: string
  from: number
  ms: number
  until: number
}

/** How long a sentence that sounded is kept for `sounded` to look back on (#490): longer than any echo window. */
const SOUNDED_KEPT_MS = 30_000

/** How long a WAV sounds, in ms; 0 for bytes that are not one. */
function wavMs(wav: Uint8Array): number {
  const parsed = parseWav(wav)
  if (parsed === null) return 0
  const bytesPerSecond = parsed.sampleRate * parsed.channels * (parsed.bitsPerSample / 8)
  return bytesPerSecond > 0 ? (parsed.pcm.length / bytesPerSecond) * 1000 : 0
}

interface QueuedSpeak {
  text: string
  options: SpeakOptions
  /** Monotonic ms of the speak call, when traced: where `tts-first-sound` opens. */
  calledAt?: number
  resolve: (outcome: SpeakOutcome) => void
}

/**
 * The TtsSpeaker the runner and download announcements share: texts queue
 * so speech never overlaps, and each is spoken sentence by sentence (#327)
 * — the first sentence is handed to playback as soon as it is synthesized,
 * the next is synthesized while it plays, and all of them play through one
 * playback stream, so there is no start gap between them. stop() (barge-in,
 * a later Command) kills the stream and drops the queue; a sentence still
 * being synthesized is discarded and the ones after it are never
 * synthesized. A text stopped mid-flight resolves `{ ok: true }` — being
 * interrupted is normal, not an error. The pane's media ducks under the
 * line through the Ducking gate (#461), not here; the line itself ducks to
 * the same floor while the person may be speaking over it (#490), until
 * let go or stopped.
 */
export function createSpeechCoordinator(deps: SpeechCoordinatorDeps): TtsSpeaker {
  const { synth, player, tracer } = deps
  const now = deps.now ?? (() => performance.now())
  const queue: QueuedSpeak[] = []
  let pumping = false
  // Barge-in epoch: sentences from before the latest stop() never reach playback.
  let stopEpoch = 0
  let current: AudioStream | null = null
  // The person may be speaking over the line (#490): the line in flight, and each after it, plays at the floor until let go or stopped.
  let ducked = false
  // What sounded (#490): the stream playing now, its sentences timed from its first sample, one after another; and the ones before it.
  let playing: { firstAt: number | null; written: Written[] } | null = null
  let sounded: Sounded[] = []

  /** The stream playing now, its sentences on the clock: each starts when the one before it ended, or when it was written, if later. */
  function playingNow(): Sounded[] {
    if (playing === null || playing.firstAt === null) return []
    let at = playing.firstAt
    return playing.written.map((sentence) => {
      const from = Math.max(at, sentence.writtenAt)
      at = from + sentence.ms
      return { text: sentence.text, from, ms: sentence.ms, until: Infinity }
    })
  }

  /** The stream ended, naturally or cut: what had sounded of it is kept; what had not begun never sounded. */
  function settle(): void {
    const at = now()
    sounded = [...sounded, ...playingNow().filter((sentence) => sentence.from < at).map((sentence) => ({ ...sentence, until: Math.min(at, sentence.from + sentence.ms) }))].filter(
      (sentence) => sentence.until > at - SOUNDED_KEPT_MS,
    )
    playing = null
  }

  function soundedWords(windowMs: number): string {
    const at = now()
    const since = at - windowMs
    const words: string[] = []
    for (const sentence of [...sounded, ...playingNow()]) {
      const end = Math.min(at, sentence.until)
      if (sentence.from >= end || sentence.from + sentence.ms <= since) continue
      // Inside a sentence, by its letters: a word sounds over its share of the sentence's time.
      const length = Math.max(1, sentence.text.length)
      for (const match of sentence.text.matchAll(/\S+/g)) {
        const wordFrom = sentence.from + (sentence.ms * match.index) / length
        const wordTo = sentence.from + (sentence.ms * (match.index + match[0].length)) / length
        if (wordFrom < end && wordTo > since) words.push(match[0])
      }
    }
    return words.join(' ')
  }

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
    ducked = false
    stopEpoch += 1
    for (const item of queue.splice(0)) {
      // Never synthesized: the stop reached it while it waited its turn.
      item.resolve({ ok: true, stopped: true })
    }
    current?.stop()
    settle()
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
    if (tracer && item.calledAt !== undefined) recordSpan(item.options.turnId, 'tts-first-sound', tracer.now() - item.calledAt)
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
            recordSpan(turnId, 'tts-synthesis', tracer.now() - synthStart, { index, spawns: synth.spawnCount?.() ?? null })
          }
        }
        // Stopped while piper rendered — never let a stale sentence reach playback.
        if (epoch !== stopEpoch) return { ok: true, stopped: true }
        if (stream === null) {
          const written: { firstAt: number | null; written: Written[] } = { firstAt: null, written: [] }
          playing = written
          stream = player.open({
            onFirstSample: () => {
              written.firstAt = now()
              firstSound(item)
            },
          })
          if (ducked) stream.setGain?.(DUCK_SHARE)
          current = stream
          playStart = tracer?.now()
        }
        playing?.written.push({ text: sentences[index]!, writtenAt: now(), ms: wavMs(wav) })
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
      if (current === stream) {
        current = null
        settle()
      }
    }
  }

  function duck(on: boolean): void {
    if (ducked === on) return
    ducked = on
    current?.setGain?.(on ? DUCK_SHARE : 1)
  }

  return { speak, stop, duck, sounded: soundedWords }
}
