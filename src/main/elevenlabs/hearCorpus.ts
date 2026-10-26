import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readUtteranceWavPcm } from '../../core/sttAb/utteranceWav.ts'
import { gateKeyterms, scoreDump, type SttCorpus, type SttGateRow } from '../../core/sttAb/sttGate.ts'
import { VAD_FRAME_SAMPLES } from '../../core/voice/vadEndpointing.ts'
import { createElevenLabsTranscriber } from './createElevenLabsTranscriber.ts'

// The STT gate's hearing (#471): each labelled dump through the cloud ear
// on a socket of its own, with the keyterms the gate names for it, the
// whole WAV pushed at once (the ear's words on a replayed dump are
// deterministic; the pacing is `pnpm stt:replay`'s, where latency is
// measured). A fault is the row's words, never a thrown run: the gate
// reads it as a miss and says which. Shared by `pnpm stt:gate` and the
// vitest corpus file.

export interface HearCorpusOptions {
  readonly apiKey: string
  readonly url?: string
  readonly dumpsDir: string
  readonly corpus: SttCorpus
  readonly heads: readonly string[]
  /** Only these dumps; absent, every labelled one. */
  readonly only?: readonly string[]
  /** Sockets open at once; the realtime API's concurrency is the tier's. */
  readonly concurrency?: number
  /** How long after the commit the ear is waited for; the app's 1.5 s is for a live line, a replay can wait. */
  readonly commitTimeoutMs?: number
  readonly onRow?: (row: SttGateRow) => void
}

/** One dump heard with one list of keyterms: the committed words, or `<fault: …>`. */
export async function hearDump(options: Pick<HearCorpusOptions, 'apiKey' | 'url' | 'commitTimeoutMs'>, pcm: Float32Array, keyterms: readonly string[]): Promise<string> {
  const ear = createElevenLabsTranscriber({
    apiKey: options.apiKey,
    ...(options.url !== undefined ? { url: options.url } : {}),
    keyterms: () => keyterms,
    commitTimeoutMs: options.commitTimeoutMs ?? 15_000,
  })
  ear.begin()
  // The frames the capture graph would push, without its pacing; what is left past the last whole frame rides finish()'s Endpoint.
  for (let offset = 0; offset + VAD_FRAME_SAMPLES <= pcm.length; offset += VAD_FRAME_SAMPLES) ear.push(pcm.subarray(offset, offset + VAD_FRAME_SAMPLES))
  try {
    return (await ear.finish(pcm)).trim()
  } catch (error) {
    return `<fault: ${error instanceof Error ? error.message : String(error)}>`
  }
}

/** Every labelled dump heard and scored, in the labels' order. */
export async function hearCorpus(options: HearCorpusOptions): Promise<SttGateRow[]> {
  const files = Object.keys(options.corpus.labels).filter((file) => options.only === undefined || options.only.includes(file))
  const rows: SttGateRow[] = new Array<SttGateRow>(files.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const at = next++
      const file = files[at]!
      const label = options.corpus.labels[file]!
      const pcm = readUtteranceWavPcm(await readFile(join(options.dumpsDir, file)))
      const heard = await hearDump(options, pcm, gateKeyterms(label, options.corpus, options.heads))
      rows[at] = scoreDump(file, label, heard)
      options.onRow?.(rows[at]!)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 3) }, worker))
  return rows
}
