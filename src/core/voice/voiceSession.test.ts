import { describe, expect, it } from 'vitest'
import { FakeClock, FakeTranscriber, FakeVad, FakeWakeDetector, RecordingTts } from '../testing/doubles'
import type { VoiceHeardEvent, VoiceState } from './ipcChannels'
import { createVoiceSession, PAUSE_LISTEN_TIMEOUT_MS } from './voiceSession'
import { mergeFramesFor, vadDefaults, type UtteranceEndpointerConfig } from './vadEndpointing'
import type { CommandRunState } from '../pipeline/runState'
import { createPerfTracer, type PerfSpanRecord } from '../perf/perfTracer'
import { audioDumpEnabled, createUtteranceDumper, type UtteranceDumpWriter } from './utteranceDump'

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
  /** Submit-command calls with their threaded turn id (#27) and cap flag (#61). */
  submitted: { text: string; turnId?: string; truncated: boolean }[]
  /** Span records when perf instrumentation is on (#27). */
  perf: PerfSpanRecord[]
  /** WAV writes when the audio-dump flag is on (#34). */
  dumps: { path: string; bytes: Uint8Array }[]
  aborts: number[]
  pauses: number[]
  resumes: (string | undefined)[]
  chimes: number[]
  /** Resolves a parked STT window when the harness runs with deferStt. */
  settleStt(text: string): void
  speakUtterance(probs?: number[]): Promise<void>
  session: ReturnType<typeof createVoiceSession>
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
}): Promise<SessionHarness> {
  const vad = overrides?.vad ?? new FakeVad()
  const baseTranscriber = overrides?.transcriber ?? new FakeTranscriber()
  const clock = new FakeClock()
  const tts = new RecordingTts()
  const states: VoiceState[] = []
  const heard: VoiceHeardEvent[] = []
  const errors: string[] = []
  const commands: string[] = []
  const submitted: { text: string; turnId?: string; truncated: boolean }[] = []
  const perf: PerfSpanRecord[] = []
  const dumps: { path: string; bytes: Uint8Array }[] = []
  const aborts: number[] = []
  const pauses: number[] = []
  const resumes: (string | undefined)[] = []
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
        begin: () => baseTranscriber.begin(),
        push: (frame: Float32Array) => baseTranscriber.push(frame),
        onPartial: (listener: (text: string) => void) => baseTranscriber.onPartial(listener),
        cancel: () => baseTranscriber.cancel(),
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
    getEndpointerConfig: overrides?.getEndpointerConfig,
    tracer,
    dumper,
    wake: overrides?.wake
      ? {
          detector: overrides.wake.detector,
          getThreshold: () => threshold,
          chime: () => chimes.push(1),
        }
      : undefined,
    onSubmitCommand: (text, turnId, truncated) => {
      commands.push(text)
      submitted.push({ text, turnId, truncated: truncated ?? false })
    },
    getRunState: () => overrides?.runState?.value ?? 'idle',
    onAbort: () => aborts.push(1),
    onPause: () => {
      pauses.push(1)
      if (overrides?.runState) overrides.runState.value = 'paused'
    },
    onResume: (steering) => {
      resumes.push(steering)
      if (overrides?.runState) overrides.runState.value = 'running'
    },
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

  return { vad, transcriber: baseTranscriber, clock, tts, states, heard, errors, commands, submitted, perf, dumps, aborts, pauses, resumes, chimes, settleStt, speakUtterance, session }
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

  it('the Pause Listen silently auto-resumes the run after five seconds of mic silence (ADR 0024)', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({
      transcriber: new FakeTranscriber(['hold on', 'use Paris instead']),
      runState,
    })
    harness.session.arm()

    expect(harness.pauses).toEqual([1])
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'pause', monitoring: false, transcribing: false })

    // A spoken "hold on" keeps it paused; the silence clock runs from the
    // last speech, and the transcript's STT window is not mic silence.
    await harness.speakUtterance()
    expect(harness.heard).toEqual([{ text: 'hold on', routed: 'pause' }])
    expect(harness.session.getState().reason).toBe('pause')

    harness.clock.advance(PAUSE_LISTEN_TIMEOUT_MS - 1)
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'pause', monitoring: false, transcribing: false })
    harness.clock.advance(1)

    // Silent resume: the run continues, the ear closes, nothing was "heard".
    expect(harness.resumes).toEqual([undefined])
    expect(harness.heard).toEqual([{ text: 'hold on', routed: 'pause' }])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })

    // And the steering utterance never lands — the run is already going.
    await harness.speakUtterance()
    expect(harness.resumes).toEqual([undefined])
    expect(harness.commands).toEqual([])
  })

  it('speech re-arms the Pause Listen silence clock — a user speaking at 4.9 s keeps it open (ADR 0024)', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ runState })
    harness.session.arm()
    expect(harness.pauses).toEqual([1])

    harness.clock.advance(PAUSE_LISTEN_TIMEOUT_MS - 100)
    // Two speech frames: enough to re-arm the clock, under the 3-frame
    // utterance-start confirm — no capture, no transcript.
    for (let i = 0; i < 2; i++) {
      harness.vad.queue.push(SPEECH)
      await harness.session.pushAudio(new Float32Array(512))
    }

    // Past the original deadline: still paused, still listening.
    harness.clock.advance(200)
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'pause', monitoring: false, transcribing: false })
    expect(harness.resumes).toEqual([])

    // Five seconds after the last speech frame, silence wins.
    harness.clock.advance(PAUSE_LISTEN_TIMEOUT_MS)
    expect(harness.resumes).toEqual([undefined])
    expect(harness.session.getState()).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
  })

  it('the Pause Listen timeout only closes the ear when the run resumed by other means', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ runState })
    harness.session.arm()
    expect(harness.pauses).toEqual([1])

    // The typed Steering path resumed the run out from under the listen.
    runState.value = 'running'
    harness.clock.advance(PAUSE_LISTEN_TIMEOUT_MS)

    expect(harness.resumes).toEqual([])
    expect(harness.session.getState()).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
  })

  it('the silence timeout waits out a slow STT window — the spoken Directive is not dropped (ADR 0024)', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ runState, deferStt: true })
    harness.session.arm()
    expect(harness.pauses).toEqual([1])

    // The directive endpoints; its transcript parks in the STT window. The
    // audio chain serializes frame-by-frame, so drain until it parks.
    const spoke = harness.speakUtterance()
    for (let i = 0; i < 1_000 && !harness.session.getState().transcribing; i++) await Promise.resolve()
    expect(harness.session.getState()).toEqual({ listening: false, reason: 'pause', monitoring: false, transcribing: true })

    // STT slower than the whole silence budget: still parked, not resumed —
    // the STT window is not mic silence.
    harness.clock.advance(2 * PAUSE_LISTEN_TIMEOUT_MS)
    expect(harness.resumes).toEqual([])
    expect(harness.session.getState().reason).toBe('pause')

    harness.settleStt('use Paris instead')
    await spoke
    expect(harness.resumes).toEqual(['use Paris instead'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
  })

  it('recovers when the run is aborted externally during pause listening', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({
      transcriber: new FakeTranscriber(['open youtube']),
      runState,
    })

    expect(harness.session.interrupt('pause')).toBe(true)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: false, transcribing: false })

    // Abort came from the UI/Escape, not the voice session: the pipeline
    // goes idle and emits its terminal events, but nobody told the session.
    runState.value = 'idle'
    harness.session.handlePipelineEvent({ type: 'status', turnId: 'turn-fixture', status: 'cancelled', at: 0 })
    harness.session.handlePipelineEvent({ type: 'done', turnId: 'turn-fixture', outcome: 'cancelled', at: 0 })
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })

    // The next activation behaves normally instead of routing to ignored.
    harness.session.arm()
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
  })

  it('exposes active-only handlers for future dedicated abort and pause wake heads', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ runState })

    expect(harness.session.interrupt('pause')).toBe(true)
    expect(harness.pauses).toEqual([1])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: false, transcribing: false })

    runState.value = 'running'
    expect(harness.session.interrupt('abort')).toBe(true)
    expect(harness.aborts).toEqual([1])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })

    runState.value = 'idle'
    expect(harness.session.interrupt('abort')).toBe(false)
    expect(harness.session.interrupt('pause')).toBe(false)
  })

  it('submits a spoken command through the same callback the text box uses, then disarms', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states).toEqual([
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true },
      { listening: false, reason: null, monitoring: false, transcribing: false },
    ])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    // The utterance audio handed to STT is the endpointed utterance: the
    // 3-frame ring the trigger fired on (incl. the first speech frames) + 8
    // speech + the endpoint/merge silence (~900 ms + ~1.5 s, #60),
    // tail-trimmed by 2.
    expect(harness.transcriber.audio[0].length).toBe((8 + SUBMIT_SILENCE - 2) * 512)
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

    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: undefined, truncated: false }])
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
    expect(harness.transcriber.audio[0].length).toBe((8 + 25 - 2) * 512)

    endFrames = 5 // Slider moved to the snappy end; no restart, no rebuild.
    harness.session.arm()
    await harness.speakUtterance()
    // The second utterance ends after just 5 silence frames — the new value.
    expect(harness.transcriber.audio[1].length).toBe((8 + 5 - 2) * 512)
    expect(harness.commands).toEqual(['first', 'second'])
  })

  it('applies a changed endpoint delay inside a listen that stays open (#37)', async () => {
    let endFrames = 25
    const runState = { value: 'paused' as CommandRunState }
    const harness = await createSession({
      transcriber: new FakeTranscriber(['hold on', 'use paris']),
      getEndpointerConfig: () => ({ endFrames, resumptionMergeMs: 0 }),
      runState,
    })

    // A Pause Listen survives a "hold on" — the slider must still reach the
    // very next utterance, not just the next listen start.
    harness.session.arm()
    await flush()
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: 25 }, () => SILENCE)])
    expect(harness.resumes).toEqual([]) // 'hold on' keeps the run paused — listen open

    endFrames = 5
    await harness.speakUtterance()
    expect(harness.transcriber.audio[1].length).toBe((8 + 5 - 2) * 512)
    expect(harness.resumes).toEqual(['use paris'])
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
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true },
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false },
    ])
    expect(harness.heard).toEqual([])
  })

  it('stops TTS when the hotkey arms (barge-in stand-in until the wake word)', async () => {
    const harness = await createSession()

    harness.session.arm()

    expect(harness.tts.stopCalls).toBe(1)
    expect(harness.states).toEqual([{ listening: true, reason: 'hotkey', monitoring: false, transcribing: false }])
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
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
  })

  it('surfaces a failed VAD as an error and disarms', async () => {
    const vad = new FakeVad()
    vad.failWith = new Error('silero model missing')
    const harness = await createSession({ vad })

    harness.session.arm()
    await harness.session.pushAudio(new Float32Array(512))

    expect(harness.errors).toEqual(['silero model missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
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

describe('voice session — resumption merge (#60)', () => {
  /** Push one 512-sample frame with the given VAD prob. */
  async function frame(harness: SessionHarness, prob: number): Promise<void> {
    harness.vad.queue.push(prob)
    await harness.session.pushAudio(new Float32Array(512))
  }

  it('rejoins a sub-window pause into one command containing both halves', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube and then play it']) })

    harness.session.arm()
    // Half A, endpoint-firing silence (~900 ms), half B inside the ~1.5 s
    // window, then silence long enough to submit.
    await harness.speakUtterance([
      ...Array.from({ length: 8 }, () => SPEECH),
      ...Array.from({ length: DEFAULTS.endFrames }, () => SILENCE),
      ...Array.from({ length: 6 }, () => SPEECH),
      ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE),
    ])

    expect(harness.commands).toEqual(['open youtube and then play it'])
    expect(harness.heard).toEqual([{ text: 'open youtube and then play it', routed: 'command' }])
    // One utterance of STT audio: half A + the pause + half B, tail-trimmed.
    expect(harness.transcriber.audio).toHaveLength(1)
    expect(harness.transcriber.audio[0].length).toBe((8 + DEFAULTS.endFrames + 6 + SUBMIT_SILENCE - 2) * 512)
  })

  it('keeps the ear open through the pause — the STT window starts only when the utterance submits', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    // Half A plus endpoint-firing silence: the merge window is open, the ear
    // is still listening, nothing is transcribing.
    for (const prob of [...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: DEFAULTS.endFrames }, () => SILENCE)]) {
      await frame(harness, prob)
    }
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false })

    // Half B rejoins; the command submits when the window closes in silence.
    await harness.speakUtterance([...Array.from({ length: 6 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE)])
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.filter((state) => state.transcribing)).toHaveLength(1)
  })

  it('submits silence-ended speech only when the window closes — never sooner', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE - 1 }, () => SILENCE)])
    // The endpoint fired, but the merge window is still open: no submission.
    expect(harness.commands).toEqual([])
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false })

    await frame(harness, SILENCE) // the window closes in silence
    await flush()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
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
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false })

    await frame(harness, SILENCE)
    expect(harness.commands).toEqual(['first', 'second'])
  })

  it('disarm during the open window drops the held utterance', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    // Speech, then silence into the open merge window (short of submitting).
    await harness.speakUtterance([...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: DEFAULTS.endFrames + 10 }, () => SILENCE)])
    expect(harness.commands).toEqual([])
    harness.session.disarm()

    // The rest of the window's silence arrives late and is dropped.
    await harness.speakUtterance(Array.from({ length: SUBMIT_SILENCE + 5 }, () => SILENCE))

    expect(harness.commands).toEqual([])
    expect(harness.transcriber.audio).toEqual([])
    expect(harness.transcriber.events.at(-1)).toBe('cancel')
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
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

    expect(harness.states).toEqual([{ listening: false, reason: null, monitoring: true, transcribing: false }])
    expect(detector.chunks.length).toBeGreaterThan(0)
    expect(harness.transcriber.audio).toHaveLength(0)
  })

  it('wake detection chimes, barges in on speech, and listens — one utterance, then back to monitoring', async () => {
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
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false })

    // The utterance submits like a hotkey command, then monitoring resumes.
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false })
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
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false })
    expect(harness.commands).toEqual([])
    expect(harness.errors).toEqual([])

    // Utterance 2 — the real command: submitted through the text-box surface.
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
  })

  it('keeps monitoring after a wake so the next wake word lands', async () => {
    const detector = new FakeWakeDetector([0.9, 0.9])
    const harness = await createSession({
      transcriber: new FakeTranscriber(['first', 'second']),
      wake: { detector },
    })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['first'])

    // Monitoring resumed: the detector fires again on new audio.
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false })
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
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })

    // Inert from here: later audio is dropped, not retried against the model.
    detector.push('wake', 0.9)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
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
    expect(harness.states).toContainEqual({ listening: true, reason: 'hotkey', monitoring: true, transcribing: false })

    // Toggling the hotkey off stops listening; the wake ear stays on.
    harness.session.arm()
    harness.session.disarm()
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false })

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
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false })
  })

  it('the abort head is a no-op while idle', async () => {
    const detector = new FakeWakeDetector({ abort: [0.95, 0.95] })
    const harness = await createSession({ wake: { detector } })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.aborts).toHaveLength(0)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false })
  })

  it('the hold on head is unwired — a hot score never pauses or opens a listen (ADR 0024)', async () => {
    const runState = { value: 'running' as CommandRunState }
    const detector = new FakeWakeDetector({ holdOn: [0.95, 0.95] })
    const harness = await createSession({ wake: { detector }, runState })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.pauses).toHaveLength(0)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false })
  })

  it('the wake word during a running run pauses it and opens the Pause Listen (ADR 0024)', async () => {
    const runState = { value: 'running' as CommandRunState }
    const detector = new FakeWakeDetector([0.95])
    const harness = await createSession({
      transcriber: new FakeTranscriber(['use Paris instead']),
      wake: { detector },
      runState,
    })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])

    expect(harness.pauses).toHaveLength(1)
    // Barge-in plus the activation cue: speech dies, then the chime confirms.
    expect(harness.tts.stopCalls).toBe(1)
    expect(harness.chimes).toHaveLength(1)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: true, transcribing: false })

    // The pause listen takes the mic: the steering utterance resumes the run.
    await harness.speakUtterance()
    expect(harness.resumes).toEqual(['use Paris instead'])
    expect(harness.heard).toEqual([{ text: 'use Paris instead', routed: 'steering' }])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true, transcribing: false })
  })

  it('the hotkey during a running run pauses it — same seam, no chime (ADR 0024)', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ runState })

    harness.session.arm()

    expect(harness.pauses).toEqual([1])
    expect(harness.chimes).toHaveLength(0)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: false, transcribing: false })
  })

  it('the wake word while paused (no listen open) opens a wake listen and steers without resuming first', async () => {
    const runState = { value: 'paused' as CommandRunState }
    const detector = new FakeWakeDetector([0.95])
    const harness = await createSession({
      transcriber: new FakeTranscriber(['use Paris instead']),
      wake: { detector },
      runState,
    })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])

    expect(harness.pauses).toHaveLength(0)
    expect(harness.chimes).toHaveLength(1)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true, transcribing: false })

    await harness.speakUtterance()
    expect(harness.resumes).toEqual(['use Paris instead'])
    expect(harness.heard).toEqual([{ text: 'use Paris instead', routed: 'steering' }])
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
    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: stt!.turnId, truncated: false }])
    // Instrumentation changes no pipeline behavior.
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
  })

  it('carries utterance speech ms, total ms, and truncated flag in the stt detail', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['go']), perf: {} })

    harness.session.arm()
    await harness.speakUtterance() // 8 speech frames; 8 + 75 − 2 frames handed to STT (#60 defaults)

    const stt = harness.perf.find((record) => record.stage === 'stt')
    expect(stt!.detail).toEqual({ speechMs: 8 * 32, totalMs: (8 + SUBMIT_SILENCE - 2) * 32, truncated: false })
  })

  it('still logs the stt span with the error when transcription fails', async () => {
    const transcriber = new FakeTranscriber(['x'])
    transcriber.rejectWith = new Error('stt model missing')
    const harness = await createSession({ transcriber, perf: {} })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.map((record) => record.stage)).toEqual(['stt'])
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
    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: expect.any(String), truncated: false }])
  })

  it('never fails an utterance over perf bookkeeping — a throwing sink is swallowed', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), perf: { throwing: true } })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: expect.any(String), truncated: false }])
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
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true },
    ])
    expect(harness.session.getState()).toEqual({
      listening: false,
      reason: 'hotkey',
      monitoring: false,
      transcribing: true,
    })

    transcriber.resolve('open youtube')
    await stt
    await flush()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
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

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })

    transcriber.resolve('open youtube')
    await stt
    await flush()

    expect(harness.commands).toEqual([])
    expect(harness.heard).toEqual([])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
  })

  it('a hotkey press during the STT window is a no-op — the transcript in flight decides the listen', async () => {
    const transcriber = new DeferredTranscriber()
    const harness = await createSession({ transcriber })

    harness.session.arm()
    const { stt } = await endpointUtterance(harness)
    harness.session.arm()

    // No third state: the listen in flight still owns the mic.
    expect(harness.states).toHaveLength(2)

    transcriber.resolve('open youtube')
    await stt
    await flush()

    expect(harness.commands).toEqual(['open youtube'])
  })

  it('a spoken "hold on" into the Pause Listen keeps the run paused (ADR 0024)', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({
      transcriber: new FakeTranscriber(['hold on']),
      runState,
    })

    // The hotkey pauses the run up front; the ear is the Pause Listen.
    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.pauses).toEqual([1])
    expect(harness.heard).toEqual([{ text: 'hold on', routed: 'pause' }])
    expect(harness.states).toEqual([
      { listening: true, reason: 'pause', monitoring: false, transcribing: false },
      { listening: false, reason: 'pause', monitoring: false, transcribing: true },
      { listening: true, reason: 'pause', monitoring: false, transcribing: false },
    ])
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
    expect(harness.transcriber.audio[0]).toHaveLength((8 + SUBMIT_SILENCE - 2) * 512) // pre-roll + speech + tail, padding trimmed
    expect(harness.commands).toEqual(['open youtube'])
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
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'hotkey', monitoring: false, transcribing: false })
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

  it('cancels the in-flight capture when a run starts mid-utterance and the pause interrupt takes the mic', async () => {
    const runState = { value: 'idle' as CommandRunState }
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), runState })

    harness.session.arm()
    for (let i = 0; i < 5; i++) {
      harness.vad.queue.push(SPEECH)
      await harness.session.pushAudio(new Float32Array(512))
    }
    // A typed command started the run while the user was mid-utterance; the
    // pause interrupt (ADR 0024 activation seam) reopens the ear for the
    // Pause Listen.
    runState.value = 'running'
    harness.session.interrupt('pause')

    expect(harness.transcriber.events).toEqual(['begin', 'push', 'push', 'push', 'cancel'])
    expect(harness.transcriber.audio).toEqual([])
    // The pause listen is live: the next utterance begins a fresh capture.
    expect(harness.session.getState()).toEqual({ listening: true, reason: 'pause', monitoring: false, transcribing: false })
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
      { listening: true, reason: 'hotkey', monitoring: false, transcribing: false },
      { listening: false, reason: 'hotkey', monitoring: false, transcribing: true },
      { listening: false, reason: null, monitoring: false, transcribing: false },
    ])
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
})

// The ear's Host Trace records (#186, ADR 0031). Host-scoped by the
// boundary rule: a listen runs outside every Run — it is what starts one —
// so nothing here names a turn.
