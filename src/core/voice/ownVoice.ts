// The app's own voice in the microphone (#490, T-B arm B1): speech the ear
// took while the app was talking is the app's own when it sounds like a
// stretch of the sentence being said, compared by text. The person's line over it carries
// words the sentence does not.

/** What the ear does with speech that starts while the app talks, inside a listen (#490): `off` drops it as the app's own voice (#326); `stop` yields the floor at speech start (B0); `filter` reads it and drops the app's own words, stopping the app for the person's (B1); `duck` lowers the app's voice at speech start, drops its own words and lets it back up, and leaves the person's line to the runner, which stops the app when it fires (B1d, F2 arm b). */
export type OverSpeech = 'off' | 'stop' | 'filter' | 'duck'

export const OVER_SPEECH_MODES: readonly OverSpeech[] = ['off', 'stop', 'filter', 'duck']

/** The arm measured on #490's cases. */
export const OVER_SPEECH_DEFAULT: OverSpeech = 'duck'

/** `BINGBONG_OVER_SPEECH` names the arm; anything else is the default. */
export function resolveOverSpeech(env: Record<string, string | undefined>): OverSpeech {
  const named = env.BINGBONG_OVER_SPEECH?.trim().toLowerCase()
  return OVER_SPEECH_MODES.find((mode) => mode === named) ?? OVER_SPEECH_DEFAULT
}

/**
 * The share of a transcript's sound one stretch of the app's sentence holds,
 * at which the transcript is the app's own. A guess still (the grill, Q3),
 * set on the first measure: the gate's 27 own captures of a YouTube read
 * (Parakeet, the room) all reach 0.81, the owner's 114 labelled lines held
 * against the same read reach 0.64 at ten letters and more, but one (0.82).
 * The kiosk's speaking-time dumps (`speaking-*.wav` under
 * BINGBONG_AUDIO_DUMP=1) settle it.
 */
export const OWN_VOICE_SHARE = 0.8

/**
 * Fewer letters than this are never the app's own: a word or two is found
 * somewhere in any long read by chance ("stop", "back", "play" all are in a
 * YouTube page's), and a short line of the person's is the one that must
 * not be lost. A short echo goes to the runner, which reads it as no Command.
 */
export const OWN_VOICE_LETTERS = 10

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES: readonly [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]

/** A whole number as it is said ("153268931" → "one hundred fifty three million …"); past a trillion, digit by digit. */
function sayNumber(digits: string): string {
  const value = Number(digits)
  if (!Number.isSafeInteger(value) || value >= 1e12) return [...digits].map((digit) => ONES[Number(digit)]).join(' ')
  const under1000 = (n: number): string[] => {
    const out: string[] = []
    if (n >= 100) out.push(ONES[Math.floor(n / 100)]!, 'hundred')
    const rest = n % 100
    if (rest >= 20) out.push(TENS[Math.floor(rest / 10)]!, ...(rest % 10 > 0 ? [ONES[rest % 10]!] : []))
    else if (rest > 0 || out.length === 0) out.push(ONES[rest]!)
    return out
  }
  if (value === 0) return 'zero'
  const out: string[] = []
  let left = value
  for (const [scale, name] of SCALES) {
    if (left >= scale) {
      out.push(...under1000(Math.floor(left / scale)), name)
      left %= scale
    }
  }
  if (left > 0) out.push(...under1000(left))
  return out.join(' ')
}

/**
 * Text as it sounds, letters only: what the ear's words and the app's text
 * share however each wrote it. Numbers are said ("4:32" and "four thirty
 * two" both "fourthirtytwo"; "153,268,931" whole), signs the voice reads
 * are words, and words glued on the page ("VERSIONDanny", "34m") part.
 */
export function soundLetters(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, (_, a, b, c, d) => (a !== undefined ? `${a} ${b}` : `${c} ${d}`))
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(\d)\.(\d)/g, '$1 point $2')
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/%/g, ' percent ')
    .replace(/\d+/g, (digits) => ` ${sayNumber(digits)} `)
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

/**
 * The share of the transcript the app's text holds in one stretch: one less
 * the fewest letter edits that make the transcript's sound some run of the
 * text's (a semi-global alignment, the run free to start and end anywhere).
 * Kept in one stretch, a short line of the person's cannot borrow its
 * letters from all over a long read; by letters, "T V" is "TV" and "radio
 * hit" is a near "Radiohead".
 */
export function ownShare(transcript: string, said: string): number {
  const heard = soundLetters(transcript)
  const spoken = soundLetters(said)
  if (heard.length === 0 || spoken.length === 0) return 0
  // row[j]: the fewest edits aligning the transcript so far to a run of the text ending at j.
  let row = new Array<number>(spoken.length + 1).fill(0)
  for (let i = 1; i <= heard.length; i++) {
    const next = new Array<number>(spoken.length + 1)
    next[0] = i
    for (let j = 1; j <= spoken.length; j++) {
      next[j] = Math.min(row[j - 1]! + (heard[i - 1] === spoken[j - 1] ? 0 : 1), row[j]! + 1, next[j - 1]! + 1)
    }
    row = next
  }
  const fewest = row.reduce((least, edits) => Math.min(least, edits), heard.length)
  return Math.max(0, 1 - fewest / heard.length)
}

/** Whether a transcript taken while the app spoke is the app's own voice: it sounds like a stretch of what is being said. */
export function isOwnVoice(transcript: string, said: string): boolean {
  return soundLetters(transcript).length >= OWN_VOICE_LETTERS && ownShare(transcript, said) >= OWN_VOICE_SHARE
}
