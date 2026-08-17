import type { Transcriber } from '../../core/ports/stt'

/**
 * Scripted STT for the e2e suite (BINGBONG_STT_SCRIPT): a JSON array of
 * transcripts consumed one per utterance ('' afterwards), mirroring
 * BINGBONG_LLM_SCRIPT. The PCM content is ignored.
 */
export function createScriptedTranscriber(scriptJson: string): Transcriber {
  const parsed: unknown = JSON.parse(scriptJson)
  if (!Array.isArray(parsed) || !parsed.every((t) => typeof t === 'string')) {
    throw new Error('BINGBONG_STT_SCRIPT must be a JSON array of strings')
  }
  const script = [...(parsed as string[])]

  return {
    async transcribe() {
      return script.shift() ?? ''
    },
  }
}
