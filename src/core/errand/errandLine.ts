import type { TaskEnded } from '../command/decisionRecord'

// How an Errand is reached before #468 routes (orchestrator ruling 1,
// #467): `errand <words>` is an exact grammar line, read only while
// BINGBONG_ERRAND=1 (the goal gate and the CLI harness set it; the kiosk
// never does), and a Task that ends not done hands its line over behind
// the same switch.

/** The env switch the Errand stands behind until #468 routes. */
export const ERRAND_ENV = 'BINGBONG_ERRAND'

/** Whether the env arms the Errand. */
export const errandArmed = (env: Record<string, string | undefined>): boolean => env[ERRAND_ENV]?.trim() === '1'

/** The Goal Line an `errand <words>` line carries; null for any other line. */
export function errandGoalOf(line: string): string | null {
  const match = /^errand\s+(.+)$/is.exec(line.trim())
  return match === null ? null : match[1]!.trim()
}

/** The Task ends that hand the line to an Errand instead of saying it could not finish (ADR 0095). */
export const HANDS_OFF: ReadonlySet<TaskEnded> = new Set<TaskEnded>(['cap', 'unsure', 'unavailable'])
