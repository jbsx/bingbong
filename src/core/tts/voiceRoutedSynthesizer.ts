import type { SpeechSynthesizer } from '../ports/tts'
import { reportFault } from '../trace/fault'
import { KOKORO_PREFIX, kokoroVoiceOf, type KokoroVoice, type TtsEngine } from './ttsVoices'

/** Kokoro in main (#412): one line in a given voice → WAV bytes; rejects at once while its model is still being fetched. */
export interface KokoroSynthesizer {
  /** `waitForVoice`: fetch the voice's style file (~0.5 MB) rather than refuse while it is missing, as a preview does; the model is never waited on. */
  synthesize(text: string, voice: KokoroVoice, options?: { waitForVoice?: boolean }): Promise<Uint8Array>
}

export interface VoiceRoutedSynthesizerDeps {
  /** Resolved per line, so a settings-page voice change applies at the next line. */
  getVoiceId(): string
  /** Null when Kokoro is off (the e2e's hermetic env): every line is Piper's, with no fault. */
  kokoro: KokoroSynthesizer | null
  /** Piper, voiced by `piperVoiceFor` over the same voice id. */
  piper: SpeechSynthesizer
}

/** The voice Piper speaks for a voice id: its own ids as they stand, the fallback voice for a Kokoro one. */
export function piperVoiceFor(voiceId: string, fallbackVoice: string): string {
  return voiceId.startsWith(KOKORO_PREFIX) ? fallbackVoice : voiceId
}

/**
 * The synthesizer the speech coordinator is given (#412): each line goes
 * to the engine its voice id names, Kokoro for `kokoro:<voice>`, Piper for
 * the rest. A Kokoro line that cannot be said, because the model is not
 * fetched yet or the engine failed, is said by Piper in the fallback
 * voice and the fault reported once per cause, so speech is never silent on a first
 * boot and the fault log is not a line per sentence of it.
 */
export function createVoiceRoutedSynthesizer(deps: VoiceRoutedSynthesizerDeps): SpeechSynthesizer {
  let last: TtsEngine | null = null
  /** The failure last reported: one fault per cause, not one per sentence while a fetch runs. Cleared once Kokoro speaks. */
  let reported: string | null = null

  function report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (message === reported) return
    reported = message
    reportFault('tts.voiceRoutedSynthesizer.kokoro', error)
  }

  async function viaPiper(text: string): Promise<Uint8Array> {
    last = 'piper'
    return deps.piper.synthesize(text)
  }

  return {
    async synthesize(text) {
      const voiceId = deps.getVoiceId()
      if (deps.kokoro === null || !voiceId.startsWith(KOKORO_PREFIX)) return viaPiper(text)
      const voice = kokoroVoiceOf(voiceId)
      if (voice === null) {
        report(new Error(`no Kokoro voice '${voiceId}'`))
        return viaPiper(text)
      }
      try {
        const wav = await deps.kokoro.synthesize(text, voice)
        last = 'kokoro'
        reported = null
        return wav
      } catch (error) {
        report(error)
        return viaPiper(text)
      }
    },
    spawnCount: () => deps.piper.spawnCount?.() ?? 0,
    lastEngine: () => last,
  }
}
