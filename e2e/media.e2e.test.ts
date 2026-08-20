import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Media verbs e2e: the orchestrator's media_control calls must land as real
// trusted key events on the focused page. The /media fixture records every
// keydown (key + shift state), so the exact YouTube-shortcut key sequence is
// asserted without depending on a real video provider. Real-YouTube playback
// is additionally covered by the opt-in gate in youtube.e2e.test.ts.
//
// Commands go through the real text box — including its input.focus(), which
// leaves the dashboard holding webContents focus. pressKey must claim pane
// focus itself or the keys would be dropped; this is the adversarial path.

function script(fixtureUrl: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: fixtureUrl } }] },
    { kind: 'answer', speak: 'Opened the media page.', display: 'Navigated to the media fixture.' },
    {
      kind: 'tool_calls',
      calls: [
        { id: 'm1', name: 'media_control', args: { action: 'play_pause' } },
        { id: 'm2', name: 'media_control', args: { action: 'volume_up' } },
        { id: 'm3', name: 'media_control', args: { action: 'volume_down' } },
        { id: 'm4', name: 'media_control', args: { action: 'next' } },
        { id: 'm5', name: 'media_control', args: { action: 'seek', offset: 30 } },
      ],
    },
    { kind: 'answer', speak: 'Media keys sent.', display: 'All media verbs were dispatched.' },
  ]
}

/** Submits a command through the real text box. */
async function submitCommand(harness: Harness, text: string): Promise<void> {
  const submitted = await harness.dashboardEval<string>(commandBoxScript(text))
  expect(submitted).toBe('submitted')
}

describe('media verbs e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script(fixture.url('/media'))) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('delivers every media verb to the focused page as trusted key events', async () => {
    const mediaUrl = fixture.url('/media')

    // Command 1 navigates; the single-shot pipeline frees the command box
    // once its answer lands.
    await submitCommand(harness, 'open the media page')
    await harness.waitForPaneUrl(mediaUrl)
    await waitFor(() => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`), {
      timeoutMs: 20000,
      intervalMs: 250,
    })

    // Command 2 runs the full verb set through media_control — with the
    // dashboard's text box still holding webContents focus.
    await submitCommand(harness, 'run every media verb')

    const expectedKeys = [
      { key: 'k', shift: false },
      { key: 'ArrowUp', shift: false },
      { key: 'ArrowDown', shift: false },
      { key: 'N', shift: true },
      { key: 'l', shift: false },
      { key: 'l', shift: false },
      { key: 'l', shift: false },
    ]

    const pressed = await waitFor(
      async () => {
        const keys = await harness.paneEval<{ key: string; shift: boolean }[]>(`window.__pressedKeys ?? []`)
        return keys.length >= expectedKeys.length ? keys : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    expect(pressed).toEqual(expectedKeys)

    // The run completed and the answer reached the transcript.
    await waitFor(
      async () => {
        const spoken = await harness.overlayEval<string>(
          `Array.from(document.querySelectorAll('.feed-entry--speak')).map((el) => el.textContent).join('\\n')`,
        )
        return spoken.includes('Media keys sent.') ? spoken : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
  })
})
