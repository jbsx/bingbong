import { DEFAULT_DECISION_THRESHOLDS, choiceProbability, type DecisionChoiceAnswer, type DecisionChoiceQuestion, type DecisionQuestions } from '../ports/decisionModel'
import { PEEK_CARD_LINGER_MS } from '../panel/peekCardState'

// The Overlap (#489, CONTEXT.md Overlap, Fate): a line given while another
// is still running is read against it, never instead of it. The Appliance
// Card carries the running Command — its words on a labelled line of their
// own, its stage in the Status Capsule's words (#428), what it has done and
// the media it is opening — and asks one more question, its Fate: what the
// new line means for the line still running. Jev picks it; code acts on it.
// A line with nothing running sees the card byte for byte as before.

/** A line still running when another is read: its words, its stage as the Status Capsule shows it, what it has done, and the media it is opening. */
export interface RunningCommand {
  readonly words: string
  /** The Status Capsule's stage word (#428): `Thinking`, the Acting word (`Playing`, `Searching`), `Loading`, `Speaking`. */
  readonly stage: string
  /** The stage's detail: the Acting object, the host loading. */
  readonly detail?: string
  /** Its Task's actions so far, as the hop card's "Done so far" lists them. */
  readonly done: readonly string[]
  /** The media it is opening, in the words that named it, before the media exists. */
  readonly opening?: string
  /** How long before the line being read it was given: a cut-off line's rest comes within a second or so, a new request later. */
  readonly sinceMs?: number
}

/**
 * The line that ended last, while it is recent (#499): a question about the
 * wait just after it ends ("is it working", 3 s after "Playing …") has it to
 * refer to. Its words, how it ended, the sentence it answered, and how long
 * before the line being read it ended.
 */
export interface EndedCommand {
  readonly words: string
  readonly outcome: 'done' | 'failed' | 'cancelled'
  /** Its Answer, as shown. */
  readonly answer?: string
  readonly agoMs: number
}

/**
 * How long a line just ended stays on the card (#499, F1 arm b, the
 * orchestrator's ruling for the owner 2026-10-28): the Peek Card's and
 * Turn Card's linger, one number across the UI, counted as theirs is from
 * the end of its sentence.
 */
export const ENDED_WINDOW_MS = PEEK_CARD_LINGER_MS

/** The line ended last, as the runner keeps it: `at` its end, on the clock `now` reads. */
export interface EndedLine {
  readonly words: string
  readonly outcome: EndedCommand['outcome']
  readonly answer?: string
  readonly at: number
}

/** The line ended last as the card carries it, while within {@link ENDED_WINDOW_MS} of its end; else none. */
export function endedWithin(line: EndedLine | null, now: number): EndedCommand | undefined {
  if (line === null || now - line.at > ENDED_WINDOW_MS) return undefined
  const { at, ...rest } = line
  return { ...rest, agoMs: Math.max(0, now - at) }
}

const ENDED_WORDS: Readonly<Record<EndedCommand['outcome'], string>> = { done: 'Done', failed: "Didn't work", cancelled: 'Stopped' }

/** An Answer's first sentence, on one line: what the doing fact quotes of it (ui.md 10: one sentence). */
function firstSentence(answer: string | undefined): string {
  const line = (answer ?? '').trim().split('\n')[0]!.trim()
  return /^.*?[.!?…](?=\s|$)/.exec(line)?.[0] ?? line
}

/** The ended line's doing sentence: `Done, 3 seconds ago: Playing “Let Down (Remastered)”.` */
function endedAnswer(ended: EndedCommand): string {
  const seconds = Math.max(1, Math.round(ended.agoMs / 1000))
  const said = firstSentence(ended.answer)
  return `${ENDED_WORDS[ended.outcome]}, ${seconds} second${seconds === 1 ? '' : 's'} ago: ${said !== '' ? said : `“${ended.words.trim().replace(/[.!?…]+$/, '')}”.`}`
}

/** What a line given during an Overlap means for the Command still running (CONTEXT.md, Fate). */
export type Fate = 'ends' | 'joins' | 'waits' | 'goes_on'

const FATES: readonly Fate[] = ['ends', 'joins', 'waits', 'goes_on']

/** The stage and its detail, as one phrase: `Loading youtube.com`, `Playing let down by radiohead`, `Thinking`. */
function stageOf(running: RunningCommand): string {
  return running.detail !== undefined && running.detail !== '' ? `${running.stage} ${running.detail}` : running.stage
}

/** The running Command's lines on the card's state (T1, measured on the gate). */
export function runningLines(running: RunningCommand): string[] {
  return [
    `Still running, from the user's line before this one${running.sinceMs !== undefined ? `, given ${(Math.max(0, running.sinceMs) / 1000).toFixed(1)} s before it` : ''}: ${JSON.stringify(running.words)}`,
    `Its stage: ${stageOf(running)}`,
    ...(running.done.length > 0 ? [`Its done so far: ${running.done.join('; ')}`] : []),
    ...(running.opening !== undefined ? [`It is opening: ${JSON.stringify(running.opening)}, not playing yet`] : []),
  ]
}

/** The Fate question (#489): the new line's meaning for the line still running, beside the action. */
export function fateQuestion(): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions: "What do the user's words mean for the line still running?",
    options: {
      ends: 'a new request, or a stop: the running line ends and the words are done instead',
      joins: 'they finish or correct the running line (its missing words, another artist, version or one), so the two are read as one line',
      waits: 'they act on what the running line is opening (pause it, loop it, skip in it, turn it down): done once it is there',
      goes_on: 'they are about something else, ask about the wait, or are not for the app (a remark, noise): the running line goes on',
    },
  }
}

/** The fact's label for "what are you doing" (#489): a fact Appliance Verb, offered only while a line runs. */
export const DOING_LABEL = 'say_doing'

/** The sentence the doing fact says (ui.md 10: one sentence, no mechanics): `Still opening “let down by radiohead”: loading youtube.com.`, or `Still on “open bbc.com”: opening bbc.com.` */
export function doingAnswer(running: RunningCommand | null, ended?: EndedCommand): string {
  // With nothing running, the line just ended says its end (#499).
  if (running === null) return ended !== undefined ? endedAnswer(ended) : 'Nothing is running.'
  const stage = stageOf(running)
  const lower = `${stage.charAt(0).toLowerCase()}${stage.slice(1)}`
  // Media still opening is named, not the line (the overlap gate's row 7): the stage after it only while a page loads.
  if (running.opening !== undefined) return `Still opening “${running.opening}”${running.stage === 'Loading' ? `: ${lower}` : ''}.`
  return `Still on “${running.words}”: ${lower}.`
}

/** The doing fact's option line, carrying what it would say. */
export function doingLine(running: RunningCommand): string {
  return `appliance: say what the app is doing now, for the line still running — ${doingAnswer(running)}`
}

/**
 * The card with the line just ended on it (#499): the doing fact for it
 * before `page`, its option naming the line, how it ended and how long ago,
 * and kept to a question about it. The state is left as it was: measured
 * (arms below), the ended line's lines on the state lured the next line's
 * own action (a retried `play` read as carrying on), its option alone did
 * not. No Fate: nothing runs.
 *
 * Arms, Mammoth, the grown case at the runner's 0.7 and the lure set (every
 * Appliance Card case of the corpus with a line just ended on it):
 * A, lines after the words, "say what the app did" 0.44; B, the same,
 * "say whether … worked, how it ended" 0.86 but 6 lost; E, B's lines at the
 * foot, 4 of 6 lost; F, one line at the foot, 2 lost; H, the option alone,
 * 1 lost; J, the option alone kept to a question, 0.91, none lost.
 */
export function withEnded<Q extends DecisionQuestions>(state: string, questions: Q, ended: EndedCommand): { state: string; questions: Q } {
  const action = questions.action
  const line = `appliance: answer a question about the user's line just before this one, whether it worked and how it ended — never a new request — ${endedAnswer(ended)}`
  const placed =
    action !== undefined && action.type === 'choice'
      ? { ...questions, action: { ...action, options: Object.fromEntries(Object.entries(action.options).flatMap(([label, each]) => (label === 'page' ? [[DOING_LABEL, line], [label, each]] : [[label, each]]))) } }
      : questions
  return { state, questions: placed as Q }
}

/** The card with the running Command on it: its lines right after the words (#494), the doing fact before `page` among the actions, and the Fate after the action (T2). */
export function withRunning<Q extends DecisionQuestions>(state: string, questions: Q, running: RunningCommand): { state: string; questions: Q } {
  const action = questions.action
  const withDoing =
    action !== undefined && action.type === 'choice'
      ? {
          ...action,
          options: Object.fromEntries(
            Object.entries(action.options).flatMap(([label, line]) => (label === 'page' ? [[DOING_LABEL, doingLine(running)], [label, line]] : [[label, line]])),
          ),
        }
      : action
  const placed = Object.fromEntries(Object.entries(questions).flatMap(([key, question]) => (key === 'action' ? [[key, withDoing], ['fate', fateQuestion()]] : [[key, question]])))
  const [words, ...rest] = state.split('\n')
  return { state: [words, ...runningLines(running), ...rest].join('\n'), questions: placed as Q }
}

/** The Fate Jev read (#489), or `goes_on` when it is unsure or gave none (the grill's Q5: a wrong goes-on costs one `stop`, a wrong end loses the first line). */
export function readFate(answer: DecisionChoiceAnswer | undefined): Fate {
  if (answer === undefined) return 'goes_on'
  const fate = FATES.find((each) => each === answer.choice)
  if (fate === undefined || choiceProbability(answer) < DEFAULT_DECISION_THRESHOLDS.choice) return 'goes_on'
  return fate
}

/** What an ended Command says (the grill's Q11), its object the Acting stage it reached (`Playing let down by radiohead`): `Stopped playing let down by radiohead.` */
export function stoppedLine(acting: string | undefined): string {
  const object = acting?.trim().replace(/[.!?…]+$/, '') ?? ''
  return object === '' ? 'Stopped.' : `Stopped ${object.charAt(0).toLowerCase()}${object.slice(1)}.`
}
