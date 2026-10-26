// A Timer's length (CONTEXT.md, Timer), read off the words that name it —
// typed ("5m", "1h30m", "2:30") or spoken ("five minutes", "an hour and a
// half", "ninety seconds") — and said back the way a person says it.

/** The longest Timer: a day. Anything longer is not a kitchen timer. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const UNITS: Readonly<Record<string, number>> = {
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  s: SECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
}

const ONES: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
}

const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** The parts of one: "half", "three quarters", "two thirds". */
const FRACTIONS: Readonly<Record<string, number>> = { half: 1 / 2, halves: 1 / 2, third: 1 / 3, thirds: 1 / 3, quarter: 1 / 4, quarters: 1 / 4 }

const isArticle = (word: string | undefined): boolean => word === 'a' || word === 'an'

/** Words a spoken length carries between its parts: "an hour and a half", "five minutes and ten seconds". */
const FILLERS: ReadonlySet<string> = new Set(['and', 'of', 'for'])

/** A number read off the words: its value, the index after it, and whether it was only an article ("a minute"). */
export interface NumberRead {
  readonly value: number
  readonly next: number
  readonly article: boolean
}

/**
 * The words a number is read from: lower case, punctuation gone but a
 * decimal point kept ("1.5"), so "a hundred percent." is
 * `a hundred percent`.
 */
export function numberWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    .filter((word) => word !== '')
}

/** Under a hundred in words: "seven", "nineteen", "forty", "twenty five". */
function underHundredAt(words: readonly string[], at: number): { value: number; next: number } | null {
  const tens = TENS[words[at] ?? '']
  if (tens !== undefined) {
    const ones = ONES[words[at + 1] ?? '']
    return ones !== undefined && ones > 0 && ones < 10 ? { value: tens + ones, next: at + 2 } : { value: tens, next: at + 1 }
  }
  const ones = ONES[words[at] ?? '']
  return ones !== undefined ? { value: ones, next: at + 1 } : null
}

/**
 * A number of `scale` and the rest after it ("two hundred and fifty", "a
 * thousand"), each part read by `part`; the bare part when no scale word
 * follows it.
 */
function scaledAt(
  words: readonly string[],
  at: number,
  scale: 'hundred' | 'thousand',
  part: (words: readonly string[], at: number) => { value: number; next: number } | null,
): { value: number; next: number } | null {
  const head = isArticle(words[at]) && words[at + 1] === scale ? { value: 1, next: at + 1 } : part(words, at)
  if (head === null || words[head.next] !== scale) return head
  const value = head.value * (scale === 'hundred' ? 100 : 1000)
  const restAt = words[head.next + 1] === 'and' && part(words, head.next + 2) !== null ? head.next + 2 : head.next + 1
  const rest = part(words, restAt)
  return rest === null ? { value, next: head.next + 1 } : { value: value + rest.value, next: rest.next }
}

/** A whole number in words, to the thousands: "twelve hundred", "a hundred and five", "two thousand five hundred". */
const wholeAt = (words: readonly string[], at: number): { value: number; next: number } | null =>
  scaledAt(words, at, 'thousand', (inner, from) => scaledAt(inner, from, 'hundred', underHundredAt))

/** Digits said one by one after "point": "five", "seven five"; null for none. */
function decimalsAt(words: readonly string[], at: number): { value: number; next: number } | null {
  let digits = ''
  let next = at
  for (; next < words.length; next += 1) {
    const word = words[next]!
    const digit = /^\d$/.test(word) ? Number(word) : ONES[word]
    if (digit === undefined || digit > 9) break
    digits += String(digit)
  }
  return digits === '' ? null : { value: Number(`0.${digits}`), next }
}

/**
 * The number at the head of the words, in digits or as it is said: whole
 * ("twenty five", "a hundred", "two thousand five hundred"), a decimal
 * ("1.5", "one point five", "zero point seven five") or a part of one
 * ("half", "three quarters", "one and a half"). A lone article is 1,
 * flagged, since "a minute" is one and "turn it up a bit" is none. Null
 * when no number starts there.
 */
export function numberAt(words: readonly string[], at: number): NumberRead | null {
  const word = words[at]
  if (word === undefined) return null
  if (/^\d+(\.\d+)?$/.test(word)) return { value: Number(word), next: at + 1, article: false }
  const part = FRACTIONS[word]
  if (part !== undefined) return { value: part, next: at + 1, article: false }
  const articlePart = isArticle(word) ? FRACTIONS[words[at + 1] ?? ''] : undefined
  if (articlePart !== undefined) return { value: articlePart, next: at + 2, article: false }
  const whole = wholeAt(words, at)
  if (whole === null) return isArticle(word) ? { value: 1, next: at + 1, article: true } : null
  // "one point five": the digits after the point.
  if (words[whole.next] === 'point') {
    const decimals = decimalsAt(words, whole.next + 1)
    if (decimals !== null) return { value: whole.value + decimals.value, next: decimals.next, article: false }
  }
  // "three quarters": a count of a part.
  const parts = FRACTIONS[words[whole.next] ?? '']
  if (parts !== undefined) return { value: whole.value * parts, next: whole.next + 1, article: false }
  // "one and a half", "one and three quarters": a whole and a part.
  if (words[whole.next] === 'and') {
    const after = numberAt(words, whole.next + 1)
    if (after !== null && !after.article && after.value > 0 && after.value < 1) return { value: whole.value + after.value, next: after.next, article: false }
  }
  return { value: whole.value, next: whole.next, article: false }
}

/**
 * Where a unit follows a number: past "of a" after a part of one ("half an
 * hour", "three quarters of an hour"), else right after it.
 */
export function unitAfter(words: readonly string[], number: NumberRead): number {
  let next = number.next
  if (number.value >= 1 || number.article) return next
  if (words[next] === 'of') next += 1
  return isArticle(words[next]) ? next + 1 : next
}

/**
 * The first number the words name, digits or spoken ("30", "fifty five", "a
 * hundred"); null when they name none. A whole number only, unless the
 * caller takes fractions ("one point five", "one and a half"): a fraction
 * is passed over whole, never read as the whole number inside it.
 */
export function firstNumber(text: string, options: { readonly fractions?: boolean } = {}): number | null {
  const words = numberWords(text)
  let at = 0
  while (at < words.length) {
    const found = numberAt(words, at)
    if (found === null || found.article) {
      at += 1
      continue
    }
    if (options.fractions === true || Number.isInteger(found.value)) return found.value
    at = found.next
  }
  return null
}

/** "1h30m", "90s", "5m": a typed length with its units joined on. */
function compactMs(word: string): number | null {
  const parts = [...word.matchAll(/(\d+(?:\.\d+)?)(h|hr|m|min|s|sec)/g)]
  if (parts.length === 0 || parts.map((part) => part[0]).join('') !== word) return null
  return parts.reduce((total, part) => total + Number(part[1]) * UNITS[part[2]!]!, 0)
}

/** "2:30" is minutes and seconds; "1:02:30" hours, minutes and seconds. */
function clockMs(text: string): number | null {
  const match = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(text.trim())
  if (match === null) return null
  return Number(match[1] ?? 0) * HOUR + Number(match[2]) * MINUTE + Number(match[3]) * SECOND
}

function withinBounds(ms: number): number | null {
  const rounded = Math.round(ms / SECOND) * SECOND
  return rounded >= SECOND && rounded <= MAX_TIMER_MS ? rounded : null
}

/**
 * The milliseconds the words name; null when they name no length, or one
 * under a second or over a day. A bare number is minutes ("timer 5"), and
 * "and a half" is half of the unit before it.
 */
export function parseDuration(text: string): number | null {
  const clock = clockMs(text)
  if (clock !== null) return withinBounds(clock)
  const words = numberWords(text)
  if (words.length === 0) return null
  if (words.length === 1) {
    const compact = compactMs(words[0]!)
    if (compact !== null) return withinBounds(compact)
    if (/^\d+(\.\d+)?$/.test(words[0]!)) return withinBounds(Number(words[0]) * MINUTE)
  }
  let total = 0
  let lastUnit: number | null = null
  let at = 0
  while (at < words.length) {
    const word = words[at]!
    if (FILLERS.has(word)) {
      at += 1
      continue
    }
    const number = numberAt(words, at)
    if (number === null) return null
    const next = unitAfter(words, number)
    const unit = UNITS[words[next] ?? '']
    // "an hour and a half", "a minute and a quarter": a part of the unit just named.
    if (unit === undefined && lastUnit !== null && !number.article && number.value < 1 && next === number.next) {
      total += number.value * lastUnit
      at = next
      continue
    }
    if (unit === undefined) return null
    total += number.value * unit
    lastUnit = unit
    at = next + 1
  }
  return lastUnit === null ? null : withinBounds(total)
}

/** A length as it is said: "5 minutes", "1 hour 30 minutes", "45 seconds". */
export function describeDuration(ms: number): string {
  const seconds = Math.round(ms / SECOND)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const part = (value: number, unit: string): string => `${value} ${unit}${value === 1 ? '' : 's'}`
  const parts = [hours > 0 ? part(hours, 'hour') : '', minutes > 0 ? part(minutes, 'minute') : '', rest > 0 ? part(rest, 'second') : ''].filter((text) => text !== '')
  return parts.length === 0 ? part(0, 'second') : parts.join(' ')
}

/** What is left, as a countdown reads: "4:59", "1:04:59"; never below 0:00. */
export function countdownLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / SECOND))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
