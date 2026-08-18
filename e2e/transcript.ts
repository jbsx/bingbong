import { expect } from 'vitest'
import { commandBoxScript } from './scripts'
import type { Harness } from './harness'
import { waitFor } from './waitFor'

// Shared transcript probes for the dashboard e2e suites: every helper reads
// the rendered transcript through the dashboard's own DOM, so assertions and
// waits see exactly what the user sees.

/** All transcript entries (commands, tool lines, answers), joined by newline. */
export async function transcriptText(harness: Harness): Promise<string> {
  return harness.dashboardEval<string>(
    `Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n')`,
  )
}

/** Display (assistant answer) entries only, joined by a divider. */
export async function transcriptDisplays(harness: Harness): Promise<string> {
  return harness.dashboardEval<string>(
    `Array.from(document.querySelectorAll('.transcript-entry--display')).map((el) => el.textContent).join('\\n---\\n')`,
  )
}

// Submit, then wait for THIS run's answer marker in the transcript — not
// merely the idle orb, whose first poll can race the run's start (the orb
// is still idle from boot before the thinking status lands, which would let
// the next submit hit a disabled input).
export async function submitAndAwaitAnswer(harness: Harness, command: string, marker: string): Promise<void> {
  const submitted = await harness.dashboardEval<string>(commandBoxScript(command))
  expect(submitted).toBe('submitted')
  await waitFor(
    async () => {
      const text = await transcriptText(harness)
      const answered = text.includes(marker) && (await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`))
      return answered || undefined
    },
    { timeoutMs: 20000, intervalMs: 250 },
  )
}
