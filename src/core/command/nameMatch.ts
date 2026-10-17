import { normalizeWords } from './command'

// The Name Match (CONTEXT.md, ADR 0077, #325): the recogniser is allowed
// to be wrong about a name, and its output is matched afterwards against
// the names the page shows and the names the user has taught the app. A
// Slot — the search terms, the text to type — whose words sound like a
// candidate is carried as the candidate's spelling; what was heard is kept
// beside it on the decision record. No model, no audio: a sound key over
// the words, an edit distance between keys, and a tolerance that grows
// with the key.
//
// The key is Metaphone-style: consonant classes with the vowels dropped
// after a word's first letter, so "line stack tips", "Linus Tech dips" and
// "liner stack tips" all key within an edit or two of "Linus Tech Tips".

/** A Name Match: the Slot as it will be carried, and the words it replaced. */
export interface NameMatch {
  readonly slot: string
  readonly candidate: string
  readonly heard: string
}

/** Edits allowed between two keys: one per four characters of the longer. */
function tolerance(length: number): number {
  return Math.floor(length / 4)
}

/** Keys shorter than this match nothing: too little sound to tell names apart. */
const MIN_KEY_LENGTH = 4

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

function isVowel(char: string | undefined): boolean {
  return char !== undefined && VOWELS.has(char)
}

/** The sound key of one word: a run of consonant classes, the leading vowel kept as A. */
export function wordSoundKey(raw: string): string {
  let word = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (word === '') return ''
  if (/^\d+$/.test(word)) return word
  // Silent openings.
  if (/^(kn|gn|pn|wr|ae)/.test(word)) word = word.slice(1)
  if (word.startsWith('x')) word = `s${word.slice(1)}`
  if (word.startsWith('wh')) word = `w${word.slice(2)}`

  let key = ''
  for (let i = 0; i < word.length; i += 1) {
    const char = word[i]!
    const prev = word[i - 1]
    const next = word[i + 1]
    // Doubled letters sound once (except C, where "cc" can be two sounds).
    if (char === prev && char !== 'c') continue
    let out = ''
    switch (char) {
      case 'a':
      case 'e':
      case 'i':
      case 'o':
      case 'u':
        out = i === 0 ? 'A' : ''
        break
      case 'b':
        out = i === word.length - 1 && prev === 'm' ? '' : 'P'
        break
      case 'c':
        if (next === 'h') {
          out = prev === 's' ? 'K' : 'X'
          i += 1
        } else if (next === 'i' && word[i + 2] === 'a') out = 'X'
        else if (next === 'e' || next === 'i' || next === 'y') out = 'S'
        else out = 'K'
        break
      case 'd':
        if (next === 'g' && (word[i + 2] === 'e' || word[i + 2] === 'i' || word[i + 2] === 'y')) {
          out = 'J'
          i += 1
        } else out = 'T'
        break
      case 'f':
        out = 'F'
        break
      case 'g':
        if (next === 'h') {
          // "gh" before a consonant or at the end is silent ("light", "high"); before a vowel it is G.
          out = isVowel(word[i + 2]) ? 'K' : ''
          i += 1
        } else if (next === 'n') out = ''
        else if (next === 'e' || next === 'i' || next === 'y') out = 'J'
        else out = 'K'
        break
      case 'h':
        out = isVowel(next) && !isVowel(prev) ? 'H' : ''
        break
      case 'j':
        out = 'J'
        break
      case 'k':
        out = prev === 'c' ? '' : 'K'
        break
      case 'l':
        out = 'L'
        break
      case 'm':
        out = 'M'
        break
      case 'n':
        out = 'N'
        break
      case 'p':
        if (next === 'h') {
          out = 'F'
          i += 1
        } else out = 'P'
        break
      case 'q':
        out = 'K'
        break
      case 'r':
        out = 'R'
        break
      case 's':
        if (next === 'h') {
          out = 'X'
          i += 1
        } else if (next === 'i' && (word[i + 2] === 'o' || word[i + 2] === 'a')) out = 'X'
        else out = 'S'
        break
      case 't':
        if (next === 'h') {
          out = '0'
          i += 1
        } else if (next === 'i' && (word[i + 2] === 'o' || word[i + 2] === 'a')) out = 'X'
        else out = 'T'
        break
      case 'v':
        out = 'F'
        break
      case 'w':
        out = isVowel(next) ? 'W' : ''
        break
      case 'x':
        out = 'KS'
        break
      case 'y':
        out = isVowel(next) ? 'Y' : ''
        break
      case 'z':
        out = 'S'
        break
      default:
        out = char.toUpperCase()
    }
    key += out
  }
  return key
}

/** The sound key of a phrase: its words' keys run together, so a word boundary the recogniser moved costs nothing. */
export function soundKey(text: string): string {
  return normalizeWords(text)
    .split(' ')
    .map(wordSoundKey)
    .join('')
}

/** Levenshtein distance, capped: stops counting past `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]!
}

/** Whether two phrases sound alike within the Name Match's tolerance: their keys within one edit per four characters. */
export function soundsAlike(a: string, b: string, slack = 0): boolean {
  const keyA = soundKey(a)
  const keyB = soundKey(b)
  const length = Math.max(keyA.length, keyB.length)
  if (length < MIN_KEY_LENGTH) return false
  const limit = tolerance(length) + slack
  return editDistance(keyA, keyB, limit) <= limit
}

/** Whether the phrase already carries the candidate word for word. */
function carries(words: readonly string[], candidate: readonly string[]): boolean {
  for (let start = 0; start + candidate.length <= words.length; start += 1) {
    if (candidate.every((word, i) => words[start + i] === word)) return true
  }
  return false
}

/**
 * The Name Match of a Slot against the candidates, in rank order: the
 * candidate whose sound key is nearest to the Slot's, or to a span of it
 * within a word of the candidate's length, inside the tolerance. The
 * first candidate wins a tie. Null when the Slot already carries a
 * candidate as spelled, or none sounds like it.
 */
export function nameMatch(slot: string, candidates: readonly string[]): NameMatch | null {
  const words = normalizeWords(slot).split(' ').filter((word) => word !== '')
  if (words.length === 0) return null
  const spoken = slot.trim().split(/\s+/)
  // The spoken words line up with the normalized ones only when nothing dropped out in normalizing; otherwise the whole Slot is one span.
  const aligned = spoken.length === words.length
  let best: { match: NameMatch; distance: number } | null = null
  for (const candidate of candidates) {
    const candidateWords = normalizeWords(candidate).split(' ').filter((word) => word !== '')
    if (candidateWords.length === 0) continue
    if (carries(words, candidateWords)) return null
    const key = soundKey(candidateWords.join(' '))
    if (key.length < MIN_KEY_LENGTH) continue
    for (let length = Math.max(1, candidateWords.length - 1); length <= Math.min(words.length, candidateWords.length + 1); length += 1) {
      for (let start = 0; start + length <= words.length; start += 1) {
        const span = words.slice(start, start + length)
        const spanKey = soundKey(span.join(' '))
        const limit = tolerance(Math.max(key.length, spanKey.length))
        const distance = editDistance(spanKey, key, limit)
        if (distance > limit) continue
        if (best !== null && distance >= best.distance) continue
        const heard = aligned ? spoken.slice(start, start + length).join(' ') : slot.trim()
        const replaced = aligned ? [...spoken.slice(0, start), candidate.trim(), ...spoken.slice(start + length)].join(' ') : candidate.trim()
        best = { match: { slot: replaced, candidate: candidate.trim(), heard }, distance }
      }
    }
  }
  return best?.match ?? null
}
