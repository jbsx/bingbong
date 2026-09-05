// Opt-in utterance audio dumps (#34): behind the established env-flag
// pattern, each detected utterance the endpointer emits is written as a
// 16 kHz mono 16-bit WAV — exactly the artifact shape the offline STT
// latency benchmark (scripts/measure-stt-latency.mjs) consumes — so STT
// changes can be A/B-ed offline against real utterances. Off by default:
// this is a benchmarking tap, not an always-on recorder. Dumps must never
// become the voice pipeline's problem — every write failure is swallowed.

import { envFlagEnabled } from '../perf/envFlag.ts'
import { reportFault } from '../trace/fault.ts'

/** Env opt-in for utterance audio dumps (#34): `BINGBONG_AUDIO_DUMP=1`. */
export const AUDIO_DUMP_ENV = 'BINGBONG_AUDIO_DUMP'

export function audioDumpEnabled(env: Record<string, string | undefined>): boolean {
  return envFlagEnabled(env, AUDIO_DUMP_ENV)
}

/** The voice pipeline's one and only audio rate: Silero/Moonshine territory. */
export const WAV_SAMPLE_RATE = 16_000

/**
 * Canonical 44-byte RIFF/WAVE header + s16le samples: mono 16 kHz 16-bit PCM,
 * the exact artifact shape `scripts/measure-stt-latency.mjs` parses with its
 * `pcmFromWav` (find the `data` chunk, read `Int16LE / 32768`).
 */
export function encodeUtteranceWav(pcm: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, WAV_SAMPLE_RATE, true)
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(44 + i * 2, Math.round(clamped * 32_767), true)
  }
  return bytes
}

/** The filesystem seam: the main process supplies Node fs, tests a fake. */
export interface UtteranceDumpWriter {
  /** Creates the dumps dir; called once before the first write (idempotent). */
  mkdir(dir: string): void
  writeFile(path: string, bytes: Uint8Array): void
}

export interface UtteranceDumper {
  /** Writes one utterance as a WAV; never throws — dumps are advisory. */
  dump(pcm: Float32Array): void
}

/**
 * One dumper per app. Files are named `utterance-<wall-ms>-<seq>.wav` —
 * the timestamp orders dumps across runs, the per-boot sequence disambiguates
 * same-millisecond utterances. With the flag off (the default) the writer
 * is never touched, not even for the directory.
 */
export function createUtteranceDumper(deps: {
  dir: string
  writer: UtteranceDumpWriter
  enabled?: boolean
  /** Wall clock for file naming (tests fake it). */
  now?: () => number
}): UtteranceDumper {
  const enabled = deps.enabled ?? false
  const now = deps.now ?? (() => Date.now())
  let sequence = 0
  let dirReady = false
  let broken = false

  return {
    dump(pcm) {
      if (!enabled || broken) return
      sequence += 1
      try {
        if (!dirReady) {
          deps.writer.mkdir(deps.dir)
          dirReady = true
        }
        deps.writer.writeFile(`${deps.dir}/utterance-${now()}-${String(sequence).padStart(4, '0')}.wav`, encodeUtteranceWav(pcm))
      } catch (error) {
        reportFault('voice.utteranceDump.dump', error)
        // A failed dump must never break the turn it records. A dir that
        // could not be created stays dead for the whole boot (a dead dumps
        // dir degrades to a no-op, like the perf sink's dead logs dir);
        // a failed file write is retried on the next utterance.
        if (!dirReady) {
          broken = true
          sequence = 0
        }
      }
    },
  }
}
