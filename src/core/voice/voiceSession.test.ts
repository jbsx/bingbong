import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { FakeClock, FakeTranscriber, FakeVad, FakeWakeDetector, RecordingTts } from '../testing/doubles'
import type { VoiceHeardEvent, VoiceState } from './ipcChannels'
import { createVoiceSession } from './voiceSession'
import type { CommandRunState } from '../pipeline/createCommandPipeline'

// The voice session is T9's coordinator: mic audio in (through the VadScorer
// and utterance endpointing), transcripts out to the same command pipeline as
// the text box, and confirmation prompts get their 12 s spoken yes/no window.
// Everything here runs on fakes; the main-process adapters only supply VAD
// probabilities and transcripts.

const SPEECH = 0.95
const SILENCE = 0.01

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
}): Promise<SessionHarness> {
  const vad = overrides?.vad ?? new FakeVad()
  const transcriber = overrides?.transcriber ?? new FakeTranscriber()
  const clock = new FakeClock()
  const tts = new RecordingTts()
  const idle = new DeferredIdle()
  const states: VoiceState[] = []
  const heard: VoiceHeardEvent[] = []
  const errors: string[] = []
  const commands: string[] = []
  const resolutions: { confirmationId: string; approved: boolean }[] = []
  const askResolutions: { askId: string; answer: string }[] = []
  const aborts: number[] = []
  const pauses: number[] = []
  const resumes: (string | undefined)[] = []
  const chimes: number[] = []
  const threshold = overrides?.wake?.threshold ?? 0.5

  const session = createVoiceSession({
    vad,
    transcriber,
    clock,
    tts,
    ttsIdle: idle,
    confirmWindowMs: overrides?.confirmWindowMs,
    wake: overrides?.wake
      ? {
          detector: overrides.wake.detector,
          getThreshold: () => threshold,
          chime: () => chimes.push(1),
        }
      : undefined,
    onSubmitCommand: (text) => commands.push(text),
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

  return { vad, transcriber, clock, tts, idle, states, heard, errors, commands, resolutions, askResolutions, aborts, pauses, resumes, chimes, speakUtterance, session }
}

function confirmationRequested(id = 'confirm-1'): PipelineEvent {
  return {
    type: 'confirmation_requested',
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
    detector.failWith = new Error('hey_jarvis_v0.1.onnx missing')
    const harness = await createSession({ wake: { detector } })
    harness.session.enableWakeMonitoring()

    await monitorFrames(harness, [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH])

    expect(harness.errors).toEqual(['hey_jarvis_v0.1.onnx missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null, monitoring: false })

    // Inert from here: later audio is dropped, not retried against the model.
    detector.queue.push(0.9)
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

  it('without a wake detector, enableWakeMonitoring is a no-op', async () => {
    const harness = await createSession()

    harness.session.enableWakeMonitoring()
    await harness.speakUtterance()

    expect(harness.states).toEqual([])
    expect(harness.vad.frames).toHaveLength(0)
  })
})
