import { isRealPage, lastPageLabel } from '../browser/lastPage'
import { pageReadPart, pageReadText } from '../browser/pageText'
import type { Command } from './command'
import type { JevDetail, JevUnavailable } from './decisionRecord'
import { SPOKEN_FAILURES } from './spokenFailure'
import type { DecisionUnavailableReason } from '../ports/decisionModel'
import { describeDuration } from '../timer/duration'

// The Answer a Command leaves in the Feed (#333): exactly one per Command,
// written from facts the Command and the page already hold — never by a
// model. Jev only picks the Command.

/** The Answer of a Command a Stop ended (the Stop button, Escape, the Abort Head, `stop`), and of one a later Command ended. */
export const STOPPED_ANSWERS = {
  stopped: 'Stopped.',
  superseded: 'Stopped: a later Command came first.',
  /** A `stop` with nothing in flight paused the music (#343). */
  paused: 'Paused.',
  /** A `stop` that found nothing in flight, being read, sounding or ringing, and no music playing. */
  nothing: 'Nothing to stop.',
} as const

/** Why Jev gave no reading, in the words "No response." is followed by. */
const JEV_UNAVAILABLE: Record<DecisionUnavailableReason, string> = {
  timeout: "Jev didn't answer in time.",
  transport: "Jev couldn't be reached.",
  http: "Jev's service answered with an error.",
  malformed: "Jev's answer couldn't be read.",
  cancelled: "Jev's call was cancelled.",
  failed: "Jev's call failed.",
}

/** What a reading that settled no Command was made of: its verb, the grammar's own error, and Jev's part in it. */
export interface NoResponseFacts {
  readonly verb: 'none' | 'done'
  /** The grammar's error, in plain words, for a line that starts with a verb it knows (`grammarErrorOf`). */
  readonly grammarError: string | null
  readonly jevAsked: boolean
  readonly jev?: JevDetail | JevUnavailable
}

/** Why nothing was done: the most specific of the grammar's error, Jev being off or not answering, and Jev's reading. */
function noResponseReason(facts: NoResponseFacts): string {
  if (facts.verb === 'done') return 'The page already shows what was asked.'
  if (facts.grammarError !== null) return facts.grammarError
  if (!facts.jevAsked) return "Jev is off, and the words aren't a command the grammar knows — try “help”."
  const jev = facts.jev
  if (jev !== undefined && 'reason' in jev) return JEV_UNAVAILABLE[jev.reason]
  const verbs = Object.entries(jev?.probabilities.verb ?? {})
  const top = verbs.length > 0 ? verbs.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0] : 'none'
  return top === 'none' || top === 'done' ? 'Jev read no command in the words.' : `Jev read “${top}”, but nothing on this page fits it.`
}

/**
 * The Answer of an Utterance read as no Command (owner ruling 2026-10-19):
 * never a silent fade — "No response." and, under it, the real reason.
 */
export function noResponseAnswer(facts: NoResponseFacts): string {
  return `No response.\n\n${noResponseReason(facts)}`
}

/** What a page is called in an Answer: its title, or its site's name when it has none. */
export function pageName(page: { url: string; title: string }): string {
  return lastPageLabel(page).title
}

/** A `search`: what it searched for, and on which site when it was scoped to one (#340). */
function searchAnswer(command: Command): string {
  return `Searched ${command.site ?? 'the web'} for “${command.slot ?? ''}”.`
}

/** What an Answer is written from: the page the action left, and the target ref's label (click, type). */
export interface AnswerFacts {
  readonly page: { url: string; title: string }
  readonly label?: string
  /** A scroll that brought nothing new into view (`SCROLL_END_OF_PAGE`): the page was already at its end. */
  readonly scrollEnded?: boolean
}

/**
 * The one-line Answer of a Command that leaves no Card (#333): a fixed
 * sentence per verb, filled in from its facts. Null for the verbs whose
 * Answer is a Card (read, screenshot, help) and the ones that fire nothing.
 */
export function commandAnswer(command: Command, facts: AnswerFacts): string | null {
  const ref = (): string => (facts.label !== undefined && facts.label !== '' ? `“${facts.label}”` : `item ${command.target ?? '?'}`)
  if (command.dismiss === true) return 'Closed the pop-up.'
  switch (command.verb) {
    case 'navigate':
      return `Opened ${pageName(facts.page)}.`
    case 'search':
      return searchAnswer(command)
    case 'click':
      return `Clicked ${ref()}.`
    case 'type':
      return `Typed into ${ref()}.`
    case 'menu':
      return `Opened the menu on ${ref()}.`
    case 'scroll_up':
      return facts.scrollEnded === true ? 'Already at the top.' : 'Scrolled up.'
    case 'scroll_down':
      return facts.scrollEnded === true ? 'Already at the bottom.' : 'Scrolled down.'
    case 'back':
      return `Went back to ${pageName(facts.page)}.`
    case 'forward':
      return `Went forward to ${pageName(facts.page)}.`
    case 'reload':
      return 'Reloaded.'
    case 'press': {
      const key = command.key ?? { key: 'Enter' }
      const times = command.times ?? 1
      return `Pressed ${key.shift ? 'Shift+' : ''}${key.key}${times > 1 ? ` ${times} times` : ''}.`
    }
    case 'clear':
      return 'Cleared the field.'
    case 'stop':
      return STOPPED_ANSWERS.stopped
    case 'resume':
      // Nothing to resume leaves the pane where it was: on no page.
      return isRealPage(facts.page.url) ? `Back on ${pageName(facts.page)}.` : 'There is no page to resume yet.'
    case 'timer':
      return command.durationMs !== undefined ? `Timer set for ${describeDuration(command.durationMs)}.` : 'Timer off.'
    case 'read':
    case 'screenshot':
    case 'help':
    // The Player writes its own Answer (#343): what it played or queued is known only once it has.
    case 'play':
    case 'none':
    case 'done':
      return null
  }
}

/** The page a Page Read is of, off its `# title — address` head (a consent dismissal may ride above it). */
function pageReadHead(result: string): { url: string; title: string } {
  const head = result.split('\n').find((line) => line.startsWith('# ')) ?? ''
  const split = head.lastIndexOf(' — ')
  return split === -1 ? { url: '', title: head.slice(2).trim() } : { url: head.slice(split + 3).trim(), title: head.slice(2, split).trim() }
}

/**
 * A Page Read's Card (#333): the page title as its heading and the page's
 * own words under it — the words `read` speaks, one paragraph a line, a
 * table's rows kept together, ending "…" when further parts follow —
 * never the controller's viewport, scroll, signature, refs or part lines.
 * `failure` when the page has no words: the Card then says so, as the
 * spoken line does, in the failure colour.
 */
export function pageReadCard(result: string): { text: string; failure: boolean } {
  const words = pageReadText(result)
  const lines = words === '' ? [SPOKEN_FAILURES.empty] : words.split('\n')
  const part = pageReadPart(result)
  if (part !== null && part.part < part.of) lines.push('…')
  const body = lines.reduce((text, line, index) => {
    if (index === 0) return line
    const tableRow = line.startsWith('|') && lines[index - 1]!.startsWith('|')
    return `${text}${tableRow ? '\n' : '\n\n'}${line}`
  }, '')
  const name = pageName(pageReadHead(result))
  return { text: name === '' ? body : `## ${name}\n\n${body}`, failure: words === '' }
}
