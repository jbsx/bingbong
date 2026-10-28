import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { AudioPlayer, AudioStream, AudioStreamPlayer } from '../../core/ports/tts'
import { parseWav, type ParsedWav } from '../../core/tts/wav'

export interface AplayPlayerDeps {
  /** Default 'aplay' (PATH). */
  bin?: string
  /** ALSA device (`-D`); default aplay's own. 'null' plays nothing, for a run off screen. */
  device?: string
  /** The Sound Mute, read at each aplay's start: while it holds, the audio goes to 'null'. */
  muted?: () => boolean
  spawnFn?: typeof nodeSpawn
  /** Monotonic ms, for where a stream is when its gain changes (#490); default performance.now. */
  now?: () => number
}

type Format = Omit<ParsedWav, 'pcm'>

/** One aplay of a stream, in one format: the child once started, every sample written to it, and where its child began in them. */
interface Segment {
  readonly format: Format
  child: ChildProcess | null
  /** Every sample of the segment, at its own level. */
  readonly pcm: Uint8Array[]
  /** The bytes of `pcm` before the running child's first: a gain change starts a child partway in (#490). */
  offset: number
  /** When the running child was started. */
  startedAt: number
  /** Settles when the segment's last child closes. */
  readonly closed: Promise<void>
  settle(error?: Error): void
}

const sameFormat = (a: Format, b: Format): boolean =>
  a.sampleRate === b.sampleRate && a.channels === b.channels && a.bitsPerSample === b.bitsPerSample

/** The samples at `gain` of their level: s16 only, the format piper writes; another plays at its own level. */
function scaled(pcm: Uint8Array, format: Format, gain: number): Uint8Array {
  if (gain === 1 || format.bitsPerSample !== 16) return pcm
  const out = new Uint8Array(pcm.length)
  const from = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const to = new DataView(out.buffer)
  for (let at = 0; at + 1 < pcm.length; at += 2) to.setInt16(at, Math.round(from.getInt16(at, true) * gain), true)
  return out
}

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
  const now = deps.now ?? (() => performance.now())
  const bin = deps.bin ?? 'aplay'
  const deviceArgs = (): string[] => (deps.muted?.() ? ['-D', 'null'] : deps.device ? ['-D', deps.device] : [])

  /** One aplay child: resolves on its close, rejects on a failure unless it was stopped. */
  function startChild(args: string[], isStopped: () => boolean): { child: ChildProcess; closed: Promise<void> } {
    const child = spawnFn(bin, [...deviceArgs(), ...args])
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
      /** The share of its level the stream plays at (#490). */
      let gain = 1
      /** The aplay taking samples now. */
      let segment: Segment | null = null
      let segments = 0
      let tail: Promise<void> = Promise.resolve()
      const children: ChildProcess[] = []
      let resolveDone!: () => void
      let rejectDone!: (error: Error) => void
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      })

      /** A child for the segment, fed its samples from `offset` at the gain now; the one before it, if any, is let go. */
      function startSegmentChild(current: Segment, offset: number): void {
        const { child, closed } = startChild(rawArgs(current.format), () => stopped || current.child !== child)
        children.push(child)
        current.child = child
        current.offset = offset
        current.startedAt = now()
        let skip = offset
        for (const pcm of current.pcm) {
          if (skip >= pcm.length) {
            skip -= pcm.length
            continue
          }
          child.stdin!.write(scaled(skip === 0 ? pcm : pcm.subarray(skip), current.format, gain))
          skip = 0
        }
        if (ended || segment !== current) child.stdin!.end()
        // Only the segment's last child settles it: one let go for a gain change says nothing.
        closed.then(
          () => {
            if (current.child === child) current.settle()
          },
          (error: Error) => {
            if (current.child === child) current.settle(error)
          },
        )
      }

      /** Start a segment's aplay behind the ones before it, and feed it what was written meanwhile. */
      function begin(format: Format, first: Uint8Array): void {
        let settle!: (error?: Error) => void
        const closed = new Promise<void>((resolve, reject) => {
          settle = (error) => (error === undefined ? resolve() : reject(error))
        })
        const current: Segment = { format, child: null, pcm: [first], offset: 0, startedAt: 0, closed, settle }
        segment = current
        const launch = (): Promise<void> => {
          if (stopped) return Promise.resolve()
          startSegmentChild(current, 0)
          return closed
        }
        segments += 1
        // The first aplay starts at once; a later one waits for the one before it to drain.
        tail = segments === 1 ? launch() : tail.then(launch)
        // An aplay that fails before end() is reported through done there; until then the failure is held, never unhandled.
        tail.catch(() => {})
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
            segment.pcm.push(pcm)
            segment.child?.stdin!.write(scaled(pcm, format, gain))
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
        setGain(next) {
          if (stopped || next === gain) return
          gain = next
          // The rest of the sound playing now is played again from where it is, at the new level: a segment still
          // waiting its turn takes the gain as it starts. Where it is is read off the clock, so a restart may repeat
          // the few ms aplay took to start.
          const current = segment
          const old = current?.child
          if (current == null || old == null || current.format.bitsPerSample !== 16) return
          const frame = (current.format.bitsPerSample / 8) * current.format.channels
          const total = current.pcm.reduce((sum, pcm) => sum + pcm.length, 0)
          const played = Math.floor(((now() - current.startedAt) / 1000) * current.format.sampleRate) * frame
          const at = Math.min(total, current.offset + played)
          old.stdin!.end()
          old.kill()
          startSegmentChild(current, at)
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
