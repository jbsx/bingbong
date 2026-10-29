import type { TtsSpeaker } from '../ports/tts'
import type { LineChime } from './chime'
import type { SpeakingGate } from './speakingGate'
import { stripMarkdownForSpeech } from './stripMarkdownForSpeech'

/** A line the app would have said (#513): its words as the voice would have had them, and whether it tells a failure. */
export interface ShownLine {
  readonly text: string
  readonly failure: boolean
}

export interface ShownSpeechDeps {
  /** Puts the line on the Line Overlay. */
  show(line: ShownLine): void
  /** Plays the line's chime: done, or failed for a failure. */
  chime(kind: LineChime): void
}

/**
 * The voice off (#513, owner's ruling 2026-10-29): the speaker every spoken
 * line goes to — the runner's, a site's question, an Errand's ask, a
 * download, the ear's — shows it and chimes instead of saying it. It stands
 * where the speaking gate does, and nothing is ever being said: no capture
 * is muted, nothing ducks under speech, and the mic hears the person
 * whenever a listen is open.
 */
export function createShownSpeech(deps: ShownSpeechDeps): SpeakingGate {
  const tts: TtsSpeaker = {
    speak: (text, options = {}) => {
      const failure = options.failure === true
      deps.show({ text: stripMarkdownForSpeech(text), failure })
      deps.chime(failure ? 'failed' : 'done')
      // Shown is its first effect: a Command whose output was speech has its Reaction close here.
      options.onFirstSound?.()
      return Promise.resolve({ ok: true })
    },
    stop: () => {},
  }
  return {
    tts,
    isSpeaking: () => false,
    speechText: () => '',
    soundedText: () => '',
    onSpeakingChange: () => () => {},
    waitIdle: () => Promise.resolve(),
  }
}
