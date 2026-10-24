// The spoken voices (#412): Kokoro-82M's English voices, named `kokoro:<voice>`
// so they cannot collide with a Piper filename, and the Piper voices
// installed in the voices dir, named by their filename. `Default` in the
// settings picker (an empty ttsVoice) is Kokoro af_heart; Piper speaks when
// Kokoro cannot.

export const KOKORO_PREFIX = 'kokoro:'
export const DEFAULT_TTS_VOICE = `${KOKORO_PREFIX}af_heart`

export type TtsEngine = 'kokoro' | 'piper'

/** Kokoro-82M v1.0's English voices, as kokoro-js@1.2.1 lists them: af_heart first, the default. */
const KOKORO_VOICES: readonly { name: string; label: string }[] = [
  { name: 'af_heart', label: 'Heart' },
  { name: 'af_alloy', label: 'Alloy' },
  { name: 'af_aoede', label: 'Aoede' },
  { name: 'af_bella', label: 'Bella' },
  { name: 'af_jessica', label: 'Jessica' },
  { name: 'af_kore', label: 'Kore' },
  { name: 'af_nicole', label: 'Nicole' },
  { name: 'af_nova', label: 'Nova' },
  { name: 'af_river', label: 'River' },
  { name: 'af_sarah', label: 'Sarah' },
  { name: 'af_sky', label: 'Sky' },
  { name: 'am_adam', label: 'Adam' },
  { name: 'am_echo', label: 'Echo' },
  { name: 'am_eric', label: 'Eric' },
  { name: 'am_fenrir', label: 'Fenrir' },
  { name: 'am_liam', label: 'Liam' },
  { name: 'am_michael', label: 'Michael' },
  { name: 'am_onyx', label: 'Onyx' },
  { name: 'am_puck', label: 'Puck' },
  { name: 'am_santa', label: 'Santa' },
  { name: 'bf_alice', label: 'Alice' },
  { name: 'bf_emma', label: 'Emma' },
  { name: 'bf_isabella', label: 'Isabella' },
  { name: 'bf_lily', label: 'Lily' },
  { name: 'bm_daniel', label: 'Daniel' },
  { name: 'bm_fable', label: 'Fable' },
  { name: 'bm_george', label: 'George' },
  { name: 'bm_lewis', label: 'Lewis' },
]

/** A Kokoro voice and the espeak language its accent is phonemized in: `en-us` for a*, `en` (British) for b*, as kokoro-js does. */
export interface KokoroVoice {
  name: string
  language: 'en-us' | 'en'
}

/** The Kokoro voice a voice id names; null for a Piper id or a voice not on the English list. */
export function kokoroVoiceOf(voiceId: string): KokoroVoice | null {
  if (!voiceId.startsWith(KOKORO_PREFIX)) return null
  const name = voiceId.slice(KOKORO_PREFIX.length)
  if (!KOKORO_VOICES.some((voice) => voice.name === name)) return null
  return { name, language: name.startsWith('b') ? 'en' : 'en-us' }
}

/** What every preview clip says: the line the shipped clips were rendered from on 2026-10-24. */
export const PREVIEW_LINE = 'Okay, the timer is set for ten minutes. I found three results for pasta recipes; the first one is from Serious Eats.'

/** The file a voice's preview clip is kept under: the id, its colon a dash. */
export function previewFileOf(voiceId: string): string {
  return `${voiceId.replace(':', '-')}.wav`
}

/**
 * A voice's synthesis cost class: engine and quality, since the cost is
 * the model's, not the voice's. Measured 2026-10-24 (#412), warm, best of
 * 3, synthesis seconds per second of audio on a Ryzen 5 5600G CPU, one
 * line: Kokoro-82M fp32 af_heart 0.233, bm_george 0.246, am_michael 0.261
 * (~0.247); Piper high lessac 0.138, cori 0.132, ryan 0.170 (~0.147);
 * Piper medium hfc_female 0.032, ryan 0.038, alba 0.040 (~0.037).
 * Absolute times mean nothing on another machine, so only their ratios
 * are shown.
 */
export const COST_PER_AUDIO_SECOND = {
  kokoro: 0.247,
  'piper-high': 0.147,
  'piper-medium': 0.037,
} as const

export type CostClass = keyof typeof COST_PER_AUDIO_SECOND

/** A Piper voice's class from `audio.quality` in its .onnx.json: high, else medium (x_low and low cost no more). */
export function piperCostClass(config: unknown): CostClass {
  const quality = (config as { audio?: { quality?: unknown } } | null)?.audio?.quality
  return quality === 'high' ? 'piper-high' : 'piper-medium'
}

/** Each listed class's cost as a whole percentage of the most expensive one listed. */
export function costPercents(classes: readonly CostClass[]): Partial<Record<CostClass, number>> {
  const top = Math.max(...classes.map((cost) => COST_PER_AUDIO_SECOND[cost]))
  const percents: Partial<Record<CostClass, number>> = {}
  for (const cost of classes) percents[cost] = Math.round((COST_PER_AUDIO_SECOND[cost] / top) * 100)
  return percents
}

/** One voice the settings picker lists. */
export interface TtsVoiceEntry {
  id: string
  engine: TtsEngine
  label: string
  /** Kokoro's accent and voice, e.g. "American, female". */
  detail?: string
  cost: CostClass
  /** Synthesis cost against the most expensive class listed. */
  costPercent: number
}

/** An installed Piper voice: its id and its parsed .onnx.json (null when unreadable). */
export interface InstalledPiperVoice {
  id: string
  config: unknown
}

/** The picker's voices: the Kokoro ones, then the installed Piper ones, each with its cost percentage. */
export function listTtsVoices(piper: readonly InstalledPiperVoice[]): TtsVoiceEntry[] {
  const kokoro = KOKORO_VOICES.map(({ name, label }) => ({
    id: `${KOKORO_PREFIX}${name}`,
    engine: 'kokoro' as const,
    label,
    detail: `${name.startsWith('a') ? 'American' : 'British'}, ${name[1] === 'f' ? 'female' : 'male'}`,
    cost: 'kokoro' as const,
  }))
  const installed = piper.map((voice) => ({ id: voice.id, engine: 'piper' as const, label: voice.id, cost: piperCostClass(voice.config) }))
  const all = [...kokoro, ...installed]
  const percents = costPercents(all.map((voice) => voice.cost))
  return all.map((voice) => ({ ...voice, costPercent: percents[voice.cost] ?? 100 }))
}
