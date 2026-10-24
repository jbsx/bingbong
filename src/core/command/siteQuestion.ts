import { choiceProbability, type DecisionChoiceAnswer, type DecisionChoiceQuestion } from '../ports/decisionModel'
import { normalizeWords } from './command'
import { isDismissPhrase } from './dismissDialog'

// A Site Question (#423, CONTEXT.md): a native confirm the page raised,
// said aloud and answered by the user's next line, never by the loop — a
// confirm usually guards what `back` cannot undo, so ADR 0076's "a Misfire
// is recovered" does not reach it. The exact lines settle it with no ask;
// any other line is Jev's to read as accept, refuse or a new Command; Jev
// unsure or unavailable, it is refused, the side that cannot do harm.

/** How the user's line answers a Site Question: yes, no, or not an answer at all but a new Command (refuse, then run it). */
export type SiteAnswer = 'accept' | 'refuse' | 'command'

const ACCEPT_LINES: ReadonlySet<string> = new Set(['yes', 'ok', 'okay', 'confirm'])
const REFUSE_LINES: ReadonlySet<string> = new Set(['no', 'cancel'])

/**
 * The page's own question, as the pane raised it. Only a `confirm` is one
 * in Electron (measured 2026-10-24, Electron 43): `prompt()` throws "not
 * supported" and opens nothing, and a leave-page warning is settled by
 * Electron itself before anyone could be asked (see the pane's rule).
 */
export interface SiteQuestion {
  readonly kind: 'confirm'
  readonly text: string
}

/** The text with an end stop, so a line said after it reads as its own sentence. */
function stopped(text: string): string {
  const trimmed = text.trim()
  return /[.?!…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/** What the app says when the page asks (#423): its words, and that a yes or a no answers it. */
export function siteQuestionLine(question: SiteQuestion): string {
  return question.text.trim() === '' ? 'The page asks a question. Yes or no?' : `The page asks: ${stopped(question.text)} Yes or no?`
}

/** What the app says of an alert it accepted (#423); null for one with no words. */
export function alertLine(text: string): string | null {
  return text.trim() === '' ? null : `The page says: ${stopped(text)}`
}

/** The Answer each reading of a Site Question leaves: the user's yes or no, or the refusal no one was sure of. */
export const SITE_ANSWERS = {
  accept: 'Answered OK.',
  refuse: 'Answered Cancel.',
  fallback: "Refused the page's question.",
} as const

/** The Site Question's card (#423): the question, the line that raised it when one did, and the user's new line; one Choice among the three answers. */
export function siteQuestionAsk(question: SiteQuestion, raisedBy: string | null, line: string): { state: string; questions: { answer: DecisionChoiceQuestion } } {
  return {
    state: [
      `A web page in the browser asked the user, in a dialog with OK and Cancel: ${JSON.stringify(question.text)}`,
      ...(raisedBy !== null ? [`It asked while the browser did what the user said: ${JSON.stringify(raisedBy)}`] : []),
      `The user's next words: ${JSON.stringify(line)}`,
    ].join('\n'),
    questions: {
      answer: {
        type: 'choice',
        instructions: "How do the user's next words answer the page's question? Choose command when the words are not an answer to it but something else for the browser to do.",
        options: {
          accept: "OK: the words say yes to the page's question",
          refuse: 'Cancel: the words say no, or not now',
          command: 'not an answer: a new command for the browser, done after the question is cancelled',
        },
      },
    },
  }
}

/** Jev's answer to the Site Question's card: the label it is sure of, else null — which the fallback refuses. */
export function readSiteAnswer(answers: { readonly answer: DecisionChoiceAnswer }, sureAbove: number): SiteAnswer | null {
  const { choice } = answers.answer
  if (choice !== 'accept' && choice !== 'refuse' && choice !== 'command') return null
  return choiceProbability(answers.answer) >= sureAbove ? choice : null
}

/** The exact lines (#423): yes, ok and confirm accept; no, cancel and every Dismiss Phrase refuse; null for any other line. */
export function exactSiteAnswer(line: string): Exclude<SiteAnswer, 'command'> | null {
  const words = normalizeWords(line)
  if (ACCEPT_LINES.has(words)) return 'accept'
  if (REFUSE_LINES.has(words) || isDismissPhrase(words)) return 'refuse'
  return null
}
