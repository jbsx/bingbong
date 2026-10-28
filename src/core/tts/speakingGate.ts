import type { TtsIdle, TtsSpeaker } from '../ports/tts'
import { stripMarkdownForSpeech } from './stripMarkdownForSpeech'

export interface SpeakingGate extends TtsIdle {
  /** The wrapped speaker — hand this to the pipeline instead of the raw one. */
  tts: TtsSpeaker
  /** Hears speaking start (the first line) and stop (the last one settled): the music ducks under it (#344). */
  onSpeakingChange(listener: (speaking: boolean) => void): () => void
}

/**
 * Watches the shared speaker so listeners can wait for speech to drain — a
 * Hot Listen's silence clock starts only once a spoken line finishes, and
 * speech captured while one plays is dropped, so the mic never transcribes
 * the app's own voice.
 *
 * This gate is also the single TTS boundary (#52): every spoken line is
 * stripped of markdown here, so pipeline answers, download announcements
 * and confirmation prompts can never leak markers or URLs to the synth.
 */
export function createSpeakingGate(inner: TtsSpeaker): SpeakingGate {
  let outstanding = 0
  // The texts being said now, in the order they were asked (#490).
  const saying: string[] = []
  let idleListeners: (() => void)[] = []
  const changeListeners = new Set<(speaking: boolean) => void>()

  function changed(speaking: boolean): void {
    for (const listener of [...changeListeners]) listener(speaking)
  }

  function settled(): void {
    outstanding -= 1
    if (outstanding > 0) return
    changed(false)
    const listeners = idleListeners
    idleListeners = []
    for (const listener of listeners) listener()
  }

  const tts: TtsSpeaker = {
    speak: (text, options) => {
      const said = stripMarkdownForSpeech(text)
      saying.push(said)
      outstanding += 1
      if (outstanding === 1) changed(true)
      const over = (): void => {
        saying.splice(saying.indexOf(said), 1)
        settled()
      }
      return inner.speak(said, options).then(
        (outcome) => {
          over()
          return outcome
        },
        (err: unknown) => {
          over()
          throw err
        },
      )
    },
    stop: () => inner.stop(),
    ...(inner.duck ? { duck: (on: boolean) => inner.duck!(on) } : {}),
  }

  return {
    tts,
    isSpeaking: () => outstanding > 0,
    speechText: () => saying.join(' '),
    soundedText: (windowMs) => inner.sounded?.(windowMs) ?? '',
    onSpeakingChange(listener) {
      changeListeners.add(listener)
      return () => changeListeners.delete(listener)
    },
    waitIdle: () =>
      outstanding === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            idleListeners.push(resolve)
          }),
  }
}
