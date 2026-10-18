import { lastPageLabel } from '../browser/lastPage'
import { pageReadText } from '../browser/pageText'
import type { Command } from './command'
import { SPOKEN_FAILURES } from './spokenFailure'

// The Answer a Command leaves in the Feed (#333): exactly one per Command,
// written from facts the Command and the page already hold — never by a
// model. Jev only picks the Command.

/** What a page is called in an Answer: its title, or its site's name when it has none. */
export function pageName(page: { url: string; title: string }): string {
  return lastPageLabel({ ...page, at: 0 }).title
}

/** What an Answer is written from: the page the action left, the target ref's label (click, type), and the action's result line. */
export interface AnswerFacts {
  readonly page: { url: string; title: string }
  readonly label?: string
  readonly result: string
}

/**
 * The one-line Answer of a Command that leaves no Card (#333): a fixed
 * sentence per verb, filled in from its facts. Null for the verbs whose
 * Answer is a Card (read, screenshot, help) and the ones that fire nothing.
 */
export function commandAnswer(command: Command, facts: AnswerFacts): string | null {
  const ref = (): string => (facts.label !== undefined && facts.label !== '' ? `“${facts.label}”` : `item ${command.target ?? '?'}`)
  switch (command.verb) {
    case 'open':
      return command.search === true ? `Searched the web for “${command.slot ?? ''}”.` : `Opened ${pageName(facts.page)}.`
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
      return 'Stopped.'
    case 'resume':
      return facts.result.startsWith('nothing to resume') ? 'There is no page to resume yet.' : `Back on ${pageName(facts.page)}.`
    case 'read':
    case 'screenshot':
    case 'help':
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
 * table's rows kept together — never the controller's viewport, scroll,
 * signature, refs or part lines.
 */
export function pageReadCard(result: string): string {
  const words = pageReadText(result)
  const lines = words === '' ? [SPOKEN_FAILURES.empty] : words.split('\n')
  const body = lines.reduce((text, line, index) => {
    if (index === 0) return line
    const tableRow = line.startsWith('|') && lines[index - 1]!.startsWith('|')
    return `${text}${tableRow ? '\n' : '\n\n'}${line}`
  }, '')
  const name = pageName(pageReadHead(result))
  return name === '' ? body : `## ${name}\n\n${body}`
}
