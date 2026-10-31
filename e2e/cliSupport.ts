import type { Harness } from './harness'

/**
 * How long a `play` on live YouTube may take to answer: since #497 the line waits through a pre-roll ad and says `playing:` once the
 * song plays. Measured 2026-10-31: 24.2-24.8 s on 5 of 6 songs with a 20.2-20.4 s ad (`media-start-ad`), 4.0 s on the one with none. The same 90 s playTiming gives the song.
 * An ad past 120 s ends the line itself (#549), `on-ad:`, later than this: 90 s stands until a sample shows a pod past it.
 */
export const LIVE_PLAY_ANSWER_MS = 90_000

/** Every way the Player ends a live `play`, `skip` or `not that one` on the CLI, as its `result` prints them: a failure answers at once and shows in the test's own `toMatch`. */
export const LIVE_PLAY_ANSWER = /^(playing: id=|on-ad: id=|unstarted: id=|no videos: |no results data: |search failed: |not a watch page: |no more results|nothing to correct|nothing before|queue empty|not a command: |error:)/

/** Runs one CLI command and resolves with the first new matching output line. */
export async function cli(harness: Harness, line: string, match: RegExp, timeoutMs?: number): Promise<string> {
  const since = harness.cliMark()
  harness.cliWrite(line)
  return harness.waitForCliOutput(match, { since, timeoutMs }).catch((error: unknown) => {
    throw new Error(`\`${line}\` printed no line matching ${match}; last output: ${harness.cliOutput().slice(-300)}`, { cause: error })
  })
}

/** "[7] link …" → 7 */
export function refOf(line: string): number {
  return Number(/^\[(\d+)\]/.exec(line)?.[1])
}

/** Matches a snapshot line like `[3] input[search] "Search"`. */
export function refLine(kind: string, label: string): RegExp {
  return new RegExp(`^\\[(\\d+)\\] ${kind}${label ? ` "${label}"` : ''}(?: .*)?$`)
}
