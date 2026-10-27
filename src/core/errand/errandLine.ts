import type { TaskEnded } from '../command/decisionRecord'

// How an Errand is reached (#467, #468, ADR 0095). The Planner enters
// after a Task that ends not done (arm C, the measured winner of #468):
// the Task's line is handed over with its steps as the Errand's first
// memory. `errand <words>` is an exact grammar line that starts one at
// once. Both are on unless BINGBONG_PLANNER=off (plannerRouting.ts).

/** The Goal Line an `errand <words>` line carries; null for any other line. */
export function errandGoalOf(line: string): string | null {
  const match = /^errand\s+(.+)$/is.exec(line.trim())
  return match === null ? null : match[1]!.trim()
}

/** The Task ends that hand the line to an Errand instead of saying it could not finish (ADR 0095). */
export const HANDS_OFF: ReadonlySet<TaskEnded> = new Set<TaskEnded>(['cap', 'unsure', 'unavailable'])
