import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'

// #83 / ADR 0009 headline behavior, end to end: "search for X and find Y"
// happens entirely on screen. The scripted orchestrator drives a visible
// tab to the fixture engine, types the query into its search box (trailing
// newline submits), reads the results page like any other page, and opens
// the right result by its href. There is no off-screen channel to reach
// for — the tools are deleted (pinned absent in unit tests) — so a green
// run here is the whole demo: search costs navigates + keystrokes on the
// pane the user is watching.

function scriptedTurns(engineUrl: string): AssistantTurn[] {
  return [
    // Land on the engine and read it: [1] is the search box.
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: engineUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'c2', name: 'read_page', args: {} }] },
    // GUI search: type into the box; the trailing newline submits.
    { kind: 'tool_calls', calls: [{ id: 'c3', name: 'type', args: { ref: 1, text: 'fixture widgets\n' } }] },
    // Read the results page like any other page: [1] is the top hit.
    { kind: 'tool_calls', calls: [{ id: 'c4', name: 'read_page', args: {} }] },
    // Open the promising result through its own link ref — the href rides
    // the click; the model never needs a hand-typed URL.
    { kind: 'tool_calls', calls: [{ id: 'c5', name: 'click', args: { ref: 1 } }] },
    { kind: 'tool_calls', calls: [{ id: 'c6', name: 'read_page', args: {} }] },
    {
      kind: 'answer',
      speak: 'Found the fixture widgets guide.',
      display: 'Searched on screen: typed into the engine box, read the results page, opened the top hit from its ref.',
    },
  ]
}

describe('on-screen GUI search e2e (#83)', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(scriptedTurns(fixture.url('/engine'))) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('completes a search task entirely in the visible tab', async () => {
    const submitted = await harness.submitCommand('search for fixture widgets')
    expect(submitted).toBe('submitted')

    // The visible tab walked engine → results → article, all rendered.
    await harness.waitForPaneUrl(fixture.url('/widgets-article'))
    expect(await harness.paneEval<string>('document.querySelector("h1")?.textContent ?? ""')).toBe(
      'Fixture widgets: the complete guide',
    )

    // The feed shows the on-screen mechanics: the query typed into the box
    // (trailing newline), the reads of each landed page, and the result
    // opened through its own link ref.
    const feedToolLines = async (): Promise<string> =>
      harness.overlayEval<string>(
        `Array.from(document.querySelectorAll('.feed-entry--tool')).map((el) => el.textContent).join('\\n')`,
      )
    await waitFor(
      async () => {
        const lines = await feedToolLines()
        return lines.includes('type "fixture widgets') && lines.includes('read page') && lines.includes('click [1]') ? lines : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    const toolLines = await feedToolLines()
    expect(toolLines).toContain(`→ ${fixture.url('/engine')}`)
    expect(toolLines).toContain('type "fixture widgets')
    expect(toolLines).toContain('click [1]')

    // The answer lands and the orb returns to idle.
    await waitFor(
      async () => {
        const display = await harness.overlayEval<string>(
          `document.querySelector('.feed-entry--display')?.textContent ?? ''`,
        )
        return display.includes('Searched on screen') ? display : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    await waitFor(
      () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--idle')`),
      { timeoutMs: 20000, intervalMs: 250 },
    )
  })
})
