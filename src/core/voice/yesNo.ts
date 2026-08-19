// Turning a spoken transcript into a confirmation decision. Deliberately a
// small word list, not an LLM call: the confirmation gate must stay fast,
// offline and predictable inside its 12 s window. First decision word wins;
// anything else leaves the prompt open for a tap or the auto-deny.

const YES_WORDS = new Set([
  'yes',
  'yeah',
  'yep',
  'yup',
  'ya',
  'sure',
  'ok',
  'okay',
  'confirm',
  'approved',
  'approve',
  'affirmative',
])
const NO_WORDS = new Set([
  'no',
  'nope',
  'nah',
  'stop',
  'cancel',
  'deny',
  'denied',
  'negative',
  'dont',
  'never',
])

/** Filler STT tends to pick up around a one-word answer. */
const FILLER = new Set(['um', 'uh', 'uhh', 'er', 'ah', 'hey', 'please', 'so', 'well', 'like'])

/** Two-word assent phrases checked before single words. */
const YES_PHRASES = ['go ahead', 'do it', 'sounds good']

export function parseYesNo(transcript: string): 'yes' | 'no' | null {
  const normalized = transcript
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized === '') return null

  for (const phrase of YES_PHRASES) {
    if (normalized.startsWith(phrase)) return 'yes'
  }

  for (const word of normalized.split(' ')) {
    if (FILLER.has(word)) continue
    if (YES_WORDS.has(word)) return 'yes'
    if (NO_WORDS.has(word)) return 'no'
  }
  return null
}
