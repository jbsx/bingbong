import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { AudioPlayer, AudioStream, AudioStreamPlayer } from '../../core/ports/tts'
import { parseWav, type ParsedWav } from '../../core/tts/wav'

export interface AplayPlayerDeps {
  /** Default 'aplay' (PATH). */
  bin?: string
  spawnFn?: typeof nodeSpawn
}

type Format = Omit<ParsedWav, 'pcm'>

const sameFormat = (a: Format, b: Format): boolean =>
  a.sampleRate === b.sampleRate && a.channels === b.channels && a.bitsPerSample === b.bitsPerSample

/** aplay's raw-input arguments for a PCM format. */
function rawArgs(format: Format): string[] {
  const sampleFormat = format.bitsPerSample === 8 ? 'U8' : `S${format.bitsPerSample}_LE`
  return ['-q', '-t', 'raw', '-f', sampleFormat, '-c', String(format.channels), '-r', String(format.sampleRate), '-']
}

/**
 * Plays WAV audio by piping it to aplay; stop() SIGTERMs the child. A
 * stream (#327) is one aplay reading raw PCM: each sentence's WAV header is
 * read off and its samples written after the last sentence's, so a spoken
 * text plays with no start gap between its sentences. A sentence in another
 * format — the voice changed mid-text — plays through a second aplay once
 * the first has drained.
 */
export function createAplayPlayer(deps: AplayPlayerDeps = {}): AudioPlayer & AudioStreamPlayer {
  const spawnFn = deps.spawnFn ?? nodeSpawn
  const bin = deps.bin ?? 'aplay'

  /** One aplay child: resolves on its close, rejects on a failure unless it was stopped. */
  function startChild(args: string[], isStopped: () => boolean): { child: ChildProcess; closed: Promise<void> } {
    const child = spawnFn(bin, args)
    const closed = new Promise<void>((resolve, reject) => {
      child.on('error', (err) => {
        if (isStopped()) resolve()
        else reject(new Error(`failed to start player at '${bin}': ${err.message}`))
      })
      child.on('close', (code) => {
        if (isStopped() || code === 0) resolve()
        else reject(new Error(`aplay exited with code ${String(code)}`))
      })
    })
    // aplay closing stdin early (or dying) must not crash on EPIPE.
    child.stdin!.on('error', () => {})
    return { child, closed }
  }

  return {
    play(wav) {
      let stopped = false
      const { child, closed } = startChild(['-q', '-'], () => stopped)
      child.stdin!.write(wav)
      child.stdin!.end()
      return {
        done: closed,
        stop() {
          stopped = true
          child.kill()
        },
      }
    },

    open(options = {}): AudioStream {
      let stopped = false
      let ended = false
      let heardFirst = false
      /** The aplay taking samples now, its format, and what it is waiting behind. */
      let segment: { format: Format; child: ChildProcess | null; pending: Uint8Array[] } | null = null
      let segments = 0
      let tail: Promise<void> = Promise.resolve()
      const children: ChildProcess[] = []
      let resolveDone!: () => void
      let rejectDone!: (error: Error) => void
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      })

      /** Start a segment's aplay behind the ones before it, and feed it what was written meanwhile. */
      function begin(format: Format, first: Uint8Array): void {
        const current: { format: Format; child: ChildProcess | null; pending: Uint8Array[] } = { format, child: null, pending: [first] }
        segment = current
        const launch = (): Promise<void> => {
          if (stopped) return Promise.resolve()
          const { child, closed } = startChild(rawArgs(format), () => stopped)
          children.push(child)
          current.child = child
          for (const pcm of current.pending.splice(0)) child.stdin!.write(pcm)
          if (ended || segment !== current) child.stdin!.end()
          return closed
        }
        segments += 1
        // The first aplay starts at once; a later one waits for the one before it to drain.
        tail = segments === 1 ? launch() : tail.then(launch)
      }

      /** The first sample handed to the device: reported once. */
      function handed(pcm: Uint8Array): void {
        if (heardFirst || pcm.length === 0) return
        heardFirst = true
        options.onFirstSample?.()
      }

      return {
        done,
        write(wav) {
          if (stopped || ended) return
          const parsed = parseWav(wav)
          if (parsed === null) return
          const { pcm, ...format } = parsed
          if (segment !== null && sameFormat(segment.format, format)) {
            if (segment.child === null) segment.pending.push(pcm)
            else segment.child.stdin!.write(pcm)
          } else {
            // A new format: the aplay before it gets no more samples.
            if (segment?.child) segment.child.stdin!.end()
            begin(format, pcm)
          }
          handed(pcm)
        },
        end() {
          if (ended) return
          ended = true
          if (segment === null) {
            resolveDone()
            return
          }
          segment.child?.stdin!.end()
          tail.then(resolveDone, rejectDone)
        },
        stop() {
          stopped = true
          for (const child of children) child.kill()
          resolveDone()
        },
      }
    },
  }
}
