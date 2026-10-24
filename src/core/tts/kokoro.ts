import { wrapRawPcmAsWav } from './wav'

// Kokoro-82M (#412): the pure half of the engine, what the onnx graph is
// fed and what it gives back. The graph (onnx-community/Kokoro-82M-v1.0-ONNX)
// takes `input_ids` int64 [1, N+2] — the phonemes as tokenizer.json ids,
// padded with `$` (0) at both ends — a `style` float32 [1, 256] taken from
// the voice file's row N, and `speed` float32 [1]; it returns a 24 kHz
// waveform. N is at most 510, so a longer sentence is said in chunks.
//
// The text normalisation and the phoneme fix-ups are kokoro-js@1.2.1's
// (src/phonemize.js, Apache-2.0, © Joshua Lochner), which ports them from
// misaki, Kokoro's own G2P. The phonemes themselves come from espeak-ng
// through the `phonemizer` package, injected here so this file stays pure.

export const KOKORO_SAMPLE_RATE = 24000
/** Phoneme tokens one graph call takes, without the two pads. */
export const KOKORO_MAX_TOKENS = 510
/** One style vector; a voice file is [510, 1, 256] of them, one per token count. */
export const KOKORO_STYLE_DIM = 256

const PAD_ID = 0

export type KokoroVocab = ReadonlyMap<string, number>

/** The character → id map of the model's tokenizer.json (`model.vocab`). */
export function parseKokoroVocab(tokenizer: unknown): KokoroVocab {
  const vocab = (tokenizer as { model?: { vocab?: unknown } } | null)?.model?.vocab
  if (typeof vocab !== 'object' || vocab === null) throw new Error('kokoro tokenizer.json has no model.vocab')
  const map = new Map<string, number>()
  for (const [char, id] of Object.entries(vocab)) if (typeof id === 'number') map.set(char, id)
  return map
}

/**
 * The phonemes as token ids, in chunks of at most 510: a chunk that would
 * run over is cut after its last space, so no word is split, or at the 510
 * when it has none. Characters the vocab lacks are dropped, as the
 * tokenizer's own normalizer drops them.
 */
export function kokoroChunks(phonemes: string, vocab: KokoroVocab, max = KOKORO_MAX_TOKENS): number[][] {
  const space = vocab.get(' ')
  const ids: number[] = []
  for (const char of phonemes.trim()) {
    const id = vocab.get(char)
    if (id !== undefined) ids.push(id)
  }
  const chunks: number[][] = []
  let start = 0
  while (ids.length - start > max) {
    const window = ids.slice(start, start + max)
    const lastSpace = space === undefined ? -1 : window.lastIndexOf(space)
    const cut = lastSpace > 0 ? lastSpace + 1 : max
    chunks.push(window.slice(0, cut))
    start += cut
  }
  if (start < ids.length) chunks.push(ids.slice(start))
  return chunks
}

/** One chunk as the graph's `input_ids`, `$`-padded at both ends. */
export function kokoroInputIds(chunk: readonly number[]): BigInt64Array {
  return BigInt64Array.from([PAD_ID, ...chunk, PAD_ID], (id) => BigInt(id))
}

/** The voice's style vector for a chunk of `tokenCount` tokens: row `tokenCount` of [510, 1, 256], the last for a full chunk. */
export function kokoroStyle(voice: Float32Array, tokenCount: number): Float32Array {
  const rows = voice.length / KOKORO_STYLE_DIM
  if (!Number.isInteger(rows) || rows < 1) throw new Error(`kokoro voice file holds ${voice.length} floats, not rows of ${KOKORO_STYLE_DIM}`)
  const row = Math.min(Math.max(tokenCount, 0), rows - 1)
  return voice.slice(row * KOKORO_STYLE_DIM, (row + 1) * KOKORO_STYLE_DIM)
}

/** The graph's float waveform as a 24 kHz 16-bit mono WAV, clipped to full scale. */
export function kokoroWav(waveform: Float32Array): Uint8Array {
  const pcm = new Int16Array(waveform.length)
  for (let i = 0; i < waveform.length; i++) {
    const sample = Math.max(-1, Math.min(1, waveform[i]!))
    pcm[i] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767)
  }
  return wrapRawPcmAsWav(new Uint8Array(pcm.buffer), KOKORO_SAMPLE_RATE)
}

/** "1990s", "10:30" → words; decimals are left for `splitDecimal`. */
function splitNumber(match: string): string {
  if (match.includes('.')) return match
  if (match.includes(':')) {
    const [hours, minutes] = match.split(':').map(Number) as [number, number]
    if (minutes === 0) return `${hours} o'clock`
    if (minutes < 10) return `${hours} oh ${minutes}`
    return `${hours} ${minutes}`
  }
  const year = parseInt(match.slice(0, 4), 10)
  if (year < 1100 || year % 1000 < 10) return match
  const left = match.slice(0, 2)
  const right = parseInt(match.slice(2, 4), 10)
  const suffix = match.endsWith('s') ? 's' : ''
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`
    if (right < 10) return `${left} oh ${right}${suffix}`
  }
  return `${left} ${right}${suffix}`
}

function flipMoney(match: string): string {
  const bill = match[0] === '$' ? 'dollar' : 'pound'
  if (isNaN(Number(match.slice(1)))) return `${match.slice(1)} ${bill}s`
  if (!match.includes('.')) return `${match.slice(1)} ${bill}${match.slice(1) === '1' ? '' : 's'}`
  const [whole, fraction] = match.slice(1).split('.') as [string, string]
  const coins = parseInt(fraction.padEnd(2, '0'), 10)
  const coin = match[0] === '$' ? (coins === 1 ? 'cent' : 'cents') : coins === 1 ? 'penny' : 'pence'
  return `${whole} ${bill}${whole === '1' ? '' : 's'} and ${coins} ${coin}`
}

function splitDecimal(match: string): string {
  const [whole, fraction] = match.split('.') as [string, string]
  return `${whole} point ${fraction.split('').join(' ')}`
}

/** kokoro-js's text normalisation: quotes, titles, numbers, money and initials as Kokoro expects them. */
export function normalizeKokoroText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/[^\S \n]/g, ' ')
    .replace(/  +/g, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNumber)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, splitDecimal)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (match) => match.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim()
}

/** Runs of punctuation (and the spaces around them): kept as they stand, since espeak drops them and the model reads them as pauses. */
const PUNCTUATION_RUN = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g

/** espeak-ng's phonemes for one run of words, in the given espeak language. */
export type Phonemize = (text: string, language: string) => Promise<string[]>

/**
 * A sentence as Kokoro's phonemes: normalised, its words phonemized by
 * espeak between the punctuation, and kokoro-js's fix-ups applied. The
 * language is espeak's: `en-us` for the American voices, `en` for the
 * British.
 */
export async function phonemizeForKokoro(text: string, language: string, phonemize: Phonemize): Promise<string> {
  const normalized = normalizeKokoroText(text)
  const pieces: { punctuation: boolean; text: string }[] = []
  let at = 0
  for (const match of normalized.matchAll(PUNCTUATION_RUN)) {
    if (at < match.index) pieces.push({ punctuation: false, text: normalized.slice(at, match.index) })
    if (match[0].length > 0) pieces.push({ punctuation: true, text: match[0] })
    at = match.index + match[0].length
  }
  if (at < normalized.length) pieces.push({ punctuation: false, text: normalized.slice(at) })
  const spoken = await Promise.all(pieces.map(async (piece) => (piece.punctuation ? piece.text : (await phonemize(piece.text, language)).join(' '))))
  let phonemes = spoken
    .join('')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
  if (language === 'en-us') phonemes = phonemes.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
  return phonemes.trim()
}
