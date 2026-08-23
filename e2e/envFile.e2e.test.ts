import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { commandBoxScript } from './scripts'
import { startFixtureServer, VISION_COMPLETION_CONTENT, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'
import type { PipelineEvent } from '../src/core/pipeline/events'

// .env boot config e2e (#76): with model routing present ONLY in a .env
// file — no shell exports — the app must boot configured. A look call is
// served by the real chat-completions adapter through the .env credentials,
// and the settings page reports each role configured/unconfigured from the
// same routing resolution the pipeline uses. (The malformed line in the
// file is part of the contract: it must be ignored, not fatal. The
// orchestrator rides BINGBONG_LLM_SCRIPT — the layer above .env — so its
// .env routing is never called; resolution is what is asserted.)

function scriptedTurns(url: string): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'nav', name: 'navigate', args: { url } }] },
    { kind: 'tool_calls', calls: [{ id: 'look-1', name: 'look', args: {} }] },
    { kind: 'answer', speak: 'Looked.', display: 'Vision described the page.' },
  ]
}

function routingStatusScript(): string {
  return `Array.from(document.querySelectorAll('.settings-role')).map((fieldset) => ({
    role: fieldset.querySelector('legend')?.textContent ?? '',
    status: fieldset.querySelector('.settings-role-status')?.textContent ?? '',
  }))`
}

function setSubagentRoutingScript(baseUrl: string): string {
  return `(() => {
    const fieldset = document.querySelectorAll('.settings-role')[1]
    if (!fieldset) return 'no-fieldset'
    const inputs = Array.from(fieldset.querySelectorAll('input'))
    if (inputs.length !== 3) return 'unexpected-input-count'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const values = [${JSON.stringify(baseUrl)}, 'fixture-subagent', 'settings-page-secret']
    inputs.forEach((input, index) => {
      setter.call(input, values[index])
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return 'edited'
  })()`
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
        `BINGBONG_ORCHESTRATOR_BASE_URL="${fixture.url('')}"`,
        'BINGBONG_ORCHESTRATOR_MODEL="fixture-orchestrator"',
        // The orchestrator resolves its key the default way (ZAI_API_KEY),
        // the vision role through an explicit per-role key — both .env paths.
        'ZAI_API_KEY="env-file-secret"',
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
      VISION_COMPLETION_CONTENT,
    )
    expect(fixture.visionEndpointHits()).toBeGreaterThan(0)
    expect(fixture.lastVisionAuthorization()).toBe('Bearer env-file-secret')
  })

  it('shows .env-configured roles as configured on the settings page', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    const statuses = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<{ role: string; status: string }[]>(routingStatusScript())
        // Length guard: an empty list passes `.every` vacuously before the
        // settings fieldsets mount.
        return captured.length === 3 && captured.every((entry) => entry.status !== '') ? captured : undefined
      },
      { timeoutMs: 10_000, intervalMs: 250 },
    )
    expect(statuses.find((entry) => entry.role === 'Orchestrator')?.status).toContain('Configured')
    expect(statuses.find((entry) => entry.role === 'Vision')?.status).toContain('Configured')
    // The subagent has no routing anywhere in this boot — its line must say
    // so truthfully.
    expect(statuses.find((entry) => entry.role === 'Subagent')?.status).toContain('Not configured')
  })

  it('flips a role to configured live when routing is saved on the settings page', async () => {
    expect(await harness.dashboardEval<string>(setSubagentRoutingScript(fixture.url('')))).toBe('edited')
    await harness.clickDashboardElement('.settings-button--primary')

    await waitFor(
      async () => {
        const statuses = await harness.dashboardEval<{ role: string; status: string }[]>(routingStatusScript())
        return statuses.find((entry) => entry.role === 'Subagent')?.status.includes('Configured') ? true : undefined
      },
      { timeoutMs: 10_000, intervalMs: 250 },
    )
  })
})
