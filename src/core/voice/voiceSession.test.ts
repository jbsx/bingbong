import { describe, expect, it } from 'vitest'
import { FakeClock, FakeTranscriber, FakeVad, FakeWakeDetector, RecordingTts, SkippingFakeWakeDetector } from '../testing/doubles'
import type { VoiceHeardEvent, VoiceState } from './ipcChannels'
import { createVoiceSession, type SubmittedCommand } from './voiceSession'
import { HOT_LISTEN_SILENCE_MS_DEFAULT } from '../settings/settings'
import { mergeFramesFor, vadDefaults, type UtteranceEndpointerConfig } from './vadEndpointing'
import type { CommandRunState } from '../pipeline/runState'
import type { TurnDetector } from '../ports/stt'
import { createPerfTracer, type PerfSpanRecord } from '../perf/perfTracer'
import { audioDumpEnabled, createUtteranceDumper, type UtteranceDumpWriter } from './utteranceDump'
import type { OverSpeech } from './ownVoice'
import { OVER_LEVEL_LEAD_FRAMES, OVER_LEVEL_TAIL_FRAMES } from './overLevel'

// The voice session is T9's coordinator: mic audio in (through the VadScorer
// and utterance endpointing), transcripts out to the same command runner as
// the prompt bar.
// Everything here runs on fakes; the main-process adapters only supply VAD
// probabilities and transcripts.

const SPEECH = 0.95
const SILENCE = 0.01
/** Fake wall-clock base for the perf tracer's stamps (deterministic ids). */
const PERF_WALL_ORIGIN = 1_700_000_000_000

/** Default endpoint timings (#37/#60), in frames, for exact-count assertions. */
const DEFAULTS = vadDefaults()
/** Silence frames that release an utterance: endpoint + merge window (#60). */
const SUBMIT_SILENCE = DEFAULTS.endFrames + mergeFramesFor(DEFAULTS)

/** One utterance of VAD probabilities: 8 speech frames + enough trailing silence to submit. */
function utteranceProbs(speechFrames = 8): number[] {
  return [...Array.from({ length: speechFrames }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE)]
}

interface SessionHarness {
  vad: FakeVad
  transcriber: FakeTranscriber
  clock: FakeClock
  tts: RecordingTts
  states: VoiceState[]
  heard: VoiceHeardEvent[]
  errors: string[]
  commands: string[]
  /** Submit-command calls with their threaded turn id (#27), cap flag (#61) and Endpoint reading (#324). */
  submitted: { text: string; turnId?: string; truncated: boolean; endpointAt?: number; overSpeech?: true; speechLevelDb?: number }[]
  /** Every speech start the session reported (#324). */
  speechStarts: number[]
  /** Every live partial the session forwarded (#324). */
  partials: string[]
  /** Every Utterance in capture the session let go (#326). */
  drops: number[]
  /** Span records when perf instrumentation is on (#27). */
  perf: PerfSpanRecord[]
  /** WAV writes when the audio-dump flag is on (#34). */
  dumps: { path: string; bytes: Uint8Array }[]
  aborts: number[]
  chimes: number[]
  /** Resolves a parked STT window when the harness runs with deferStt. */
  settleStt(text: string): void
  speakUtterance(probs?: number[]): Promise<void>
  session: ReturnType<typeof createVoiceSession>
}

/** The speaking gate as the session reads it (#326): whether a line is playing, and when it stops. */
class FakeSpeaking {
  speaking = false
  /** What the app is saying (#490). */
  text = ''
  private waiters: (() => void)[] = []

  isSpeaking(): boolean {
    return this.speaking
  }

  speechText(): string {
    return this.speaking ? this.text : ''
  }

  waitIdle(): Promise<void> {
    return this.speaking ? new Promise((resolve) => this.waiters.push(resolve)) : Promise.resolve()
  }

  finish(): void {
    this.speaking = false
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}

/** A speaker that tells what its voice just sounded (#490). */
class FakeSounding extends FakeSpeaking {
  /** The words of the last echo window. */
  sounded = ''
  /** Windows told one per ask, the last held, ahead of `sounded`. */
  windows: string[] = []

  soundedText(): string {
    return (this.windows.length > 1 ? this.windows.shift() : this.windows[0]) ?? this.sounded
  }
}

async function flush(microtasks = 5): Promise<void> {
  for (let i = 0; i < microtasks; i++) await Promise.resolve()
}

async function createSession(overrides?: {
  transcriber?: FakeTranscriber
  vad?: FakeVad
  wake?: { detector: FakeWakeDetector; threshold?: number }
  runState?: { value: CommandRunState }
  /** Turns on perf instrumentation; sttMs is the scripted STT duration. */
  perf?: { sttMs?: number; throwing?: boolean }
  /** Sets BINGBONG_AUDIO_DUMP for the session's dumper (#34). */
  audioDump?: boolean
  /** Live endpointer config (#37) — the settings slider seam. */
  getEndpointerConfig?: () => Partial<UtteranceEndpointerConfig>
  /** Static endpointer overrides — the small-cap seam for truncation tests (#61). */
  endpointerConfig?: Partial<UtteranceEndpointerConfig>
  /** Parks every finish() until settleStt — the STT-window seam (ADR 0024). */
  deferStt?: boolean
  /** The speaking gate (#326): TTS in flight drops the Utterance. */
  speaking?: FakeSpeaking
  /** Live `hotListenSilenceMs` (#326). */
  hotListenSilenceMs?: () => number
  /** What the runner answers a submitted Command with: its Task, settling when the Task ends (#328). */
  submitResult?: () => Promise<unknown>
  /** The turn check (#357); absent leaves the pause cap a plain timer. */
  turn?: TurnDetector
  /** Speech over the app's voice (#490); absent is `off`. */
  overSpeech?: OverSpeech
}): Promise<SessionHarness> {
  const vad = overrides?.vad ?? new FakeVad()
  const baseTranscriber = overrides?.transcriber ?? new FakeTranscriber()
  const clock = new FakeClock()
  const tts = new RecordingTts()
  const states: VoiceState[] = []
  const heard: VoiceHeardEvent[] = []
  const errors: string[] = []
  const commands: string[] = []
  const submitted: { text: string; turnId?: string; truncated: boolean; endpointAt?: number; overSpeech?: true; speechLevelDb?: number }[] = []
  const speechStarts: number[] = []
  const partials: string[] = []
  const drops: number[] = []
  const perf: PerfSpanRecord[] = []
  const dumps: { path: string; bytes: Uint8Array }[] = []
  const aborts: number[] = []
  const chimes: number[] = []
  const threshold = overrides?.wake?.threshold ?? 0.5

  // The real tracer over an in-memory sink, on the same FakeClock the session
  // uses — deterministic durations and wall stamps (#27's injectable seam).
  const tracer = overrides?.perf
    ? createPerfTracer({
        sink: {
          write: (record) => {
            if (overrides.perf?.throwing) throw new Error('disk full')
            perf.push(record)
          },
        },
        clock: { monotonic: () => clock.now(), wall: () => PERF_WALL_ORIGIN + clock.now() },
      })
    : undefined
  // Scripted STT latency: the final pass advances the fake clock.
  // deferStt parks each finish() until settleStt — a slow STT window.
  const pendingStt: { resolve: (text: string) => void }[] = []
  const transcriber = overrides?.perf
    ? {
        get engine() {
          return baseTranscriber.engine
        },
        get sentMs() {
          return baseTranscriber.sentMs
        },
        get keyterms() {
          return baseTranscriber.keyterms
        },
        begin: (preRoll?: Float32Array) => baseTranscriber.begin(preRoll),
        push: (frame: Float32Array) => baseTranscriber.push(frame),
        onPartial: (listener: (text: string) => void) => baseTranscriber.onPartial(listener),
        cancel: () => baseTranscriber.cancel(),
        pauseReached: (pcm: Float32Array) => baseTranscriber.pauseReached(pcm),
        pauseEnded: () => baseTranscriber.pauseEnded(),
        finish: async (pcm: Float32Array) => {
          clock.advance(overrides.perf?.sttMs ?? 1_500)
          return baseTranscriber.finish(pcm)
        },
      }
    : overrides?.deferStt
      ? {
          begin: () => baseTranscriber.begin(),
          push: (frame: Float32Array) => baseTranscriber.push(frame),
          onPartial: (listener: (text: string) => void) => baseTranscriber.onPartial(listener),
          cancel: () => baseTranscriber.cancel(),
          finish: (pcm: Float32Array) => {
            void pcm
            return new Promise<string>((resolve) => pendingStt.push({ resolve }))
          },
        }
      : baseTranscriber

  // The real dumper over an in-memory writer, switched by the env flag the
  // way main wires it (#34): flag off — wired but writes nothing.
  const dumpDir = '/user-data/audio-dumps'
  const dumpWriter: UtteranceDumpWriter = {
    mkdir: () => {},
    writeFile: (path, bytes) => dumps.push({ path, bytes }),
  }
  const dumper =
    overrides?.audioDump !== undefined
      ? createUtteranceDumper({
          dir: dumpDir,
          writer: dumpWriter,
          enabled: audioDumpEnabled({ BINGBONG_AUDIO_DUMP: overrides.audioDump ? '1' : undefined }),
          now: () => PERF_WALL_ORIGIN + clock.now(),
        })
      : undefined

  const session = createVoiceSession({
    vad,
    transcriber,
    clock,
    tts,
    endpointerConfig: overrides?.endpointerConfig,
    turn: overrides?.turn,
    getEndpointerConfig: overrides?.getEndpointerConfig,
    tracer,
    dumper,
    speaking: overrides?.speaking,
    ...(overrides?.overSpeech !== undefined ? { getOverSpeech: () => overrides.overSpeech! } : {}),
    getHotListenSilenceMs: overrides?.hotListenSilenceMs,
    wake: overrides?.wake
      ? {
          detector: overrides.wake.detector,
          getThreshold: () => threshold,
          chime: () => chimes.push(1),
        }
      : undefined,
    onSubmitCommand: (text, sent: SubmittedCommand) => {
      commands.push(text)
      submitted.push({ text, ...sent })
      return overrides?.submitResult?.()
    },
    onSpeechStart: () => speechStarts.push(1),
    onPartial: (text) => partials.push(text),
    onUtteranceDropped: () => drops.push(1),
    getRunState: () => overrides?.runState?.value ?? 'idle',
    onAbort: () => aborts.push(1),
    onStateChange: (state) => states.push(state),
    onHeard: (event) => heard.push(event),
    onError: (message) => errors.push(message),
  })

  const chunk = new Float32Array(512)
  const speakUtterance = async (probs = utteranceProbs()) => {
    for (const prob of probs) {
      // One 512-sample chunk per frame keeps frame splitting out of the way;
      // a separate test covers multi-frame chunks.
      vad.queue.push(prob)
      await session.pushAudio(chunk)
    }
  }

  const settleStt = (text: string): void => {
    pendingStt.shift()?.resolve(text)
  }

  return { vad, transcriber: baseTranscriber, clock, tts, states, heard, errors, commands, submitted, speechStarts, partials, drops, perf, dumps, aborts, chimes, settleStt, speakUtterance, session }
}

describe('voice session', () => {
  it.each(['stop', 'abort', 'cancel', 'never mind'])('routes active "%s" to abort, never to the runner as a command', async (phrase) => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ transcriber: new FakeTranscriber([phrase]), runState })
    harness.session.arm()
    await flush()

    await harness.speakUtterance()

    expect(harness.aborts).toEqual([1])
    expect(harness.commands).toEqual([])
    expect(harness.heard).toEqual([{ text: phrase, routed: 'abort' }])
  })

  it('routes idle stop as an ordinary command', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['stop']) })
    harness.session.arm()

    await harness.speakUtterance()

    expect(harness.aborts).toEqual([])
    expect(harness.commands).toEqual(['stop'])
  })

  it('submits a spoken command through the same callback the text box uses, then disarms', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states).toEqual([
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false },
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true, hearing: false },
      { listening: false, reason: null, monitoring: false, transcribing: false, hearing: false },
    ])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    // The utterance audio handed to STT is the endpointed utterance: the
    // 3-frame ring the trigger fired on (incl. the first speech frames) + 8
    // speech + the pause cap's silence, of which the transcriber gets the
    // 20 frames the 700 ms Endpoint left it (#357).
    expect(harness.transcriber.audio[0].length).toBe((8 + 20) * 512)
  })

  it('submits an utterance that hit the hard cap with the truncation flag (#61)', async () => {
    // A small cap keeps the test short; the flag is the cap's, not a
    // duration's — any capped utterance proves the threading.
    const harness = await createSession({
      transcriber: new FakeTranscriber(['and then I want you to open']),
      endpointerConfig: { maxUtteranceMs: 640 },
    })

    harness.session.arm()
    // Unbroken speech: only the cap can end this utterance (truncated=true).
    await harness.speakUtterance(Array.from({ length: 40 }, () => SPEECH))

    expect(harness.commands).toEqual(['and then I want you to open'])
    expect(harness.submitted[0].truncated).toBe(true)
    expect(harness.heard).toEqual([{ text: 'and then I want you to open', routed: 'command' }])
  })

  it('submits a silence-ended utterance without the truncation flag (#61)', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.submitted).toEqual([{ text: 'open youtube', truncated: false }])
  })

  it('applies a changed endpoint delay to the next utterance without a restart (#37)', async () => {
    let endFrames = 25 // The old ~800 ms default, as a saved settings file would carry.
    const harness = await createSession({
      transcriber: new FakeTranscriber(['first', 'second']),
      // The merge hold is pinned off (#60): this test is the silence timing.
      getEndpointerConfig: () => ({ endFrames, resumptionMergeMs: 0 }),
    })

    harness.session.arm()
    // Exactly 8 speech + 25 silence: the utterance emits on the last frame, so
    // the fake VAD's queue holds no leftovers for the next utterance.
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: 25 }, () => SILENCE)])
    expect(harness.transcriber.audio[0].length).toBe((8 + 20) * 512) // at most 20 frames of the silence (#357)

    endFrames = 5 // Slider moved to the snappy end; no restart, no rebuild.
    harness.session.arm()
    await harness.speakUtterance()
    // The second utterance ends after just 5 silence frames — the new value.
    expect(harness.transcriber.audio[1].length).toBe((8 + 5 - 2) * 512)
    expect(harness.commands).toEqual(['first', 'second'])
  })

  it('splits pushed chunks into 512-sample frames for the VAD', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['go']) })
    harness.session.arm()

    // Push the whole utterance as 1024-sample chunks: two frames each.
    const probs = utteranceProbs(5)
    harness.vad.queue = [...probs]
    const twoFrames = new Float32Array(1024)
    for (let i = 0; i < Math.ceil(probs.length / 2); i++) {
      await harness.session.pushAudio(twoFrames)
    }

    expect(harness.commands).toEqual(['go'])
    expect(harness.vad.frames.every((frame) => frame.length === 512)).toBe(true)
  })

  it('stays armed when nothing was recognized (a breath, not a command)', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['']) })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.commands).toEqual([])
    // The blip exits the STT window cleanly — back to the open ear (#38).
    expect(harness.states).toEqual([
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false },
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true, hearing: false },
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false },
    ])
    expect(harness.heard).toEqual([])
  })

  it('stops TTS when the hotkey arms (barge-in stand-in until the wake word)', async () => {
    const harness = await createSession()

    harness.session.arm()

    expect(harness.tts.stopCalls).toBe(1)
    expect(harness.states).toEqual([{ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false }])
  })

  it('drops audio entirely while not listening', async () => {
    const harness = await createSession()

    await harness.speakUtterance()

    expect(harness.vad.frames).toHaveLength(0)
    expect(harness.transcriber.audio).toHaveLength(0)
  })

  it('surfaces a failed transcriber as an error and disarms', async () => {
    const transcriber = new FakeTranscriber(['x'])
    transcriber.rejectWith = new Error('stt model missing')
    const harness = await createSession({ transcriber })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.errors).toEqual(['stt model missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  it('surfaces a failed VAD as an error and disarms', async () => {
    const vad = new FakeVad()
    vad.failWith = new Error('silero model missing')
    const harness = await createSession({ vad })

    harness.session.arm()
    await harness.session.pushAudio(new Float32Array(512))

    expect(harness.errors).toEqual(['silero model missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  it('disarm drops in-flight utterance audio', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    // Half an utterance, then the user disarms.
    harness.vad.queue = utteranceProbs().slice(0, 10)
    for (let i = 0; i < 10; i++) await harness.session.pushAudio(new Float32Array(512))
    harness.session.disarm()

    // The rest of the audio arrives late and is dropped.
    harness.vad.queue = utteranceProbs().slice(10)
    await harness.speakUtterance()

    expect(harness.commands).toEqual([])
    expect(harness.transcriber.audio).toHaveLength(0)
    // VAD state resets on arm (fresh episode) and on disarm.
    expect(harness.vad.resets).toBe(2)
  })

})

describe('voice session — the plain loop (#324, ADR 0076)', () => {
  it('an activation while a Command is in flight opens a listen like any other: the next Command supersedes it', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), runState })

    harness.session.arm()
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false })
    await harness.speakUtterance()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.aborts).toEqual([])
  })

  it('reports speech start once per Utterance, so the page is collected while the user speaks', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube', 'back']) })

    harness.session.arm()
    await harness.speakUtterance()
    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.speechStarts).toEqual([1, 1])
  })

  it('forwards the live partial while listening and clears it at the Endpoint', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    harness.transcriber.emitPartial('open')
    harness.transcriber.emitPartial('open you')
    await harness.speakUtterance()
    harness.transcriber.emitPartial('late')

    expect(harness.partials).toEqual(['open', 'open you', '', ''])
  })
})

describe('voice session — resumption merge (#60)', () => {
  // The branch default is no hold (ADR 0076); the hold's own tests turn it
  // on explicitly, at the 1.5 s `main` holds (#60).
  const MERGED = { resumptionMergeMs: 1_500 }
  const MERGE_FRAMES = mergeFramesFor({ ...DEFAULTS, ...MERGED })
  /** Silence frames that release a held utterance: endpoint + merge window. */
  const MERGED_SUBMIT_SILENCE = DEFAULTS.endFrames + MERGE_FRAMES

  /** Push one 512-sample frame with the given VAD prob. */
  async function frame(harness: SessionHarness, prob: number): Promise<void> {
    harness.vad.queue.push(prob)
    await harness.session.pushAudio(new Float32Array(512))
  }

  it('rejoins a sub-window pause into one command containing both halves', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube and then play it']), endpointerConfig: MERGED })

    harness.session.arm()
    // Half A, endpoint-firing silence (~300 ms), half B inside the 1.5 s
    // window, then silence long enough to submit.
    await harness.speakUtterance([
      ...Array.from({ length: 8 }, () => SPEECH),
      ...Array.from({ length: DEFAULTS.endFrames }, () => SILENCE),
      ...Array.from({ length: 6 }, () => SPEECH),
      ...Array.from({ length: MERGED_SUBMIT_SILENCE + 5 }, () => SILENCE),
    ])

    expect(harness.commands).toEqual(['open youtube and then play it'])
    expect(harness.heard).toEqual([{ text: 'open youtube and then play it', routed: 'command' }])
    // One utterance of STT audio: half A + the pause + half B, tail-trimmed.
    expect(harness.transcriber.audio).toHaveLength(1)
    expect(harness.transcriber.audio[0].length).toBe((8 + DEFAULTS.endFrames + 6 + 20) * 512)
  })

  it('keeps the ear open through the pause — the STT window starts only when the utterance submits', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), endpointerConfig: MERGED })

    harness.session.arm()
    // Half A plus endpoint-firing silence: the merge window is open, the ear
    // is still listening, nothing is transcribing.
    for (const prob of [...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: DEFAULTS.endFrames }, () => SILENCE)]) {
      await frame(harness, prob)
    }
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true })

    // Half B rejoins; the command submits when the window closes in silence.
    await harness.speakUtterance([...Array.from({ length: 6 }, () => SPEECH), ...Array.from({ length: MERGED_SUBMIT_SILENCE + 5 }, () => SILENCE)])
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.filter((state) => state.transcribing)).toHaveLength(1)
  })

  it('submits silence-ended speech only when the window closes — never sooner', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), endpointerConfig: MERGED })

    harness.session.arm()
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: MERGED_SUBMIT_SILENCE - 1 }, () => SILENCE)])
    // The endpoint fired, but the merge window is still open: no submission.
    expect(harness.commands).toEqual([])
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true })

    await frame(harness, SILENCE) // the window closes in silence
    await flush()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  it('the merge window is tunable through the endpointer-config seam, live (#60)', async () => {
    let config: Partial<UtteranceEndpointerConfig> = { endFrames: 6, resumptionMergeMs: 0 }
    const harness = await createSession({
      transcriber: new FakeTranscriber(['first', 'second']),
      getEndpointerConfig: () => config,
    })

    // Merge off: the utterance submits at the endpoint itself (6 frames).
    harness.session.arm()
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: 6 }, () => SILENCE)])
    expect(harness.commands).toEqual(['first'])

    // Merge on for the next utterance — no restart, no rebuild.
    config = { endFrames: 6, resumptionMergeMs: 1_500 }
    harness.session.arm()
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: 6 + 46 }, () => SILENCE)])
    // One frame short of the window's close: still holding.
    expect(harness.commands).toEqual(['first'])
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true })

    await frame(harness, SILENCE)
    expect(harness.commands).toEqual(['first', 'second'])
  })

  it('disarm during the open window drops the held utterance', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), endpointerConfig: MERGED })

    harness.session.arm()
    // Speech, then silence into the open merge window (short of submitting).
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: DEFAULTS.endFrames + 10 }, () => SILENCE)])
    expect(harness.commands).toEqual([])
    harness.session.disarm()

    // The rest of the window's silence arrives late and is dropped.
    await harness.speakUtterance(Array.from({ length: MERGED_SUBMIT_SILENCE + 5 }, () => SILENCE))

    expect(harness.commands).toEqual([])
    expect(harness.transcriber.audio).toEqual([])
    expect(harness.transcriber.events.at(-1)).toBe('cancel')
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })
})


describe('voice session — wake word (T10)', () => {
  /** Push `frames` monitoring frames (512 samples each) with the given VAD probs. */
  async function monitorFrames(harness: SessionHarness, probs: number[]): Promise<void> {
    for (const prob of probs) {
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
  }

  it('monitors without listening: audio feeds the wake detector, not the transcriber', async () => {
    const detector = new FakeWakeDetector([0.1, 0.1])
    const harness = await createSession({ wake: { detector } })

    harness.session.enableWakeMonitoring()
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.states).toEqual([{ listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }])
    expect(detector.chunks.length).toBeGreaterThan(0)
    expect(harness.transcriber.audio).toHaveLength(0)
  })

  it('loads the wake models as monitoring starts, before any audio (#435)', async () => {
    const detector = new SkippingFakeWakeDetector([0.1])
    const harness = await createSession({ wake: { detector } })

    harness.session.enableWakeMonitoring()

    expect(detector.loads).toBe(1)
    expect(detector.chunks).toHaveLength(0)
  })

  it('wake detection chimes, barges in on speech, and opens a Hot Listen that stays open after the Utterance', async () => {
    const detector = new FakeWakeDetector([0.9])
    const harness = await createSession({
      transcriber: new FakeTranscriber(['open youtube']),
      wake: { detector },
    })
    harness.session.enableWakeMonitoring()

    // Two and a half frames complete the first 1280-sample wake chunk.
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])

    // Activation: chime + barge-in stop + listening with the wake reason.
    expect(harness.chimes).toHaveLength(1)
    expect(harness.tts.stopCalls).toBe(1)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false })

    // The utterance submits like a hotkey command, and the ear stays open (#326).
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false })
  })

  it('a barge-in tail that transcribes empty is a harmless no-op — the real command after it is not swallowed (#41 acceptance)', async () => {
    const detector = new FakeWakeDetector([0.9])
    // First finish is the stopped speech's tail (or the activation chime)
    // reaching the mic — synthetic audio Moonshine can zero out; the second
    // is the user's actual spoken command.
    const harness = await createSession({
      transcriber: new FakeTranscriber(['', 'open youtube']),
      wake: { detector },
    })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.tts.stopCalls).toBe(1)

    // Utterance 1 — the tail: an empty transcript must reopen the ear with
    // the wake listen intact (the harmless no-op branch), not close it.
    await harness.speakUtterance()
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false })
    expect(harness.commands).toEqual([])
    expect(harness.errors).toEqual([])

    // Utterance 2 — the real command: submitted through the text-box surface.
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
  })

  it('keeps monitoring after a Hot Listen closes so the next wake word lands', async () => {
    const detector = new FakeWakeDetector([0.9])
    const harness = await createSession({
      transcriber: new FakeTranscriber(['first', 'second']),
      wake: { detector },
    })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['first'])

    // Silence closes the Hot Listen; monitoring resumes and the detector fires again on new audio.
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false, hearing: false })
    detector.push('wake', 0.9)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false })
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['first', 'second'])
    expect(harness.chimes).toHaveLength(2)
  })

  it('a detector failure surfaces one error and disables monitoring', async () => {
    const detector = new FakeWakeDetector()
    detector.failWith = new Error('wake/bing_bong.onnx missing')
    const harness = await createSession({ wake: { detector } })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.errors).toEqual(['wake/bing_bong.onnx missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })

    // Inert from here: later audio is dropped, not retried against the model.
    detector.push('wake', 0.9)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  it('the hotkey still works while monitoring, and disarm keeps monitoring live', async () => {
    const detector = new FakeWakeDetector()
    const harness = await createSession({
      transcriber: new FakeTranscriber(['open youtube']),
      wake: { detector },
    })
    harness.session.enableWakeMonitoring()

    harness.session.arm()
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states).toContainEqual({ listening: true, reason: 'hotkey', monitoring: true, transcribing: false, hearing: false })

    // Toggling the hotkey off stops listening; the wake ear stays on.
    harness.session.arm()
    harness.session.disarm()
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false, hearing: false })

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(detector.chunks.length).toBeGreaterThan(0)
  })

  it('the abort head cancels an active run from the always-on ear', async () => {
    const runState = { value: 'running' as CommandRunState }
    const detector = new FakeWakeDetector({ abort: [0.95] })
    const harness = await createSession({ wake: { detector }, runState })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])

    expect(harness.aborts).toHaveLength(1)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false, hearing: false })
  })

  it('the abort head is a no-op while idle', async () => {
    const detector = new FakeWakeDetector({ abort: [0.95, 0.95] })
    const harness = await createSession({ wake: { detector } })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.aborts).toHaveLength(0)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false, hearing: false })
  })

  it('asks for the abort head only while a Command runs, and never for "hold on" (#435)', async () => {
    const runState = { value: 'idle' as CommandRunState }
    const detector = new FakeWakeDetector()
    const harness = await createSession({ wake: { detector }, runState })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(detector.asked.length).toBeGreaterThan(0)
    expect(new Set(detector.asked.flat())).toEqual(new Set(['wake']))

    runState.value = 'running'
    const before = detector.asked.length
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(detector.asked.slice(before).every((heads) => heads.join() === 'wake,abort')).toBe(true)
  })

  it('without a wake detector, enableWakeMonitoring is a no-op', async () => {
    const harness = await createSession()

    harness.session.enableWakeMonitoring()
    await harness.speakUtterance()

    expect(harness.states).toEqual([])
    expect(harness.vad.frames).toHaveLength(0)
  })
})

describe('voice session — perf spans (#27)', () => {
  it('mints one turn id at utterance end and logs stt + wake-to-transcript spans sharing it', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), perf: {} })

    harness.session.arm() // listen start: the wake-to-transcript clock starts here
    harness.clock.advance(300) // the user speaks
    await harness.speakUtterance() // utterance ends at t=300; STT takes 1500ms

    const stt = harness.perf.find((record) => record.stage === 'stt')
    const wake = harness.perf.find((record) => record.stage === 'wake-to-transcript')
    expect(stt).toBeDefined()
    expect(wake).toBeDefined()
    expect(stt!.turnId).toBe(wake!.turnId)
    // The id is wall-stamped at mint time (utterance end, before STT).
    expect(stt!.turnId).toBe(`turn-${(PERF_WALL_ORIGIN + 300).toString(36)}-1`)
    expect(stt!.durMs).toBe(1_500)
    expect(wake!.durMs).toBe(1_800)
    expect(stt!.t).toBe(1_800)
    expect(stt!.at).toBe(PERF_WALL_ORIGIN + 1_800)
    // The turn id rides the submit-command callback for the next ticket.
    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: stt!.turnId, truncated: false, endpointAt: 300 }])
    // Instrumentation changes no pipeline behavior.
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
  })

  it('carries utterance speech ms, total ms, and truncated flag in the stt detail', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['go']), perf: {} })

    harness.session.arm()
    await harness.speakUtterance() // 8 speech frames, then the pause cap; at most 20 frames of it handed to STT (#357)

    const stt = harness.perf.find((record) => record.stage === 'stt')
    expect(stt!.detail).toEqual({ speechMs: 8 * 32, totalMs: (8 + 20) * 32, truncated: false, endedBy: 'cap', silenceMs: SUBMIT_SILENCE * 32, cold: true })
  })

  it('carries the Utterance\'s Speech Level to the runner and the stt span (#500): a `none` said at the mic is answered aloud', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['L-O-O-P.']), perf: {} })

    harness.session.arm()
    // Every frame at 0.1: the loudest fifth reads −20 dBFS.
    for (const prob of utteranceProbs()) {
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512).fill(0.1))
    }

    expect(harness.submitted[0]!.speechLevelDb).toBeCloseTo(-20, 3)
    expect((harness.perf.find((record) => record.stage === 'stt')!.detail as { levelDb: number }).levelDb).toBeCloseTo(-20, 1)
  })

  it('marks only the run\'s first decode cold: it loads the engine\'s sessions', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['go', 'stop']), perf: {} })

    harness.session.arm()
    await harness.speakUtterance()
    harness.session.arm()
    await harness.speakUtterance()

    const stt = harness.perf.filter((record) => record.stage === 'stt')
    expect(stt.map((record) => record.detail?.cold)).toEqual([true, undefined])
  })

  it('an end-of-speech span: the pause, and the turn check that read it — audio queues behind the check', async () => {
    const harness = await createSession({
      transcriber: new FakeTranscriber(['go']),
      perf: {},
      turn: {
        score: async () => {
          harness.clock.advance(900)
          return 0.92
        },
      },
    })

    harness.session.arm()
    await harness.speakUtterance()

    const end = harness.perf.find((record) => record.stage === 'end-of-speech')
    expect(end).toMatchObject({ durMs: DEFAULTS.turnCheckFrames * 32 + 900, detail: { endedBy: 'turn' } })
  })

  it('tells the transcriber the pause is reached before the Endpoint, with the audio the Endpoint then carries (#443)', async () => {
    const transcriber = new FakeTranscriber(['go'])
    const harness = await createSession({ transcriber, turn: { score: async () => 0.92 } })

    harness.session.arm()
    await harness.speakUtterance()

    // The hotkey's listen is single-shot: it closes (cancel) after the line.
    expect(transcriber.events.filter((event) => event !== 'push')).toEqual(['begin', 'pause', 'finish', 'cancel'])
    expect(transcriber.pausedAudio[0]!.length).toBe(transcriber.audio[0]!.length)
    expect(harness.commands).toEqual(['go'])
  })

  it('an endpoint-to-words span: from the last speech frame, through the pause and the turn check, to the words (#443)', async () => {
    const harness = await createSession({
      transcriber: new FakeTranscriber(['go']),
      perf: { sttMs: 120 },
      turn: {
        score: async () => {
          harness.clock.advance(85)
          return 0.92
        },
      },
    })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.find((record) => record.stage === 'endpoint-to-words')).toMatchObject({
      durMs: DEFAULTS.turnCheckFrames * 32 + 85 + 120,
      detail: { endedBy: 'turn', atPause: true },
    })
    expect(harness.perf.find((record) => record.stage === 'stt')!.detail).toMatchObject({ atPause: true, pauseDecodes: 1 })
  })

  it("a pause the turn read unfinished is not the Endpoint's audio: the stt span says the final decoded afresh (#443)", async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['go']), perf: {}, turn: { score: async () => 0.1 } })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.find((record) => record.stage === 'stt')!.detail).toMatchObject({ endedBy: 'cap', atPause: false, pauseDecodes: 1 })
  })

  it('an end-of-speech span at the pause cap is the pause alone', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['go']), perf: {} })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.find((record) => record.stage === 'end-of-speech')).toMatchObject({ durMs: SUBMIT_SILENCE * 32, detail: { endedBy: 'cap' } })
  })

  it('names the engine that transcribed in the stt detail (#358)', async () => {
    const harness = await createSession({ transcriber: Object.assign(new FakeTranscriber(['go']), { engine: 'parakeet' }), perf: {} })

    harness.session.arm()
    await harness.speakUtterance()

    const stt = harness.perf.find((record) => record.stage === 'stt')
    expect(stt!.detail?.engine).toBe('parakeet')
  })

  it('carries the audio the cloud ear sent in the stt detail (#463)', async () => {
    const harness = await createSession({ transcriber: Object.assign(new FakeTranscriber(['go']), { engine: 'elevenlabs', sentMs: 1_250 }), perf: {} })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.find((record) => record.stage === 'stt')!.detail).toMatchObject({ engine: 'elevenlabs', sentMs: 1_250 })
  })

  it('carries the keyterms the cloud ear was asked with in the stt detail (#471)', async () => {
    const keyterms = ['niyam', 'idle', 'loop']
    const harness = await createSession({ transcriber: Object.assign(new FakeTranscriber(['go']), { engine: 'elevenlabs', sentMs: 900, keyterms }), perf: {} })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.find((record) => record.stage === 'stt')!.detail).toMatchObject({ engine: 'elevenlabs', keyterms })
  })

  it('carries the turn check that fired the Endpoint in the stt detail (#357)', async () => {
    const harness = await createSession({
      transcriber: new FakeTranscriber(['go']),
      perf: {},
      turn: {
        score: async () => {
          harness.clock.advance(37)
          return 0.92
        },
      },
    })

    harness.session.arm()
    await harness.speakUtterance()

    const stt = harness.perf.find((record) => record.stage === 'stt')
    expect(stt!.detail).toMatchObject({
      endedBy: 'turn',
      silenceMs: DEFAULTS.turnCheckFrames * 32,
      turnVerdict: 'finished',
      turnProbability: 0.92,
      turnScoreMs: 37,
    })
    expect(harness.commands).toEqual(['go'])
  })

  it('still logs the stt span with the error when transcription fails', async () => {
    const transcriber = new FakeTranscriber(['x'])
    transcriber.rejectWith = new Error('stt model missing')
    const harness = await createSession({ transcriber, perf: {} })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.map((record) => record.stage)).toEqual(['stt', 'end-of-speech'])
    expect(harness.perf[0].detail).toMatchObject({ error: 'stt model missing', truncated: false })
    expect(harness.errors).toEqual(['stt model missing'])
  })

  it('keeps the wake-to-transcript clock running through an empty transcript', async () => {
    // Only a non-empty transcript can end a command listen, so the marker
    // must survive an empty one: the command that follows is still measured
    // from the original listen start, not from the empty blip.
    const harness = await createSession({ transcriber: new FakeTranscriber(['', 'open youtube']), perf: {} })

    harness.session.arm() // listen start at t=0
    harness.clock.advance(300)
    await harness.speakUtterance() // empty transcript — listen stays open, marker intact
    harness.clock.advance(400)
    await harness.speakUtterance() // the command

    const wake = harness.perf.find((record) => record.stage === 'wake-to-transcript')
    expect(wake).toBeDefined()
    // 300ms to the blip + 1500ms its STT + 400ms gap + 1500ms the command's STT.
    expect(wake!.durMs).toBe(3_700)
    // The blank one is counted: a long span with many is an open ear, not a slow one.
    expect(wake!.detail).toEqual({ reason: 'hotkey', blips: 1 })
    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: expect.any(String), truncated: false, endpointAt: expect.any(Number) }])
  })

  it('never fails an utterance over perf bookkeeping — a throwing sink is swallowed', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), perf: { throwing: true } })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: expect.any(String), truncated: false, endpointAt: expect.any(Number) }])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    expect(harness.errors).toEqual([])
  })
})

describe('voice session — transcribing state (#38)', () => {
  /**
   * STT under test control: the endpoint has fired, but the transcript is
   * held back until the test resolves — the real ~seconds-long STT window.
   */
  class DeferredTranscriber extends FakeTranscriber {
    private resolveText: ((text: string) => void) | null = null

    override finish(pcm: Float32Array): Promise<string> {
      this.audio.push(pcm)
      return new Promise((resolve) => {
        this.resolveText = resolve
      })
    }

    resolve(text: string): void {
      this.resolveText?.(text)
    }
  }

  it('flips to transcribing at endpoint fire, not at transcript arrival, then exits on submit', async () => {
    const transcriber = new DeferredTranscriber()
    const harness = await createSession({ transcriber })

    harness.session.arm()
    const { stt } = await endpointUtterance(harness)

    // The endpoint fired; STT is in flight. The state left listening the
    // moment the utterance ended — before any transcript exists.
    expect(harness.states).toEqual([
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false },
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true, hearing: false },
    ])
    expect(harness.session.getState()).toEqual({
      listening: false,
      reason: 'hotkey',
      monitoring: false,
      transcribing: true,
      hearing: false,
    })

    transcriber.resolve('open youtube')
    await stt
    await flush()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  /**
   * Feed frames until the endpoint fires; resolves holding the STT-pending
   * push. The push rides in an object — `await` would otherwise assimilate
   * the bare thenable and deadlock until the transcript resolves.
   */
  async function endpointUtterance(harness: SessionHarness): Promise<{ stt: Promise<void> }> {
    for (const prob of utteranceProbs()) {
      harness.vad.queue.push(prob)
      const pushed = harness.session.pushAudio(new Float32Array(512))
      await flush()
      if (harness.states.at(-1)?.transcribing) return { stt: pushed }
    }
    throw new Error('utterance never endpointed')
  }

  it('a disarm during the STT window exits transcribing to idle and drops the transcript', async () => {
    const transcriber = new DeferredTranscriber()
    const harness = await createSession({ transcriber })

    harness.session.arm()
    const { stt } = await endpointUtterance(harness)
    harness.session.disarm()

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })

    transcriber.resolve('open youtube')
    await stt
    await flush()

    expect(harness.commands).toEqual([])
    expect(harness.heard).toEqual([])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  it('a hotkey press during the STT window is a no-op — the transcript in flight decides the listen', async () => {
    const transcriber = new DeferredTranscriber()
    const harness = await createSession({ transcriber })

    harness.session.arm()
    const { stt } = await endpointUtterance(harness)
    harness.session.arm()

    // No fourth state: the listen in flight still owns the mic.
    expect(harness.states).toHaveLength(3)

    transcriber.resolve('open youtube')
    await stt
    await flush()

    expect(harness.commands).toEqual(['open youtube'])
  })

})

describe('voice session — streaming transcriber port (#40)', () => {
  it('begins the capture at speech start and pushes every utterance frame before finish', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    await harness.speakUtterance() // 8 speech frames + trailing silence, default config

    // Frames 1–2 sit in pre-roll (startFrames 3); frame 3 begins the capture.
    // Frames 3–8 (6 speech) flow through push, then every silence frame but
    // the last — the endpoint + merge silence (#60) holds the utterance, and
    // the frame that finally releases it is not pushed — finish() gets the
    // complete utterance.
    expect(harness.transcriber.events).toEqual([
      'begin',
      ...Array.from({ length: 6 + SUBMIT_SILENCE - 1 }, () => 'push'),
      'finish',
      'cancel', // stopListening after the command submit resets the ear
    ])
    expect(harness.transcriber.pushedFrames).toHaveLength(6 + SUBMIT_SILENCE - 1)
    expect(harness.transcriber.audio).toHaveLength(1)
    expect(harness.transcriber.audio[0]).toHaveLength((8 + 20) * 512) // pre-roll + speech + at most 20 frames of tail (#357)
    expect(harness.commands).toEqual(['open youtube'])
  })

  it('hands begin the pre-roll before the trigger frame, so an engine hearing only what it is sent keeps the first syllable (#463)', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    await harness.speakUtterance()

    // startFrames 3: frames 1–2 are the pre-roll, frame 3 the trigger, pushed.
    expect(harness.transcriber.preRolls).toHaveLength(1)
    expect(harness.transcriber.preRolls[0]).toHaveLength(2 * 512)
  })

  it('tells the engine the listen opened, once per activation (#463)', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    harness.session.arm()
    expect(harness.transcriber.listensOpened).toBe(1)
  })

  it('discards the capture when the endpointer drops a blip — no finish ever runs', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    // 4 speech frames = 128 ms < minSpeechMs 160: a blip, not an utterance.
    await harness.speakUtterance([...Array.from({ length: 4 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE)])

    // The blip rides the merge hold too (#60): frames stream until the window
    // closes in silence and discards it.
    expect(harness.transcriber.events).toEqual([
      'begin',
      ...Array.from({ length: 2 + SUBMIT_SILENCE - 1 }, () => 'push'),
      'cancel',
    ])
    expect(harness.transcriber.audio).toEqual([])
    expect(harness.commands).toEqual([])
    // The ear stays open — a blip never left the listening state.
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false })
  })

  it('cancels the in-flight capture on disarm mid-utterance', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    for (let i = 0; i < 5; i++) {
      harness.vad.queue.push(SPEECH)
      await harness.session.pushAudio(new Float32Array(512))
    }
    harness.session.disarm()

    expect(harness.transcriber.events).toEqual(['begin', 'push', 'push', 'push', 'cancel'])
    expect(harness.transcriber.audio).toEqual([])
    expect(harness.commands).toEqual([])
  })

  it('partial transcripts are observable at the port during speech — the session is unaffected', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })
    const partials: string[] = []
    harness.transcriber.onPartial((text) => partials.push(text))

    harness.session.arm()
    for (let i = 0; i < 3; i++) {
      harness.vad.queue.push(SPEECH)
      await harness.session.pushAudio(new Float32Array(512))
    }
    // Mid-speech: a streaming engine would have emitted this by now.
    harness.transcriber.emitPartial('open you')
    expect(partials).toEqual(['open you'])

    await harness.speakUtterance([...Array.from({ length: 5 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE)])

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states).toEqual([
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false },
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true, hearing: false },
      { listening: false, reason: null, monitoring: false, transcribing: false, hearing: false },
    ])
  })
})

describe('voice session — hearing (#441)', () => {
  async function frames(harness: SessionHarness, probs: number[]): Promise<void> {
    for (const prob of probs) {
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
  }

  const hearing = (states: VoiceState[]): boolean[] => states.map((state) => state.hearing)

  it('is set on the very frame speech starts — with the speech start, no frame later — and cleared at the Endpoint', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['pause']) })
    harness.session.arm()
    const startFrames = vadDefaults().startFrames
    await frames(harness, Array.from({ length: startFrames - 1 }, () => SPEECH))
    expect(harness.speechStarts).toEqual([])
    expect(harness.session.getState().hearing).toBe(false)
    await frames(harness, [SPEECH])
    expect(harness.speechStarts).toEqual([1])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: true })
    await harness.speakUtterance([...Array.from({ length: 5 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE)])
    expect(harness.commands).toEqual(['pause'])
    expect(hearing(harness.states)).toEqual([false, true, false, false])
    expect(harness.states.find((state) => state.transcribing)?.hearing).toBe(false)
  })

  it('is cleared when the endpointer drops a blip, and the ear stays open', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['pause']) })
    harness.session.arm()
    await harness.speakUtterance([...Array.from({ length: 4 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE)])
    expect(hearing(harness.states)).toEqual([false, true, false])
    expect(harness.states.at(-1)?.listening).toBe(true)
  })

  it('is cleared when the listen closes mid-utterance', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['pause']) })
    harness.session.arm()
    await frames(harness, [SPEECH, SPEECH, SPEECH, SPEECH])
    expect(harness.session.getState().hearing).toBe(true)
    harness.session.disarm()
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  it('is never set by the app’s own voice, and is cleared when a line starts under the speech', async () => {
    const speaking = new FakeSpeaking()
    const harness = await createSession({ transcriber: new FakeTranscriber(['pause']), speaking })
    harness.session.arm()
    speaking.speaking = true
    await frames(harness, [SPEECH, SPEECH, SPEECH, SPEECH])
    expect(hearing(harness.states)).toEqual([false])
    await frames(harness, Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE))
    speaking.speaking = false
    await frames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.session.getState().hearing).toBe(true)
    speaking.speaking = true
    await frames(harness, [SPEECH])
    expect(harness.session.getState().hearing).toBe(false)
    expect(harness.states.at(-1)?.listening).toBe(true)
  })
})

describe('voice session — utterance audio dumps (#34)', () => {
  /** The benchmark reader again (scripts/measure-stt-latency.mjs shape check). */
  function pcmFromWav(bytes: Uint8Array): Float32Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const samples = new Float32Array((bytes.length - 44) / 2)
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768
    return samples
  }

  it('with the flag set, each detected utterance lands as a timestamp/sequence WAV holding exactly the STT audio', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), audioDump: true })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.dumps).toHaveLength(1)
    expect(harness.dumps[0].path).toBe(`/user-data/audio-dumps/utterance-${PERF_WALL_ORIGIN}-0001.wav`)
    const dumped = pcmFromWav(harness.dumps[0].bytes)
    const transcribed = harness.transcriber.audio[0]
    expect(dumped.length).toBe(transcribed.length)
    dumped.forEach((sample, i) => expect(sample).toBeCloseTo(transcribed[i], 4))
    // The command flow is unchanged by the dump.
    expect(harness.commands).toEqual(['open youtube'])
  })

  it('with the flag unset, nothing is written — not even the directory', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), audioDump: false })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.dumps).toEqual([])
    expect(harness.commands).toEqual(['open youtube'])
  })

  it('still dumps the utterance when transcription fails — the audio survives for offline A/B', async () => {
    const transcriber = new FakeTranscriber(['x'])
    transcriber.rejectWith = new Error('stt model missing')
    const harness = await createSession({ transcriber, audioDump: true })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.dumps).toHaveLength(1)
    expect(harness.errors).toEqual(['stt model missing'])
  })
  it('with the flag set, a wake dumps the ear\'s last ~2 s as wake-<timestamp>-<sequence>.wav, the firing chunk last (#435)', async () => {
    const detector = new FakeWakeDetector([0.1, 0.1, 0.9])
    const harness = await createSession({ wake: { detector }, audioDump: true })
    harness.session.enableWakeMonitoring()

    for (let i = 0; i < 8; i++) {
      harness.vad.queue.push(0.95)
      await harness.session.pushAudio(new Float32Array(512).fill((i + 1) / 10))
    }

    expect(harness.dumps.map((dump) => dump.path)).toEqual([`/user-data/audio-dumps/wake-${PERF_WALL_ORIGIN}-0001.wav`])
    // Three chunks heard, the third fired: 3 × 1280 samples, ending at 3840 of the 4096 pushed.
    const dumped = pcmFromWav(harness.dumps[0].bytes)
    expect(dumped.length).toBe(3 * 1280)
    expect(dumped.at(-1)).toBeCloseTo(0.8, 3)
  })

  it('with the flag unset, a wake dumps nothing', async () => {
    const detector = new FakeWakeDetector([0.9])
    const harness = await createSession({ wake: { detector }, audioDump: false })
    harness.session.enableWakeMonitoring()

    for (let i = 0; i < 3; i++) {
      harness.vad.queue.push(0.95)
      await harness.session.pushAudio(new Float32Array(512))
    }

    expect(harness.states.at(-1)?.listening).toBe(true)
    expect(harness.dumps).toEqual([])
  })
})

// The ear's Host Trace records (#186, ADR 0031). Host-scoped by the
// boundary rule: a listen runs outside every Run — it is what starts one —
// so nothing here names a turn.

describe('voice session — Hot Listen (#326)', () => {
  async function monitorFrames(harness: SessionHarness, probs: number[]): Promise<void> {
    for (const prob of probs) {
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
  }

  /** A wake opens the Hot Listen; the detector stays quiet after it. */
  async function hotListen(script: string[], overrides?: Parameters<typeof createSession>[0]) {
    const detector = new FakeWakeDetector({ wake: [0.9, 0], abort: [0] })
    const harness = await createSession({ transcriber: new FakeTranscriber(script), wake: { detector }, ...overrides })
    harness.session.enableWakeMonitoring()
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false })
    return { harness, detector }
  }

  const open = { listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false }
  const closed = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }

  it('a wake inside the open listen drops the Utterance in capture, and the hearing with it (#441)', async () => {
    const { harness, detector } = await hotListen(['scroll down'])
    await harness.speakUtterance()
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH])
    expect(harness.session.getState().hearing).toBe(true)
    detector.push('wake', 0.9, 0)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual(open)
  })

  it('submits the next Utterance as the next Command with no wake and no chime', async () => {
    const { harness } = await hotListen(['scroll down', 'go back'])
    await harness.speakUtterance()
    expect(harness.states.at(-1)).toEqual(open)
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['scroll down', 'go back'])
    expect(harness.chimes).toHaveLength(1)
    expect(harness.states.at(-1)).toEqual(open)
  })

  it('a wake heard while it is open changes nothing: no chime, no reset of the listen', async () => {
    const { harness, detector } = await hotListen(['scroll down', 'go back'])
    await harness.speakUtterance()
    const states = harness.states.length
    detector.push('wake', 0.9, 0)
    await monitorFrames(harness, [SILENCE, SILENCE, SILENCE])
    expect(harness.chimes).toHaveLength(1)
    expect(harness.states).toHaveLength(states)
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['scroll down', 'go back'])
  })

  it('closes after hotListenSilenceMs of silence since the last Endpoint, and monitoring resumes', async () => {
    const { harness, detector } = await hotListen(['scroll down', 'go back'], { hotListenSilenceMs: () => 5_000 })
    await harness.speakUtterance()
    harness.clock.advance(4_000)
    expect(harness.states.at(-1)).toEqual(open)
    // A second Utterance restarts the clock at its Endpoint.
    await harness.speakUtterance()
    harness.clock.advance(4_999)
    expect(harness.states.at(-1)).toEqual(open)
    const resets = detector.resets
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
    // The monitor is reset so the next wake is heard.
    expect(detector.resets).toBe(resets + 1)
    expect(harness.commands).toEqual(['scroll down', 'go back'])
  })

  it('restarts its silence clock when the Task ends: the full hotListenSilenceMs after the final page (#328 AC8)', async () => {
    let endTask: () => void = () => {}
    const { harness } = await hotListen(['pull up the latest elon musk tweet'], {
      hotListenSilenceMs: () => 8_000,
      submitResult: () => new Promise<void>((resolve) => (endTask = resolve)),
    })
    await harness.speakUtterance()
    // Five seconds of hops, then the Task ends.
    harness.clock.advance(5_000)
    endTask()
    await flush()
    harness.clock.advance(7_000)
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(1_000)
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('stays open through a Task longer than hotListenSilenceMs: the clock waits for the Task to end (#328 AC8)', async () => {
    let endTask: () => void = () => {}
    const { harness } = await hotListen(['pull up the latest elon musk tweet'], {
      hotListenSilenceMs: () => 8_000,
      submitResult: () => new Promise<void>((resolve) => (endTask = resolve)),
    })
    await harness.speakUtterance()
    harness.clock.advance(12_000)
    expect(harness.states.at(-1)).toEqual(open)
    endTask()
    await flush()
    harness.clock.advance(7_999)
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('defaults to 8 s of silence', async () => {
    const { harness } = await hotListen(['scroll down'])
    await harness.speakUtterance()
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT - 1)
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
    expect(HOT_LISTEN_SILENCE_MS_DEFAULT).toBe(8_000)
  })

  it('disarm closes it at once', async () => {
    const { harness } = await hotListen(['scroll down'])
    await harness.speakUtterance()
    harness.session.disarm()
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('Escape closes it at once, and closes nothing when no Hot Listen is open', async () => {
    const { harness } = await hotListen(['scroll down'])
    await harness.speakUtterance()
    expect(harness.session.closeHotListen()).toBe(true)
    expect(harness.states.at(-1)).toEqual(closed)
    expect(harness.session.closeHotListen()).toBe(false)
  })

  it('the Abort Head closes it at once, idle or not', async () => {
    const { harness, detector } = await hotListen(['scroll down'])
    await harness.speakUtterance()
    detector.push('abort', 0.95, 0)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('lets the Utterance in capture go when disarm closes the Listen mid-speech', async () => {
    const { harness } = await hotListen(['scroll down'])
    await harness.speakUtterance(utteranceProbs().slice(0, 8))
    expect(harness.drops).toEqual([])
    harness.session.disarm()
    expect(harness.drops).toEqual([1])
  })

  it('drops the wake phrase said inside a Hot Listen: it is no Command, and the next Utterance is', async () => {
    const { harness, detector } = await hotListen(['scroll down', 'go back'])
    await harness.speakUtterance()
    // The wake head fires at the end of the phrase, once speech is under way.
    detector.push('wake', 0, 0.9, 0)
    await harness.speakUtterance()
    expect(harness.drops.length).toBeGreaterThan(0)
    expect(harness.commands).toEqual(['scroll down'])
    expect(harness.chimes).toHaveLength(1)
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['scroll down', 'go back'])
  })

  it('a hotkey Listen stays single-shot', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['scroll down']) })
    harness.session.arm()
    await harness.speakUtterance()
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false })
  })

  it('drops an Utterance captured while TTS is in flight: no transcript, no Command, no speech start, and the Listen stays open', async () => {
    const speaking = new FakeSpeaking()
    const { harness } = await hotListen(['scroll down', 'go back'], { speaking })
    speaking.speaking = true
    harness.transcriber.events.length = 0
    await harness.speakUtterance()
    expect(harness.transcriber.events).toEqual([])
    expect(harness.transcriber.audio).toHaveLength(0)
    expect(harness.speechStarts).toEqual([])
    expect(harness.commands).toEqual([])
    expect(harness.states.at(-1)).toEqual(open)
    speaking.finish()
    await flush()
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['scroll down'])
  })

  it('drops an Utterance that TTS starts under, and forwards no partial from it', async () => {
    const speaking = new FakeSpeaking()
    const { harness } = await hotListen(['scroll down'], { speaking })
    const probs = utteranceProbs()
    for (const [i, prob] of probs.entries()) {
      if (i === 3) {
        speaking.speaking = true
        harness.transcriber.emitPartial('scroll')
      }
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
    expect(harness.transcriber.events.at(-1)).toBe('cancel')
    expect(harness.partials.filter((text) => text !== '')).toEqual([])
    expect(harness.commands).toEqual([])
  })

  it('stays open through playback: the silence clock starts when it ends', async () => {
    const speaking = new FakeSpeaking()
    const { harness } = await hotListen(['scroll down'], { speaking })
    await harness.speakUtterance()
    speaking.speaking = true
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT * 2)
    expect(harness.states.at(-1)).toEqual(open)
    speaking.finish()
    await flush()
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT - 1)
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('writes one listen-closed span when its silence closes it, heard: the listen submitted a line (#483)', async () => {
    const { harness } = await hotListen(['scroll down'], { perf: { sttMs: 0 } })
    await harness.speakUtterance()
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT)
    expect(harness.states.at(-1)).toEqual(closed)
    const spans = harness.perf.filter((record) => record.stage === 'listen-closed')
    expect(spans).toHaveLength(1)
    expect(spans[0]!.detail).toEqual({ reason: 'wake', blips: 0, heard: true })
  })

  it('the Abort Head still interrupts a run while TTS plays', async () => {
    const speaking = new FakeSpeaking()
    const runState = { value: 'running' as CommandRunState }
    const { harness, detector } = await hotListen(['scroll down'], { speaking, runState })
    await harness.speakUtterance()
    speaking.speaking = true
    detector.push('abort', 0.95, 0)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.aborts).toHaveLength(1)
    expect(harness.states.at(-1)).toEqual(closed)
  })
})

describe('voice session — speech over the app’s own voice, inside a listen (#490)', () => {
  const READ = 'Let Down, Radiohead. If playback doesn’t begin shortly, try restarting your device.'

  /** A Hot Listen open, the app saying READ. */
  async function overRead<S extends FakeSpeaking = FakeSpeaking>(script: string[], overSpeech: OverSpeech, extra?: Parameters<typeof createSession>[0], given?: S) {
    const detector = new FakeWakeDetector({ wake: [0.9, 0], abort: [0] })
    const speaking = given ?? new FakeSpeaking()
    const harness = await createSession({ transcriber: new FakeTranscriber(script), wake: { detector }, speaking, overSpeech, ...extra })
    harness.session.enableWakeMonitoring()
    for (const prob of [SPEECH, SPEECH, SPEECH]) {
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
    speaking.speaking = true
    speaking.text = READ
    // The wake itself cut whatever was said before (barge-in): only what follows counts.
    harness.tts.stopCalls = 0
    harness.dumps.length = 0
    return { harness, speaking }
  }

  it('duck: the person’s line is taken and the app’s voice ducks at speech start; the session never stops it, the line’s Command does', async () => {
    const { harness } = await overRead(['move on'], 'duck')
    await harness.speakUtterance()
    expect(harness.tts.ducks).toEqual([true])
    expect(harness.tts.stopCalls).toBe(0)
    expect(harness.submitted).toMatchObject([{ text: 'move on', overSpeech: true }])
    expect(harness.speechStarts).toHaveLength(1)
  })

  it('duck: the app’s own words over it are not taken, and its voice comes back up', async () => {
    const { harness } = await overRead(['if playback doesnt begin shortly'], 'duck')
    await harness.speakUtterance()
    expect(harness.commands).toEqual([])
    expect(harness.tts.ducks).toEqual([true, false])
    expect(harness.tts.stopCalls).toBe(0)
    expect(harness.session.getState()).toMatchObject({ listening: true, transcribing: false })
  })

  it('duck: a partial over the app’s voice is never offered early', async () => {
    const { harness } = await overRead(['move on'], 'duck')
    const probs = utteranceProbs()
    for (const [i, prob] of probs.entries()) {
      if (i === 3) harness.transcriber.emitPartial('move')
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
    expect(harness.partials.filter((text) => text !== '')).toEqual([])
    expect(harness.commands).toEqual(['move on'])
  })

  it('duck: a stop word the app itself just said is its echo, not an abort; it fires nothing and the listen stays open', async () => {
    const { harness, speaking } = await overRead(['Cancel'], 'duck', { runState: { value: 'running' } })
    speaking.text = 'To avoid this, cancel and sign in to YouTube on your computer.'
    await harness.speakUtterance()
    expect(harness.aborts).toEqual([])
    expect(harness.submitted).toEqual([])
    expect(harness.tts.ducks).toEqual([true, false])
    expect(harness.session.getState()).toMatchObject({ listening: true })
  })

  it('duck: a short echo of a title the app is reading fires nothing (narrow20: "Nirvana" read as play)', async () => {
    const { harness, speaking } = await overRead(['Nirvana'], 'duck')
    speaking.text = "Classic Rock Songs 70s 80s 90s Full Album Nirvana, Guns N' Roses, AC/DC, Bon Jovi"
    await harness.speakUtterance()
    expect(harness.commands).toEqual([])
    expect(harness.session.getState()).toMatchObject({ listening: true })
  })

  it('duck: a stop word the app did not say is still the person’s abort', async () => {
    const { harness } = await overRead(['stop'], 'duck', { runState: { value: 'running' } })
    await harness.speakUtterance()
    expect(harness.aborts).toHaveLength(1)
  })

  it('stop: the app yields the floor at speech start, and the line is taken', async () => {
    const { harness } = await overRead(['move on'], 'stop')
    await harness.speakUtterance()
    expect(harness.tts.stopCalls).toBe(1)
    expect(harness.tts.ducks).toEqual([])
    expect(harness.commands).toEqual(['move on'])
  })

  it('filter: the person’s line stops the app at its Endpoint; the app’s own words are dropped, the app never stopped', async () => {
    const person = await overRead(['move on'], 'filter')
    await person.harness.speakUtterance()
    expect(person.harness.tts.stopCalls).toBe(1)
    expect(person.harness.submitted).toEqual([expect.not.objectContaining({ overSpeech: true })])
    const own = await overRead(['try restarting your device'], 'filter')
    await own.harness.speakUtterance()
    expect(own.harness.commands).toEqual([])
    expect(own.harness.tts.stopCalls).toBe(0)
  })

  it('a line the app starts under the person’s speech is read too, not let go', async () => {
    const { harness, speaking } = await overRead(['move on'], 'duck')
    speaking.speaking = false
    const probs = utteranceProbs()
    for (const [i, prob] of probs.entries()) {
      if (i === 3) speaking.speaking = true
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
    expect(harness.tts.ducks).toEqual([true])
    expect(harness.commands).toEqual(['move on'])
  })

  it('off: speech over the app’s voice is its own, dropped untranscribed, as before', async () => {
    const { harness } = await overRead(['move on'], 'off')
    await harness.speakUtterance()
    expect(harness.commands).toEqual([])
    expect(harness.transcriber.audio).toHaveLength(0)
  })

  it('dumps what it captured while the app spoke apart from the utterances, taken or not', async () => {
    const own = await overRead(['try restarting your device'], 'duck', { audioDump: true })
    await own.harness.speakUtterance()
    const muted = await overRead(['move on'], 'off', { audioDump: true })
    await muted.harness.speakUtterance()
    expect([...own.harness.dumps, ...muted.harness.dumps].map((dump) => dump.path.split('/').pop()!.split('-')[0])).toEqual(['speaking', 'speaking'])
  })

  it('duck: a stretch of the person’s voice well above the ducked echo is cut out of the echo’s capture and read alone', async () => {
    const { harness } = await overRead(['move on'], 'duck')
    const frame = (level: number): Float32Array => new Float32Array(512).fill(level)
    // The echo at its ducked level keeps the capture open; the person speaks into it, ten times as loud, then the echo goes on.
    const levels = [...Array.from({ length: 40 }, () => 0.02), ...Array.from({ length: 10 }, () => 0.2), ...Array.from({ length: 20 }, () => 0.02)]
    for (const level of levels) {
      harness.vad.queue.push(SPEECH)
      await harness.session.pushAudio(frame(level))
    }
    expect(harness.submitted).toMatchObject([{ text: 'move on', overSpeech: true }])
    // The stretch alone, with a frame ahead of it and a little quiet after: never the forty frames of echo before it.
    expect(harness.transcriber.audio[0]!.length).toBe((OVER_LEVEL_LEAD_FRAMES + 10 + OVER_LEVEL_TAIL_FRAMES) * 512)
    expect(harness.tts.stopCalls).toBe(0)
  })

  it('duck: an echo at an even level is never cut', async () => {
    const { harness } = await overRead(['let down radiohead'], 'duck')
    for (let i = 0; i < 80; i++) {
      harness.vad.queue.push(SPEECH)
      await harness.session.pushAudio(new Float32Array(512).fill(i < 15 ? 0.1 : 0.02))
    }
    expect(harness.transcriber.audio).toHaveLength(0)
    expect(harness.submitted).toEqual([])
  })

  it('records whose it was read to be', async () => {
    const { harness } = await overRead(['if playback doesnt begin shortly'], 'duck', { perf: { sttMs: 0 } })
    await harness.speakUtterance()
    expect(harness.perf.find((record) => record.stage === 'over-speech')?.detail).toEqual({ verdict: 'own', share: 1, mode: 'duck' })
  })

  const CLOCKS = 'Stop the Clocks is a compilation album by Oasis. It was released in November 2006. The album was promoted with a tour. Stop the Clocks reached number one.'

  it('duck: a short line is the app’s own only when its words just sounded: a person’s "stop" over a read that names Stop elsewhere is their abort (the orchestrator’s ruling)', async () => {
    const sounding = new FakeSounding()
    sounding.text = CLOCKS
    const { harness } = await overRead(['Stop.'], 'duck', { runState: { value: 'running' } }, sounding)
    sounding.text = CLOCKS
    sounding.sounded = 'released in November 2006. The album'
    await harness.speakUtterance()
    expect(harness.aborts).toHaveLength(1)
  })

  it('duck: a short echo of words that just sounded fires nothing', async () => {
    const sounding = new FakeSounding()
    const { harness } = await overRead(['Stop the clocks'], 'duck', { runState: { value: 'running' } }, sounding)
    sounding.text = CLOCKS
    sounding.sounded = 'promoted with a tour. Stop the Clocks reached'
    await harness.speakUtterance()
    expect(harness.aborts).toEqual([])
    expect(harness.submitted).toEqual([])
    expect(harness.session.getState()).toMatchObject({ listening: true })
  })

  it('the words that sounded are kept across the capture, one window after another, from before it began', async () => {
    const sounding = new FakeSounding()
    const { harness } = await overRead(['Be hey Jude'], 'duck', { perf: { sttMs: 0 } }, sounding)
    sounding.text = CLOCKS
    sounding.windows = ['played Let It Be', 'It Be Hey', 'Hey Jude, now']
    await harness.speakUtterance()
    expect(harness.commands).toEqual([])
    expect(harness.perf.find((record) => record.stage === 'over-speech')?.detail).toMatchObject({ verdict: 'own' })
  })
})

describe('voice session — a wake that brings no words (#483)', () => {
  async function monitorFrames(harness: SessionHarness, probs: number[]): Promise<void> {
    for (const prob of probs) {
      harness.vad.queue.push(prob)
      await harness.session.pushAudio(new Float32Array(512))
    }
  }

  /** A sound trips the wake word at t=0; the detector stays quiet after it. */
  async function falseWake(script: string[], overrides?: Parameters<typeof createSession>[0]) {
    const detector = new FakeWakeDetector({ wake: [0.9, 0], abort: [0] })
    const harness = await createSession({ transcriber: new FakeTranscriber(script), wake: { detector }, perf: { sttMs: 0 }, ...overrides })
    harness.session.enableWakeMonitoring()
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual(open)
    return { harness, detector }
  }

  const open = { listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: false }
  const closed = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }
  const listenClosed = (harness: SessionHarness) => harness.perf.filter((record) => record.stage === 'listen-closed')

  it('closes after hotListenSilenceMs with nothing said, writes one listen-closed span heard: false, and the monitor hears again', async () => {
    const { harness, detector } = await falseWake([], { hotListenSilenceMs: () => 5_000 })
    harness.clock.advance(4_999)
    expect(harness.states.at(-1)).toEqual(open)
    const resets = detector.resets
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
    expect(detector.resets).toBe(resets + 1)
    expect(harness.commands).toEqual([])
    expect(harness.heard).toEqual([])
    // No words: no wake-to-transcript; the close is its own record.
    expect(harness.perf.filter((record) => record.stage === 'wake-to-transcript')).toEqual([])
    expect(listenClosed(harness)).toHaveLength(1)
    expect(listenClosed(harness)[0]).toMatchObject({ durMs: 5_000, detail: { reason: 'wake', blips: 0, heard: false } })
    // A real wake after it opens the ear again (the detector's quiet score from the first wake is still queued).
    detector.push('wake', 0.9, 0)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toMatchObject({ listening: true, reason: 'wake' })
    expect(harness.chimes).toHaveLength(2)
  })

  it('a blip restarts the bound: it closes hotListenSilenceMs after the blip, never sooner', async () => {
    const { harness } = await falseWake([''], { hotListenSilenceMs: () => 5_000 })
    harness.clock.advance(3_000)
    // The blip's empty transcript restarts the bound.
    await harness.speakUtterance()
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(4_999)
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
    expect(listenClosed(harness)).toHaveLength(1)
    expect(listenClosed(harness)[0]).toMatchObject({ durMs: 8_000, detail: { reason: 'wake', blips: 1, heard: false } })
  })

  it('a blip the endpointer discards restarts the bound too', async () => {
    const { harness } = await falseWake([], { hotListenSilenceMs: () => 5_000 })
    harness.clock.advance(3_000)
    // Four speech frames and silence: an utterance starts, but under minSpeechMs it is dropped before any transcript.
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE)])
    expect(harness.transcriber.audio).toHaveLength(0)
    harness.clock.advance(4_999)
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('speech under way holds the bound: a line that starts before it and ends after it is still heard', async () => {
    const { harness } = await falseWake(['scroll down'], { hotListenSilenceMs: () => 5_000 })
    harness.clock.advance(4_000)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH])
    harness.clock.advance(2_000)
    expect(harness.states.at(-1)).toEqual({ ...open, hearing: true })
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['scroll down'])
    expect(harness.states.at(-1)).toEqual(open)
  })

  it('defaults to the Hot Listen’s 8 s', async () => {
    const { harness } = await falseWake([])
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT - 1)
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(1)
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('a line playing holds the bound: it starts when the line ends', async () => {
    const speaking = new FakeSpeaking()
    const { harness } = await falseWake([], { speaking })
    speaking.speaking = true
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT * 2)
    expect(harness.states.at(-1)).toEqual(open)
    speaking.finish()
    await flush()
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT)
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('a Task still under way holds the bound, and its end starts it (#328)', async () => {
    let endTask: () => void = () => {}
    const { harness, detector } = await falseWake(['pull up the latest tweet'], {
      submitResult: () => new Promise<void>((resolve) => (endTask = resolve)),
    })
    await harness.speakUtterance()
    // Escape closes the Hot Listen while the Task runs; a false wake opens a fresh listen.
    expect(harness.session.closeHotListen()).toBe(true)
    detector.push('wake', 0.9, 0)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual(open)
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT * 2)
    expect(harness.states.at(-1)).toEqual(open)
    endTask()
    await flush()
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT)
    expect(harness.states.at(-1)).toEqual(closed)
  })

  it('a hotkey listen with nothing said is unchanged: no bound closes it', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['']), perf: { sttMs: 0 } })
    harness.session.arm()
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT * 10)
    await harness.speakUtterance()
    harness.clock.advance(HOT_LISTEN_SILENCE_MS_DEFAULT * 10)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false, hearing: false })
    expect(harness.perf.filter((record) => record.stage === 'listen-closed')).toEqual([])
  })
})
