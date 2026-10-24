import { describe, expect, it } from 'vitest'
import { kokoroChunks, kokoroInputIds, kokoroWav, kokoroStyle, normalizeKokoroText, parseKokoroVocab, phonemizeForKokoro, KOKORO_MAX_TOKENS, KOKORO_STYLE_DIM } from './kokoro'
import { parseWav } from './wav'

// The model's own tokenizer.json shape (onnx-community/Kokoro-82M-v1.0-ONNX), cut to a few characters.
const TOKENIZER = { model: { vocab: { $: 0, ',': 3, '.': 4, ' ': 16, a: 43, b: 44, k: 53, ə: 83, ˈ: 156 } } }

describe('parseKokoroVocab', () => {
  it('reads the character → id map from tokenizer.json', () => {
    const vocab = parseKokoroVocab(TOKENIZER)
    expect(vocab.get('ə')).toBe(83)
    expect(vocab.get(' ')).toBe(16)
  })

  it('refuses a file with no vocab', () => {
    expect(() => parseKokoroVocab({ model: {} })).toThrow(/vocab/)
  })
})

describe('kokoroChunks', () => {
  const vocab = parseKokoroVocab(TOKENIZER)

  it('maps each phoneme character to its id and drops the ones the vocab lacks', () => {
    expect(kokoroChunks('kˈab, ʔa.', vocab)).toEqual([[53, 156, 43, 44, 3, 16, 43, 4]])
  })

  it('keeps a sentence of up to 510 tokens whole', () => {
    expect(kokoroChunks('a'.repeat(KOKORO_MAX_TOKENS), vocab)).toEqual([Array(KOKORO_MAX_TOKENS).fill(43)])
  })

  it('cuts a longer sentence at its last space inside the 510, so no word is split', () => {
    const word = 'a'.repeat(9)
    const phonemes = Array(60).fill(word).join(' ') // 60 × 9 + 59 spaces = 599 tokens
    const chunks = kokoroChunks(phonemes, vocab)
    expect(chunks.every((chunk) => chunk.length <= KOKORO_MAX_TOKENS)).toBe(true)
    // 51 words and their spaces fill 509; the cut falls after the 51st word's space.
    expect(chunks[0]).toHaveLength(51 * 10)
    expect(chunks[1]).toHaveLength(9 * 10 - 1)
    expect(chunks.flat()).toHaveLength(599)
  })

  it('cuts a run with no space at the 510', () => {
    const chunks = kokoroChunks('a'.repeat(1100), vocab)
    expect(chunks.map((chunk) => chunk.length)).toEqual([510, 510, 80])
  })

  it('gives no chunk for text with nothing to say', () => {
    expect(kokoroChunks('   ', vocab)).toEqual([])
    expect(kokoroChunks('', vocab)).toEqual([])
  })
})

describe('kokoroInputIds', () => {
  it('pads the chunk with the $ token at both ends', () => {
    expect([...kokoroInputIds([53, 43])]).toEqual([0n, 53n, 43n, 0n])
  })
})

describe('kokoroStyle', () => {
  // A voice file is Float32 [510, 1, 256]: row r holds r in every cell here.
  const voice = new Float32Array(510 * KOKORO_STYLE_DIM)
  for (let row = 0; row < 510; row++) voice.fill(row, row * KOKORO_STYLE_DIM, (row + 1) * KOKORO_STYLE_DIM)

  it('takes the row the chunk’s token count names', () => {
    const style = kokoroStyle(voice, 12)
    expect(style).toHaveLength(KOKORO_STYLE_DIM)
    expect(style.every((value) => value === 12)).toBe(true)
  })

  it('takes the last row for a full 510-token chunk', () => {
    expect(kokoroStyle(voice, 510)[0]).toBe(509)
  })

  it('refuses a voice file of the wrong size', () => {
    expect(() => kokoroStyle(new Float32Array(10), 3)).toThrow(/voice/)
  })
})

describe('normalizeKokoroText', () => {
  it('speaks money, times and decimals as words, as kokoro-js does', () => {
    expect(normalizeKokoroText('It costs $5.50')).toBe('It costs 5 dollars and 50 cents')
    expect(normalizeKokoroText('Meet at 10:30')).toBe('Meet at 10 30')
    expect(normalizeKokoroText('Meet at 10:00')).toBe("Meet at 10 o'clock")
    expect(normalizeKokoroText('pi is 3.14')).toBe('pi is 3 point 1 4')
    expect(normalizeKokoroText('Dr. Smith')).toBe('Doctor Smith')
    expect(normalizeKokoroText('pages 3-5')).toBe('pages 3 to 5')
  })
})

describe('phonemizeForKokoro', () => {
  it('phonemizes the words between punctuation and keeps the punctuation as it stands', async () => {
    const asked: string[] = []
    const phonemize = async (text: string, language: string): Promise<string[]> => {
      asked.push(`${language}|${text}`)
      return [text.toUpperCase()]
    }
    expect(await phonemizeForKokoro('okay, ten minutes.', 'en-us', phonemize)).toBe('OKAY, TEN MINUTES.')
    expect(asked).toEqual(['en-us|okay', 'en-us|ten minutes'])
  })

  it('applies kokoro-js’s phoneme fix-ups: r is ɹ, the American t between vowels after nine is d', async () => {
    const phonemize = async (text: string): Promise<string[]> => [text === 'ninety' ? 'nˈaɪnti' : 'raʲ']
    expect(await phonemizeForKokoro('ninety', 'en-us', phonemize)).toBe('nˈaɪndi')
    expect(await phonemizeForKokoro('ninety', 'en-gb', phonemize)).toBe('nˈaɪnti')
    expect(await phonemizeForKokoro('rye', 'en-us', phonemize)).toBe('ɹaj')
  })
})

describe('kokoroWav', () => {
  it('is a 24 kHz 16-bit mono WAV of the waveform, clipped to full scale', () => {
    const wav = kokoroWav(new Float32Array([0, 0.5, -1, 2]))
    const parsed = parseWav(wav)!
    expect(parsed.sampleRate).toBe(24000)
    expect(parsed.channels).toBe(1)
    expect(parsed.bitsPerSample).toBe(16)
    const samples = new Int16Array(parsed.pcm.buffer.slice(parsed.pcm.byteOffset, parsed.pcm.byteOffset + parsed.pcm.byteLength))
    expect([...samples]).toEqual([0, 16384, -32768, 32767])
  })
})
