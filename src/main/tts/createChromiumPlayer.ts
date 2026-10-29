import type { AudioPlayer, AudioStream, AudioStreamPlayer } from '../../core/ports/tts'
import { parseWav, type ParsedWav } from '../../core/tts/wav'

/** A PCM format, as a WAV's header names it. */
export type PcmFormat = Omit<ParsedWav, 'pcm'>

/**
 * The page the app's voice plays in through Chromium (#490,
 * speechSurface.ts), one numbered stream at a time: calls reach it in the
 * order they are made.
 */
export interface SpeechSurface {
  /** A stream; `first` settles once its first samples are handed to the graph (true) or it ended with none (false), `done` once it has played out or was stopped. */
  open(id: number, silent: boolean): { first: Promise<boolean>; done: Promise<void> }
  /** One sentence's samples, played right after the stream's last. */
  write(id: number, format: PcmFormat, pcm: Uint8Array): void
  /** No more samples: `done` settles once the last has played. */
  end(id: number): void
  /** What is left plays from now at this share of its level. */
  gain(id: number, value: number): void
  /** Cut at once: `done` settles. */
  stop(id: number): void
}

export interface ChromiumPlayerDeps {
  surface: SpeechSurface
  /** aplay's device, as piperConfig resolves it: 'null' plays nothing, for a run off screen. */
  device?: string
  /** The Sound Mute, read at each stream's start, as aplay reads it at each aplay's: while it holds, the stream plays to no device. */
  muted?: () => boolean
  /** How long past its sound a stream may take to say it is done before it is taken as failed; default 5 s. */
  graceMs?: number
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

const DEFAULT_GRACE_MS = 5000

/** How long PCM in `format` sounds, in ms. */
function soundMs(format: PcmFormat, bytes: number): number {
  const perSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8)
  return perSecond > 0 ? (bytes / perSecond) * 1000 : 0
}

/**
 * Plays the app's voice through Chromium (#490), so the mic's echo
 * canceller has it as its reference: the same contract as the aplay player
 * (createAplayPlayer.ts) over a page that plays WebAudio. A stream is one
 * schedule of sentences with no gap between them; a sentence in another
 * format simply plays at its own rate. `onFirstSample` fires when the page
 * has the first samples scheduled, the moment aplay's fires when they are
 * written to its stdin. A stream whose page never says it is done — a
 * window gone mid-line — fails once its sound and a grace have passed, so
 * no line is left speaking forever.
 */
export function createChromiumPlayer(deps: ChromiumPlayerDeps): AudioPlayer & AudioStreamPlayer {
  const { surface } = deps
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS
  const setTimeoutFn = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let nextId = 0
  const silent = (): boolean => deps.device === 'null' || deps.muted?.() === true

  function open(options: { onFirstSample?: () => void } = {}): AudioStream {
    const id = ++nextId
    const page = surface.open(id, silent())
    let stopped = false
    let ended = false
    let wrote = false
    let soundTotalMs = 0
    let watchdog: unknown = null
    let resolveDone!: () => void
    let rejectDone!: (error: Error) => void
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    })
    const settle = (error?: Error): void => {
      if (watchdog !== null) clearTimeoutFn(watchdog)
      watchdog = null
      if (error === undefined || stopped) resolveDone()
      else rejectDone(error)
    }
    page.first.then(
      (started) => {
        if (started && !stopped) options.onFirstSample?.()
      },
      () => {},
    )
    page.done.then(
      () => settle(),
      (error: unknown) => settle(new Error(`the speech page failed: ${error instanceof Error ? error.message : String(error)}`)),
    )
    return {
      done,
      write(wav) {
        if (stopped || ended) return
        const parsed = parseWav(wav)
        if (parsed === null || parsed.pcm.length === 0) return
        const { pcm, ...format } = parsed
        wrote = true
        soundTotalMs += soundMs(format, pcm.length)
        surface.write(id, format, pcm)
      },
      end() {
        if (ended || stopped) return
        ended = true
        surface.end(id)
        // From here the page plays at most what was written: one that never answers has gone.
        watchdog = setTimeoutFn(() => {
          watchdog = null
          rejectDone(new Error('the speech page never finished the line'))
        }, (wrote ? soundTotalMs : 0) + graceMs)
      },
      setGain(value) {
        if (stopped) return
        surface.gain(id, value)
      },
      stop() {
        if (stopped) return
        stopped = true
        surface.stop(id)
        settle()
      },
    }
  }

  return {
    play(wav) {
      const stream = open()
      stream.write(wav)
      stream.end()
      return { done: stream.done, stop: () => stream.stop() }
    },
    open,
  }
}
