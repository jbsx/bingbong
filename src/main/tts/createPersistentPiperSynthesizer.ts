import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SpeechSynthesizer } from '../../core/ports/tts'
import { DEFAULT_PIPER_SAMPLE_RATE } from '../../core/tts/piperVoices'
import { wrapRawPcmAsWav } from '../../core/tts/wav'
import { reportFault } from '../../core/trace/fault'
import { resolvePiperVoice } from './createPiperSynthesizer'

export interface PersistentPiperDeps {
  bin: string
  voicesDir: string
  /** Resolved per line: a changed voice swaps the process at the next line. */
  getVoiceId(): string
  /** What a line falls back to when the persistent process cannot start: the per-line spawn. */
  fallback: SpeechSynthesizer
  spawnFn?: typeof nodeSpawn
  readDirFn?: (dir: string) => Promise<string[]>
  /** Where piper writes its WAVs; a fresh temp dir by default. */
  outputDir?: () => Promise<string>
  readBytesFn?: (path: string) => Promise<Uint8Array>
  removeFn?: (path: string) => Promise<void>
  /** How long one line may take before its process is taken for hung. */
  lineTimeoutMs?: number
}

/** A persistent synthesizer can start its process before the first line. */
export interface PersistentPiperSynthesizer extends SpeechSynthesizer {
  /** Start the process for the current voice now, so the first line pays no model load. */
  prefetch(): void
}

const LINE_TIMEOUT_MS = 20_000

/** A voice's model and config, as the voices dir resolves it. */
type PiperVoice = Awaited<ReturnType<typeof resolvePiperVoice>>

interface PiperProcess {
  readonly child: ChildProcess
  readonly modelPath: string
  alive: boolean
  waiting: { resolve(path: string): void; reject(error: Error): void } | null
  /** The end of what it said on stderr, for the error when it dies. */
  stderrTail: string
}

/** Calls `onLine` with each complete line a stream emits. */
function onLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffered = ''
  stream.on('data', (chunk: Buffer | string) => {
    buffered += chunk.toString()
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  })
}

/**
 * One piper per voice that stays up (#327, ADR 0076): `--output-dir` mode,
 * one WAV per stdin line, each path reported as piper finishes it — the
 * Python piper logs `Wrote <path>` on stderr, the C++ piper prints the path
 * on stdout; either is read as the line's delimiter. Lines are written one
 * at a time. A process that dies is restarted at the next line, and a line
 * it died under is retried once on the new one. A process that dies before
 * any piper here has answered a line could not start — no piper, or one
 * without `--output-dir` — and every line from then on goes to the per-line
 * spawn, with no error surfaced. The process exits with the app: its stdin
 * closes.
 */
export function createPersistentPiperSynthesizer(deps: PersistentPiperDeps): PersistentPiperSynthesizer {
  const spawnFn = deps.spawnFn ?? nodeSpawn
  const readDirFn = deps.readDirFn ?? ((dir: string) => readdir(dir))
  const readBytesFn = deps.readBytesFn ?? (async (path: string) => new Uint8Array(await readFile(path)))
  const removeFn = deps.removeFn ?? ((path: string) => rm(path, { force: true }))
  const lineTimeoutMs = deps.lineTimeoutMs ?? LINE_TIMEOUT_MS
  let outputDir: Promise<string> | null = null
  let piper: PiperProcess | null = null
  /** The persistent process could not start: the per-line spawn speaks from here on. */
  let fallenBack = false
  /** Lines any piper here has answered: until the first, a process that dies could not start; after it, one that dies crashed. */
  let answered = 0
  let spawns = 0
  // Lines run one at a time: piper answers them in order, one path each.
  let chain: Promise<unknown> = Promise.resolve()

  const dirOf = (): Promise<string> => {
    outputDir ??= deps.outputDir?.() ?? mkdtemp(join(tmpdir(), 'bingbong-piper-'))
    return outputDir
  }

  function start(voice: PiperVoice, dir: string): PiperProcess {
    spawns += 1
    const child = spawnFn(deps.bin, ['--model', voice.modelPath, '--config', voice.configPath, '--output-dir', dir])
    const proc: PiperProcess = { child, modelPath: voice.modelPath, alive: true, waiting: null, stderrTail: '' }
    const die = (error: Error): void => {
      proc.alive = false
      const waiting = proc.waiting
      proc.waiting = null
      waiting?.reject(error)
    }
    /** A line piper printed that names a WAV in the output dir answers the line it was given. */
    const takeWavPath = (line: string): void => {
      const at = line.indexOf(dir)
      const path = at === -1 ? '' : line.slice(at).trim()
      if (!path.endsWith('.wav')) return
      const waiting = proc.waiting
      proc.waiting = null
      waiting?.resolve(path)
    }
    onLines(child.stdout!, takeWavPath)
    onLines(child.stderr!, (line) => {
      takeWavPath(line)
      proc.stderrTail = `${proc.stderrTail}\n${line}`.slice(-400)
    })
    child.on('error', (err) => die(new Error(`failed to start piper at '${deps.bin}': ${err.message}`)))
    child.on('close', (code) => {
      const detail = proc.stderrTail.trim()
      die(new Error(`piper exited with code ${String(code)}${detail === '' ? '' : `: ${detail}`}`))
    })
    // A dying piper closes our stdin early; the close event reports the real error.
    child.stdin!.on('error', () => {})
    return proc
  }

  /** The live process for this voice: the one running, else a new one, the old voice's killed. */
  function processFor(voice: PiperVoice, dir: string): PiperProcess {
    if (piper !== null && piper.alive && piper.modelPath === voice.modelPath) return piper
    if (piper !== null && piper.alive) {
      piper.alive = false
      piper.child.kill()
    }
    piper = start(voice, dir)
    return piper
  }

  /** Write one line and wait for the path of its WAV. */
  function renderLine(proc: PiperProcess, line: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!proc.alive) {
        reject(new Error('piper is not running'))
        return
      }
      const timer = setTimeout(() => {
        proc.waiting = null
        proc.alive = false
        proc.child.kill()
        reject(new Error(`piper gave no output within ${lineTimeoutMs} ms`))
      }, lineTimeoutMs)
      proc.waiting = {
        resolve: (path) => {
          clearTimeout(timer)
          resolve(path)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      }
      proc.child.stdin!.write(`${line}\n`)
    })
  }

  /** The persistent process could not start: this line and every one after it go to the per-line spawn. */
  function fallBack(text: string, error: unknown): Promise<Uint8Array> {
    reportFault('tts.createPersistentPiperSynthesizer.start', error)
    fallenBack = true
    return deps.fallback.synthesize(text)
  }

  async function synthesizeLine(text: string): Promise<Uint8Array> {
    if (fallenBack) return deps.fallback.synthesize(text)
    const spoken = text.replace(/\s+/g, ' ').trim()
    // piper skips a blank line and would never answer it.
    if (spoken === '') return wrapRawPcmAsWav(new Uint8Array(0), DEFAULT_PIPER_SAMPLE_RATE)
    const voice = await resolvePiperVoice(deps.voicesDir, deps.getVoiceId(), readDirFn)
    const dir = await dirOf()
    // The prefetched process already died, and no piper has ever answered: it could not start.
    if (piper !== null && !piper.alive && answered === 0) return fallBack(text, new Error('the prefetched piper exited before its first line'))
    for (let attempt = 0; ; attempt++) {
      const proc = processFor(voice, dir)
      let path: string
      try {
        path = await renderLine(proc, spoken)
      } catch (error) {
        if (answered === 0) {
          if (proc.alive) proc.child.kill()
          return fallBack(text, error)
        }
        // A piper that has worked here crashed: restarted for one retry, then the line fails.
        if (attempt >= 1) throw error
        continue
      }
      answered += 1
      const bytes = await readBytesFn(path)
      void removeFn(path).catch((error: unknown) => reportFault('tts.createPersistentPiperSynthesizer.remove', error))
      return bytes
    }
  }

  return {
    synthesize(text) {
      const run = chain.then(() => synthesizeLine(text))
      chain = run.catch(() => {})
      return run
    },
    spawnCount: () => spawns + (fallenBack ? (deps.fallback.spawnCount?.() ?? 0) : 0),
    prefetch() {
      const run = chain.then(async () => {
        if (fallenBack) return
        processFor(await resolvePiperVoice(deps.voicesDir, deps.getVoiceId(), readDirFn), await dirOf())
      })
      chain = run.catch((error: unknown) => reportFault('tts.createPersistentPiperSynthesizer.prefetch', error))
    },
  }
}
