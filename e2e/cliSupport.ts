import type { Harness } from './harness'

/** Runs one CLI command and resolves with the first new matching output line. */
export async function cli(harness: Harness, line: string, match: RegExp): Promise<string> {
  const since = harness.cliMark()
  harness.cliWrite(line)
  return harness.waitForCliOutput(match, { since })
}

/** "[7] link …" → 7 */
export function refOf(line: string): number {
  return Number(/^\[(\d+)\]/.exec(line)?.[1])
}

/** Matches a snapshot line like `[3] input[search] "Search"`. */
export function refLine(kind: string, label: string): RegExp {
  return new RegExp(`^\\[(\\d+)\\] ${kind}${label ? ` "${label}"` : ''}(?: .*)?$`)
}
