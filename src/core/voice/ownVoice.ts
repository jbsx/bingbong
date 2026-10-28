// The app's own voice in the microphone (#490, T-B arm B1): speech the ear
// took while the app was talking is the app's own when it sounds like a
// stretch of the sentence being said, compared by text. The person's line over it carries
// words the sentence does not.

/** What the ear does with speech that starts while the app talks, inside a listen (#490): `off` drops it as the app's own voice (#326); `stop` yields the floor at speech start (B0); `filter` reads it and drops the app's own words, stopping the app for the person's (B1); `duck` lowers the app's voice at speech start, drops its own words and lets it back up, and leaves the person's line to the runner, which stops the app when it fires (B1d, F2 arm b). */
export type OverSpeech = 'off' | 'stop' | 'filter' | 'duck'

export const OVER_SPEECH_MODES: readonly OverSpeech[] = ['off', 'stop', 'filter', 'duck']

/**
 * Off: speech over the app's voice is its own and dropped (#326). The duck
 * is the arm measured on #490's cases, named by BINGBONG_OVER_SPEECH=duck;
 * the default went back to off by the orchestrator's ruled reversal (#490,
 * eighth pass), since its echo negative did not hold green twice in a row.
 */
export const OVER_SPEECH_DEFAULT: OverSpeech = 'off'

/** `BINGBONG_OVER_SPEECH` names the arm; anything else is the default. */
export function resolveOverSpeech(env: Record<string, string | undefined>): OverSpeech {
  const named = env.BINGBONG_OVER_SPEECH?.trim().toLowerCase()
  return OVER_SPEECH_MODES.find((mode) => mode === named) ?? OVER_SPEECH_DEFAULT
}

/**
 * The share of a transcript's sound one stretch of the app's sentence holds,
 * at which the transcript is the app's own. A guess still (the grill, Q3),
 * set on the first measure, between the grill's 0.7 and what it lets
 * through: the gate's 28 own captures of a YouTube read (Parakeet, the
 * room) reach 0.75 at least; the owner's 114 labelled lines held against
 * the same read reach 0.64 at ten letters and more but one ("open
 * youtube", 0.82), and "play let down" over a read of Let Down 0.73. A thin
 * margin both ways.
 * The kiosk's speaking-time dumps (`speaking-*.wav` under
 * BINGBONG_AUDIO_DUMP=1) settle it.
 */
export const OWN_VOICE_SHARE = 0.75

/**
 * Fewer letters than this are never the app's own by a near stretch: a word
 * or two is near something in any long read by chance, and a short line of
 * the person's is the one that must not be lost. A short capture is the
 * app's own only when its words are found whole in what the app's voice has
 * just sounded (the orchestrator's rulings, #490): the runner read short
 * echoes of titles and of "Stopped." as Commands (narrow18–20 at c7e80bf0),
 * and a person's "stop" or "back" is still heard when the app did not just
 * say it, even over a read that names "Stop Crying Your Heart Out" further on.
 */
export const OWN_VOICE_LETTERS = 10

/**
 * How far back what the app's voice sounded is held against a short capture
 * (#490): the ruling's "~2 s", a guess. Each frame of a capture over the
 * voice takes this window, so a capture holds what sounded from this long
 * before it began to its end. What it must cover: the room's echo delay and
 * the error of placing a word by its letters inside a sentence's sound;
 * the speaking dumps carry no playback clock, so the delay is not measured
 * from them, and the gate's over-speech span says whether the window held
 * each long own capture (`recentShare`).
 */
export const ECHO_WINDOW_MS = 2000

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
  return soundWords(text).join('')
}

/** Text as it sounds, word by word: `soundLetters` with the words kept apart. */
function soundWords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, (_, a, b, c, d) => (a !== undefined ? `${a} ${b}` : `${c} ${d}`))
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(\d)\.(\d)/g, '$1 point $2')
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/%/g, ' percent ')
    .replace(/\//g, ' slash ')
    .replace(/\d+/g, (digits) => ` ${sayNumber(digits)} `)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== '')
}

/**
 * The fewest letter edits that make each head of the heard sound, `heard[0, i)`,
 * some run of the text's (a semi-global alignment, the run free to start and
 * end anywhere): `[i]` for every i.
 */
function stretchEdits(heard: string, spoken: string): number[] {
  const out = [0]
  let row = new Array<number>(spoken.length + 1).fill(0)
  for (let i = 1; i <= heard.length; i++) {
    const next = new Array<number>(spoken.length + 1)
    next[0] = i
    for (let j = 1; j <= spoken.length; j++) next[j] = Math.min(row[j - 1]! + (heard[i - 1] === spoken[j - 1] ? 0 : 1), row[j]! + 1, next[j - 1]! + 1)
    row = next
    out.push(row.reduce((least, edits) => Math.min(least, edits), i))
  }
  return out
}

/** The fewest letter edits that make each tail of the heard sound, `heard[n - t, n)`, a head of the text's: `[t]` for every t. */
function headEdits(heard: string, spoken: string): number[] {
  const out = [0]
  // Read backwards, a head of the text is a run that ends at the text's start: free to begin, fixed to end.
  let row = new Array<number>(spoken.length + 1).fill(0)
  for (let t = 1; t <= heard.length; t++) {
    const letter = heard[heard.length - t]
    const next = new Array<number>(spoken.length + 1)
    next[spoken.length] = t
    for (let j = spoken.length - 1; j >= 0; j--) next[j] = Math.min(row[j + 1]! + (letter === spoken[j] ? 0 : 1), row[j]! + 1, next[j + 1]! + 1)
    row = next
    out.push(row[0]!)
  }
  return out
}

/**
 * The share of the transcript the app's text holds in one stretch: one less
 * the fewest letter edits that make the transcript's sound some run of the
 * text's (a semi-global alignment, the run free to start and end anywhere).
 * Kept in one stretch, a short line of the person's cannot borrow its
 * letters from all over a long read; by letters, "T V" is "TV" and "radio
 * hit" is a near "Radiohead".
 *
 * Given the sentences in the order said, a stretch may also run from
 * anywhere in one into the head of the next (#490): a sentence stopped
 * mid-way is followed at once by the next ("Stopped."), and a capture over
 * the cut holds the end of what was heard of the one and the start of the
 * other — "Light on the river stopped." over a read's "Moonlight on the
 * River" (row 10 at 86d0fbd5, 0.73 as one stretch).
 */
export function ownShare(transcript: string, said: string | readonly string[]): number {
  const heard = soundLetters(transcript)
  const texts = (typeof said === 'string' ? [said] : said).map(soundLetters).filter((text) => text.length > 0)
  if (heard.length === 0 || texts.length === 0) return 0
  let fewest = heard.length
  const stretches = texts.map((text) => stretchEdits(heard, text))
  for (const edits of stretches) fewest = Math.min(fewest, edits[heard.length]!)
  for (let k = 0; k + 1 < texts.length; k++) {
    const heads = headEdits(heard, texts[k + 1]!)
    for (let i = 0; i <= heard.length; i++) fewest = Math.min(fewest, stretches[k]![i]! + heads[heard.length - i]!)
  }
  return Math.max(0, 1 - fewest / heard.length)
}

/** Whether the transcript's sound is a run of whole words of what was said, the sentences in the order said: "after sex" in "Cigarettes After Sex", never "rose" in "Roses". */
function foundWhole(transcript: string, said: string | readonly string[]): boolean {
  const heard = soundLetters(transcript)
  if (heard === '') return false
  const words = (typeof said === 'string' ? [said] : said).flatMap(soundWords)
  for (let i = 0; i < words.length; i++) {
    let run = ''
    for (let j = i; j < words.length && run.length < heard.length; j++) run += words[j]
    if (run === heard) return true
  }
  return false
}

/**
 * Whether a transcript taken while the app spoke is the app's own voice: it
 * sounds like a stretch of what is being said; or, short, like a stretch of
 * what its voice has just sounded (`recent`: an echo window holds too few
 * words to be near by chance, and the ear drops a letter, "Content" for
 * "Contents", narrow22) — when the speaker cannot tell, its words found whole
 * in what is being said.
 */
export function isOwnVoice(transcript: string, said: string | readonly string[], recent?: string | readonly string[]): boolean {
  if (soundLetters(transcript).length >= OWN_VOICE_LETTERS) return ownShare(transcript, said) >= OWN_VOICE_SHARE
  return recent === undefined ? foundWhole(transcript, said) : ownShare(transcript, recent) >= OWN_VOICE_SHARE
}
