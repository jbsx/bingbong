import type { Command } from './command'
import { SPOKEN_FAILURES } from './spokenFailure'
import { hostOf } from '../pipeline/stageWords'

// The next line after a failure (#438, principles 9 and 10): an error says
// what happened and what to say next, since voice has no menu to discover
// and without the next line the person retries the same one. A fallback
// wording per failure and Command kind, in code: never a judgement, so
// never another ask (AGENTS.md "Jev decides; code shapes the ask"). Every
// line it names is one the grammar takes as it stands.

/** The failures that name their next line whatever the Command was. */
const BY_FAILURE: ReadonlyMap<string, string | null> = new Map([
  [SPOKEN_FAILURES.consent, 'click accept'],
  [SPOKEN_FAILURES.popup, 'press escape'],
  [SPOKEN_FAILURES.blocked, 'press escape'],
  // The Dismissal Ladder already pressed Escape on a pop-up that stayed: the way on is to leave its page.
  [SPOKEN_FAILURES.dialogStayed, 'back'],
  [SPOKEN_FAILURES.blocker, 'back'],
  [SPOKEN_FAILURES.notFound, 'back'],
  [SPOKEN_FAILURES.unavailable, 'back'],
  [SPOKEN_FAILURES.empty, 'back'],
  [SPOKEN_FAILURES.noPage, 'resume'],
  [SPOKEN_FAILURES.noBack, 'resume'],
  [SPOKEN_FAILURES.unsure, 'read'],
  [SPOKEN_FAILURES.notFinished, 'read'],
  [SPOKEN_FAILURES.noShelfFile, null],
])

/**
 * The line that would have worked after `failure`: by the failure when it
 * names one alone, else by the Command's kind; `words`, the line's own,
 * for what was not found here. Null when no line would do better.
 */
export function nextLine(failure: string, command?: Pick<Command, 'verb' | 'slot'> | null, words?: string): string | null {
  const fixed = BY_FAILURE.get(failure)
  if (fixed !== undefined) return fixed
  if (/^There's no item \d+ /.test(failure)) return 'read'
  if (words !== undefined && words.trim() !== '') return `search ${words.trim()}`
  switch (command?.verb) {
    case 'navigate':
      return command.slot !== null && command.slot !== '' ? `search ${hostOf(command.slot)}` : 'help'
    case 'search':
      return 'reload'
    case 'play':
      return 'not that one'
    case 'click':
    case 'type':
    case 'menu':
    case 'media':
    case 'scroll_up':
    case 'scroll_down':
      return 'read'
    default:
      return 'help'
  }
}

/** A failure with its next line (#438): under it on the screen, after it aloud — the same words. */
export function withNextLine(failure: string, next: string | null): { shown: string; said: string } {
  if (next === null) return { shown: failure, said: failure }
  const line = `Try “${next}”.`
  return { shown: `${failure}\n\n${line}`, said: `${failure} ${line}` }
}
