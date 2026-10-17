import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { createAplayPlayer } from './createAplayPlayer'
import { wrapRawPcmAsWav } from '../../core/tts/wav'

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

function readStdin(child: FakeChild): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stdin.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

describe('aplay player', () => {
  it('pipes the WAV to aplay’s stdin and resolves when playback ends', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const player = createAplayPlayer({ spawnFn })

    const wav = new Uint8Array([1, 2, 3])
    const playback = player.play(wav)

    const call = calls[0]!
    expect(call.command).toBe('aplay')
    expect(call.args).toEqual(['-q', '-'])
    expect(await readStdin(call.child)).toEqual(Buffer.from(wav))

    call.child.emit('close', 0)
    await expect(playback.done).resolves.toBeUndefined()
  })

  it('rejects done when aplay exits nonzero', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const player = createAplayPlayer({ spawnFn })

    const playback = player.play(new Uint8Array([1]))
    const expectation = expect(playback.done).rejects.toThrow('aplay exited with code 2')
    calls[0]!.child.emit('close', 2)
    await expectation
  })

  it('stop() kills playback instantly and done still resolves', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const player = createAplayPlayer({ spawnFn })

    const playback = player.play(new Uint8Array([1]))
    playback.stop()

    expect(calls[0]!.child.killed).toBe(true)
    await expect(playback.done).resolves.toBeUndefined()
  })

  it('rejects done when aplay cannot be started', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const player = createAplayPlayer({ spawnFn, bin: '/missing/aplay' })

    const playback = player.play(new Uint8Array([1]))
    const expectation = expect(playback.done).rejects.toThrow("failed to start player at '/missing/aplay'")
    calls[0]!.child.emit('error', new Error('spawn ENOENT'))
    await expectation
  })
})

// The stream a spoken text plays through (#327): one aplay reading raw PCM
// in the voice's format, each sentence's samples written after the last, so
// there is no start gap between sentences.
describe('aplay stream', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  it('plays every sentence through one aplay, its samples in order, and reports the first sample once', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const player = createAplayPlayer({ spawnFn })
    let firstSamples = 0

    const stream = player.open({ onFirstSample: () => (firstSamples += 1) })
    expect(calls).toHaveLength(0)
    stream.write(wrapRawPcmAsWav(new Uint8Array([1, 2]), 22050))
    expect(firstSamples).toBe(1)
    stream.write(wrapRawPcmAsWav(new Uint8Array([3, 4]), 22050))
    stream.end()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toEqual(['-q', '-t', 'raw', '-f', 'S16_LE', '-c', '1', '-r', '22050', '-'])
    expect(await readStdin(calls[0]!.child)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(firstSamples).toBe(1)

    calls[0]!.child.emit('close', 0)
    await expect(stream.done).resolves.toBeUndefined()
  })

  it('stop() kills the stream at once, done resolves, and later writes reach nothing', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const player = createAplayPlayer({ spawnFn })

    const stream = player.open()
    stream.write(wrapRawPcmAsWav(new Uint8Array([1, 2]), 22050))
    stream.stop()
    expect(calls[0]!.child.killed).toBe(true)
    stream.write(wrapRawPcmAsWav(new Uint8Array([3, 4]), 22050))
    stream.end()

    await expect(stream.done).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('an ended stream nothing was written to is done at once', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const stream = createAplayPlayer({ spawnFn }).open()
    stream.end()
    await expect(stream.done).resolves.toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('plays a sentence in another format through a second aplay once the first has drained', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const player = createAplayPlayer({ spawnFn })

    const stream = player.open()
    stream.write(wrapRawPcmAsWav(new Uint8Array([1, 2]), 22050))
    stream.write(wrapRawPcmAsWav(new Uint8Array([3, 4]), 16000))
    stream.end()
    expect(await readStdin(calls[0]!.child)).toEqual(Buffer.from([1, 2]))
    expect(calls).toHaveLength(1)

    calls[0]!.child.emit('close', 0)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.args).toContain('16000')
    expect(await readStdin(calls[1]!.child)).toEqual(Buffer.from([3, 4]))
    calls[1]!.child.emit('close', 0)
    await expect(stream.done).resolves.toBeUndefined()
  })

  it('rejects done when aplay exits nonzero', async () => {
    const { calls, spawnFn } = fakeSpawn()
    const stream = createAplayPlayer({ spawnFn }).open()
    stream.write(wrapRawPcmAsWav(new Uint8Array([1, 2]), 22050))
    stream.end()
    const expectation = expect(stream.done).rejects.toThrow('aplay exited with code 1')
    calls[0]!.child.emit('close', 1)
    await expectation
  })
})
