// The app's own voice in the microphone (#490, T-B arm B1): speech the ear
// took while the app was talking is the app's own when its words are the
// sentence being said, compared by text. The person's line over it carries
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
 * The share of a transcript's words the app's sentence holds, in order, at
 * which the transcript is the app's own. A guess (the grill, Q3: it starts
 * at reliability.md's 0.7 similarity); the kiosk's speaking-time dumps
 * (`speaking-*.wav` under BINGBONG_AUDIO_DUMP=1) settle it.
 */
export const OWN_VOICE_SHARE = 0.7

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')

/** The share of the transcript's words found in the app's sentence in their order (a longest common subsequence). */
export function ownShare(transcript: string, said: string): number {
  const heard = wordsOf(transcript)
  const spoken = wordsOf(said)
  if (heard.length === 0 || spoken.length === 0) return 0
  let row = new Array<number>(spoken.length + 1).fill(0)
  for (const word of heard) {
    const next = new Array<number>(spoken.length + 1).fill(0)
    for (let j = 1; j <= spoken.length; j++) next[j] = word === spoken[j - 1] ? row[j - 1]! + 1 : Math.max(row[j]!, next[j - 1]!)
    row = next
  }
  return row[spoken.length]! / heard.length
}

/** Whether a transcript taken while the app spoke is the app's own voice: its words are the sentence being said. */
export function isOwnVoice(transcript: string, said: string): boolean {
  return ownShare(transcript, said) >= OWN_VOICE_SHARE
}
