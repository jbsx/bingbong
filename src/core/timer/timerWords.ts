import { parseDuration } from './duration'

// The spoken lines that are about the Timer (CONTEXT.md): "set a timer for
// five minutes", "ten minute timer", "cancel the timer". Read before the
// verb phrases, since "cancel" and "stop" alone are the stop verb, and
// "set" heads nothing else.

export type TimerWords = { readonly kind: 'set'; readonly durationMs: number } | { readonly kind: 'cancel' }

const CANCEL = /^(?:please )?(?:cancel|stop|clear|end|dismiss|silence|turn off|kill|delete|remove) (?:the |my |that )?(?:timer|alarm)(?: off)?$|^(?:timer|alarm) off$|^turn (?:the |my )?(?:timer|alarm) off$/

/** The words that may head a set: "set a", "start me a", "please put on the". */
const SET_HEAD = /^(?:please )?(?:(?:set|start|make|put on|give me|run|begin)(?: me)? )?(?:a |an |the |my )?/

/** The line lower-cased, punctuation off but a length's own `.` and `:` kept ("1.5 hours", "2:30"). */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9.:\s]/g, ' ')
    .replace(/[.:](?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** What a line says about the Timer; null when it is about something else, or names no length. */
export function readTimerWords(text: string): TimerWords | null {
  const words = wordsOf(text)
  if (CANCEL.test(words)) return { kind: 'cancel' }
  const body = words.replace(SET_HEAD, '')
  // "timer for 5 minutes", "timer 5m", or "5 minute timer".
  const length = /^timer (?:for |of )?(.+)$/.exec(body)?.[1] ?? /^(.+?) timer$/.exec(body)?.[1]
  if (length === undefined) return null
  const durationMs = parseDuration(length)
  return durationMs === null ? null : { kind: 'set', durationMs }
}
