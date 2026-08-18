import { spawn as nodeSpawn } from 'node:child_process'
import type { WakeWordDetector } from '../../core/ports/wake'
import { assertWakeChunk } from '../../core/ports/wake'

/**
 * Python sidecar fallback: the reference openwakeword implementation running
 * in a spawned python3, behind the same WakeWordDetector seam as the ONNX
 * port — the swap is config-only (BINGBONG_WAKE_ENGINE=python). The
 * reference scores one model per process, so the sidecar drives the wake
 * head only; the abort/holdOn heads report 0 on this engine (the node
 * engine runs all three). The process is lazily spawned on the first
 * score; a dead sidecar rejects score() (the session shows it and drops
 * the ear), never crashes the app.
 *
 * Wire protocol (both directions): 4-byte LE length (type byte + payload),
 * 1 type byte, payload. Node→Python: 0 = audio (s16le PCM), 1 = reset.
 * Python→Node: 0 = score (ASCII float), 1 = error (ASCII message).
 */

const MSG_AUDIO = 0
const MSG_RESET = 1
const MSG_SCORE = 0
const MSG_ERROR = 1

export interface CreatePythonWakeDetectorDeps {
  pythonBin: string
  scriptPath: string
  /** The "bing bong" head; the reference sidecar scores no interrupt heads. */
  wakeModelPath: string
  /** Injectable for tests; defaults to child_process.spawn. */
  spawnFn?: typeof nodeSpawn
}

interface PendingScore {
  resolve(score: number): void
  reject(err: Error): void
}

export function createPythonWakeDetector(deps: CreatePythonWakeDetectorDeps): WakeWordDetector {
  const spawnFn = deps.spawnFn ?? nodeSpawn

  let child: ReturnType<typeof nodeSpawn> | null = null
  let dead: Error | null = null
  let stdoutBuffer = Buffer.alloc(0)
  let pending: PendingScore[] = []
  // One outstanding chunk at a time keeps score↔response pairing trivial.
  let chain: Promise<unknown> = Promise.resolve()

  function failAll(err: Error): void {
    dead ??= err
    const waiting = pending
    pending = []
    for (const score of waiting) score.reject(dead)
  }

  function handleFrame(type: number, payload: Buffer): void {
    if (type === MSG_SCORE) {
      const score = pending.shift()
      score?.resolve(Number.parseFloat(payload.toString('ascii')))
      return
    }
    if (type === MSG_ERROR) {
      const message = payload.toString('utf8')
      const score = pending.shift()
      if (score) score.reject(new Error(message))
      else failAll(new Error(message))
    }
  }

  function handleStdout(chunk: Buffer): void {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])
    for (;;) {
      if (stdoutBuffer.length < 5) return
      const length = stdoutBuffer.readUInt32LE(0)
      if (stdoutBuffer.length < 4 + length) return
      const type = stdoutBuffer.readUInt8(4)
      const payload = stdoutBuffer.subarray(5, 4 + length)
      stdoutBuffer = stdoutBuffer.subarray(4 + length)
      handleFrame(type, payload)
    }
  }

  function ensureChild(): ReturnType<typeof nodeSpawn> {
    if (dead) throw dead
    if (child) return child

    const spawned = spawnFn(deps.pythonBin, ['-u', deps.scriptPath, '--model', deps.wakeModelPath])
    child = spawned
    let stderrTail = ''
    spawned.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })
    spawned.stdout?.on('data', handleStdout)
    // Writing to a dead sidecar's stdin must not crash on EPIPE.
    spawned.stdin?.on('error', () => {})
    spawned.on('error', (err) => failAll(new Error(`wake sidecar failed to start: ${err.message}`)))
    spawned.on('close', (code) => {
      if (code === 0 && dead === null) return
      const detail = stderrTail.trim()
      failAll(new Error(`wake sidecar exited${code === null ? '' : ` with code ${String(code)}`}${detail === '' ? '' : `: ${detail}`}`))
    })
    return spawned
  }

  function writeFrameTo(target: ReturnType<typeof nodeSpawn>, type: number, payload: Buffer): void {
    const frame = Buffer.alloc(5 + payload.length)
    frame.writeUInt32LE(1 + payload.length, 0)
    frame.writeUInt8(type, 4)
    payload.copy(frame, 5)
    target.stdin?.write(frame)
  }

  function toS16le(chunk: Float32Array): Buffer {
    const pcm = Buffer.alloc(chunk.length * 2)
    for (let i = 0; i < chunk.length; i++) {
      const scaled = Math.round(chunk[i] * 32767)
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, scaled)), i * 2)
    }
    return pcm
  }

  return {
    async score(chunk) {
      assertWakeChunk(chunk)
      const spawned = ensureChild()
      const pcm = toS16le(chunk)
      const wake = await new Promise<number>((resolve, reject) => {
        // Pending is registered synchronously — response frames pair FIFO with
        // score() calls, and a fast sidecar can answer before the write chain runs.
        pending.push({ resolve, reject })
        chain = chain.then(() => {
          // A dead sidecar already rejected every pending score via failAll.
          if (dead) return
          writeFrameTo(spawned, MSG_AUDIO, pcm)
        })
      })
      return { wake, abort: 0, holdOn: 0 }
    },

    reset() {
      if (dead || !child) return
      writeFrameTo(child, MSG_RESET, Buffer.alloc(0))
    },
  }
}
