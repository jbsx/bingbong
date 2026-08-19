import type { Transcriber } from '../../core/ports/stt'
import { finalOnlyTranscriber } from '../../core/voice/finalOnlyTranscriber'

/** A scripted utterance: the transcript, optionally held for a delay. */
interface ScriptedUtterance {
  text: string
  /** Hold the promise this long before resolving — the STT window in e2e (#38). */
  delayMs?: number
}

/**
 * Scripted STT for the e2e suite (BINGBONG_STT_SCRIPT): a JSON array of
 * transcripts consumed one per utterance ('' afterwards), mirroring
 * BINGBONG_LLM_SCRIPT. An entry may be `{ text, delayMs }` to hold the
 * transcription like the real engine would — the e2e transcribing-state test
 * needs the window to last. The PCM content is ignored.
 */
export function createScriptedTranscriber(scriptJson: string): Transcriber {
  const parsed: unknown = JSON.parse(scriptJson)
  const isEntry = (t: unknown): t is string | ScriptedUtterance =>
    typeof t === 'string' ||
    (typeof t === 'object' &&
      t !== null &&
      typeof (t as { text?: unknown }).text === 'string' &&
      ((t as { delayMs?: unknown }).delayMs === undefined || typeof (t as { delayMs?: unknown }).delayMs === 'number'))
  if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
    throw new Error('BINGBONG_STT_SCRIPT must be a JSON array of strings or { text, delayMs } objects')
  }
  const script: ScriptedUtterance[] = (parsed as (string | ScriptedUtterance)[]).map((t) =>
    typeof t === 'string' ? { text: t } : t,
  )

  return finalOnlyTranscriber(async () => {
    const next = script.shift() ?? { text: '' }
    if (next.delayMs && next.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs))
    }
    return next.text
  })
}
