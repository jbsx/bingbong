import { PROGRESS_FLOOR } from '../command/jevReading'
import { DEFAULT_DECISION_THRESHOLDS } from '../ports/decisionModel'
import type { PipelineEvent } from './events'

// The Task's progress bar (#375): the Status Capsule's bar for the running
// Task, as a pure function over the pipeline event stream. Every hop past
// the first carries the Progress Noul (#373) on its `command` event —
// whether the last action brought the page closer to the words — and the
// bar moves with each one as it arrives, so the user sees a Task closing
// in or stalling before it ends. The UI reads nothing the record does not
// already hold: the Noul's probability and the closing hop's action.

/** How one hop moved the bar: forward on a hop that helped, held in the middle, back on one that did not; full on a sure yes. */
export type ProgressMove = 'forward' | 'held' | 'back' | 'full'

/** What the Status Capsule's bar draws for the Task that has a reading. */
export interface TaskProgress {
  /** The Task's id — hop 0's turn id. */
  readonly taskId: string
  /** How far along the bar stands, 0 to 1: full only on a sure yes. */
  readonly filled: number
  /** Every move so far, oldest first — the bar's own history, one per Noul and one for the close. */
  readonly moves: readonly ProgressMove[]
}

/**
 * One helping hop's share of the bar: the Task's cap is five actions
 * (`MAX_TASK_ACTIONS` in the runner), so five helping hops reach the brim;
 * only the Verdict's sure yes fills it.
 */
const STEP = 1 / 5
/** Where the bar stops short of full until the Verdict says done. */
const BRIM = 1 - STEP / 2

/** At or above it, the Noul is sure the action helped: the Noul bar, 0.7. */
const HELPED = DEFAULT_DECISION_THRESHOLDS.noul

/** A Noul's move: at the Noul bar forward, at the floor (#373) back, between the two held. */
export function moveOf(progress: number): Exclude<ProgressMove, 'full'> {
  if (progress >= HELPED) return 'forward'
  if (progress <= PROGRESS_FLOOR) return 'back'
  return 'held'
}

/** The words the Feed shows beside the action a Noul judged (#375): closer, no closer, or unsure between the two. */
export function describeProgress(progress: number): string {
  const move = moveOf(progress)
  return move === 'forward' ? 'closer' : move === 'back' ? 'no closer' : 'unsure'
}

/** Where a move leaves the bar: a step forward to the brim, a step back to the floor, full on the close. */
function advance(filled: number, move: ProgressMove): number {
  switch (move) {
    case 'forward':
      return Math.min(BRIM, filled + STEP)
    case 'back':
      return Math.max(0, filled - STEP)
    case 'held':
      return filled
    case 'full':
      return 1
  }
}

/**
 * Folds pipeline events into the running Task's bar. Pure and
 * renderer-agnostic. No bar until the first Noul arrives: hop 0 alone, or a
 * Local Match, shows none. A new Command's hop 0 clears the last Task's
 * bar; until then it stands where the Task left it.
 */
export function createTaskProgressTracker(): {
  onEvent(event: PipelineEvent): void
  current(): TaskProgress | null
} {
  let progress: TaskProgress | null = null

  return {
    onEvent(event) {
      if (event.type !== 'command') return
      const task = event.task
      // A Command with no Task, or a Task's (or a later Step's) first hop: whatever bar stood is the last Task's.
      if (task === undefined || task.hop === 0) {
        progress = null
        return
      }
      const standing = progress?.taskId === task.id ? progress : { taskId: task.id, filled: 0, moves: [] as ProgressMove[] }
      // The closing hop on a sure yes (#369): it fires nothing, its action reads `done`, and the bar fills.
      const move: ProgressMove | null = event.dropped === true && event.action === 'done' ? 'full' : task.progress !== undefined ? moveOf(task.progress) : null
      if (move === null) return
      progress = { taskId: task.id, filled: advance(standing.filled, move), moves: [...standing.moves, move] }
    },
    current: () => progress,
  }
}
