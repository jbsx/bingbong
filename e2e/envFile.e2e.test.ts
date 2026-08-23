import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { commandBoxScript } from './scripts'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'
import type { PipelineEvent } from '../src/core/pipeline/events'

// .env boot config e2e (#76): with vision routing present ONLY in a .env
// file — no shell exports — the app must boot configured. A look call is
// served by the real chat-completions adapter through the .env credentials,
// and the settings page reports the vision role configured from the same
// routing resolution the pipeline uses. (The malformed line in the file is
// part of the contract: it must be ignored, not fatal.)

const VISION_DESCRIPTION = 'A fixture page described by the .env-configured vision role.'

function scriptedTurns(url: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'nav', name: 'navigate', args: { url } }] },
    { kind: 'tool_calls', calls: [{ id: 'look-1', name: 'look', args: {} }] },
    { kind: 'answer', speak: 'Looked.', display: 'Vision described the page.' },
  ]
}

describe('.env config e2e', () => {
  let fixture: FixtureServer
  let harness: Harness
  let envFileDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    envFileDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-envfile-'))
    const envFile = join(envFileDir, '.env')
    await writeFile(
      envFile,
      [
        `BINGBONG_VISION_BASE_URL="${fixture.url('')}"`,
        'BINGBONG_VISION_MODEL="fixture-vision"',
        'BINGBONG_VISION_API_KEY="env-file-secret"',
        'this line is malformed and must be ignored',
        '',
      ].join('\n'),
      'utf8',
    )
    harness = await startHarness({
      fixture,
      env: {
        // The orchestrator rides a script — process env, the layer ABOVE
        // .env. The vision role must resolve from the .env file alone.
        BINGBONG_LLM_SCRIPT: JSON.stringify(scriptedTurns(fixture.url('/second'))),
        BINGBONG_ENV_FILE: envFile,
        // Unset the harness's scripted vision doubles so the real
        // chat-completions adapter runs against the .env endpoint.
        BINGBONG_VISION_SCRIPT: undefined,
        BINGBONG_VISION_DESCRIPTION_SCRIPT: undefined,
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
    await rm(envFileDir, { recursive: true, force: true }).catch(() => {})
  })

  it('serves a look call with .env-only vision credentials', async () => {
    await harness.dashboardEval(`window.__envFileEvents = []
      window.bingbong.assistant.onEvent((event) => window.__envFileEvents.push(event))`)
    expect(await harness.dashboardEval<string>(commandBoxScript('look at this page'))).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__envFileEvents || []')
        return captured.some((event) => event.type === 'done') ? captured : undefined
      },
      { timeoutMs: 30_000, intervalMs: 250 },
    )
    const look = events.find((event) => event.type === 'tool_result' && event.callId === 'look-1')
    expect(look && 'ok' in look && look.ok ? String(look.result) : 'missing look result').toContain(
      VISION_DESCRIPTION,
    )
    expect(fixture.visionEndpointHits()).toBeGreaterThan(0)
    expect(fixture.lastVisionAuthorization()).toBe('Bearer env-file-secret')
  })

  it('shows the vision role configured on the settings page', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    const statuses = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<{ role: string; status: string }[]>(
          `Array.from(document.querySelectorAll('.settings-role')).map((fieldset) => ({
            role: fieldset.querySelector('legend')?.textContent ?? '',
            status: fieldset.querySelector('.settings-role-status')?.textContent ?? '',
          }))`,
        )
        return captured.some((entry) => entry.status !== '') ? captured : undefined
      },
      { timeoutMs: 10_000, intervalMs: 250 },
    )
    expect(statuses.find((entry) => entry.role === 'Vision')?.status).toContain('Configured')
    // The orchestrator has no routing anywhere in this boot (a script serves
    // it) — its line must say so truthfully.
    expect(statuses.find((entry) => entry.role === 'Orchestrator')?.status).toContain('Not configured')
  })
})
