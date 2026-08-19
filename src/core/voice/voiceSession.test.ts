import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { FakeClock, FakeTranscriber, FakeVad, FakeWakeDetector, RecordingTts } from '../testing/doubles'
import type { VoiceHeardEvent, VoiceState } from './ipcChannels'
import { createVoiceSession } from './voiceSession'
import type { CommandRunState } from '../pipeline/createCommandPipeline'
import { createPerfTracer, type PerfSpanRecord } from '../perf/perfTracer'
import { audioDumpEnabled, createUtteranceDumper, type UtteranceDumpWriter } from './utteranceDump'

// The voice session is T9's coordinator: mic audio in (through the VadScorer
// and utterance endpointing), transcripts out to the same command pipeline as
// the text box, and confirmation prompts get their 12 s spoken yes/no window.
// Everything here runs on fakes; the main-process adapters only supply VAD
// probabilities and transcripts.

const SPEECH = 0.95
const SILENCE = 0.01
/** Fake wall-clock base for the perf tracer's stamps (deterministic ids). */
const PERF_WALL_ORIGIN = 1_700_000_000_000

/** One utterance of VAD probabilities: 8 speech frames + 30 trailing silence. */
function utteranceProbs(speechFrames = 8): number[] {
  return [...Array.from({ length: speechFrames }, () => SPEECH), ...Array.from({ length: 30 }, () => SILENCE)]
}

class DeferredIdle {
  private waiting: (() => void)[] = []
  busy = false

  waitIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve()
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  becomeIdle(): void {
    this.busy = false
    for (const resolve of this.waiting.splice(0)) resolve()
  }
}

interface SessionHarness {
  vad: FakeVad
  transcriber: FakeTranscriber
  clock: FakeClock
  tts: RecordingTts
  idle: DeferredIdle
  states: VoiceState[]
  heard: VoiceHeardEvent[]
  errors: string[]
  commands: string[]
  /** Submit-command calls with their threaded turn id (#27). */
  submitted: { text: string; turnId?: string }[]
  /** Span records when perf instrumentation is on (#27). */
  perf: PerfSpanRecord[]
  /** WAV writes when the audio-dump flag is on (#34). */
  dumps: { path: string; bytes: Uint8Array }[]
  resolutions: { confirmationId: string; approved: boolean }[]
  askResolutions: { askId: string; answer: string }[]
  aborts: number[]
  pauses: number[]
  resumes: (string | undefined)[]
  chimes: number[]
  speakUtterance(probs?: number[]): Promise<void>
  session: ReturnType<typeof createVoiceSession>
}

async function flush(microtasks = 5): Promise<void> {
  for (let i = 0; i < microtasks; i++) await Promise.resolve()
}

async function createSession(overrides?: {
  transcriber?: FakeTranscriber
  vad?: FakeVad
  confirmWindowMs?: number
  wake?: { detector: FakeWakeDetector; threshold?: number }
  runState?: { value: CommandRunState }
  /** Turns on perf instrumentation; sttMs is the scripted STT duration. */
  perf?: { sttMs?: number; throwing?: boolean }
  /** Sets BINGBONG_AUDIO_DUMP for the session's dumper (#34). */
  audioDump?: boolean
}): Promise<SessionHarness> {
  const vad = overrides?.vad ?? new FakeVad()
  const baseTranscriber = overrides?.transcriber ?? new FakeTranscriber()
  const clock = new FakeClock()
  const tts = new RecordingTts()
  const idle = new DeferredIdle()
  const states: VoiceState[] = []
  const heard: VoiceHeardEvent[] = []
  const errors: string[] = []
  const commands: string[] = []
  const submitted: { text: string; turnId?: string }[] = []
  const perf: PerfSpanRecord[] = []
  const dumps: { path: string; bytes: Uint8Array }[] = []
  const resolutions: { confirmationId: string; approved: boolean }[] = []
  const askResolutions: { askId: string; answer: string }[] = []
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
  // Scripted STT latency: transcription advances the fake clock.
  const transcriber = overrides?.perf
    ? {
        transcribe: async (pcm: Float32Array) => {
          clock.advance(overrides.perf?.sttMs ?? 1_500)
          return baseTranscriber.transcribe(pcm)
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
    ttsIdle: idle,
    confirmWindowMs: overrides?.confirmWindowMs,
    tracer,
    dumper,
    wake: overrides?.wake
      ? {
          detector: overrides.wake.detector,
          getThreshold: () => threshold,
          chime: () => chimes.push(1),
        }
      : undefined,
    onSubmitCommand: (text, turnId) => {
      commands.push(text)
      submitted.push({ text, turnId })
    },
    onResolveConfirmation: (confirmationId, approved) => resolutions.push({ confirmationId, approved }),
    onResolveAsk: (askId, answer) => askResolutions.push({ askId, answer }),
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

  return { vad, transcriber: baseTranscriber, clock, tts, idle, states, heard, errors, commands, submitted, perf, dumps, resolutions, askResolutions, aborts, pauses, resumes, chimes, speakUtterance, session }
}

function confirmationRequested(id = 'confirm-1'): PipelineEvent {
  return {
    type: 'confirmation_requested',
    turnId: 'turn-fixture',
    confirmationId: id,
    callId: 'c1',
    toolName: 'click',
    prompt: 'Run click?',
    expiresAt: 60_000,
    at: 0,
  }
}

function askRequested(id = 'ask-1'): PipelineEvent {
  return {
    type: 'ask_requested',
    turnId: 'turn-fixture',
    askId: id,
    callId: 'c1',
    question: 'Which city do you mean?',
    expiresAt: 45_000,
    at: 0,
  }
}

describe('voice session', () => {
  it.each(['stop', 'abort', 'cancel', 'never mind'])('routes active "%s" to abort before confirmation handling', async (phrase) => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ transcriber: new FakeTranscriber([phrase]), runState })
    harness.session.handlePipelineEvent(confirmationRequested())
    await flush()

    await harness.speakUtterance()

    expect(harness.aborts).toEqual([1])
    expect(harness.resolutions).toEqual([])
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

  it('keeps listening after pause with no timeout, then resumes with spoken steering', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({
      transcriber: new FakeTranscriber(['hold on', 'use Paris instead']),
      runState,
    })
    harness.session.arm()

    await harness.speakUtterance()
    expect(harness.pauses).toEqual([1])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: false })

    harness.clock.advance(24 * 60 * 60 * 1000)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: false })

    await harness.speakUtterance()
    expect(harness.resumes).toEqual(['use Paris instead'])
    expect(harness.heard).toEqual([
      { text: 'hold on', routed: 'pause' },
      { text: 'use Paris instead', routed: 'steering' },
    ])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
  })

  it('recovers when the run is aborted externally during pause listening', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({
      transcriber: new FakeTranscriber(['open youtube']),
      runState,
    })

    expect(harness.session.interrupt('pause')).toBe(true)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: false })

    // Abort came from the UI/Escape, not the voice session: the pipeline
    // goes idle and emits its terminal events, but nobody told the session.
    runState.value = 'idle'
    harness.session.handlePipelineEvent({ type: 'status', turnId: 'turn-fixture', status: 'cancelled', at: 0 })
    harness.session.handlePipelineEvent({ type: 'done', turnId: 'turn-fixture', outcome: 'cancelled', at: 0 })
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })

    // The next activation behaves normally instead of routing to ignored.
    harness.session.arm()
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
  })

  it('exposes active-only handlers for future dedicated abort and pause wake heads', async () => {
    const runState = { value: 'running' as CommandRunState }
    const harness = await createSession({ runState })

    expect(harness.session.interrupt('pause')).toBe(true)
    expect(harness.pauses).toEqual([1])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: false })

    runState.value = 'running'
    expect(harness.session.interrupt('abort')).toBe(true)
    expect(harness.aborts).toEqual([1])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })

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
      { listening: true, reason: 'hotkey', monitoring: false },
      { listening: false, reason: null, monitoring: false },
    ])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    // The utterance audio handed to STT is the endpointed utterance: the
    // 3-frame ring the trigger fired on (incl. the first speech frames) + 8
    // speech + 25 silence frames, tail-trimmed by 2 → 31 frames total.
    expect(harness.transcriber.audio[0].length).toBe(31 * 512)
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
    expect(harness.states).toEqual([{ listening: true, reason: 'hotkey', monitoring: false }])
    expect(harness.heard).toEqual([])
  })

  it('stops TTS when the hotkey arms (barge-in stand-in until the wake word)', async () => {
    const harness = await createSession()

    harness.session.arm()

    expect(harness.tts.stopCalls).toBe(1)
    expect(harness.states).toEqual([{ listening: true, reason: 'hotkey', monitoring: false }])
  })

  it('drops audio entirely while not listening', async () => {
    const harness = await createSession()

    await harness.speakUtterance()

    expect(harness.vad.frames).toHaveLength(0)
    expect(harness.transcriber.audio).toHaveLength(0)
  })

  it('auto-arms for a confirmation once the spoken prompt finishes', async () => {
    const harness = await createSession()

    harness.idle.busy = true
    harness.session.handlePipelineEvent(confirmationRequested())
    await flush()
    // The prompt is still speaking — not listening yet.
    expect(harness.states).toEqual([])

    harness.idle.becomeIdle()
    await flush()

    expect(harness.states).toEqual([{ listening: true, reason: 'confirmation', monitoring: false }])
  })

  it('answers a confirmation with a spoken yes and disarms', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['um, yeah sure']) })

    harness.session.handlePipelineEvent(confirmationRequested('confirm-7'))
    await flush()
    await harness.speakUtterance()

    expect(harness.resolutions).toEqual([{ confirmationId: 'confirm-7', approved: true }])
    expect(harness.heard).toEqual([{ text: 'um, yeah sure', routed: 'confirmation' }])
    expect(harness.commands).toEqual([])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
  })

  it('answers a confirmation with a spoken no', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['nope']) })

    harness.session.handlePipelineEvent(confirmationRequested('confirm-2'))
    await flush()
    await harness.speakUtterance()

    expect(harness.resolutions).toEqual([{ confirmationId: 'confirm-2', approved: false }])
  })

  it('keeps the window open through undecided answers, without submitting them as commands', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['maybe', 'yes']) })

    harness.session.handlePipelineEvent(confirmationRequested('confirm-3'))
    await flush()
    await harness.speakUtterance()

    expect(harness.resolutions).toEqual([])
    expect(harness.commands).toEqual([])
    expect(harness.heard).toEqual([{ text: 'maybe', routed: 'ignored' }])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'confirmation', monitoring: false })

    await harness.speakUtterance()
    expect(harness.resolutions).toEqual([{ confirmationId: 'confirm-3', approved: true }])
  })

  it('closes the window after 12 s without resolving — tap buttons and the 60 s auto-deny stay in charge', async () => {
    const harness = await createSession()

    harness.session.handlePipelineEvent(confirmationRequested())
    await flush()

    harness.clock.advance(12_000)

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
    expect(harness.resolutions).toEqual([])
  })

  it('disarms when the confirmation is resolved by tap mid-window', async () => {
    const harness = await createSession()

    harness.session.handlePipelineEvent(confirmationRequested('confirm-4'))
    await flush()
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'confirmation', monitoring: false })

    harness.session.handlePipelineEvent({
      type: 'confirmation_resolved',
      turnId: 'turn-fixture',
      confirmationId: 'confirm-4',
      approved: true,
      reason: 'user',
      at: 1_000,
    })

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
    // The 12 s window timer is gone too — no late disarm state event.
    harness.clock.advance(12_000)
    expect(harness.states).toHaveLength(2)
  })

  it('never arms a window for a confirmation already resolved while the prompt was still speaking', async () => {
    const harness = await createSession()

    harness.idle.busy = true
    harness.session.handlePipelineEvent(confirmationRequested('confirm-5'))
    harness.session.handlePipelineEvent({
      type: 'confirmation_resolved',
      turnId: 'turn-fixture',
      confirmationId: 'confirm-5',
      approved: false,
      reason: 'user',
      at: 500,
    })
    harness.idle.becomeIdle()
    await flush()

    expect(harness.states).toEqual([])
  })

  it('surfaces a failed transcriber as an error and disarms', async () => {
    const transcriber = new FakeTranscriber(['x'])
    transcriber.rejectWith = new Error('whisper model missing')
    const harness = await createSession({ transcriber })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.errors).toEqual(['whisper model missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
  })

  it('surfaces a failed VAD as an error and disarms', async () => {
    const vad = new FakeVad()
    vad.failWith = new Error('silero model missing')
    const harness = await createSession({ vad })

    harness.session.arm()
    await harness.session.pushAudio(new Float32Array(512))

    expect(harness.errors).toEqual(['silero model missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
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

  it('hotkey arm during an open confirmation window keeps serving that confirmation', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['yeah']) })

    harness.session.handlePipelineEvent(confirmationRequested('confirm-9'))
    await flush()
    // User presses the hotkey while the window is open.
    harness.session.arm()
    await harness.speakUtterance()

    // Still routed to the open confirmation, not submitted as a command.
    expect(harness.resolutions).toEqual([{ confirmationId: 'confirm-9', approved: true }])
    expect(harness.commands).toEqual([])
  })
})

describe('voice session — ask_user window (issue #18)', () => {
  it('opens a free-text listen window once the spoken question finishes', async () => {
    const harness = await createSession()

    harness.idle.busy = true
    harness.session.handlePipelineEvent(askRequested('ask-1'))
    await flush()
    // Still speaking — the window has not opened yet.
    expect(harness.states).toEqual([])

    harness.idle.becomeIdle()
    await flush()

    expect(harness.states).toEqual([{ listening: true, reason: 'ask', monitoring: false }])
  })

  it('returns the spoken transcript as the free-text answer', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['the one in Paris, France']) })

    harness.session.handlePipelineEvent(askRequested('ask-4'))
    await flush()
    await harness.speakUtterance()

    expect(harness.askResolutions).toEqual([{ askId: 'ask-4', answer: 'the one in Paris, France' }])
    expect(harness.heard).toEqual([{ text: 'the one in Paris, France', routed: 'ask' }])
    expect(harness.commands).toEqual([])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
  })

  it('keeps the window open when speech transcribes to nothing', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['']) })

    harness.session.handlePipelineEvent(askRequested('ask-2'))
    await flush()
    await harness.speakUtterance()

    expect(harness.askResolutions).toEqual([])
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'ask', monitoring: false })
  })

  it('closes the window after 45 s without resolving — typed answers stay possible', async () => {
    const harness = await createSession()

    harness.session.handlePipelineEvent(askRequested('ask-3'))
    await flush()

    harness.clock.advance(45_000)

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
    expect(harness.askResolutions).toEqual([])
  })

  it('stops listening when the ask is answered by typing', async () => {
    const harness = await createSession()

    harness.session.handlePipelineEvent(askRequested('ask-5'))
    await flush()
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'ask', monitoring: false })

    harness.session.handlePipelineEvent({
      type: 'ask_resolved',
      turnId: 'turn-fixture',
      askId: 'ask-5',
      answer: 'typed answer',
      reason: 'user',
      at: 900,
    })

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
    // The window timer is gone too — no late disarm state event.
    harness.clock.advance(45_000)
    expect(harness.states).toHaveLength(2)
  })

  it('serves a hotkey-armed mic to the open ask, not as a command', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['paris']) })

    harness.session.handlePipelineEvent(askRequested('ask-6'))
    await flush()
    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.askResolutions).toEqual([{ askId: 'ask-6', answer: 'paris' }])
    expect(harness.commands).toEqual([])
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

    expect(harness.states).toEqual([{ listening: false, reason: null, monitoring: true }])
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
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true })

    // The utterance submits like a hotkey command, then monitoring resumes.
    await harness.speakUtterance()
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true })
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
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'wake', monitoring: true })
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
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })

    // Inert from here: later audio is dropped, not retried against the model.
    detector.push('wake', 0.9)
    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })
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
    expect(harness.states).toContainEqual({ listening: true, reason: 'hotkey', monitoring: true })

    // Toggling the hotkey off stops listening; the wake ear stays on.
    harness.session.arm()
    harness.session.disarm()
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true })

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])
    expect(detector.chunks.length).toBeGreaterThan(0)
  })

  it('a confirmation window while monitoring returns to monitoring after the spoken yes', async () => {
    const detector = new FakeWakeDetector()
    const harness = await createSession({
      transcriber: new FakeTranscriber(['yes']),
      wake: { detector },
    })
    harness.session.enableWakeMonitoring()

    harness.session.handlePipelineEvent(confirmationRequested('confirm-w'))
    await flush()
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'confirmation', monitoring: true })

    await harness.speakUtterance()
    expect(harness.resolutions).toEqual([{ confirmationId: 'confirm-w', approved: true }])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true })
  })

  it('the abort head cancels an active run from the always-on ear', async () => {
    const runState = { value: 'running' as CommandRunState }
    const detector = new FakeWakeDetector({ abort: [0.95] })
    const harness = await createSession({ wake: { detector }, runState })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])

    expect(harness.aborts).toHaveLength(1)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true })
  })

  it('the abort head is a no-op while idle', async () => {
    const detector = new FakeWakeDetector({ abort: [0.95, 0.95] })
    const harness = await createSession({ wake: { detector } })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.aborts).toHaveLength(0)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true })
  })

  it('the hold on head pauses an active run and opens the steering listen', async () => {
    const runState = { value: 'running' as CommandRunState }
    const detector = new FakeWakeDetector({ holdOn: [0.95] })
    const harness = await createSession({
      transcriber: new FakeTranscriber(['use Paris instead']),
      wake: { detector },
      runState,
    })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH])

    expect(harness.pauses).toHaveLength(1)
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'pause', monitoring: true })

    // The steering utterance routes exactly like the keyword path (#20).
    await harness.speakUtterance()
    expect(harness.resumes).toEqual(['use Paris instead'])
    expect(harness.heard).toEqual([{ text: 'use Paris instead', routed: 'steering' }])
  })

  it('the hold on head is a no-op while idle', async () => {
    const detector = new FakeWakeDetector({ holdOn: [0.95, 0.95] })
    const harness = await createSession({ wake: { detector } })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.pauses).toHaveLength(0)
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: true })
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
    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: stt!.turnId }])
    // Instrumentation changes no pipeline behavior.
    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
  })

  it('carries utterance speech ms, total ms, and truncated flag in the stt detail', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['go']), perf: {} })

    harness.session.arm()
    await harness.speakUtterance() // 8 speech frames; 31 frames handed to STT

    const stt = harness.perf.find((record) => record.stage === 'stt')
    expect(stt!.detail).toEqual({ speechMs: 8 * 32, totalMs: 31 * 32, truncated: false })
  })

  it('logs the stt span for confirmation answers but no wake-to-transcript span', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['yes']), perf: {} })

    harness.session.handlePipelineEvent(confirmationRequested('confirm-p'))
    await flush()
    await harness.speakUtterance()

    expect(harness.perf.map((record) => record.stage)).toEqual(['stt'])
    expect(harness.submitted).toEqual([])
  })

  it('still logs the stt span with the error when transcription fails', async () => {
    const transcriber = new FakeTranscriber(['x'])
    transcriber.rejectWith = new Error('whisper model missing')
    const harness = await createSession({ transcriber, perf: {} })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.perf.map((record) => record.stage)).toEqual(['stt'])
    expect(harness.perf[0].detail).toMatchObject({ error: 'whisper model missing', truncated: false })
    expect(harness.errors).toEqual(['whisper model missing'])
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
    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: expect.any(String) }])
  })

  it('never fails an utterance over perf bookkeeping — a throwing sink is swallowed', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']), perf: { throwing: true } })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.submitted).toEqual([{ text: 'open youtube', turnId: expect.any(String) }])
    expect(harness.heard).toEqual([{ text: 'open youtube', routed: 'command' }])
    expect(harness.errors).toEqual([])
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
    transcriber.rejectWith = new Error('whisper model missing')
    const harness = await createSession({ transcriber, audioDump: true })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.dumps).toHaveLength(1)
    expect(harness.errors).toEqual(['whisper model missing'])
  })
})
