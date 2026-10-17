import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { SpeechSynthesizer } from '../../core/ports/tts'
import { createPersistentPiperSynthesizer } from './createPersistentPiperSynthesizer'

// A persistent Piper (#327, AC1): one process per voice serves every line,
// in `--output-dir` mode — one WAV per stdin line, its path reported as it
// is written (stderr's `Wrote <path>` from the Python piper, a bare path on
// stdout from the C++ one). A process that dies is restarted and the line
// retried once; one that cannot start falls back to the per-line spawn.

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly lines: string[] = []
  killed = false

  constructor() {
    super()
    let buffered = ''
    this.stdin.on('data', (chunk: Buffer) => {
      buffered += chunk.toString()
      const parts = buffered.split('\n')
      buffered = parts.pop() ?? ''
      this.lines.push(...parts)
    })
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

const OUT = '/tmp/piper-out'
const VOICES = ['en_US-ryan-medium.onnx', 'en_US-ryan-medium.onnx.json', 'en_GB-alan-medium.onnx', 'en_GB-alan-medium.onnx.json']

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function makeSynth(overrides: { getVoiceId?: () => string; fallback?: SpeechSynthesizer } = {}) {
  const children: FakeChild[] = []
  const args: string[][] = []
  const files = new Map<string, Uint8Array>()
  const removed: string[] = []
  const fallbackTexts: string[] = []
  const spawnFn = ((_command: string, spawnArgs?: readonly string[]) => {
    const child = new FakeChild()
    children.push(child)
    args.push([...(spawnArgs ?? [])])
    return child as unknown as ChildProcess
  }) as unknown as typeof import('node:child_process').spawn
  const synth = createPersistentPiperSynthesizer({
    bin: 'piper',
    voicesDir: '/voices',
    getVoiceId: overrides.getVoiceId ?? (() => 'en_US-ryan'),
    spawnFn,
    readDirFn: async () => VOICES,
    outputDir: async () => OUT,
    readBytesFn: async (path) => {
      const bytes = files.get(path)
      if (bytes === undefined) throw new Error(`ENOENT ${path}`)
      return bytes
    },
    removeFn: async (path) => {
      removed.push(path)
    },
    fallback: overrides.fallback ?? {
      synthesize: async (text) => {
        fallbackTexts.push(text)
        return new Uint8Array([9])
      },
    },
  })
  /** The child answers its last line: the WAV is written and its path reported, Python-style on stderr. */
  const answer = (child: FakeChild, name: string, bytes: Uint8Array, stream: 'stderr' | 'stdout' = 'stderr'): void => {
    const path = `${OUT}/${name}.wav`
    files.set(path, bytes)
    if (stream === 'stderr') child.stderr.write(`INFO:__main__:Wrote ${path}\n`)
    else child.stdout.write(`${path}\n`)
  }
  return { synth, children, args, removed, fallbackTexts, answer }
}

describe('persistent piper synthesizer', () => {
  it('serves two consecutive lines from one process, each its own delimited output (AC1)', async () => {
    const { synth, children, args, removed, answer } = makeSynth()

    const first = synth.synthesize('Hello there.')
    await flush()
    expect(children).toHaveLength(1)
    expect(args[0]).toEqual(['--model', '/voices/en_US-ryan-medium.onnx', '--config', '/voices/en_US-ryan-medium.onnx.json', '--output-dir', OUT])
    expect(children[0]!.lines).toEqual(['Hello there.'])
    answer(children[0]!, '1', new Uint8Array([1, 1]))
    expect(await first).toEqual(new Uint8Array([1, 1]))

    const second = synth.synthesize('General   Kenobi.\nYou are bold.')
    await flush()
    // A line is one line: inner newlines would split it into two outputs.
    expect(children[0]!.lines).toEqual(['Hello there.', 'General Kenobi. You are bold.'])
    answer(children[0]!, '2', new Uint8Array([2, 2]), 'stdout')
    expect(await second).toEqual(new Uint8Array([2, 2]))

    expect(children).toHaveLength(1)
    expect(synth.spawnCount?.()).toBe(1)
    await flush()
    expect(removed).toEqual([`${OUT}/1.wav`, `${OUT}/2.wav`])
  })

  it('serializes lines: the second is written only once the first has its output', async () => {
    const { synth, children, answer } = makeSynth()

    const first = synth.synthesize('One.')
    const second = synth.synthesize('Two.')
    await flush()
    expect(children[0]!.lines).toEqual(['One.'])
    answer(children[0]!, '1', new Uint8Array([1]))
    await first
    await flush()
    expect(children[0]!.lines).toEqual(['One.', 'Two.'])
    answer(children[0]!, '2', new Uint8Array([2]))
    expect(await second).toEqual(new Uint8Array([2]))
  })

  it('restarts a process that died between lines (AC1)', async () => {
    const { synth, children, answer } = makeSynth()

    const first = synth.synthesize('One.')
    await flush()
    answer(children[0]!, '1', new Uint8Array([1]))
    await first
    children[0]!.emit('close', 1)

    const second = synth.synthesize('Two.')
    await flush()
    expect(children).toHaveLength(2)
    expect(children[1]!.lines).toEqual(['Two.'])
    answer(children[1]!, '2', new Uint8Array([2]))
    expect(await second).toEqual(new Uint8Array([2]))
    expect(synth.spawnCount?.()).toBe(2)
  })

  it('retries a line once on a restarted process when the process dies under it (AC1)', async () => {
    const { synth, children, answer } = makeSynth()

    const first = synth.synthesize('One.')
    await flush()
    answer(children[0]!, '1', new Uint8Array([1]))
    await first

    const second = synth.synthesize('Two.')
    await flush()
    children[0]!.stderr.write('Segmentation fault\n')
    children[0]!.emit('close', 139)
    await flush()
    expect(children).toHaveLength(2)
    expect(children[1]!.lines).toEqual(['Two.'])
    answer(children[1]!, '2', new Uint8Array([2]))
    expect(await second).toEqual(new Uint8Array([2]))
  })

  it('fails a line its retry also dies under, and keeps the persistent route for the next line', async () => {
    const { synth, children, fallbackTexts, answer } = makeSynth()

    const first = synth.synthesize('One.')
    await flush()
    answer(children[0]!, '1', new Uint8Array([1]))
    await first

    const poison = synth.synthesize('Poison.')
    await flush()
    children[0]!.emit('close', 139)
    await flush()
    children[1]!.emit('close', 139)
    await expect(poison).rejects.toThrow('piper exited with code 139')

    const next = synth.synthesize('Three.')
    await flush()
    expect(children).toHaveLength(3)
    answer(children[2]!, '3', new Uint8Array([3]))
    expect(await next).toEqual(new Uint8Array([3]))
    expect(fallbackTexts).toEqual([])
  })

  it('falls back without spawning again when the prefetched process could not start', async () => {
    const { synth, children, fallbackTexts } = makeSynth()
    ;(synth as SpeechSynthesizer & { prefetch(): void }).prefetch()
    await flush()
    children[0]!.emit('error', new Error('spawn piper ENOENT'))

    expect(await synth.synthesize('One.')).toEqual(new Uint8Array([9]))
    expect(children).toHaveLength(1)
    expect(fallbackTexts).toEqual(['One.'])
  })

  it('falls back to the per-line spawn with no error when the process cannot start (AC1)', async () => {
    const { synth, children, fallbackTexts } = makeSynth()

    const first = synth.synthesize('One.')
    await flush()
    children[0]!.emit('error', new Error('spawn piper ENOENT'))
    expect(await first).toEqual(new Uint8Array([9]))

    // And stays there: no further process is spawned.
    expect(await synth.synthesize('Two.')).toEqual(new Uint8Array([9]))
    expect(fallbackTexts).toEqual(['One.', 'Two.'])
    expect(children).toHaveLength(1)
  })

  it('falls back when the process exits before it serves its first line — a piper without --output-dir', async () => {
    const { synth, children, fallbackTexts } = makeSynth()

    const first = synth.synthesize('One.')
    await flush()
    children[0]!.stderr.write('error: unrecognized arguments: --output-dir\n')
    children[0]!.emit('close', 2)
    expect(await first).toEqual(new Uint8Array([9]))
    expect(fallbackTexts).toEqual(['One.'])
  })

  it('swaps the process at the next line when the voice changes', async () => {
    let voice = 'en_US-ryan'
    const { synth, children, args, answer } = makeSynth({ getVoiceId: () => voice })

    const first = synth.synthesize('One.')
    await flush()
    answer(children[0]!, '1', new Uint8Array([1]))
    await first

    voice = 'en_GB-alan'
    const second = synth.synthesize('Two.')
    await flush()
    expect(children[0]!.killed).toBe(true)
    expect(children).toHaveLength(2)
    expect(args[1]![1]).toBe('/voices/en_GB-alan-medium.onnx')
    answer(children[1]!, '2', new Uint8Array([2]))
    expect(await second).toEqual(new Uint8Array([2]))
  })

  it('prefetch starts the process before the first line, which then reuses it', async () => {
    const { synth, children, answer } = makeSynth()
    const prefetching = synth as SpeechSynthesizer & { prefetch(): void }

    prefetching.prefetch()
    await flush()
    expect(children).toHaveLength(1)
    expect(children[0]!.lines).toEqual([])

    const line = synth.synthesize('One.')
    await flush()
    expect(children).toHaveLength(1)
    answer(children[0]!, '1', new Uint8Array([1]))
    expect(await line).toEqual(new Uint8Array([1]))
  })

  it('rejects with a descriptive error when the voice is not installed', async () => {
    const { synth } = makeSynth({ getVoiceId: () => 'de_DE-thorsten' })
    await expect(synth.synthesize('hi')).rejects.toThrow("piper voice 'de_DE-thorsten' not found in /voices")
  })
})
