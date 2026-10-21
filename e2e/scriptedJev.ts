// Jev's readings for the scripted stand-in (BINGBONG_DECISION_SCRIPT): a
// line with free words is Jev's (ADR 0079), so a suite that types `play
// <words>` scripts the reading it would get. Each entry answers only the
// ask whose state carries its line, so a consent wall's ask or another
// line's never takes it; a Choice names its label alone.

interface Reading {
  /** The line, as typed. */
  readonly line: string
  /** The action card's label (#370): a ref-less browser verb, `click-N` and the like, a Media Op's `forward-N` (#372), or an Appliance Verb (#374). */
  readonly action: string
  /** The Slot's words as a span label (`s1-2`); `none` when it carries none. */
  readonly slot?: string
  /** The Amount rung a seek reads (#372, ADR 0080); `little` when the reading names none. */
  readonly amount?: string
  /** A hop past the first (#328): the Verdict, sure at 0.9 — `yes` ends the Task done. */
  readonly outcome?: 'yes' | 'in_the_way' | 'not_yet'
  /** A hop past the first: the Progress Noul (#373), the probability the last action brought the page closer. */
  readonly progress?: number
}

/** What a hop's reading adds to the Command's: the Verdict and the Progress Noul. */
type HopReading = Pick<Reading, 'outcome' | 'progress'>

const choice = (label: string) => ({ type: 'choice', choice: label, confidence: 0.9 })

/** A line's reading: `play <words>` and `queue <words>` the Appliance Verb with the words past the first as the Slot. */
export function readingOf(line: string, action?: string, more: { readonly amount?: string } & HopReading = {}): Reading {
  const words = line.trim().split(/\s+/)
  const head = words[0]!.toLowerCase()
  if (action === undefined && (head === 'play' || head === 'queue')) return { line, action: head, slot: `s1-${words.length - 1}`, ...more }
  return { line, action: action ?? 'none', ...more }
}

/** The hub fixture's Task (#375), a line no grammar reads, typed over /hub-index. */
export const HUB_TASK_LINE = 'what defect rate did hub aurora return'

/**
 * The hub Task's readings (#375), each hop's Noul judging the action
 * before it, every click on an address the Task has not visited (a visited
 * one is off the card): hub Aurora's link (judged to have helped, 0.9),
 * back to the index (unsure, 0.5), hub Borealis's link (judged not to have
 * helped, 0.1), its audit link (helped, 0.9) and a sure yes — so the bar
 * reads forward, held, back, forward, full, and the Feed's four action
 * lines read closer, unsure, no closer, closer.
 */
export function hubTaskReadings(): Reading[] {
  return [
    readingOf(HUB_TASK_LINE, 'click-1'),
    readingOf(HUB_TASK_LINE, 'back', { progress: 0.9, outcome: 'not_yet' }),
    readingOf(HUB_TASK_LINE, 'click-2', { progress: 0.5, outcome: 'not_yet' }),
    readingOf(HUB_TASK_LINE, 'click-1', { progress: 0.1, outcome: 'not_yet' }),
    readingOf(HUB_TASK_LINE, 'none', { progress: 0.9, outcome: 'yes' }),
  ]
}

/** The env that scripts these readings, in the order they are typed: one entry per ask, a Task's hops each their own. */
export function decisionScript(...readings: Reading[]): { BINGBONG_DECISION_SCRIPT: string } {
  const entries = readings.map((reading) => ({
    when: JSON.stringify(reading.line),
    answers: {
      action: choice(reading.action),
      slot: choice(reading.slot ?? 'none'),
      amount: choice(reading.amount ?? 'little'),
      where: choice('web'),
      ...(reading.outcome !== undefined ? { outcome: choice(reading.outcome) } : {}),
      ...(reading.progress !== undefined ? { progress: { type: 'noul', noul: reading.progress } } : {}),
    },
  }))
  return { BINGBONG_DECISION_SCRIPT: JSON.stringify(entries) }
}
