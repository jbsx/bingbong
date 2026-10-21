import type { DecisionChoiceAnswer, DecisionQuestions, DecisionResult } from '../ports/decisionModel'

// A Jev case (#338): one recorded ask and the answer each question should
// get — a Choice label, or a label it must not be — promoted by the owner
// from a real misread into the corpus folder. `pnpm jev:replay` asks Jev
// each case again and reports, per expectation, what it chose against the
// expected label, so a change to the state text or the question wording
// is accepted only when it passes its own case and leaves no other worse.
// Zero runtime imports: the jev:* scripts run this under node's type
// stripping.

/**
 * What one question's answer must be: `target=ref-27` (that label),
 * `outcome=yes>=0.7` (that label at that probability or more, #366 — a
 * sure answer where the runner acts only on one), `target!=ref-21`
 * (anything but it), or `verb<0.7` (whatever it chooses, under that
 * probability, #367 — an unsure answer a sure one outvotes).
 */
export type JevExpectation =
  | { readonly question: string; readonly label: string; readonly atLeast?: number }
  | { readonly question: string; readonly not: string }
  | { readonly question: string; readonly below: number }

/** The ask as the case keeps it: what Jev is sent again. */
export interface JevAsk {
  readonly state: string
  readonly questions: DecisionQuestions
}

export interface JevCase {
  /** The turn the ask was recorded for, when the case came from the log. */
  readonly turnId?: string
  /** The words the Command was read from, for the human reading the case. */
  readonly transcript?: string
  /** The model that first answered it, and when it was asked. */
  readonly model?: string
  readonly recordedAt?: number
  readonly expect: readonly JevExpectation[]
  readonly ask: JevAsk
}

/** A probability, as a floor or a ceiling takes it: from 0 to 1. */
const isProbability = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1

/** `target=ref-27`, `outcome=yes>=0.7`, `target!=ref-21` or `verb<0.7`, as the CLI takes it; a string is why it cannot be read. */
export function parseExpectation(text: string): JevExpectation | string {
  const unread = `"${text}" is not <question>=<label>[>=<probability>], <question>!=<label> or <question><<probability>`
  const match = /^([^=!<]+)(!?=|<)(.+)$/.exec(text.trim())
  if (match === null) return unread
  const [, question, op, said] = match as unknown as [string, string, string, string]
  if (op === '<') {
    const below = said.trim() === '' ? NaN : Number(said)
    return isProbability(below) ? { question: question.trim(), below } : unread
  }
  if (op !== '=') return { question: question.trim(), not: said.trim() }
  const [label, floor] = said.split('>=') as [string, string | undefined]
  if (floor === undefined) return { question: question.trim(), label: label.trim() }
  const atLeast = floor.trim() === '' ? NaN : Number(floor)
  return isProbability(atLeast) ? { question: question.trim(), label: label.trim(), atLeast } : unread
}

/** The label an expectation names, whether it must be the answer or must not; null for a ceiling, which names none. */
const labelOf = (expectation: JevExpectation): string | null => ('label' in expectation ? expectation.label : 'not' in expectation ? expectation.not : null)

export function expectationText(expectation: JevExpectation): string {
  if ('below' in expectation) return `${expectation.question}<${expectation.below.toFixed(2)}`
  const floor = 'label' in expectation && expectation.atLeast !== undefined ? `>=${expectation.atLeast.toFixed(2)}` : ''
  return `${expectation.question}${'label' in expectation ? '=' : '!='}${labelOf(expectation)}${floor}`
}

/** Why an expectation cannot be asked of these questions: no such question, not a Choice, or no such label; null when it can. */
export function expectationProblem(questions: DecisionQuestions, expectation: JevExpectation): string | null {
  const question = questions[expectation.question]
  if (question === undefined) return `no question "${expectation.question}" (asked: ${Object.keys(questions).join(', ')})`
  if (question.type !== 'choice') return `"${expectation.question}" is not a Choice`
  const label = labelOf(expectation)
  return label === null || label in question.options ? null : `"${expectation.question}" offers no label "${label}"`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function readExpectation(raw: unknown): JevExpectation | null {
  if (!isRecord(raw) || typeof raw.question !== 'string') return null
  if (typeof raw.label === 'string') {
    if (raw.atLeast === undefined) return { question: raw.question, label: raw.label }
    return isProbability(raw.atLeast) ? { question: raw.question, label: raw.label, atLeast: raw.atLeast } : null
  }
  if (typeof raw.not === 'string') return { question: raw.question, not: raw.not }
  if (isProbability(raw.below)) return { question: raw.question, below: raw.below }
  return null
}

/** A parsed case file read as a case; a string is why it is not one. */
export function readJevCase(raw: unknown): JevCase | string {
  if (!isRecord(raw)) return 'not a JSON object'
  const ask = raw.ask
  if (!isRecord(ask) || typeof ask.state !== 'string' || !isRecord(ask.questions)) return 'no ask with a state and questions'
  if (!Array.isArray(raw.expect) || raw.expect.length === 0) return 'no expectations'
  const expectations = raw.expect.map(readExpectation)
  if (expectations.some((expectation) => expectation === null)) return 'an expectation is not {question, label[, atLeast]}, {question, not} or {question, below}'
  const questions = ask.questions as unknown as DecisionQuestions
  for (const expectation of expectations as JevExpectation[]) {
    const problem = expectationProblem(questions, expectation)
    if (problem !== null) return problem
  }
  return { ...(raw as unknown as JevCase), expect: expectations as JevExpectation[] }
}

/** How one expectation came out against Jev's answer. */
export interface ExpectationOutcome {
  readonly expectation: JevExpectation
  readonly pass: boolean
  readonly chosen: string
  readonly chosenProbability: number
  /** The expected (or excluded) label's probability. */
  readonly labelProbability: number
}

export type CaseVerdict =
  | { readonly name: string; readonly pass: boolean; readonly outcomes: readonly ExpectationOutcome[] }
  | { readonly name: string; readonly pass: false; readonly problem: string }

/** Judge a case against Jev's fresh answer: it passes when every expectation holds. */
export function judgeJevCase(name: string, jevCase: JevCase, result: DecisionResult<DecisionQuestions>): CaseVerdict {
  if (result.status !== 'answered') return { name, pass: false, problem: `Jev did not answer: ${result.reason} (${result.message})` }
  const unanswered = jevCase.expect.find((expectation) => result.answers[expectation.question]?.type !== 'choice')
  if (unanswered !== undefined) return { name, pass: false, problem: `Jev gave no Choice for "${unanswered.question}"` }
  const outcomes = jevCase.expect.map((expectation): ExpectationOutcome => {
    const answer = result.answers[expectation.question] as DecisionChoiceAnswer
    const chosenProbability = answer.probabilities[answer.choice] ?? answer.confidence
    if ('below' in expectation) return { expectation, pass: chosenProbability < expectation.below, chosen: answer.choice, chosenProbability, labelProbability: chosenProbability }
    const label = labelOf(expectation)!
    const sure = !('label' in expectation) || (answer.probabilities[label] ?? (answer.choice === label ? answer.confidence : 0)) >= (expectation.atLeast ?? 0)
    return {
      expectation,
      pass: 'label' in expectation ? answer.choice === label && sure : answer.choice !== label,
      chosen: answer.choice,
      chosenProbability,
      labelProbability: answer.probabilities[label] ?? 0,
    }
  })
  return { name, pass: outcomes.every((outcome) => outcome.pass), outcomes }
}

const p = (probability: number): string => probability.toFixed(2)

function outcomeLine(outcome: ExpectationOutcome): string {
  const label = labelOf(outcome.expectation)
  const chose = `chose ${outcome.chosen} ${p(outcome.chosenProbability)}`
  return `  ${expectationText(outcome.expectation)}  ${label === null || outcome.chosen === label ? chose : `${chose} · ${label} ${p(outcome.labelProbability)}`}`
}

/** The replay's report: PASS or FAIL per case, a line per expectation, then the tally. */
export function formatJevReplay(verdicts: readonly CaseVerdict[], model: string): string {
  const lines: string[] = []
  for (const verdict of verdicts) {
    const head = `${verdict.pass ? 'PASS' : 'FAIL'}  ${verdict.name}`
    if ('problem' in verdict) {
      lines.push(`${head}  ${verdict.problem}`)
      continue
    }
    lines.push(head, ...verdict.outcomes.map(outcomeLine))
  }
  const passed = verdicts.filter((verdict) => verdict.pass).length
  lines.push(`${verdicts.length} case${verdicts.length === 1 ? '' : 's'}: ${passed} passed, ${verdicts.length - passed} failed (${model})`)
  return lines.join('\n')
}
