import { describe, expect, it, vi } from 'vitest'
import workletSource from './micCaptureWorklet.js?raw'
import { CAPTURE_CONTEXT_OPTIONS, captureConstraints, createFrameChunker, openMicCapture, type CaptureContextOptions } from './micCapture'

/** The worklet's processor class, loaded as the audio thread loads it. */
function loadWorklet(): new () => { port: { postMessage(data: Float32Array): void }; process(inputs: Float32Array[][]): boolean } {
  let registered: unknown
  class AudioWorkletProcessor {
    port = { postMessage: (_data: Float32Array) => {} }
  }
  // The audio thread's globals, and nothing else: the worklet's own source, run as the AudioWorkletGlobalScope runs it.
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', workletSource)(AudioWorkletProcessor, 16000, (_name: string, processor: unknown) => {
    registered = processor
  })
  return registered as never
}

/** A deterministic stereo signal, one 128-sample render quantum at a time. */
const quantum = (index: number): Float32Array[] => {
  const left = new Float32Array(128)
  const right = new Float32Array(128)
  for (let i = 0; i < 128; i++) {
    left[i] = Math.sin((index * 128 + i) / 7)
    right[i] = Math.cos((index * 128 + i) / 11)
  }
  return [left, right]
}

describe('the capture context (#431)', () => {
  it('opens at 16 kHz with no output device', () => {
    expect(CAPTURE_CONTEXT_OPTIONS).toEqual({ sampleRate: 16000, sinkId: { type: 'none' } })
  })

  it('keeps the processing flags on and asks for the chosen mic exactly', () => {
    expect(captureConstraints('default')).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
    expect(captureConstraints('')).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
    expect(captureConstraints('c920-id')).toEqual({ deviceId: { exact: 'c920-id' }, echoCancellation: true, noiseSuppression: true, autoGainControl: true })
  })

  it('builds stream → worklet → frames over IPC with those options, and tears it all down', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const node = { port: { onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null }, disconnect: vi.fn() }
    const context = {
      audioWorklet: { addModule: vi.fn(async () => {}) },
      createMediaStreamSource: vi.fn(() => source),
      close: vi.fn(async () => {}),
    }
    const getUserMedia = vi.fn(async () => stream)
    const createContext = vi.fn((_options: CaptureContextOptions) => context as unknown as AudioContext)
    const sent: Float32Array[] = []
    const capture = await openMicCapture('c920-id', {
      getUserMedia,
      createContext,
      createWorkletNode: (_context, name) => {
        expect(name).toBe('bingbong-capture')
        return node as unknown as AudioWorkletNode
      },
      workletUrl: 'worklet.js',
      send: (samples) => sent.push(samples.slice()),
      onFault: () => {},
    })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: captureConstraints('c920-id') })
    expect(createContext).toHaveBeenCalledWith({ sampleRate: 16000, sinkId: { type: 'none' } })
    expect(context.audioWorklet.addModule).toHaveBeenCalledWith('worklet.js')
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(source.connect).toHaveBeenCalledWith(node)

    node.port.onmessage?.({ data: new Float32Array(1024).fill(0.5) } as MessageEvent<Float32Array>)
    node.port.onmessage?.({ data: new Float32Array(1024).fill(0.25) } as MessageEvent<Float32Array>)
    expect(sent.map((chunk) => chunk.length)).toEqual([2048])

    capture.stop()
    expect(node.port.onmessage).toBeNull()
    expect(track.stop).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()
  })

  it('closes the context and stops the mic when the worklet will not load', async () => {
    const track = { stop: vi.fn() }
    const context = { audioWorklet: { addModule: vi.fn(async () => Promise.reject(new Error('no'))) }, close: vi.fn(async () => {}) }
    const onFault = vi.fn()
    await expect(
      openMicCapture('default', {
        getUserMedia: async () => ({ getTracks: () => [track] }) as unknown as MediaStream,
        createContext: () => context as unknown as AudioContext,
        createWorkletNode: () => {
          throw new Error('unreached')
        },
        workletUrl: 'worklet.js',
        send: () => {},
        onFault,
      }),
    ).rejects.toThrow('mic capture worklet failed to load')
    expect(onFault).toHaveBeenCalledWith('voice.audioWorklet.addModule', expect.any(Error))
    expect(track.stop).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()
  })
})

describe('the frame path (#431): what the main process receives', () => {
  it('is every sample the mic gave, downmixed to mono, in whole 512-sample frames of at least four', () => {
    const Processor = loadWorklet()
    const processor = new Processor()
    const sent: Float32Array[] = []
    const chunk = createFrameChunker((samples) => sent.push(samples.slice()))
    processor.port.postMessage = (data) => chunk(data)

    const quanta = 100
    const expected: number[] = []
    for (let q = 0; q < quanta; q++) {
      const [left, right] = quantum(q)
      expect(processor.process([[left, right]])).toBe(true)
      for (let i = 0; i < 128; i++) expected.push((left[i] + right[i]) / 2)
    }
    // An empty input (no track yet) adds nothing.
    processor.process([[]])

    expect(sent.every((samples) => samples.length % 512 === 0 && samples.length >= 2048)).toBe(true)
    const received = sent.flatMap((samples) => [...samples])
    // 12 800 samples in; the worklet posts 1024 at a time (12 posts = 12 288), the chunker sends 2048 per two posts.
    expect(received.length).toBe(12288)
    expect(received).toEqual(expected.slice(0, received.length).map((v) => Math.fround(v)))
  })

  it('carries a remainder to the next post rather than dropping it', () => {
    const sent: Float32Array[] = []
    const chunk = createFrameChunker((samples) => sent.push(samples.slice()))
    const ramp = (from: number, length: number): Float32Array => Float32Array.from({ length }, (_, i) => from + i)
    chunk(ramp(0, 1500))
    expect(sent).toEqual([])
    chunk(ramp(1500, 1000))
    expect(sent.map((samples) => samples.length)).toEqual([2048])
    chunk(ramp(2500, 1700))
    expect(sent.map((samples) => samples.length)).toEqual([2048, 2048])
    expect(sent.flatMap((samples) => [...samples])).toEqual([...ramp(0, 4096)])
  })
})
