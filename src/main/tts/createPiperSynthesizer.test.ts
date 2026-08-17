import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { createPiperSynthesizer } from './createPiperSynthesizer'

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false

  kill(): boolean {
    this.killed = true
    return true
  }
}

interface SpawnCall {
  command: string
  args: string[]
  child: FakeChild
}

function fakeSpawn() {
  const calls: SpawnCall[] = []
  const spawnFn = (command: string, args?: readonly string[]) => {
    const child = new FakeChild()
    calls.push({ command, args: [...(args ?? [])], child })
    return child as unknown as ChildProcess
  }
  return { calls, spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn }
}

const VOICES = ['en_US-ryan-medium.onnx', 'en_US-ryan-medium.onnx.json']

function makeSynth(overrides: Partial<Parameters<typeof createPiperSynthesizer>[0]> = {}) {
  const { calls, spawnFn } = fakeSpawn()
  const synth = createPiperSynthesizer({
    bin: 'piper',
    voicesDir: '/voices',
    getVoiceId: () => 'en_US-ryan',
    spawnFn,
    readDirFn: async () => VOICES,
    readFileFn: async () => JSON.stringify({ audio: { sample_rate: 16000 } }),
    ...overrides,
  })
  return { synth, calls }
}

describe('piper synthesizer', () => {
  it('spawns piper with the resolved voice and returns WAV-wrapped PCM', async () => {
    const { synth, calls } = makeSynth()

    const wavPromise = synth.synthesize('hello there')
    await new Promise((resolve) => setImmediate(resolve))
    const call = calls[0]!
    expect(call.command).toBe('piper')
    expect(call.args).toEqual([
      '--model',
      '/voices/en_US-ryan-medium.onnx',
      '--config',
      '/voices/en_US-ryan-medium.onnx.json',
      '--output-raw',
    ])

    const stdinText = await new Promise<string>((resolve) => {
      let text = ''
      call.child.stdin.on('data', (chunk: Buffer) => (text += chunk.toString()))
      call.child.stdin.on('end', () => resolve(text))
    })
    expect(stdinText).toBe('hello there')

    call.child.stdout.write(Buffer.from([0xaa, 0xbb]))
    call.child.stdout.end()
    call.child.emit('close', 0)

    const wav = await wavPromise
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    // 16000 Hz s16le mono → byte rate 32000 at header offset 28.
    expect(new DataView(wav.buffer).getUint32(28, true)).toBe(32000)
    expect(wav.slice(44)).toEqual(new Uint8Array([0xaa, 0xbb]))
  })

  it('rejects with a descriptive error when the voice is not installed', async () => {
    const { synth } = makeSynth({ getVoiceId: () => 'de_DE-thorsten' })
    await expect(synth.synthesize('hi')).rejects.toThrow("piper voice 'de_DE-thorsten' not found in /voices")
  })

  it('rejects when the voices dir cannot be read', async () => {
    const { synth } = makeSynth({
      readDirFn: async () => {
        throw new Error('ENOENT')
      },
    })
    await expect(synth.synthesize('hi')).rejects.toThrow('piper voices dir not readable')
  })

  it('rejects with piper’s stderr when it exits nonzero', async () => {
    const { synth, calls } = makeSynth()
    const wavPromise = synth.synthesize('hi')
    await new Promise((resolve) => setImmediate(resolve))
    const call = calls[0]!
    call.child.stderr.write('model load failed')
    call.child.emit('close', 1)
    await expect(wavPromise).rejects.toThrow('piper exited with code 1: model load failed')
  })

  it('rejects when the piper binary cannot be started', async () => {
    const { synth, calls } = makeSynth()
    const wavPromise = synth.synthesize('hi')
    await new Promise((resolve) => setImmediate(resolve))
    calls[0]!.child.emit('error', new Error('spawn piper ENOENT'))
    await expect(wavPromise).rejects.toThrow("failed to start piper at 'piper': spawn piper ENOENT")
  })
})
