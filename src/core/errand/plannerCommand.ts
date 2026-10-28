import { AMOUNT_RUNGS, LEVEL_RUNGS } from '../browser/mediaOp'
import { JEV_VERBS, PRESS_KEYS, pressKeyOf, type Command, type CommandPage } from '../command/command'
import { commandQuestions, commandState, fitCard, readCommandAnswers, type Appliance, type CommandAnswers, type CommandQuestions, type HopContext } from '../command/jevReading'
import type { AppState } from '../command/appOp'
import { promptChars, type CardCut } from '../decision/cardBudget'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { PlannerAction } from '../ports/plannerModel'
import { parseDuration } from '../timer/duration'

// The Planner's card and its actions (#467, ADR 0095): the card an Errand
// step is planned over is the Decision Model's own — the same builder over
// a fresh snapshot, Capture and the page's text in parts on it (#466) — so
// the Planner sees exactly what Jev would. Its action, named by kind or by
// the card line's id, is read into the Command that line makes through
// Jev's own reader, so a step is a Command like any other: the same ops by
// kind, the same refusals of what the card does not offer. Never
// `evaluate`. Two readings are the Errand's own: the page's text read in
// parts (into the memory, never aloud) and the Timer the grammar sets.

/** The card one Errand step is planned over. */
export interface ErrandCard {
  readonly page: CommandPage
  readonly context: HopContext
  readonly questions: CommandQuestions
  /** What the Planner reads: the state Jev reads, then each line the card offers by id, the Appliance Verbs apart. */
  readonly text: string
  /** What the card gave up to fit the Card Budget (#501), as every ask's record names it. */
  readonly cuts: readonly CardCut[]
  /** The card is over the budget after every cut (#501): it is never sent. */
  readonly over?: true
  /** The budget it was built to, in characters; none when unbounded. */
  readonly budget?: number
  /** Its size as the budget reads it (`promptChars`): what a host's refusal is weighed against. */
  readonly size: number
  /** The appliance it was offered, so the card can be built again to a tighter budget. */
  readonly appliance?: Appliance
}

/** The Timer as an Appliance Verb (#467): the CLI grammar's `timer`, set by a length. */
const TIMER_VERB = { timer: 'set the Timer: words are its length (55 minutes, 1h30m), or "off"' }

/** The web's search as the Planner takes it: the option's text is the words. */
const WEB_SEARCH_LINE = 'search the web for the words given as the option\'s "text"'

/** The browser's own verbs and the card's ref-bound lines: everything on the card that is not an Appliance Verb. */
const isBrowserLine = (id: string): boolean => (JEV_VERBS as readonly string[]).includes(id) || /-\d+$/.test(id) || id === 'capture-page'

/**
 * The card one Errand step is planned over, built to the Card Budget as
 * every ask is (#495, #501): what is further down yields, then the refs
 * from the page's end, its cuts and whether it is still over kept for the
 * step's record.
 */
export function errandCard(goalLine: string, page: CommandPage, context: HopContext, options: { readonly appliance?: Appliance; readonly budgetChars?: number } = {}): ErrandCard {
  const { questions, state, cuts, over } = fitCard(
    options.budgetChars,
    page,
    (shown, further) => commandQuestions(goalLine, shown, context, { ...(options.appliance !== undefined ? { appliance: options.appliance } : {}), further }),
    (shown, asked) => commandState(goalLine, shown, context, undefined, undefined, asked),
    context.links,
  )
  // The browser's ref-less verbs are the Planner's own action kinds, said in its instructions; their lines here are Jev's words for them. The web's search has no kind of its own.
  const offers = Object.entries(questions.action.options).filter(([id]) => isBrowserLine(id) && !(JEV_VERBS as readonly string[]).includes(id))
  const text = [state, 'The card offers (id: what it does):', ...offers.map(([id, line]) => `${id}: ${line}`), `search: ${WEB_SEARCH_LINE}`].join('\n')
  return {
    page,
    context,
    questions,
    text,
    cuts,
    ...(over === true ? { over } : {}),
    ...(options.budgetChars !== undefined ? { budget: options.budgetChars } : {}),
    size: promptChars(state, questions),
    ...(options.appliance !== undefined ? { appliance: options.appliance } : {}),
  }
}

/** The same card built again to a tighter budget (#501): the one retry after a host refused the step's ask for its size. */
export function refitErrandCard(card: ErrandCard, goalLine: string, budgetChars: number): ErrandCard {
  return errandCard(goalLine, card.page, card.context, { ...(card.appliance !== undefined ? { appliance: card.appliance } : {}), budgetChars })
}

/** The Appliance Verbs the card offers, by name and line, with the Timer beside them. */
export function errandVerbs(card: ErrandCard): Record<string, string | null> {
  return { ...Object.fromEntries(Object.entries(card.questions.action.options).filter(([id]) => !isBrowserLine(id))), ...TIMER_VERB }
}

/** What a Planner action comes to: a Command to fire, a part of the page's text to read, or why it is none. */
export type ResolvedAction = { readonly kind: 'command'; readonly command: Command } | { readonly kind: 'read'; readonly part: number } | { readonly kind: 'refused'; readonly reason: string }

const sure = (label: string): DecisionChoiceAnswer => ({ type: 'choice', choice: label, confidence: 1, probabilities: { [label]: 1 } })

/** The Amount a Planner names: a rung by its name, else its words, which a seek reads in seconds and a level as a number. */
function amountAnswer(amount: string | undefined): DecisionChoiceAnswer {
  if (amount !== undefined && ([...AMOUNT_RUNGS, ...LEVEL_RUNGS] as readonly string[]).includes(amount)) return sure(amount)
  return amount === undefined ? sure('little') : { type: 'choice', choice: 'words', confidence: 1, probabilities: { words: 1, to: 1 } }
}

/** The card line a ref-bound action names; null for an action that needs none. */
function labelOf(action: PlannerAction): string | null {
  switch (action.kind) {
    case 'click':
    case 'type':
    case 'capture':
      return `${action.kind}-${action.ref}`
    case 'media':
      return `${action.op}-${action.ref}`
    case 'scroll':
      return action.ref === undefined ? null : `${action.direction}-${action.ref}`
    case 'option':
      return action.option
    case 'verb':
      return action.verb
    default:
      return null
  }
}

const command = (made: Command): ResolvedAction => ({ kind: 'command', command: made })
const refused = (reason: string): ResolvedAction => ({ kind: 'refused', reason })

/** A read's part: the first number it names, else the first part. */
const partOf = (part: string): number => Math.max(1, Number(/\d+/.exec(part)?.[0] ?? 1))

/** The words an action carries for its line: a type's text, an option's, a verb's, a media op's amount. */
function wordsOf(action: PlannerAction): string | undefined {
  switch (action.kind) {
    case 'type':
      return action.text
    case 'option':
      return action.text
    case 'verb':
      return action.words
    default:
      return undefined
  }
}

/**
 * The Command a Planner action makes on this card: the browser verbs that
 * need no line as the grammar makes them; everything else through the
 * line it names, read by Jev's reader as a sure pick of that line, its
 * words the Planner's own. A line the card does not offer is refused.
 */
export function resolveAction(action: PlannerAction, card: ErrandCard, app?: AppState): ResolvedAction {
  switch (action.kind) {
    case 'navigate':
      return command({ verb: 'navigate', target: null, slot: action.url })
    case 'back':
      return command({ verb: 'back', target: null, slot: null })
    case 'press': {
      const key = pressKeyOf(action.key) ?? Object.values(PRESS_KEYS).find((known) => known.key.toLowerCase() === action.key.toLowerCase()) ?? null
      return key === null ? refused(`press takes enter, escape, tab, space or an arrow, not ${JSON.stringify(action.key)}`) : command({ verb: 'press', target: null, slot: action.key, key, times: 1 })
    }
    case 'read':
      return { kind: 'read', part: partOf(action.part) }
    case 'scroll':
      if (action.ref === undefined) return command({ verb: action.direction === 'up' ? 'scroll_up' : 'scroll_down', target: null, slot: null })
      break
    case 'verb':
      if (action.verb === 'timer') {
        const words = action.words ?? ''
        if (/^(off|cancel|stop)$/i.test(words.trim())) return command({ verb: 'timer', target: null, slot: null })
        const durationMs = parseDuration(words)
        return durationMs === null ? refused(`timer needs a length (55 minutes, 1h30m), not ${JSON.stringify(words)}`) : command({ verb: 'timer', target: null, slot: null, durationMs })
      }
      break
    default:
      break
  }
  const label = labelOf(action)!
  const words = wordsOf(action)
  if (label === 'read') return { kind: 'read', part: 1 }
  if (label === 'none' || label === 'stop') return refused(`${label} is no step: say done or ask instead`)
  // The web's own search and an address by its words: the reader past hop 0 never searches again (#332), which an Errand's step may.
  if (label === 'search' || label === 'navigate') return words === undefined || words.trim() === '' ? refused(`${label} needs its words`) : command({ verb: label, target: null, slot: words })
  if (!Object.hasOwn(card.questions.action.options, label)) return refused(`${label} is not on the card`)
  const answers = {
    action: sure(label),
    slot: sure('none'),
    extent: sure('screen'),
    amount: amountAnswer(action.kind === 'media' ? action.amount : undefined),
    where: sure('web'),
  } as unknown as CommandAnswers
  const read = readCommandAnswers(answers, words ?? (action.kind === 'media' ? action.amount : undefined) ?? '', card.page, card.context, app)
  if (read.verb === 'none') return refused(`${label} does nothing on this page`)
  // The Slot is the Planner's own words, never a span of a line it was not spoken in.
  if (read.verb === 'type' || read.verb === 'play') {
    if (words === undefined || words === '') return read.verb === 'type' ? refused(`${label} needs its text`) : command(read)
    return command({ ...read, slot: words })
  }
  return command(read)
}
