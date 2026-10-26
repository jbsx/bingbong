import type { TaskEnded } from '../command/decisionRecord'
import type { PlannerActionClass, PlannerCapture, PlannerMemory } from '../ports/plannerModel'
import { confirmLine, type Confirm } from './confirmClass'

// An Errand's memory (#467, ADR 0095): the Goal Line, the steps done —
// each its action, its class, its outcome and its seconds — what was
// captured, and the last card, rebuilt each step. It is the Planner port's
// input (#465) and what the Errand says when it ends otherwise than done.
// Pure: every change makes a new memory.

/** One step the Errand took, or the person's answer it was given. */
export interface ErrandStep {
  /** The Planner's one-line why: the step's words in the Feed and on the Status Capsule. */
  readonly why: string
  /** The action as it was taken, in the card's words. */
  readonly action: string
  readonly class: PlannerActionClass
  /** What it came to, in the facts the next card shows ("Done so far"). */
  readonly outcome: string
  /** The step's Answer, the sentence the Feed shows: what "done so far" is said in. */
  readonly said?: string
  readonly seconds: number
}

export interface ErrandMemory {
  readonly goalLine: string
  readonly steps: readonly ErrandStep[]
  readonly captures: readonly PlannerCapture[]
  /** The last card, as the Decision Model would see it; null before the first. */
  readonly card: string | null
}

/** A Task that ended not done (#467): its "Done so far" lines and how it ended, handed to the Errand. */
export interface TaskHandOff {
  readonly actions: readonly string[]
  readonly ended: TaskEnded
  /** The last Answer it left, shown and perhaps said: "No response.", a page's line. */
  readonly said?: string
}

const HANDED = 'the Task before this Errand'

const ENDED_WORDS: Partial<Record<TaskEnded, string>> = {
  cap: 'it ran out of actions',
  unsure: 'it found no next step',
  unavailable: 'the Decision Model did not answer',
}

export function errandMemory(goalLine: string, handOff?: TaskHandOff): ErrandMemory {
  const steps: ErrandStep[] =
    handOff === undefined
      ? []
      : [
          ...handOff.actions.map((action) => ({ why: HANDED, action, class: 'stays' as const, outcome: 'done', seconds: 0 })),
          {
            why: HANDED,
            action: 'the Task stopped',
            class: 'stays',
            outcome: `${ENDED_WORDS[handOff.ended] ?? `it ended ${handOff.ended}`}${handOff.said !== undefined ? `, its last Answer ${JSON.stringify(handOff.said)}` : ''}, and handed the line to you`,
            seconds: 0,
          },
        ]
  return { goalLine, steps, captures: [], card: null }
}

export const withStep = (memory: ErrandMemory, step: ErrandStep): ErrandMemory => ({ ...memory, steps: [...memory.steps, step] })
export const withCapture = (memory: ErrandMemory, capture: PlannerCapture): ErrandMemory => ({ ...memory, captures: [...memory.captures, capture] })
export const withCard = (memory: ErrandMemory, card: string): ErrandMemory => ({ ...memory, card })

/** The memory as the Planner port takes it. */
export function plannerMemoryOf(memory: ErrandMemory): PlannerMemory {
  return {
    steps: memory.steps.map((step) => ({ action: `${step.action} — ${step.why}`, outcome: step.outcome, class: step.class, seconds: step.seconds })),
    captures: memory.captures,
    card: memory.card,
  }
}

/** The question back, answered or not, as a step: the person's words are what the Planner reads next. */
export function askedStep(question: string, answer: string | null, seconds: number): ErrandStep {
  return { why: 'a question back', action: `asked: ${JSON.stringify(question)}`, class: 'stays', outcome: answer === null ? 'no answer' : `the person answered: ${JSON.stringify(answer)}`, seconds }
}

/** A confirm and its answer as a step (#467): a refusal is the person's answer, and the Planner carries on from it. */
export function confirmStep(confirm: Confirm, answer: string | null, yes: boolean, seconds: number): ErrandStep {
  const outcome = yes ? 'the person said yes: it was done' : answer === null ? 'no answer: it was not done' : `the person said no (${JSON.stringify(answer)}): it was not done`
  return { why: 'said back before it fired', action: `said back: ${JSON.stringify(confirmLine(confirm))}`, class: 'leaves', outcome, seconds }
}

const lowerFirst = (sentence: string): string => sentence.charAt(0).toLowerCase() + sentence.slice(1)

/** What the Errand's steps did, in their own Answers: "Done so far: opened …; clicked …." */
export function doneSoFar(memory: ErrandMemory): string {
  const said = memory.steps.flatMap((step) => (step.said === undefined || step.said === '' ? [] : [lowerFirst(step.said.replace(/[.!]+$/, ''))]))
  return said.length === 0 ? 'Nothing done yet.' : `Done so far: ${said.join('; ')}.`
}

/** The cap reached (#467): done so far, then that it ran out of time. */
export const capLine = (memory: ErrandMemory): string => `${doneSoFar(memory)} Ran out of time.`

/** The Planner gone, or past its 30 s (#467): that, then done so far. */
export const unavailableLine = (memory: ErrandMemory): string => `The planner did not answer. ${doneSoFar(memory)}`

/** A step that broke (#467): what happened, then done so far — never silence. */
export const faultLine = (memory: ErrandMemory): string => `That stopped on an error. ${doneSoFar(memory)}`

/** The question back let go (#467): the question again, then that the Errand ends there. */
export function unansweredLine(question: string): string {
  const asked = question.trim()
  return `${/[?]$/.test(asked) ? asked : `${asked.replace(/[.!]+$/, '')}?`} Ending there.`
}

/** An Errand asked for with no Planner configured (#467): said, and nothing fires. */
export const NO_PLANNER_LINE = 'The planner is not set up: its key is missing.'
