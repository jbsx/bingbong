// The voice records (#186, ADR 0031): the Host Trace's first real record
// set. The voice pipeline is the one subsystem a user drives directly and
// the one that left almost nothing behind — two `console.log` lines in the
// Learned Terms ledger, and otherwise a perf span with durations but no
// words. When a wake word does not fire, an utterance is cut in half, or a
// transcript comes back as something the user never said, the question is
// always what the pipeline actually heard, and until now the answer was
// nowhere.
//
// Every kind here is host-scoped by the boundary rule: the ear runs
// outside any Run — it is what *starts* one — so these records name the
// Active Session and never a turn. That is also why the whole set rides
// `BINGBONG_HOST_TRACE`: with the flag unset there is no writer, and a
// deployed Kiosk keeps no record of anything anyone said near it.

import type { VoiceListenReason } from '../voice/ipcChannels'

/**
 * How much of a transcript a `voice_stt` record keeps. An utterance is
 * hard-capped well below this, so the cut is a backstop against a runaway
 * engine rather than something a normal line meets.
 */
export const TRACE_TRANSCRIPT_MAX_CHARS = 4_000

/**
 * How much of one spoken line a `tts_line` record keeps. Answers are
 * bounded before they reach speech; the cut keeps a pathological one from
 * spending the roll on its own.
 */
export const TRACE_SPOKEN_LINE_MAX_CHARS = 4_000

/**
 * One wake-word detection as the monitor scored it (#186). Written for the
 * detection that fired, never for the thousands of chunks that did not:
 * the always-on ear scores every 80 ms, and a record per chunk would be a
 * file about nothing. The scores are what a missed or spurious wake is
 * diagnosed against — a detection that cleared the threshold but not the
 * VAD gate never reaches here, because it never happened as far as the
 * session is concerned.
 */
export interface WakeDetectedEvent {
  readonly kind: 'voice_wake'
  /** Which head fired: the activation word, or the dedicated abort head (#22). */
  readonly head: 'wake' | 'abort'
  /** The head's score on the chunk that fired it. */
  readonly score: number
  /** The live threshold from settings the score was judged against. */
  readonly threshold: number
  /** Highest VAD probability in the recent window — the music/noise gate. */
  readonly gateMax: number
  /** The gate the VAD maximum had to clear. */
  readonly gate: number
}

/**
 * One utterance endpoint as the endpointer fired it (#186). The durations
 * are the perf span's, kept here beside the words so a truncated command
 * ("play the—") and the endpoint that cut it are one file apart rather
 * than two.
 */
export interface UtteranceEndpointEvent {
  readonly kind: 'voice_endpoint'
  /** Speech-probable milliseconds in the utterance. */
  readonly speechMs: number
  /** Wall-clock milliseconds from capture start to the endpoint. */
  readonly totalMs: number
  /** Whether the utterance hit the hard cap rather than ending on silence. */
  readonly truncated: boolean
  /** Why the listen was open: hotkey, wake, a confirmation window, a pause. */
  readonly reason: VoiceListenReason | null
}

/**
 * One transcript as STT returned it (#186), with the Learned Terms the
 * decode was biased toward and the ones the text actually contains. A
 * mishearing is diagnosed by exactly this pair: a term in the bias set
 * that never lands, or a term that lands where the user did not say it.
 */
export interface SttTranscriptEvent {
  readonly kind: 'voice_stt'
  /** The transcript, trimmed as the session trimmed it, cut at {@link TRACE_TRANSCRIPT_MAX_CHARS}. */
  readonly text: string
  /** Full length before the cut, so truncation is visible. */
  readonly chars: number
  /** How long the engine took, in milliseconds. */
  readonly durationMs: number
  /** How many bias phrases the decode was given — the size of the haystack. */
  readonly biasCount: number
  /** The bias phrases the transcript contains (#186), lowercased. */
  readonly biasHits: readonly string[]
  /** The engine's own error, on a failed pass; absent on success. */
  readonly error?: string
}

/**
 * One change to the Learned Terms ledger (#186), replacing the two
 * `console.log` lines it used to leave. The growth of the lexicon is ADR
 * 0022's whole story and it belongs in a file that can be read after the
 * fact, beside the transcripts the admissions came from.
 */
export interface LearnedTermEvent {
  readonly kind: 'learned_term'
  /** How the change was made: a Run's proposals, or the settings list. */
  readonly source: 'proposals' | 'manual'
  readonly admitted: readonly string[]
  readonly removed: readonly string[]
}

/**
 * One line as it was handed to Piper (#186) — the exact text, not the
 * answer it came from. What the user hears is the last transformation in
 * a long chain, and a line that reads wrong aloud is diagnosed by what
 * the synthesizer was actually given.
 */
export interface SpokenLineEvent {
  readonly kind: 'tts_line'
  /** The text handed to the synthesizer, cut at {@link TRACE_SPOKEN_LINE_MAX_CHARS}. */
  readonly text: string
  /** Full length before the cut. */
  readonly chars: number
  /** The turn the line belongs to, when it had one — a download announcement has none. */
  readonly turnId?: string
}

/**
 * One line barge-in dropped (#186). A user who hears half an answer and a
 * user who hears none at all are the same bug report; the difference is
 * whether the line was still queued when the wake word cut it, or already
 * rendered and waiting to play.
 */
export interface DroppedLineEvent {
  readonly kind: 'tts_dropped'
  /** The dropped text, cut at {@link TRACE_SPOKEN_LINE_MAX_CHARS}. */
  readonly text: string
  readonly chars: number
  /**
   * Where the line was when the stop reached it: `queued` — never
   * synthesized; `synthesized` — rendered, then dropped before playback;
   * `speaking` — cut off mid-playback.
   */
  readonly stage: 'queued' | 'synthesized' | 'speaking'
  readonly turnId?: string
}

/** Everything the voice pipeline records (#186). All host-scoped. */
export type VoiceTraceEvent =
  | WakeDetectedEvent
  | UtteranceEndpointEvent
  | SttTranscriptEvent
  | LearnedTermEvent
  | SpokenLineEvent
  | DroppedLineEvent

/** One line's text as a record keeps it: cut, with the true length beside it. */
export function tracedText(text: string, maxChars: number): { text: string; chars: number } {
  return { text: text.slice(0, maxChars), chars: text.length }
}

/**
 * Which bias phrases a transcript contains. Word-boundary matching on the
 * lowercased text, so `bing` does not hit inside `binge` — a hit list that
 * over-reports is one nobody can read a mishearing out of.
 */
export function biasHits(text: string, phrases: readonly string[]): string[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  const hits: string[] = []
  for (const phrase of phrases) {
    const needle = phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (needle !== '' && haystack.includes(` ${needle} `) && !hits.includes(needle)) hits.push(needle)
  }
  return hits
}
