import type { DecisionChoiceAnswer, DecisionChoiceQuestion } from '../ports/decisionModel'
import type { FileChooser } from '../ports/browser'
import { promptChars } from '../decision/cardBudget'
import { describeShelfFile, type ShelfFile } from '../shelf/shelf'

// The Shelf ask (#424, ADR 0092): the page opened its file chooser —
// intercepted, so no OS dialog — and Jev is asked which file on the Shelf
// the words mean, each by its name, age and size, or none. Its pick is
// set on the field and nothing is sent: an upload is recoverable until the
// form is, and sending it is a line of its own.

/** The Shelf ask's one question. */
export type ShelfQuestions = { readonly file: DecisionChoiceQuestion }
export type ShelfAnswers = { readonly [K in keyof ShelfQuestions]: DecisionChoiceAnswer }

/** The Shelf ask as it is put: the state, the question, and the files its options number, in their order. */
export interface ShelfAsk {
  readonly state: string
  readonly questions: ShelfQuestions
  readonly files: readonly ShelfFile[]
}

/** A Choice offers at most 255 options; one is `none`. */
const MAX_FILES = 254

/** The file field as the state names it: its label, what it accepts and whether it takes several, as its ref line says them. */
function fieldOf(chooser: FileChooser): string {
  const label = chooser.label !== '' ? ` ${JSON.stringify(chooser.label)}` : ''
  const accepts = chooser.accept !== '' ? ` accepts ${JSON.stringify(chooser.accept)}` : ''
  return `file field${label}${accepts}${chooser.multiple ? ' takes several files' : ''}`
}

/**
 * The Shelf ask over the Shelf's files, newest first as given: every one,
 * the field's `accept` on its line for Jev to weigh (the widest net) —
 * measured a tie on the gate against the Shelf filtered by `accept`
 * (2026-10-24, Mammoth ∩ Elephant, 3 seed cases: 6/6 asks through on both
 * arms), so the arm cheapest to reverse stands.
 */
export function shelfAsk(text: string, page: { readonly url: string; readonly title: string }, chooser: FileChooser, shelf: readonly ShelfFile[], nowMs: number): ShelfAsk {
  const files = shelf.slice(0, MAX_FILES)
  const state = [
    `The user spoke to a web browser: ${JSON.stringify(text)}`,
    `Page: ${page.url} — ${JSON.stringify(page.title)}`,
    `The page opened its file chooser for its ${fieldOf(chooser)}: the file chosen is set on the field, and nothing is sent.`,
  ].join('\n')
  const options = Object.fromEntries(files.map((file, index) => [`file-${index + 1}`, `upload ${describeShelfFile(file, nowMs)}`]))
  return {
    state,
    questions: {
      file: {
        type: 'choice',
        instructions: "Which file on the shelf do the user's words mean to upload? Choose none when no file here is what the words mean.",
        options: { ...options, none: 'no file on the shelf is what the words mean' },
      },
    },
    files,
  }
}

/** The Shelf ask cut to the Card Budget (ADR 0088): the oldest files leave first, the most that fit kept, found by halving. */
export function fitShelfAsk(budget: number, text: string, page: { readonly url: string; readonly title: string }, chooser: FileChooser, shelf: readonly ShelfFile[], nowMs: number): ShelfAsk {
  const whole = shelfAsk(text, page, chooser, shelf, nowMs)
  const fits = (ask: ShelfAsk): boolean => promptChars(ask.state, ask.questions) <= budget
  if (fits(whole)) return whole
  let [low, high] = [0, whole.files.length - 1]
  let best = shelfAsk(text, page, chooser, [], nowMs)
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const tried = shelfAsk(text, page, chooser, whole.files.slice(0, middle), nowMs)
    if (fits(tried)) {
      best = tried
      low = middle + 1
    } else high = middle - 1
  }
  return best
}

/** The file Jev chose; null for `none`, or a label no option has. */
export function readShelfAnswer(answer: DecisionChoiceAnswer, files: readonly ShelfFile[]): ShelfFile | null {
  const match = /^file-(\d+)$/.exec(answer.choice)
  return match === null ? null : (files[Number(match[1]) - 1] ?? null)
}
