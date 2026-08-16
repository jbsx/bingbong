// The orchestrator's response contract: every final answer carries a short
// spoken line (≤ SPEAK_SENTENCE_LIMIT sentences) plus full display text, and
// errors get a spoken one-liner while the dashboard keeps the detail.

export const SPEAK_SENTENCE_LIMIT = 2

/**
 * Keep at most `max` sentences. A sentence ends at a [.!?] run followed by
 * whitespace (or end of text) — so URLs and numbers like `youtube.com` or
 * `1.5gb` do not split mid-token.
 */
export function capSentences(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== '')
  return sentences.slice(0, max).join(' ')
}

/** A spoken one-liner for an error; the full message stays on the dashboard. */
export function spokenErrorLine(message: string): string {
  const first = capSentences(message, 1)
  return first === '' ? 'Something went wrong.' : `Something went wrong: ${first}`
}

function extractFenced(content: string): string | null {
  const match = content.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/)
  return match ? match[1] : null
}

function extractJsonSlice(content: string): string | null {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const slice = content.slice(start, end + 1)
  return slice === content ? null : slice
}

/**
 * Parse the model's final message into {speak, display}. Accepted shapes, in
 * order: a bare JSON object, a JSON object in a code fence, a JSON object with
 * surrounding prose. Anything else falls back to the raw text — capped for
 * speaking, unchanged for display.
 */
export function parseAssistantAnswer(content: string): { speak: string; display: string } {
  const trimmed = content.trim()
  const candidates = [trimmed, extractFenced(trimmed), extractJsonSlice(trimmed)]

  for (const candidate of candidates) {
    if (candidate === null) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (
        typeof parsed === 'object' && parsed !== null &&
        typeof (parsed as { speak?: unknown }).speak === 'string' &&
        typeof (parsed as { display?: unknown }).display === 'string'
      ) {
        const { speak, display } = parsed as { speak: string; display: string }
        return { speak: capSentences(speak, SPEAK_SENTENCE_LIMIT), display }
      }
    } catch {
      // try the next candidate
    }
  }

  return { speak: capSentences(trimmed, SPEAK_SENTENCE_LIMIT), display: trimmed }
}
