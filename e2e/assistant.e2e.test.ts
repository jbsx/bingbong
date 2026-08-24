import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import { routingEnvKeys } from '../src/core/agent/modelRouting'

// Text-driven smoke: a command typed into the dashboard's text box drives the
// orchestrator loop (scripted LLM double) and the real browser pane acts.
// This is the top adapter of the command-pipeline seam.

function scriptedTurns(fixtureUrl: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixtureUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'c2', name: 'read_page', args: {} }] },
    {
      kind: 'answer',
      speak: 'Opened the fixture page. It has one input.',
      display: 'Navigated to the fixture page and read it: one input is visible.',
    },
  ]
}

// The dev shell may carry real keys; this env block proves the unconfigured
// error path regardless of the machine it runs on. Key names come from the
// router so renames can't silently break the guard.
const NO_ROUTING_ENV: Record<string, string | undefined> = Object.fromEntries(
  ['BINGBONG_LLM_SCRIPT', ...routingEnvKeys('orchestrator')].map((key) => [key, undefined]),
)

describe('assistant text-box trigger e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(scriptedTurns(fixture.url('/'))) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('runs a typed command end to end: browser acts, transcript answers, orb idles', async () => {
    const root = fixture.url('/')

    const submitted = await harness.submitCommand('open the fixture page')
    expect(submitted).toBe('submitted')

    // The pane really navigated (navigate tool through the CDP controller).
    await harness.waitForPaneUrl(root)

    // The transcript shows the answer card (#54): the display entry
    // renders, and its spoken line is suppressed from the view (TTS-only
    // — the pipeline still speaks it).
    await waitFor(
      async () => {
        const answer = await harness.overlayEval<{ display: string; spoken: string }>(
          `(() => ({
            display: document.querySelector('.feed-entry--display')?.textContent ?? '',
            spoken: document.querySelector('.feed-entry--speak')?.textContent ?? '',
          }))()`,
        )
        return answer.display.includes('Navigated to the fixture page') && answer.spoken === '' ? answer : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // …the tool calls are visible…
    const toolLines = await harness.overlayEval<string>(
      `Array.from(document.querySelectorAll('.feed-entry--tool')).map((el) => el.textContent).join('\\n')`,
    )
    expect(toolLines).toContain(`→ ${root}`)
    expect(toolLines).toContain('read page')

    // …and the orb returned to idle once the run finished.
    await waitFor(
      () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
      { timeoutMs: 20000, intervalMs: 250 },
    )
  })

  it('displays and speaks a one-liner when model routing is unconfigured', async () => {
    const app = await startHarness({ fixture, env: NO_ROUTING_ENV })
    try {
      const submitted = await app.submitCommand('open youtube')
      expect(submitted).toBe('submitted')

      const error = await waitFor(
        async () => {
          const text = await app.overlayEval<string>(
            `document.querySelector('.feed-entry--error')?.textContent ?? ''`,
          )
          return text === '' ? undefined : text
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      expect(error).toMatch(/model routing for 'orchestrator' is not configured/)
      await waitFor(
        () => app.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await app.quit()
    }
  })
})
