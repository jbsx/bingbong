import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { denyConfirmationScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { waitForDisplay } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Settings + app voice tools (#67, ADR 0006): set_setting applies a real
// settings change end-to-end — model-invoked tool → settings store → the
// same persisted settings.json the settings page writes → live web zoom on
// the pane — with no confirmation card (tuning is immediate). app_control
// quit rides the real confirmation gate: the dialog shows the spoken prompt,
// Deny cancels it, and the app survives to answer.

const SUB_PATH = '/second'

describe('settings and app control voice tools e2e', () => {
  let fixture: FixtureServer
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-settings-'))
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  async function paneZoom(): Promise<number | undefined> {
    const sid = harness.paneSessionId()
    if (!sid) return undefined
    const response = await harness.cdp.send<{ result?: { value?: number } }>(
      'Runtime.evaluate',
      { expression: 'window.devicePixelRatio', returnByValue: true },
      sid,
    )
    return response.result?.value
  }

  it('set_setting changes web zoom immediately, unconfirmed, persisted like a typed save', async () => {
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [{ id: 's1', name: 'set_setting', args: { setting: 'web_zoom_percent', number_value: 80 } }],
      },
      { kind: 'answer', speak: 'Eighty percent.', display: 'Web zoom set to 80%.' },
    ]
    harness = await startHarness({
      fixture,
      userDataDir,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })

    expect(await harness.submitCommand('make the web eighty percent')).toBe('submitted')

    // Unconfirmed: a settings change never pauses for a risk gate.
    await waitForDisplay(harness, 'Web zoom set to 80%.')
    expect(await harness.dashboardEval<boolean>(`!document.querySelector('.confirmation-card')`)).toBe(true)

    // The change persisted through the real store, exactly like a typed save.
    await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        return raw && JSON.parse(raw).webZoomPercent === 80 ? true : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )

    // And it applies live: the next navigation renders at the new zoom.
    await harness.navigatePane(fixture.url(SUB_PATH))
    const zoom = await waitFor(
      async () => {
        const value = await paneZoom()
        return value !== undefined && Math.abs(value - 0.8) < 0.01 ? value : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(zoom).toBeCloseTo(0.8, 5)

    await harness.quit()
  })

  it('a cancelled app_control quit shows the gate, denies, and the app survives', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'q1', name: 'app_control', args: { action: 'quit' } }] },
      { kind: 'answer', speak: 'Still here.', display: 'Quit cancelled, still here.' },
    ]
    harness = await startHarness({
      fixture,
      userDataDir,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })

    expect(await harness.submitCommand('quit the app')).toBe('submitted')

    // The gate holds: the dialog shows the spoken yes/no prompt…
    await waitFor(
      async () => {
        const prompt = await harness.dashboardEval<string>(
          `document.querySelector('.confirmation-prompt')?.textContent ?? ''`,
        )
        return prompt === '' ? undefined : prompt
      },
      { timeoutMs: 20000, intervalMs: 250 },
    ).then((prompt) => {
      expect(prompt).toBe('Quit Bing Bong?')
    })

    // …and denying through the real button cancels the quit…
    expect(await harness.dashboardEval<string>(denyConfirmationScript())).toBe('denied')

    // …the app survived: the run continues to its answer and the dashboard
    // still responds. (The pane is deliberately not probed here: a second
    // app on the same e2e profile boots with its pane target unresponsive
    // to harness evals — an artifact of the harness, not of this flow.)
    await waitForDisplay(harness, 'Quit cancelled, still here.')
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.url-input')`)).toBe(true)

    await harness.quit()
  })
})
