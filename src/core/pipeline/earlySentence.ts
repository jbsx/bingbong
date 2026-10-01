import { capSentences, closedSpokenSentence, SPEAK_SENTENCE_LIMIT } from '../agent/answerContract'
import { isOffLanguageRendering } from '../agent/answerLanguage'
import { repairSpokenRendering } from './answerEvidence'

// The Answer's spoken sentence, spoken when it closes (#312). `speak` is
// the Answer object's first key, so the sentence is complete in the stream
// a median 16.7 s before the round ends; the pipeline speaks it then and
// the round goes on. Only the checks that can be run on the sentence alone
// are run before it is spoken: the two-sentence cap, the Identity Slip
// repair (#246) and the Off-language check (#286). A sentence that fails
// one is not spoken early, and its round is handled as before.

/** A sentence that may be spoken before its round ends. */
export interface EarlySentence {
  /** As the Answer's `speak` would hold it: capped, as written. */
  readonly speak: string
  /** As it is voiced: the Identity Slips deleted. */
  readonly spoken: string
}

/** The sentence as it would be spoken, or null when it may not be spoken early. */
export function earlySentenceOf(sentence: string): EarlySentence | null {
  const speak = capSentences(sentence, SPEAK_SENTENCE_LIMIT)
  if (isOffLanguageRendering(speak)) return null
  const spoken = repairSpokenRendering(speak).text
  return spoken.trim() === '' ? null : { speak, spoken }
}

/**
 * One round's watch over its streamed text. `ready` settles once, with the
 * sentence, when the stream has closed it and it passed; it never settles
 * when it did not, or when the round streamed no Answer.
 */
export interface SpokenSentenceWatch {
  /** One streamed fragment of the round's raw content. */
  onText(text: string): void
  /**
   * The client retried the attempt (#47, #271): its partial text is
   * dropped, and a sentence it had already closed belongs to a reply that
   * never landed.
   */
  restart(): void
  /** Whether the sentence came from an attempt the client then retried: it was spoken for no Answer. */
  readonly abandoned: boolean
  readonly ready: Promise<EarlySentence>
}

export function createSpokenSentenceWatch(): SpokenSentenceWatch {
  let buffer = ''
  // Judged once: a later sentence in the same reply is not the Answer's.
  let judged = false
  let abandoned = false
  let resolve: (sentence: EarlySentence) => void = () => {}
  const ready = new Promise<EarlySentence>((settle) => {
    resolve = settle
  })
  return {
    onText(text) {
      if (judged) return
      buffer += text
      const sentence = closedSpokenSentence(buffer)
      if (sentence === null) return
      judged = true
      const early = earlySentenceOf(sentence)
      if (early !== null) resolve(early)
    },
    restart() {
      if (judged) abandoned = true
      else buffer = ''
    },
    get abandoned() {
      return abandoned
    },
    ready,
  }
}
