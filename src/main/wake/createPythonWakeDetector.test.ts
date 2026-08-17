import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { createPythonWakeDetector } from './createPythonWakeDetector'

// The Python sidecar adapter (T10 fallback): same WakeWordDetector seam as
// the ONNX port, backed by the reference openwakeword implementation in a
// spawned python3. The wire protocol is length-prefixed frames on
// stdin/stdout; the fake child below pins that protocol.

const MSG_AUDIO = 0
const MSG_RESET = 1
const MSG_SCORE = 0
const MSG_ERROR = 1

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false

  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'))
    return true
  }

  sendFrame(type: number, payload: Buffer): void {
    const frame = Buffer.alloc(5 + payload.length)
    frame.writeUInt32LE(1 + payload.length, 0)
    frame.writeUInt8(type, 4)
    payload.copy(frame, 5)
    this.stdout.write(frame)
  }

  sendScore(score: number): void {
    this.sendFrame(MSG_SCORE, Buffer.from(score.toFixed(6)))
  }
}

function fakeSpawn() {
  const calls: { command: string; args: string[]; child: FakeChild }[] = []
  const spawnFn = (command: string, args?: readonly string[]) => {
    const child = new FakeChild()
    calls.push({ command, args: [...(args ?? [])], child })
    return child as unknown as ChildProcess
  }
  return { calls, spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn }
}

function readFrames(child: FakeChild, count: number): Promise<{ type: number; payload: Buffer }[]> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0)
    const frames: { type: number; payload: Buffer }[] = []
    child.stdin.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 5 && buffer.length >= 5 + buffer.readUInt32LE(0) - 1) {
        const length = buffer.readUInt32LE(0)
        frames.push({ type: buffer.readUInt8(4), payload: buffer.subarray(5, 4 + length) })
        buffer = buffer.subarray(4 + length)
        if (frames.length === count) resolve(frames)
      }
    })
  })
}

function createDetector(spawnFn: ReturnType<typeof fakeSpawn>['spawnFn']) {
  return createPythonWakeDetector({
    pythonBin: 'python3',
    scriptPath: 'scripts/wake_sidecar.py',
    classifierModelPath: 'hey_jarvis_v0.1.onnx',
    spawnFn,
  })
}

describe('python wake sidecar', () => {
  it('spawns lazily on the first score and frames the audio as s16le PCM', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const detector = createDetector(spawnFn)
    expect(calls).toHaveLength(0)

    const scoring = detector.score(new Float32Array(1280).fill(0.5))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.command).toBe('python3')
    expect(calls[0]!.args).toEqual(['-u', 'scripts/wake_sidecar.py', '--model', 'hey_jarvis_v0.1.onnx'])

    const frames = await readFrames(calls[0]!.child, 1)
    expect(frames[0]!.type).toBe(MSG_AUDIO)
    expect(frames[0]!.payload).toHaveLength(2560)
    expect(frames[0]!.payload.readInt16LE(0)).toBe(Math.round(0.5 * 32767))

    calls[0]!.child.sendScore(0.42)
    await expect(scoring).resolves.toBeCloseTo(0.42, 5)
  })

  it('resolves scores in write order across multiple chunks', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const detector = createDetector(spawnFn)

    const first = detector.score(new Float32Array(1280))
    const second = detector.score(new Float32Array(1280))
    calls[0]!.child.sendScore(0.1)
    calls[0]!.child.sendScore(0.2)

    await expect(first).resolves.toBeCloseTo(0.1, 5)
    await expect(second).resolves.toBeCloseTo(0.2, 5)
  })

  it('handles score frames split across stdout reads', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const detector = createDetector(spawnFn)

    const scoring = detector.score(new Float32Array(1280))
    const child = calls[0]!.child
    const frame = Buffer.alloc(5 + 8)
    frame.writeUInt32LE(9, 0)
    frame.writeUInt8(MSG_SCORE, 4)
    frame.write('0.123456', 5, 'ascii')
    child.stdout.write(frame.subarray(0, 7))
    child.stdout.write(frame.subarray(7))

    await expect(scoring).resolves.toBeCloseTo(0.123456, 5)
  })

  it('reset() sends a reset frame once the sidecar is running', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const detector = createDetector(spawnFn)

    const scoring = detector.score(new Float32Array(1280))
    calls[0]!.child.sendScore(0.1)
    await scoring

    detector.reset()
    const frames = await readFrames(calls[0]!.child, 2)
    expect(frames[1]).toEqual({ type: MSG_RESET, payload: Buffer.alloc(0) })
  })

  it('a sidecar error frame rejects the pending score', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const detector = createDetector(spawnFn)

    const scoring = detector.score(new Float32Array(1280))
    const expectation = expect(scoring).rejects.toThrow('boom')
    calls[0]!.child.sendFrame(MSG_ERROR, Buffer.from('boom'))
    await expectation
  })

  it('a dead sidecar rejects pending and future scores', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const detector = createDetector(spawnFn)

    const scoring = detector.score(new Float32Array(1280))
    const expectation = expect(scoring).rejects.toThrow(/sidecar/)
    calls[0]!.child.emit('close', 1)
    await expectation
    await expect(detector.score(new Float32Array(1280))).rejects.toThrow(/sidecar/)
  })
})
