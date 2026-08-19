// The read side of the utterance-dump artifact (#34): canonical 16 kHz mono
// s16le PCM WAVs. Mirrors the scanning `pcmFromWav` that
// scripts/measure-stt-latency.mjs keeps in its .mjs body — the same bytes,
// now in a tested home the #39 A/B harness replays dumps from. Dev tool only.

export function readUtteranceWavPcm(bytes: Uint8Array): Float32Array {
  let dataOffset = -1
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x64 && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x61) {
      dataOffset = i // 'data'
      break
    }
  }
  if (dataOffset < 0) throw new Error('no data chunk in WAV bytes')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = new Float32Array(Math.floor((bytes.length - dataOffset - 8) / 2))
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(dataOffset + 8 + i * 2, true) / 32_768
  return samples
}
