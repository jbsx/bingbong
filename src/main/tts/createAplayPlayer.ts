import { spawn as nodeSpawn } from 'node:child_process'
import type { AudioPlayer } from '../../core/ports/tts'

export interface AplayPlayerDeps {
  /** Default 'aplay' (PATH). */
  bin?: string
  spawnFn?: typeof nodeSpawn
}

/** Plays WAV audio by piping it to aplay; stop() SIGTERMs the child. */
export function createAplayPlayer(deps: AplayPlayerDeps = {}): AudioPlayer {
  const spawnFn = deps.spawnFn ?? nodeSpawn
  const bin = deps.bin ?? 'aplay'

  return {
    play(wav) {
      const child = spawnFn(bin, ['-q', '-'])
      let stopped = false

      const done = new Promise<void>((resolve, reject) => {
        child.on('error', (err) => {
          if (stopped) resolve()
          else reject(new Error(`failed to start player at '${bin}': ${err.message}`))
        })
        child.on('close', (code) => {
          if (stopped || code === 0) resolve()
          else reject(new Error(`aplay exited with code ${String(code)}`))
        })
      })

      // aplay closing stdin early (or dying) must not crash on EPIPE.
      child.stdin.on('error', () => {})
      child.stdin.write(wav)
      child.stdin.end()

      return {
        done,
        stop() {
          stopped = true
          child.kill()
        },
      }
    },
  }
}
