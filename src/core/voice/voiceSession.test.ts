import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import type { Transcriber, VadScorer } from '../ports/stt'
import { FakeClock, RecordingTts } from '../testing/doubles'
import type { VoiceHeardEvent, VoiceState } from './ipcChannels'
import { createVoiceSession } from './voiceSession'

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

class FakeVad implements VadScorer {
  queue: number[]
  private last = SILENCE
  readonly frames: Float32Array[] = []
  resets = 0
  failWith: Error | null = null

  constructor(probs: number[] = []) {
    this.queue = [...probs]
  }

  async score(frame: Float32Array): Promise<number> {
    this.frames.push(frame)
    if (this.failWith) throw this.failWith
    if (this.queue.length > 0) this.last = this.queue.shift() ?? this.last
    return this.last
  }

  reset(): void {
    this.resets += 1
  }
}

class FakeTranscriber implements Transcriber {
  private queue: string[]
  readonly audio: Float32Array[] = []
  rejectWith: Error | null = null

  constructor(script: string[] = []) {
    this.queue = [...script]
  }

  async transcribe(pcm: Float32Array): Promise<string> {
    this.audio.push(pcm)
    if (this.rejectWith) throw this.rejectWith
    return this.queue.shift() ?? ''
  }
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

  const session = createVoiceSession({
    vad,
    transcriber,
    clock,
    tts,
    ttsIdle: idle,
    confirmWindowMs: overrides?.confirmWindowMs,
    onSubmitCommand: (text) => commands.push(text),
    onResolveConfirmation: (confirmationId, approved) => resolutions.push({ confirmationId, approved }),
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

  return { vad, transcriber, clock, tts, idle, states, heard, errors, commands, resolutions, speakUtterance, session }
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

describe('voice session', () => {
  it('submits a spoken command through the same callback the text box uses, then disarms', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['open youtube']) })

    harness.session.arm()
    await harness.speakUtterance()

    expect(harness.commands).toEqual(['open youtube'])
    expect(harness.states).toEqual([
      { listening: true, reason: 'hotkey' },
      { listening: false, reason: null },
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
    expect(harness.states).toEqual([{ listening: true, reason: 'hotkey' }])
    expect(harness.heard).toEqual([])
  })

  it('stops TTS when the hotkey arms (barge-in stand-in until the wake word)', async () => {
    const harness = await createSession()

    harness.session.arm()

    expect(harness.tts.stopCalls).toBe(1)
    expect(harness.states).toEqual([{ listening: true, reason: 'hotkey' }])
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

    expect(harness.states).toEqual([{ listening: true, reason: 'confirmation' }])
  })

  it('answers a confirmation with a spoken yes and disarms', async () => {
    const harness = await createSession({ transcriber: new FakeTranscriber(['um, yeah sure']) })

    harness.session.handlePipelineEvent(confirmationRequested('confirm-7'))
    await flush()
    await harness.speakUtterance()

    expect(harness.resolutions).toEqual([{ confirmationId: 'confirm-7', approved: true }])
    expect(harness.heard).toEqual([{ text: 'um, yeah sure', routed: 'confirmation' }])
    expect(harness.commands).toEqual([])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null })
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
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'confirmation' })

    await harness.speakUtterance()
    expect(harness.resolutions).toEqual([{ confirmationId: 'confirm-3', approved: true }])
  })

  it('closes the window after 12 s without resolving — tap buttons and the 60 s auto-deny stay in charge', async () => {
    const harness = await createSession()

    harness.session.handlePipelineEvent(confirmationRequested())
    await flush()

    harness.clock.advance(12_000)

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null })
    expect(harness.resolutions).toEqual([])
  })

  it('disarms when the confirmation is resolved by tap mid-window', async () => {
    const harness = await createSession()

    harness.session.handlePipelineEvent(confirmationRequested('confirm-4'))
    await flush()
    expect(harness.states.at(-1)).toEqual({ listening: true, reason: 'confirmation' })

    harness.session.handlePipelineEvent({
      type: 'confirmation_resolved',
      confirmationId: 'confirm-4',
      approved: true,
      reason: 'user',
      at: 1_000,
    })

    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null })
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
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null })
  })

  it('surfaces a failed VAD as an error and disarms', async () => {
    const vad = new FakeVad()
    vad.failWith = new Error('silero model missing')
    const harness = await createSession({ vad })

    harness.session.arm()
    await harness.session.pushAudio(new Float32Array(512))

    expect(harness.errors).toEqual(['silero model missing'])
    expect(harness.states.at(-1)).toEqual({ listening: false, reason: null })
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
    expect(harness.vad.resets).toBe(1)
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
