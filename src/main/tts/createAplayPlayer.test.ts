import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { createAplayPlayer } from './createAplayPlayer'

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
