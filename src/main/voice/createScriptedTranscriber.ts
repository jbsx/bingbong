import type { Transcriber } from '../../core/ports/stt'

/** A scripted utterance: the transcript, optionally held for a delay, optionally heard in partials first. */
interface ScriptedUtterance {
  text: string
  /** Hold the promise this long before resolving — the STT window in e2e (#38). */
  delayMs?: number
  /** The partial transcripts emitted while the utterance is spoken (Early Fire, #326), one every {@link SCRIPTED_PARTIAL_STRIDE_FRAMES} frames. */
  partials?: string[]
}

/** Frames pushed between scripted partials: the real engine's first after 1 s and every 0.5 s after, compressed for the suite. */
export const SCRIPTED_PARTIAL_STRIDE_FRAMES = 2

function isEntry(t: unknown): t is string | ScriptedUtterance {
  if (typeof t === 'string') return true
  if (typeof t !== 'object' || t === null) return false
  const entry = t as { text?: unknown; delayMs?: unknown; partials?: unknown }
  return (
    typeof entry.text === 'string' &&
    (entry.delayMs === undefined || typeof entry.delayMs === 'number') &&
    (entry.partials === undefined || (Array.isArray(entry.partials) && entry.partials.every((p) => typeof p === 'string')))
  )
}

/**
 * Scripted STT for the e2e suite (BINGBONG_STT_SCRIPT): a JSON array of
 * transcripts consumed one per utterance ('' afterwards), mirroring
 * BINGBONG_LLM_SCRIPT. An entry may be `{ text, delayMs, partials }`:
 * `delayMs` holds the transcription like the real engine would — the e2e
 * transcribing-state test needs the window to last — and `partials` are
 * emitted while the utterance is spoken, one every
 * {@link SCRIPTED_PARTIAL_STRIDE_FRAMES} pushed frames, the way Moonshine
 * streams them (#326). The PCM content is ignored.
 */
export function createScriptedTranscriber(scriptJson: string): Transcriber {
  const parsed: unknown = JSON.parse(scriptJson)
  if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
    throw new Error('BINGBONG_STT_SCRIPT must be a JSON array of strings or { text, delayMs, partials } objects')
  }
  const script: ScriptedUtterance[] = (parsed as (string | ScriptedUtterance)[]).map((t) => (typeof t === 'string' ? { text: t } : t))
  const listeners = new Set<(text: string) => void>()
  // Frames pushed in the capture under way, and how many of its partials are out.
  let pushed = 0
  let emitted = 0

  return {
    begin() {
      pushed = 0
      emitted = 0
    },
    push() {
      pushed += 1
      const partials = script[0]?.partials ?? []
      if (emitted < partials.length && pushed % SCRIPTED_PARTIAL_STRIDE_FRAMES === 0) {
        const partial = partials[emitted]!
        emitted += 1
        for (const listener of listeners) listener(partial)
      }
    },
    onPartial(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async finish() {
      const next = script.shift() ?? { text: '' }
      if (next.delayMs && next.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, next.delayMs))
      }
      return next.text
    },
    cancel() {
      pushed = 0
      emitted = 0
    },
  }
}
