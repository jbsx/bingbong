import { VAD_FRAME_SAMPLES } from '../../core/voice/vadEndpointing'

/** The rate the main process takes every mic frame at: the VAD, the wake detector and STT all read 16 kHz. */
export const TARGET_RATE = 16000
const FRAMES_PER_CHUNK = 4

/** `sinkId` on the constructor (Chromium 110+), which TypeScript's DOM lib does not carry yet. */
export type CaptureContextOptions = AudioContextOptions & { sinkId?: string | { type: 'none' } }

/**
 * The capture context (#431): it resamples the mic to 16 kHz and plays
 * nothing, so it opens no output device. Without `sinkId: none` an
 * AudioContext holds an output stream whether or not anything reaches its
 * destination: on the kiosk a RUNNING silent "Playback" sink-input that kept
 * the renderer's realtime audio thread, the audio service's output path and
 * pulse's mixer awake all day. With it the context renders on a silent clock
 * and the worklet still gets every quantum.
 */
export const CAPTURE_CONTEXT_OPTIONS: CaptureContextOptions = { sampleRate: TARGET_RATE, sinkId: { type: 'none' } }

/**
 * What the capture asks the mic for. The processing flags stay on until the
 * owner's wake-under-music run measures them (#431). `channelCount: 1` was
 * measured and left out: Chromium still opened pulse's source-output at
 * s16le 2ch 44.1 kHz, and the CPU did not move.
 */
export function captureConstraints(micId: string): MediaTrackConstraints {
  return {
    ...(micId === 'default' || micId === '' ? {} : { deviceId: { exact: micId } }),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,




  }
}

/**
 * The frame path from the worklet to IPC: the worklet posts 1024-sample
 * chunks of mono 16 kHz audio; whole 512-sample VAD frames go on, at least
 * four at a time, and the remainder carries to the next post.
 */
export function createFrameChunker(send: (samples: Float32Array) => void): (chunk: Float32Array) => void {
  let carry = new Float32Array(0)
  return (chunk) => {
    const merged = new Float32Array(carry.length + chunk.length)
    merged.set(carry)
    merged.set(chunk, carry.length)
    const frames = Math.floor(merged.length / VAD_FRAME_SAMPLES)
    if (frames >= FRAMES_PER_CHUNK) {
      const sent = frames * VAD_FRAME_SAMPLES
      send(merged.subarray(0, sent))
      carry = merged.slice(sent)
    } else {
      carry = merged
    }
  }
}

export interface MicCaptureDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  createContext(options: CaptureContextOptions): AudioContext
  createWorkletNode(context: AudioContext, name: string): AudioWorkletNode
  workletUrl: URL | string
  send(samples: Float32Array): void
  onFault(where: string, error: unknown): void
  /** The open capture lost its device (#530): a track ended that nobody stopped. */
  onLost(): void
}

export interface MicCapture {
  stop(): void
}

/** Opens the mic and the capture graph: stream → worklet (downmix, 1024-sample posts) → frame chunker → IPC. */
export async function openMicCapture(micId: string, deps: MicCaptureDeps): Promise<MicCapture> {
  const stream = await deps.getUserMedia({ audio: captureConstraints(micId) })
  const context = deps.createContext(CAPTURE_CONTEXT_OPTIONS)
  try {
    await context.audioWorklet.addModule(deps.workletUrl)
  } catch (error) {
    deps.onFault('voice.audioWorklet.addModule', error)
    stream.getTracks().forEach((track) => track.stop())
    await context.close()
    throw new Error('mic capture worklet failed to load')
  }
  const source = context.createMediaStreamSource(stream)
  const node = deps.createWorkletNode(context, 'bingbong-capture')
  source.connect(node)

  const chunk = createFrameChunker(deps.send)
  node.port.onmessage = (event: MessageEvent<Float32Array>) => chunk(event.data)
  const onEnded = (): void => deps.onLost()
  stream.getTracks().forEach((track) => track.addEventListener('ended', onEnded))

  return {
    stop: () => {
      stream.getTracks().forEach((track) => track.removeEventListener('ended', onEnded))
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
    },
  }
}
