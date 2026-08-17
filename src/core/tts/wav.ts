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
