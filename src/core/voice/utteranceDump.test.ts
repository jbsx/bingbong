import { describe, expect, it } from 'vitest'
import { AUDIO_DUMP_ENV, audioDumpEnabled, createUtteranceDumper, encodeUtteranceWav } from './utteranceDump'

// Opt-in utterance audio dumps (#34): behind BINGBONG_AUDIO_DUMP, each
// detected utterance is written as a 16 kHz mono WAV — the artifact shape
// scripts/measure-stt-latency.mjs consumes — for A/B-ing STT changes
// offline. Off by default; it is a benchmarking tap, not a recorder.

/** The benchmark script's own WAV reader (scripts/measure-stt-latency.mjs). */
function pcmFromWav(buffer: Uint8Array): Float32Array {
  let dataOffset = -1
  for (let i = 0; i <= buffer.length - 4; i++) {
    if (buffer[i] === 0x64 && buffer[i + 1] === 0x61 && buffer[i + 2] === 0x74 && buffer[i + 3] === 0x61) {
      dataOffset = i // 'data'
      break
    }
  }
  if (dataOffset < 0) throw new Error('no data chunk')
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const samples = new Float32Array(Math.floor((buffer.length - dataOffset - 8) / 2))
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(dataOffset + 8 + i * 2, true) / 32768
  return samples
}

describe('audioDumpEnabled', () => {
  it.each(['1', 'true', 'yes', 'on', 'TRUE', 'Yes'])('enables for %s', (value) => {
    expect(audioDumpEnabled({ [AUDIO_DUMP_ENV]: value })).toBe(true)
  })

  it.each([undefined, '', '0', 'false', 'no', 'off', 'nonsense'])('disables for %s', (value) => {
    expect(audioDumpEnabled({ [AUDIO_DUMP_ENV]: value })).toBe(false)
  })
})

describe('encodeUtteranceWav', () => {
  it('round-trips through the benchmark reader: 16 kHz mono s16le PCM', () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1, -1])
    const wav = encodeUtteranceWav(pcm)
    const decoded = pcmFromWav(wav)
    expect(decoded.length).toBe(pcm.length)
    decoded.forEach((sample, i) => expect(sample).toBeCloseTo(pcm[i], 4))
  })

  it('writes a canonical RIFF/WAVE header a 16 kHz mono tool accepts', () => {
    const pcm = new Float32Array(3)
    const wav = encodeUtteranceWav(pcm)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    const ascii = (offset: number, length: number): string => String.fromCharCode(...wav.subarray(offset, offset + length))

    expect(ascii(0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 6) // rest of the file
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(32_000) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(ascii(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(6) // 2 bytes × 3 samples
    expect(wav.length).toBe(44 + 6)
  })
})

/** In-memory writer: captures files, can fail like a real filesystem. */
class RecordingWriter {
  readonly files: { path: string; bytes: Uint8Array }[] = []
  dir: string | null = null
  failMkdir = false
  failWrites = false
  mkdir(dir: string): void {
    if (this.failMkdir) throw new Error('EACCES')
    this.dir = dir
  }
  writeFile(path: string, bytes: Uint8Array): void {
    if (this.failWrites) throw new Error('ENOSPC')
    this.files.push({ path, bytes })
  }
}

const WALL_MS = 1_700_000_000_000

describe('createUtteranceDumper', () => {
  it('writes each utterance as utterance-<timestamp>-<sequence>.wav under the dir', () => {
    const writer = new RecordingWriter()
    const dumper = createUtteranceDumper({ dir: '/data/audio-dumps', writer, enabled: true, now: () => WALL_MS })

    dumper.dump(new Float32Array([0, 0.5, -0.5]))
    dumper.dump(new Float32Array([1]))

    expect(writer.dir).toBe('/data/audio-dumps')
    expect(writer.files.map((file) => file.path.split('/').pop())).toEqual([
      'utterance-1700000000000-0001.wav',
      'utterance-1700000000000-0002.wav',
    ])
    const decoded = pcmFromWav(writer.files[0].bytes)
    expect(decoded.length).toBe(3)
    decoded.forEach((sample, i) => expect(sample).toBeCloseTo([0, 0.5, -0.5][i], 4))
  })

  it('writes nothing — not even the dir — while the flag is off', () => {
    const writer = new RecordingWriter()
    const dumper = createUtteranceDumper({ dir: '/data/audio-dumps', writer })

    dumper.dump(new Float32Array([0.5]))

    expect(writer.dir).toBeNull()
    expect(writer.files).toEqual([])
  })

  it('degrades to a permanent no-op when the dumps dir cannot be created', () => {
    const writer = new RecordingWriter()
    writer.failMkdir = true
    const dumper = createUtteranceDumper({ dir: '/data/audio-dumps', writer, enabled: true, now: () => WALL_MS })

    expect(() => dumper.dump(new Float32Array([0.5]))).not.toThrow()
    writer.failMkdir = false // the disk heals — the channel stays dead, like a dead logs dir
    dumper.dump(new Float32Array([0.5]))

    expect(writer.files).toEqual([])
  })

  it('swallows a failed write and tries again on the next utterance', () => {
    const writer = new RecordingWriter()
    writer.failWrites = true
    const dumper = createUtteranceDumper({ dir: '/data/audio-dumps', writer, enabled: true, now: () => WALL_MS })

    expect(() => dumper.dump(new Float32Array([0.5]))).not.toThrow()
    writer.failWrites = false
    dumper.dump(new Float32Array([0.25]))

    expect(writer.files.map((file) => file.path.split('/').pop())).toEqual(['utterance-1700000000000-0002.wav'])
  })
})
