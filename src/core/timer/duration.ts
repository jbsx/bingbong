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
  a: 1,
  an: 1,
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

/** Words a spoken length carries between its parts: "an hour and a half", "five minutes and ten seconds". */
const FILLERS: ReadonlySet<string> = new Set(['and', 'of', 'for'])

/** A number at the head of the words, digits or spoken ("twenty five", "a"); null when none starts them. */
function numberAt(words: readonly string[], at: number): { value: number; next: number } | null {
  const word = words[at]
  if (word === undefined) return null
  if (/^\d+(\.\d+)?$/.test(word)) return { value: Number(word), next: at + 1 }
  if (word === 'half') return { value: 0.5, next: at + 1 }
  const tens = TENS[word]
  if (tens !== undefined) {
    const ones = ONES[words[at + 1] ?? '']
    return ones !== undefined && ones < 10 && words[at + 1] !== 'a' && words[at + 1] !== 'an' ? { value: tens + ones, next: at + 2 } : { value: tens, next: at + 1 }
  }
  const ones = ONES[word]
  return ones !== undefined ? { value: ones, next: at + 1 } : null
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
  const words = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    .filter((word) => word !== '')
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
    // "and a half": half the unit just named.
    if ((word === 'a' || word === 'an') && words[at + 1] === 'half' && lastUnit !== null && UNITS[words[at + 2] ?? ''] === undefined) {
      total += lastUnit / 2
      at += 2
      continue
    }
    const number = numberAt(words, at)
    if (number === null) return null
    // "half an hour", "half a minute": the article before the unit is not a second number.
    let next = number.next
    let value = number.value
    if (value === 0.5 && (words[next] === 'a' || words[next] === 'an')) next += 1
    // "one and a half hours": the half rides on the number before the unit.
    if (words[next] === 'and' && (words[next + 1] === 'a' || words[next + 1] === 'an') && words[next + 2] === 'half') {
      value += 0.5
      next += 3
    }
    const unit = UNITS[words[next] ?? '']
    if (unit === undefined) return null
    total += value * unit
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
