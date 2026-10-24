import type { SpeechSynthesizer } from '../ports/tts'
import { reportFault } from '../trace/fault'
import { KOKORO_PREFIX, kokoroVoiceOf, type KokoroVoice, type TtsEngine } from './ttsVoices'

/** Kokoro in main (#412): one line in a given voice → WAV bytes; rejects at once while its model is still being fetched. */
export interface KokoroSynthesizer {
  synthesize(text: string, voice: KokoroVoice): Promise<Uint8Array>
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
 * voice and the fault reported, so speech is never silent on a first boot.
 */
export function createVoiceRoutedSynthesizer(deps: VoiceRoutedSynthesizerDeps): SpeechSynthesizer {
  let last: TtsEngine | null = null

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
        reportFault('tts.voiceRoutedSynthesizer.kokoro', new Error(`no Kokoro voice '${voiceId}'`))
        return viaPiper(text)
      }
      try {
        const wav = await deps.kokoro.synthesize(text, voice)
        last = 'kokoro'
        return wav
      } catch (error) {
        reportFault('tts.voiceRoutedSynthesizer.kokoro', error)
        return viaPiper(text)
      }
    },
    spawnCount: () => deps.piper.spawnCount?.() ?? 0,
    lastEngine: () => last,
  }
}
