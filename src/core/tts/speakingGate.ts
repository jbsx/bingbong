import type { TtsIdle, TtsSpeaker } from '../ports/tts'
import { stripMarkdownForSpeech } from './stripMarkdownForSpeech'

export interface SpeakingGate extends TtsIdle {
  /** The wrapped speaker — hand this to the pipeline instead of the raw one. */
  tts: TtsSpeaker
}

/**
 * Watches the shared speaker so listeners can wait for speech to drain — the
 * confirmation voice window opens only after the spoken prompt finishes, so
 * the mic never transcribes the assistant's own voice.
 *
 * This gate is also the single TTS boundary (#52): every spoken line is
 * stripped of markdown here, so pipeline answers, download announcements
 * and confirmation prompts can never leak markers or URLs to the synth.
 */
export function createSpeakingGate(inner: TtsSpeaker): SpeakingGate {
  let outstanding = 0
  let idleListeners: (() => void)[] = []

  function settled(): void {
    outstanding -= 1
    if (outstanding > 0) return
    const listeners = idleListeners
    idleListeners = []
    for (const listener of listeners) listener()
  }

  const tts: TtsSpeaker = {
    speak: (text, turnId) => {
      outstanding += 1
      return inner.speak(stripMarkdownForSpeech(text), turnId).then(
        (outcome) => {
          settled()
          return outcome
        },
        (err: unknown) => {
          settled()
          throw err
        },
      )
    },
    stop: () => inner.stop(),
  }

  return {
    tts,
    waitIdle: () =>
      outstanding === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            idleListeners.push(resolve)
          }),
  }
}
