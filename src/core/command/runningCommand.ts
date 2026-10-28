import { DEFAULT_DECISION_THRESHOLDS, choiceProbability, type DecisionChoiceAnswer, type DecisionChoiceQuestion, type DecisionQuestions } from '../ports/decisionModel'

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
export function doingAnswer(running: RunningCommand | null): string {
  if (running === null) return 'Nothing is running.'
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
