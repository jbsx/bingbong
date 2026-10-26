import type { Command, CommandVerb } from './command'
import { isAddressShaped } from './openAddress'
import { SPOKEN_FAILURES } from './spokenFailure'

// The next line after a failure (#438, principles 9 and 10): an error says
// what happened and what to say next, since voice has no menu to discover
// and without the next line the person retries the same one. A fallback
// wording per failure and Command kind, in code: never a judgement, so
// never another ask (AGENTS.md "Jev decides; code shapes the ask"). Every
// line it names is one the Local Match takes as it stands, with no Jev
// call (#445, pinned by its test), on any page but one with a control
// labelled with the line's very words (ADR 0089: "back" beside a Back
// link has two readings). A line Jev would have to read — "search …",
// "not that one", "click accept" on a wall whose button says "Accept
// all" — is none of them.

/** Every fixed Try line, by the Command verb the Local Match reads it as. */
export const TRY_LINES = {
  help: 'help',
  read: 'read',
  back: 'back',
  reload: 'reload',
  resume: 'resume',
  press: 'press escape',
} as const satisfies Partial<Record<CommandVerb, string>>

/** The grammar's own search line for `words` (#445): `navigate` with words that are no address runs the search they name. */
export function searchLine(words: string): string {
  return `navigate ${words.trim()}`
}

/** The failures that name their next line whatever the Command was. */
export const BY_FAILURE: ReadonlyMap<string, string | null> = new Map([
  // The consent rule already clicked its pick and the wall stayed; a click by label fires only where a button says it word for word.
  [SPOKEN_FAILURES.consent, TRY_LINES.back],
  [SPOKEN_FAILURES.popup, TRY_LINES.press],
  [SPOKEN_FAILURES.blocked, TRY_LINES.press],
  // The Dismissal Ladder already pressed Escape on a pop-up that stayed: the way on is to leave its page.
  [SPOKEN_FAILURES.dialogStayed, TRY_LINES.back],
  [SPOKEN_FAILURES.blocker, TRY_LINES.back],
  [SPOKEN_FAILURES.notFound, TRY_LINES.back],
  [SPOKEN_FAILURES.unavailable, TRY_LINES.back],
  [SPOKEN_FAILURES.empty, TRY_LINES.back],
  [SPOKEN_FAILURES.noPage, TRY_LINES.resume],
  [SPOKEN_FAILURES.noBack, TRY_LINES.resume],
  [SPOKEN_FAILURES.unsure, TRY_LINES.read],
  [SPOKEN_FAILURES.notFinished, TRY_LINES.read],
  [SPOKEN_FAILURES.noShelfFile, null],
])

/** The next line by the failed Command's kind, when the failure names none; `help` for a kind not listed. */
export const BY_KIND: Readonly<Partial<Record<CommandVerb, string | null>>> = {
  // The grammar has no line that searches for an address (`navigate <host>` opens it again), and an IP or localhost has nothing to search for.
  navigate: TRY_LINES.back,
  search: TRY_LINES.reload,
  // "not that one" is Jev's to read (ADR 0089), and the Queue already moved on past the song.
  play: null,
  click: TRY_LINES.read,
  type: TRY_LINES.read,
  menu: TRY_LINES.read,
  media: TRY_LINES.read,
  scroll_up: TRY_LINES.read,
  scroll_down: TRY_LINES.read,
}

/**
 * The line that would have worked after `failure`: by the failure when it
 * names one alone, else by the Command's kind; `words`, the line's own,
 * for what was not found here. Null when no line would do better.
 */
export function nextLine(failure: string, command?: Pick<Command, 'verb' | 'slot'> | null, words?: string): string | null {
  const fixed = BY_FAILURE.get(failure)
  if (fixed !== undefined) return fixed
  if (/^There's no item \d+ /.test(failure)) return TRY_LINES.read
  // Words that read as an address would be opened, not searched for.
  if (words !== undefined && words.trim() !== '' && !isAddressShaped(words.trim())) return searchLine(words)
  const byKind = command === undefined || command === null ? undefined : BY_KIND[command.verb]
  return byKind === undefined ? TRY_LINES.help : byKind
}

/** A failure with its next line (#438): under it on the screen, after it aloud — the same words. */
export function withNextLine(failure: string, next: string | null): { shown: string; said: string } {
  if (next === null) return { shown: failure, said: failure }
  const line = `Try “${next}”.`
  return { shown: `${failure}\n\n${line}`, said: `${failure} ${line}` }
}
