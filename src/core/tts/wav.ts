// Piper's `--output-raw` emits headerless s16le mono PCM; players like aplay
// read a canonical WAV from stdin, so wrap the PCM in a 44-byte header.

const HEADER_BYTES = 44

export function wrapRawPcmAsWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const wav = new Uint8Array(HEADER_BYTES + pcm.length)
  const view = new DataView(wav.buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i)
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcm.length, true)
  wav.set(pcm, HEADER_BYTES)

  return wav
}

export interface ParsedWav {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** The samples, without the header. */
  pcm: Uint8Array
}

/**
 * The format and samples of a PCM WAV (#327): the stream player writes a
 * spoken text's sentences into one raw-PCM aplay, so each sentence's header
 * is read off and its samples passed on. Chunks before `data` are skipped.
 * Null for bytes that are not a RIFF/WAVE file with `fmt ` and `data`.
 */
export function parseWav(wav: Uint8Array): ParsedWav | null {
  if (wav.length < 12) return null
  const ascii = (offset: number): string => String.fromCharCode(...wav.subarray(offset, offset + 4))
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') return null
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  let format: Omit<ParsedWav, 'pcm'> | null = null
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = ascii(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= wav.length) {
      format = { sampleRate: view.getUint32(body + 4, true), channels: view.getUint16(body + 2, true), bitsPerSample: view.getUint16(body + 14, true) }
    } else if (id === 'data') {
      return format === null ? null : { ...format, pcm: wav.subarray(body, Math.min(wav.length, body + size)) }
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2)
  }
  return null
}
