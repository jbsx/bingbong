// The Voice Prompt (ADR 0078, #359): the Prompt Bar's F1 form — orb, hint,
// waveform, the voice state, and while an Utterance is taken the live
// partial words with a Page Term in peach. Pure: words and terms in,
// spans out.

import type { EarLoading } from './ipcChannels'

export interface PartialSpan {
  text: string
  /** The span is a Page Term the page shows. */
  term: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The live words split into spans, each Page Term found in them as whole
 * words (any case) marked — where two terms start at the same word, the
 * longer wins.
 */
export function partialSpans(text: string, terms: readonly string[]): PartialSpan[] {
  const usable = [...new Set(terms.map((term) => term.trim()).filter((term) => term !== ''))].sort((a, b) => b.length - a.length)
  if (usable.length === 0 || text === '') return [{ text, term: false }]
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  const spans: PartialSpan[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start > last) spans.push({ text: text.slice(last, start), term: false })
    spans.push({ text: match[0], term: true })
    last = start + match[0].length
  }
  if (last < text.length) spans.push({ text: text.slice(last), term: false })
  return spans
}

/** The ear's real state, as the Voice Prompt says it (CONTEXT.md). */
export type EarPhase = 'starting' | 'failed' | 'rest' | 'listening' | 'hearing' | 'transcribing' | 'off'

/**
 * What the ear is doing: starting (#442) — open but unable to hear yet, or
 * holding a line it took until it can read it; failed (#447) — a model it
 * hears or reads with did not load, the wait ended, or the capture did not
 * open (#530), so no frame reaches it; open for an Utterance,
 * hearing one being spoken (#441), reading one it took, waiting for the
 * wake word (at rest), or nothing at all — the microphone off. While the
 * app speaks, an open ear that has heard nothing is at rest (#472): what
 * starts under the line is dropped as its own voice, and only the wake
 * word, which cuts it, is heard — unless it hears the person over the
 * app's voice (#490), when it listens still. Before main has said, at rest.
 */
export function earPhase(voice: { listening: boolean; transcribing: boolean; monitoring: boolean; hearing: boolean; speaking?: boolean; overSpeech?: boolean; loading?: EarLoading; captureFailed?: boolean } | null): EarPhase {
  if (voice === null) return 'rest'
  // No capture hears nothing, listen open or not; only a line already taken is still in hand to read.
  // An ear that asks for none is off as ever: a hotkey-only ear's next Ctrl+Space tries again.
  if (voice.captureFailed === true && !voice.transcribing && (voice.listening || voice.monitoring)) return 'failed'
  // A model that did not load ends the wait (#447) open or shut — a monitor whose VAD threw has stopped itself, and is not a microphone switched off —
  // unless a listen or a read is under way: with only the wake word failed, Ctrl+Space still opens an ear that hears.
  if (voice.loading === 'failed' && !voice.listening && !voice.transcribing) return 'failed'
  // The models that hear load as the microphone opens: shut, it is off, not starting.
  if (voice.loading === 'ear' && (voice.listening || voice.transcribing || voice.monitoring)) return 'starting'
  // A line taken before the transcriber is in waits for it: still the ear's cold start, counted from the Endpoint.
  if (voice.transcribing) return voice.loading === 'words' ? 'starting' : 'transcribing'
  if (voice.listening && voice.hearing) return 'hearing'
  if (voice.listening && (voice.speaking !== true || voice.overSpeech === true)) return 'listening'
  return voice.monitoring ? 'rest' : 'off'
}

/**
 * The said-line before the first partial lands (#441): "say a command"
 * while the open ear waits for speech; "…" from the frame speech starts —
 * the receipt that the ear has the line — and through the read.
 */
export function wordlessLine(phase: EarPhase): string {
  return phase === 'listening' ? 'say a command' : '…'
}

/** Whole seconds from a phase's start to `now`, both on the caller's clock (#442); 0 before main has said when it began. */
export function waitSeconds(since: number | undefined, now: number): number {
  return since === undefined ? 0 : Math.floor(Math.max(0, now - since) / 1000)
}

/**
 * The ear's wait narrated (#442, UI principle 2), in two parts: what it is
 * on — the part a short line ellipsizes — and its seconds in this phase,
 * counted on the renderer's clock, which stay in sight. Starting with no
 * line, the ear loading; with one, and transcribing, the words — the last
 * partial, or "your words" with none. The person's words, never a model's
 * name.
 */
export function earWaitParts(phase: 'starting' | 'transcribing', voice: { partial: string; transcribing?: boolean; since?: number }, now: number): { object: string; tail: string } {
  const object = phase === 'starting' && voice.transcribing !== true ? 'loading the ear' : voice.partial === '' ? 'your words' : `“${voice.partial}”`
  return { object, tail: ` · ${waitSeconds(voice.since, now)}s` }
}

/** The wait as one line: {@link earWaitParts} joined. */
export function earWaitLine(phase: 'starting' | 'transcribing', voice: { partial: string; transcribing?: boolean; since?: number }, now: number): string {
  const { object, tail } = earWaitParts(phase, voice, now)
  return `${object}${tail}`
}

/** What ends the Utterance being taken (#357): the turn check when the words are done, else the Pause cap of quiet, in seconds. */
export function quietLine(pauseCapMs: number): string {
  return `ends when you finish — ${Number((pauseCapMs / 1000).toFixed(2))} s at most`
}
