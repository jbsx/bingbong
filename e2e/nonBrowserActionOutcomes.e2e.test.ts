import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

// #115 / ADR 0027: non-browser Direct Actions return their resulting state.
// This run completes settings and panel work from those Action Outcomes alone;
// no read_page, Look, navigation, or other browser verification is involved.
const SCRIPT: AssistantTurn[] = [
  {
    kind: 'tool_calls',
    calls: [
      { id: 'setting', name: 'set_setting', args: { setting: 'appearance', string_value: 'dark' } },
      { id: 'panel', name: 'set_panel_width', args: { preset: 'half_screen' } },
    ],
  },
  { kind: 'answer', speak: 'Updated.', display: 'The appearance and panel width are updated.' },
]

describe('non-browser Action Outcomes e2e (#115)', () => {
  let fixture: FixtureServer
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-action-outcomes-'))
    harness = await startHarness({
      fixture,
      userDataDir,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(SCRIPT) },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('completes settings and panel actions from returned state without browser inspection', async () => {
    await harness.dashboardEval(`
      window.__nonBrowserOutcomeEvents = []
      window.bingbong.assistant.onEvent((event) => window.__nonBrowserOutcomeEvents.push(event))
    `)

    expect(await harness.submitCommand('use dark appearance and make the panel half the screen')).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__nonBrowserOutcomeEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    const results = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool_result' && event.ok,
    )

    expect(results.map((event) => event.name)).toEqual(['set_setting', 'set_panel_width'])
    // The plan-less round carries its one corrective Run Plan nudge (#116)
    // on the first useful result; the second stays clean.
    expect(results.find((event) => event.name === 'set_setting')?.result).toMatch(/^Appearance set to dark\./)

    const panelWidth = await harness.dashboardEval<number>(
      'window.bingbong.feedPanel.getState().then((state) => state?.width ?? 0)',
    )
    expect(results.find((event) => event.name === 'set_panel_width')?.result).toBe(
      `Panel width set to ${panelWidth}px.`,
    )

    const persisted = JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      appearance?: string
    }
    expect(persisted.appearance).toBe('dark')
  })
})
