import { isRealPage, lastPageLabel } from '../browser/lastPage'
import { pageReadPart, pageReadText } from '../browser/pageText'
import { pageControls } from '../browser/emptyLanding'
import type { Command } from './command'
import type { JevDetail, JevUnavailable } from './decisionRecord'
import { SPOKEN_FAILURES } from './spokenFailure'
import { NO_OBSERVABLE_CHANGE } from '../browser/actionOutcome'
import { mediaOpAnswer } from './mediaOp'
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

/** What a reading that settled no Command was made of: the grammar's own error, and Jev's part in it. */
export interface NoResponseFacts {
  /** The grammar's error, in plain words, for a line that starts with a verb it knows (`grammarErrorOf`). */
  readonly grammarError: string | null
  readonly jevAsked: boolean
  readonly jev?: JevDetail | JevUnavailable
  /** The Where Ask's reading (#379, ADR 0082), when the first read `none` and the Where Ask was asked. */
  readonly where?: JevDetail | JevUnavailable
  /** The Mark Ask's reading (#382, ADR 0084 amended), when it was asked in place of the first reading's unsure click on a Textless Ref. */
  readonly marked?: JevDetail | JevUnavailable
}

/** An action card label in words (#370): `click-12` is "click [12]", `open-3` "open link 3", `scroll_down` "scroll down". */
function actionWords(label: string): string {
  return label
    .replace(/^(click|type|menu)-(\d+)$/, '$1 [$2]')
    .replace(/^open-(\d+)$/, 'open link $1')
    .replace(/_/g, ' ')
}

/** Why nothing was done: the most specific of the grammar's error, Jev being off or not answering, and Jev's reading off its action card. */
function noResponseReason(facts: NoResponseFacts): string {
  if (facts.grammarError !== null) return facts.grammarError
  if (!facts.jevAsked) return "Jev is off, and the words aren't a command the grammar knows — try “help”."
  const jev = facts.jev
  if (jev !== undefined && 'reason' in jev) return JEV_UNAVAILABLE[jev.reason]
  const top = topAction(jev)
  // An unsure click on a Textless Ref asked again with the marked page (#382): the guess, and the page showing no command.
  if (facts.marked !== undefined && facts.where === undefined) return `Jev was unsure of “${actionWords(top)}”, and shown the page it read no command.`
  const first = top === 'none' ? 'Jev read no command in the words' : `Jev read “${actionWords(top)}”, but nothing on this page fits it`
  const where = facts.where
  // After a Where Ask (#379, ADR 0082), both readings: the first's none, then the Where Ask's.
  if (where === undefined) return `${first}.`
  if ('reason' in where) return `${first}; asked where it would be, ${JEV_UNAVAILABLE[where.reason]}`
  const found = topAction(where)
  return found === 'none' ? `${first}, and nothing on this page to look for.` : `${first}, and where it would be read “${actionWords(found)}”, but nothing on this page fits it.`
}

/** The action card label a reading gave the most probability; `none` when it gave none. */
function topAction(jev: JevDetail | undefined): string {
  const actions = Object.entries(jev?.probabilities.action ?? {})
  return actions.length > 0 ? actions.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0] : 'none'
}

/**
 * The Answer of an Utterance read as no Command (owner ruling 2026-10-19):
 * never a silent fade — "No response." and, under it, the real reason.
 */
export function noResponseAnswer(facts: NoResponseFacts): string {
  return `No response.\n\n${noResponseReason(facts)}`
}

/** What a page is called in an Answer: its title whole (no host stands beside it here), or its site's name when it has none. */
export function pageName(page: { url: string; title: string }): string {
  return page.title !== '' ? page.title : lastPageLabel(page).host
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
  /** A Media Op's changes clause (#372): what the element's facts changed, or `no observable change`. */
  readonly mediaChanges?: string
}

/** The changes a Media Op's outcome names, as the controller joined them; none for `no observable change`. */
function mediaChangesIn(clause: string | undefined): readonly string[] | undefined {
  if (clause === undefined) return undefined
  return clause === NO_OBSERVABLE_CHANGE ? [] : clause.split(', ')
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
    case 'media':
      return command.mediaOp === undefined ? null : mediaOpAnswer(command.mediaOp, mediaChangesIn(facts.mediaChanges))
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
      return null
  }
}

/** The page a Page Read is of, off its `# title — address` head (a consent dismissal may ride above it). */
function pageReadHead(result: string): { url: string; title: string } {
  const head = result.split('\n').find((line) => line.startsWith('# ')) ?? ''
  const split = head.lastIndexOf(' — ')
  return split === -1 ? { url: '', title: head.slice(2).trim() } : { url: head.slice(split + 3).trim(), title: head.slice(2, split).trim() }
}

const counted = (n: number, one: string, many: string): string[] => (n === 0 ? [] : [n === 1 ? one : `${n} ${many}`])

/**
 * What a Page Read with no words says of a page made only of controls
 * (2026-10-21 audit): the links, buttons and media players it holds, counted
 * by kind — no failure, since the page showed something. Null when the read
 * has words, or lists none of them.
 */
export function controlsOnlyLine(result: string): string | null {
  if (pageReadText(result) !== '') return null
  const controls = pageControls(result)
  if (controls === null) return null
  const kinds = [...counted(controls.media, 'a media player', 'media players'), ...counted(controls.button, 'a button', 'buttons'), ...counted(controls.link, 'a link', 'links')]
  const listed = kinds.length === 1 ? kinds[0]! : `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)!}`
  return `This page has no text, only ${listed}.`
}

/**
 * A Page Read's Card (#333): the page title as its heading and the page's
 * own words under it — the words `read` speaks, one paragraph a line, a
 * table's rows kept together, ending "…" when further parts follow —
 * never the controller's viewport, scroll, signature, refs or part lines.
 * `failure` when the page has no words: the Card then says so, as the
 * spoken line does, in the failure colour — unless it holds links, buttons
 * or media, which the Card names instead ({@link controlsOnlyLine}).
 */
export function pageReadCard(result: string): { text: string; failure: boolean } {
  const words = pageReadText(result)
  const controls = controlsOnlyLine(result)
  const lines = words !== '' ? words.split('\n') : [controls ?? SPOKEN_FAILURES.empty]
  const part = pageReadPart(result)
  if (part !== null && part.part < part.of) lines.push('…')
  const body = lines.reduce((text, line, index) => {
    if (index === 0) return line
    const tableRow = line.startsWith('|') && lines[index - 1]!.startsWith('|')
    return `${text}${tableRow ? '\n' : '\n\n'}${line}`
  }, '')
  const name = pageName(pageReadHead(result))
  return { text: name === '' ? body : `## ${name}\n\n${body}`, failure: words === '' && controls === null }
}
