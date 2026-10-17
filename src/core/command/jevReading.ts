import type { DecisionChoiceAnswer, DecisionChoiceQuestion, DecisionNoulQuestion } from '../ports/decisionModel'
import { JEV_VERBS, PRESS_KEYS, pressKeyOf, verbTakesSlot, verbTakesTarget, type Command, type CommandPage, type CommandRef, type CommandVerb } from './command'
import { wordsAfterVerb } from './localMatch'
import { isAddressShaped } from './openAddress'

// One Jev call per Command the Local Match cannot settle (#324, ADR 0076).
// The state is the transcript, the page's address and title and its
// numbered refs — label, kind, href, no page text. Three Choices are asked
// in parallel: the verb, the target among the refs plus `none`, and the
// Slot among the transcript's contiguous word spans. Unneeded answers are
// ignored; the top Choice is acted on at any confidence; only `none` as
// the verb drops the Utterance. Speed over accuracy: nothing here asks
// "did you mean".

/** A Choice offers at most 255 options; one is `none`. */
const MAX_SPANS = 254

const VERB_DESCRIPTIONS: Readonly<Record<(typeof JEV_VERBS)[number], string>> = {
  open: 'go to a website or address, or search the web for the words',
  click: 'click one of the numbered refs on the page',
  type: 'type words into one of the numbered refs (a text field)',
  scroll_up: 'scroll the page up',
  scroll_down: 'scroll the page down',
  back: 'go back to the previous page',
  forward: 'go forward',
  press: 'press a key: enter, escape, space or an arrow key',
  read: 'read the page aloud or show its contents',
  clear: 'clear the text in the focused field',
  stop: 'stop what the browser is doing',
  none: 'not a command for this page: a remark, a question, a name, noise',
}

export interface SlotSpan {
  readonly start: number
  readonly end: number
  readonly words: string
}

/** The transcript's words, each shorn of edge punctuation. */
function wordsOf(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^["'“”‘’(\[]+|["'“”‘’)\].,!?;:]+$/g, ''))
    .filter((word) => word !== '')
}

/**
 * Every contiguous word span of the transcript, start then end ascending,
 * under the Choice cap: when the transcript has more spans than fit, the
 * longest spans are left out first — a Slot is a phrase, and every word
 * stays offered on its own.
 */
export function slotSpans(text: string): SlotSpan[] {
  const words = wordsOf(text)
  const n = words.length
  let longest = n
  const spansUpTo = (length: number): number => {
    let count = 0
    for (let l = 1; l <= length; l += 1) count += n - l + 1
    return count
  }
  while (longest > 1 && spansUpTo(longest) > MAX_SPANS) longest -= 1
  const spans: SlotSpan[] = []
  for (let start = 0; start < n; start += 1) {
    for (let end = start; end < n && end - start < longest; end += 1) {
      if (spans.length >= MAX_SPANS) return spans
      spans.push({ start, end, words: words.slice(start, end + 1).join(' ') })
    }
  }
  return spans
}

function describeRef(ref: CommandRef): string {
  const kind = ref.kind === 'input' && ref.inputType !== null ? `input[${ref.inputType}]` : ref.kind
  return `${kind} ${JSON.stringify(ref.label)}${ref.href !== null ? ` ${ref.href}` : ''}`
}

/** The state the three questions are asked over. */
export function commandState(text: string, page: CommandPage): string {
  return [
    `The user spoke to a web browser: ${JSON.stringify(text)}`,
    `Page: ${page.url} — ${JSON.stringify(page.title)}`,
    'Refs (number, kind, label, address):',
    ...page.refs.map((ref) => `[${ref.ref}] ${describeRef(ref)}`),
  ].join('\n')
}

/** A type, not an interface, so it reads as the port's `DecisionQuestions` record. */
export type CommandQuestions = {
  readonly verb: DecisionChoiceQuestion
  readonly target: DecisionChoiceQuestion
  readonly slot: DecisionChoiceQuestion
}

/** The three questions: the verb, the target, the Slot. */
export function commandQuestions(text: string, page: CommandPage): CommandQuestions {
  return {
    verb: {
      type: 'choice',
      instructions: 'Which verb did the user ask the browser for? Choose none when the words are not a command for this page.',
      options: { ...VERB_DESCRIPTIONS },
    },
    target: {
      type: 'choice',
      instructions: 'Which numbered ref on the page do the words name as the thing to click or type into? Choose none when the command needs no ref, or names none of them.',
      options: { none: 'no ref: the command does not act on one element', ...Object.fromEntries(page.refs.map((ref) => [`ref-${ref.ref}`, describeRef(ref)])) },
    },
    slot: {
      type: 'choice',
      instructions: 'Which words of the transcript are the thing the command carries verbatim: the address to open, the search terms, the text to type, the key to press? Choose none when it carries none.',
      options: { none: 'the command carries no words of its own', ...Object.fromEntries(slotSpans(text).map((span) => [`s${span.start}-${span.end}`, span.words])) },
    },
  }
}

/**
 * A partial transcript's questions (Early Fire, #326): the three Choices
 * and one Noul — whether the words so far are the whole Command. The Noul
 * decides only whether to wait for more words, never whether to act.
 */
export type PartialQuestions = CommandQuestions & { readonly complete: DecisionNoulQuestion }

export function partialQuestions(text: string, page: CommandPage): PartialQuestions {
  return {
    ...commandQuestions(text, page),
    complete: { type: 'noul', instructions: 'Is this a complete command, with nothing still to be said?' },
  }
}

export type CommandAnswers = {
  readonly verb: DecisionChoiceAnswer
  readonly target: DecisionChoiceAnswer
  readonly slot: DecisionChoiceAnswer
}

function refOfLabel(label: string): number | null {
  const match = /^ref-(\d+)$/.exec(label)
  return match ? Number(match[1]) : null
}

/** The most probable ref the target answer holds; null when the page has none. */
function mostProbableRef(answer: DecisionChoiceAnswer, page: CommandPage): number | null {
  const direct = refOfLabel(answer.choice)
  if (direct !== null && page.refs.some((ref) => ref.ref === direct)) return direct
  let best: { ref: number; probability: number } | null = null
  for (const [label, probability] of Object.entries(answer.probabilities)) {
    const ref = refOfLabel(label)
    if (ref === null || !page.refs.some((candidate) => candidate.ref === ref)) continue
    if (best === null || probability > best.probability) best = { ref, probability }
  }
  return best?.ref ?? page.refs[0]?.ref ?? null
}

/** The words the Slot answer names; the words after the verb when it names none. */
function slotWords(answer: DecisionChoiceAnswer, text: string): string {
  const match = /^s(\d+)-(\d+)$/.exec(answer.choice)
  if (match) {
    const words = wordsOf(text)
    const span = words.slice(Number(match[1]), Number(match[2]) + 1).join(' ')
    if (span !== '') return span
  }
  return wordsAfterVerb(text)
}

/** The Command Jev's answers make: the top Choice of each, read as the verb needs them. */
export function readCommandAnswers(answers: CommandAnswers, text: string, page: CommandPage): Command {
  const verb = answers.verb.choice as CommandVerb
  const none: Command = { verb: 'none', target: null, slot: null }
  if (!JEV_VERBS.includes(verb as (typeof JEV_VERBS)[number]) || verb === 'none') return none
  let target: number | null = null
  if (verbTakesTarget(verb)) {
    target = mostProbableRef(answers.target, page)
    // A click or a type on a page with nothing to act on is no Command.
    if (target === null) return none
  }
  const slot = verbTakesSlot(verb) ? slotWords(answers.slot, text) : null
  if (verb === 'open' && slot !== null && !isAddressShaped(slot)) {
    // "open <something on the page>": when Jev's target Choice names a ref
    // outright, the words name that element and opening it is clicking it
    // — the Local Match's own rule for a label one ref carries. An
    // address-shaped Slot is navigated whatever the target says.
    const chosen = refOfLabel(answers.target.choice)
    if (chosen !== null && page.refs.some((ref) => ref.ref === chosen)) return { verb: 'click', target: chosen, slot: null }
  }
  if (verb === 'press') {
    const key = slot === null ? null : pressKeyOf(slot)
    return { verb, target: null, slot, key: key ?? PRESS_KEYS.enter, times: 1 }
  }
  return { verb, target, slot }
}
