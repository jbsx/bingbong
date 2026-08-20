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

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/**
 * The string value starting at `openQuote` (its index in `content`), with
 * completed escapes unescaped — everything visible so far. Stops at the
 * closing quote or the first incomplete escape.
 */
function partialStringValue(content: string, openQuote: number): string {
  let out = ''
  for (let i = openQuote + 1; i < content.length; i += 1) {
    const char = content[i]!
    if (char === '"') return out
    if (char !== '\\') {
      out += char
      continue
    }
    const escaped = content[i + 1]
    if (escaped === undefined) return out
    if (escaped === 'u') {
      const hex = content.slice(i + 2, i + 6)
      if (hex.length < 4 || /[^0-9a-fA-F]/.test(hex)) return out
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 5
      continue
    }
    out += ESCAPES[escaped] ?? `\\${escaped}`
    i += 1
  }
  return out
}

/**
 * The visible fragment of a partially streamed answer (#47): the raw
 * content buffer is the answer-contract JSON in flight, so the first
 * `"display"`/`"speak"` value that opens streams (unescaping completed
 * escapes); prose — the fallback contract — streams raw. Monotonic: the
 * visible text only grows as the buffer grows, so successive calls diff
 * cleanly into flush fragments. The first key to open owns the stream; a
 * later key never shrinks it (the final display entry replaces the
 * partial at round end).
 */
export function partialAnswerText(content: string): string {
  if (!content.trimStart().startsWith('{')) return content
  const key = /"(?:display|speak)"\s*:\s*"/.exec(content)
  if (!key) return ''
  return partialStringValue(content, key.index + key[0].length - 1)
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
