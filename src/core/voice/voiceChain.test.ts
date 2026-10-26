import { describe, expect, it } from 'vitest'
import { FakeClock, FakeTranscriber, FakeVad, FakeWakeDetector } from '../testing/doubles'
import { setFaultSink, type FaultReport } from '../trace/fault'
import type { CommandRunState } from '../pipeline/runState'
import type { VoiceHeardEvent, VoiceState } from './ipcChannels'
import { mergeFramesFor, vadDefaults, VAD_FRAME_SAMPLES } from './vadEndpointing'
import {
  createVoiceChainClient,
  createVoiceChainHost,
  type ChainBias,
  type ChainModelLoad,
  type FromVoiceChain,
  type VoiceChainContext,
  type VoiceChainModels,
} from './voiceChain'
import type { SubmittedCommand } from './voiceSession'
import { WAKE_CHUNK_SAMPLES } from '../ports/wake'

// The voice chain's message contract (#430): the voice session runs in the
// voice process (the host) and main holds a VoiceSession that only routes
// (the client). Here both halves run in one test over a link that clones
// every message as a process boundary would, with fake models in the host:
// frames in, the wake, the Utterance's end, its partials and transcript out,
// and a voice process that exits reported as a fault and started again.

const SPEECH = 0.95
const SILENCE = 0.01
const DEFAULTS = vadDefaults()
const SUBMIT_SILENCE = DEFAULTS.endFrames + mergeFramesFor(DEFAULTS)

/** A transcriber that streams one partial a few frames into the capture, and counts its loads. */
class StreamingTranscriber extends FakeTranscriber {
  prepared = 0
  pushes = 0
  override begin(): void {
    super.begin()
    this.pushes = 0
  }
  override push(frame: Float32Array): void {
    super.push(frame)
    this.pushes += 1
    if (this.pushes === 3) this.emitPartial('scroll')
  }
  async prepare(): Promise<void> {
    this.prepared += 1
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await tick()
}

interface Process {
  models: VoiceChainModels & { vad: FakeVad; transcriber: StreamingTranscriber }
  /** The bias the decoder would read now. */
  bias(): ChainBias | null
  /** A message the process's own sinks send (faults, model loads). */
  send(message: FromVoiceChain): void
  /** The process dies. */
  exit(code: number): void
  stopped: boolean
}

function wire(options?: { vad?: () => number[]; wake?: () => FakeWakeDetector | null; transcripts?: string[]; bias?: () => ChainBias; task?: () => Promise<unknown> }) {
  const clock = new FakeClock()
  const processes: Process[] = []
  const states: VoiceState[] = []
  const heard: VoiceHeardEvent[] = []
  const errors: string[] = []
  const partials: string[] = []
  const submitted: { text: string; submitted: SubmittedCommand }[] = []
  const chimes: number[] = []
  const spans: { stage: string; detail?: Record<string, unknown> }[] = []
  const loads: ChainModelLoad[] = []
  const forwarded: FaultReport[] = []
  const context: VoiceChainContext = { speaking: false, runState: 'idle' as CommandRunState, wakeThreshold: 0.5 }

  const client = createVoiceChainClient<{ name: string }>({
    config: { name: 'models' },
    context: () => ({ ...context }),
    ...(options?.bias ? { bias: options.bias } : {}),
    clock,
    tracer: { span: (_turnId, stage, _durMs, detail) => spans.push({ stage, ...(detail ? { detail } : {}) }) },
    tracerEpochMs: 0,
    onModelLoad: (load) => loads.push(load),
    onFault: (report) => forwarded.push(report),
    callbacks: {
      stopSpeech: () => {},
      chime: () => chimes.push(1),
      onSubmitCommand: (text, details) => {
        submitted.push({ text, submitted: details })
        return options?.task?.()
      },
      onPartial: (text) => partials.push(text),
      onAbort: () => {},
      onStateChange: (state) => states.push(state),
      onHeard: (event) => heard.push(event),
      onError: (message) => errors.push(message),
    },
    start(events) {
      let alive = true
      let bias: () => ChainBias | null = () => null
      const models = {
        vad: new FakeVad(options?.vad?.() ?? []),
        transcriber: new StreamingTranscriber(options?.transcripts ?? ['scroll down']),
        wake: options?.wake ? options.wake() : null,
      }
      const toMain = (message: FromVoiceChain): void => {
        const copy = structuredClone(message)
        setTimeout(() => {
          if (alive) events.message(copy)
        }, 0)
      }
      const host = createVoiceChainHost<{ name: string }>({
        send: toMain,
        epochNow: () => 0,
        build: async (config, getBias) => {
          expect(config).toEqual({ name: 'models' })
          bias = getBias
          return models
        },
      })
      const process: Process = {
        models,
        bias: () => bias(),
        send: toMain,
        exit(code) {
          alive = false
          events.exit(`exited with code ${String(code)}`)
        },
        stopped: false,
      }
      processes.push(process)
      return {
        post(message) {
          const copy = structuredClone(message)
          setTimeout(() => {
            if (alive) host.receive(copy)
          }, 0)
        },
        stop() {
          alive = false
          process.stopped = true
        },
      }
    },
  })

  /** The mic's frames, `n` VAD frames in one chunk, as the renderer sends them. */
  const frames = (n: number): Promise<void> => client.pushAudio(new Float32Array(n * VAD_FRAME_SAMPLES))
  return { client, clock, processes, states, heard, errors, partials, submitted, chimes, spans, loads, forwarded, context, frames }
}

describe('the voice chain across the process boundary (#430)', () => {
  it('a hotkey listen: frames in, the partial, the Utterance end and its transcript out', async () => {
    const chain = wire({ vad: () => [...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 4 }, () => SILENCE)] })
    chain.client.arm()
    await settle()
    expect(chain.client.getState()).toMatchObject({ listening: true, reason: 'hotkey' })
    for (let i = 0; i < 8 + SUBMIT_SILENCE + 4; i++) await chain.frames(1)
    await settle()
    expect(chain.partials).toContain('scroll')
    expect(chain.submitted).toEqual([{ text: 'scroll down', submitted: expect.objectContaining({ truncated: false, turnId: expect.any(String), endpointAt: expect.any(Number) }) }])
    expect(chain.heard).toEqual([{ text: 'scroll down', routed: 'command' }])
    // Single-shot: the listen closed with the Command.
    expect(chain.client.getState()).toMatchObject({ listening: false, transcribing: false })
    // The process's spans land in main's tracer.
    expect(chain.spans.map((span) => span.stage)).toEqual(expect.arrayContaining(['stt', 'end-of-speech']))
  })

  it('every pushAudio resolves once the voice process has scored its frames', async () => {
    const chain = wire()
    chain.client.arm()
    await settle()
    let scored = false
    const pushed = chain.frames(4).then(() => {
      scored = true
    })
    expect(scored).toBe(false)
    await pushed
    expect(chain.processes[0]!.models.vad.frames).toHaveLength(4)
  })

  it('the wake word: monitoring hears the frames, chimes, and opens a wake listen', async () => {
    const chain = wire({ vad: () => Array.from({ length: 40 }, () => SPEECH), wake: () => new FakeWakeDetector([0.01, 0.99]) })
    chain.client.enableWakeMonitoring()
    await settle()
    expect(chain.client.getState().monitoring).toBe(true)
    await chain.client.pushAudio(new Float32Array(2 * WAKE_CHUNK_SAMPLES))
    await settle()
    expect(chain.chimes).toHaveLength(1)
    expect(chain.client.getState()).toMatchObject({ listening: true, reason: 'wake' })
  })

  it('what the session reads off the app rides with the frames: speech under a line playing is no Command', async () => {
    const chain = wire({ vad: () => [...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 4 }, () => SILENCE)] })
    chain.client.arm()
    await settle()
    chain.context.speaking = true
    for (let i = 0; i < 8 + SUBMIT_SILENCE + 4; i++) await chain.frames(1)
    await settle()
    expect(chain.submitted).toEqual([])
    expect(chain.processes[0]!.models.transcriber.events).not.toContain('finish')
  })

  it('sends the bias at start and again only when it changes', async () => {
    let bias: ChainBias = ['first']
    const chain = wire({ bias: () => bias })
    chain.client.arm()
    await settle()
    expect(chain.processes[0]!.bias()).toEqual(['first'])
    bias = [{ phrases: ['Linus Tech Tips'], boost: 1.5 }]
    await chain.frames(1)
    await settle()
    expect(chain.processes[0]!.bias()).toEqual([{ phrases: ['Linus Tech Tips'], boost: 1.5 }])
  })

  it('loads the STT engine ahead of the first line, whose span is then not cold', async () => {
    const chain = wire({ vad: () => [...Array.from({ length: 8 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 4 }, () => SILENCE)] })
    await chain.client.prepareTranscriber()
    expect(chain.processes[0]!.models.transcriber.prepared).toBe(1)
    chain.client.arm()
    await settle()
    for (let i = 0; i < 8 + SUBMIT_SILENCE + 4; i++) await chain.frames(1)
    await settle()
    const stt = chain.spans.find((span) => span.stage === 'stt')
    expect(stt?.detail?.cold).toBeUndefined()
  })

  it('a wake listen stays hot until its Task ends; Escape closes it from main', async () => {
    let endTask: () => void = () => {}
    const chain = wire({
      vad: () => [...Array.from({ length: 16 }, () => SPEECH), ...Array.from({ length: SUBMIT_SILENCE + 4 }, () => SILENCE)],
      wake: () => new FakeWakeDetector([0.99]),
      task: () => new Promise<void>((resolve) => (endTask = resolve)),
    })
    chain.client.enableWakeMonitoring()
    await settle()
    await chain.client.pushAudio(new Float32Array(WAKE_CHUNK_SAMPLES))
    await settle()
    for (let i = 0; i < 16 + SUBMIT_SILENCE + 4; i++) await chain.frames(1)
    await settle()
    expect(chain.submitted.map((s) => s.text)).toEqual(['scroll down'])
    expect(chain.client.isHotListenOpen()).toBe(true)
    endTask()
    await settle()
    expect(chain.client.closeHotListen()).toBe(true)
    await settle()
    expect(chain.client.getState()).toMatchObject({ listening: false })
    expect(chain.client.closeHotListen()).toBe(false)
  })

  it('a voice process that exits is a fault, the ear says it is down, and a new one starts with the ear as it was', async () => {
    const faults: string[] = []
    setFaultSink((report) => faults.push(report.site))
    try {
      const chain = wire({ wake: () => new FakeWakeDetector([0.01]) })
      chain.client.enableWakeMonitoring()
      await settle()
      expect(chain.client.getState().monitoring).toBe(true)
      const pending = chain.frames(4)
      chain.processes[0]!.exit(1)
      // A frame in flight is let go, not left hanging.
      await pending
      expect(faults).toContain('voice.chain.exit')
      expect(chain.client.getState()).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false })
      expect(chain.errors).toEqual(['The voice process stopped; starting it again.'])
      chain.clock.advance(1_000)
      await settle()
      expect(chain.processes).toHaveLength(2)
      expect(chain.client.getState().monitoring).toBe(true)
      // The second, in quick succession, waits twice as long.
      chain.processes[1]!.exit(1)
      chain.clock.advance(1_000)
      await settle()
      expect(chain.processes).toHaveLength(2)
      chain.clock.advance(1_000)
      await settle()
      expect(chain.processes).toHaveLength(3)
    } finally {
      setFaultSink(null)
    }
  })

  it('stop ends the voice process for good: no fault, no restart', async () => {
    const faults: string[] = []
    setFaultSink((report) => faults.push(report.site))
    try {
      const chain = wire()
      await settle()
      chain.client.stop()
      expect(chain.processes[0]!.stopped).toBe(true)
      chain.clock.advance(60_000)
      await settle()
      expect(chain.processes).toHaveLength(1)
      expect(faults).toEqual([])
    } finally {
      setFaultSink(null)
    }
  })

  it("the voice process's faults and model loads reach main's sinks", async () => {
    const chain = wire()
    await settle()
    chain.processes[0]!.send({ type: 'modelLoad', load: { model: 'stt', durMs: 2_400, failed: false } })
    chain.processes[0]!.send({ type: 'fault', report: { kind: 'fault', site: 'voice.createParakeetTranscriber.partialPass', message: 'boom' } })
    await settle()
    expect(chain.loads).toEqual([{ model: 'stt', durMs: 2_400, failed: false }])
    expect(chain.forwarded.map((report) => report.site)).toEqual(['voice.createParakeetTranscriber.partialPass'])
  })

  it('a press before the models are in waits for them, in order', async () => {
    const chain = wire()
    // No settle: the init has not been handled yet.
    chain.client.arm()
    await settle()
    expect(chain.client.getState()).toMatchObject({ listening: true, reason: 'hotkey' })
  })
})
