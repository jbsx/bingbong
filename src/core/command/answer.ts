import { isRealPage, lastPageLabel } from '../browser/lastPage'
import { pageReadPart, pageReadText } from '../browser/pageText'
import { describeCommand, type Command, type CommandPage } from './command'
import { SPOKEN_FAILURES } from './spokenFailure'
import { describeDuration } from '../timer/duration'

// The Answer a Command leaves in the Feed (#333): exactly one per Command,
// written from facts the Command and the page already hold — never by a
// model. Jev only picks the Command.

/** The Answer of a Command a Stop ended (the Stop button, Escape, the Abort Head, `stop`), and of one a later Command ended. */
export const STOPPED_ANSWERS = {
  stopped: 'Stopped.',
  superseded: 'Stopped: a later Command came first.',
} as const

/** What a page is called in an Answer: its title, or its site's name when it has none. */
export function pageName(page: { url: string; title: string }): string {
  return lastPageLabel(page).title
}

/** An `open` whose Slot is search terms: what it searched for, and on which site when it was scoped to one (#340). */
function searchAnswer(command: Command): string {
  return `Searched ${command.site ?? 'the web'} for “${command.slot ?? ''}”.`
}

/** What an Answer is written from: the page the action left, and the target ref's label (click, type). */
export interface AnswerFacts {
  readonly page: { url: string; title: string }
  readonly label?: string
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
    case 'open':
      return command.search === true ? searchAnswer(command) : `Opened ${pageName(facts.page)}.`
    case 'click':
      return `Clicked ${ref()}.`
    case 'type':
      return `Typed into ${ref()}.`
    case 'scroll_up':
      return 'Scrolled up.'
    case 'scroll_down':
      return 'Scrolled down.'
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

/**
 * The Answer of a best guess that landed (#329): the line was not read — Jev
 * unavailable, or none configured — so the Answer says what was done with
 * it: the web search its words became, or the action guessed.
 */
export function bestGuessAnswer(command: Command, page?: CommandPage): string {
  if (command.verb === 'open' && command.search === true) return searchAnswer(command)
  return `Took a guess: ${describeCommand(command, page)}.`
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
