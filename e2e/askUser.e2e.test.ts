import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { answerAskScript } from './scripts'
import { waitFor } from './waitFor'

async function waitForEvents(harness: Harness, name: string): Promise<PipelineEvent[]> {
  return waitFor(
    async () => {
      const events = await harness.dashboardEval<PipelineEvent[]>(`window[${JSON.stringify(name)}] || []`)
      return events.some((event) => event.type === 'done') ? events : undefined
    },
    { timeoutMs: 20_000, intervalMs: 200 },
  )
}

describe('ask_user typed answer e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'ask', name: 'ask_user', args: { question: 'Which city do you mean?' } }] },
      { kind: 'answer', speak: 'Using Paris.', display: 'Using the typed answer.' },
    ]
    harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('renders the question and returns a typed answer to the model', async () => {
    await harness.dashboardEval(`
      window.__askTypedEvents = []
      window.bingbong.assistant.onEvent((event) => window.__askTypedEvents.push(event))
    `)
    expect(await harness.submitCommand('book a hotel')).toBe('submitted')

    const question = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.ask-question')?.textContent ?? ''`)
        return text === '' ? undefined : text
      },
      { timeoutMs: 15_000, intervalMs: 200 },
    )
    expect(question).toBe('Which city do you mean?')
    expect(await harness.dashboardEval<string>(answerAskScript('Paris, France'))).toBe('answered')

    const events = await waitForEvents(harness, '__askTypedEvents')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'ask_resolved',
      answer: 'Paris, France',
      reason: 'user',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      callId: 'ask',
      ok: true,
      // The plan-less round carries its one corrective Run Plan nudge (#116).
      result: expect.stringMatching(/^Paris, France/),
    }))
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.ask-card')`)).toBe(false)
  })
})

describe('ask_user timeout e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'ask', name: 'ask_user', args: { question: 'Which city?' } }] },
      { kind: 'answer', speak: 'I stopped safely.', display: 'No answer arrived, so I abandoned the request.' },
    ]
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_ASK_TIMEOUT_MS: '1200',
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('returns user did not answer and lets the model stop safely', async () => {
    await harness.dashboardEval(`
      window.__askTimeoutEvents = []
      window.bingbong.assistant.onEvent((event) => window.__askTimeoutEvents.push(event))
    `)
    expect(await harness.submitCommand('book a hotel')).toBe('submitted')

    const events = await waitForEvents(harness, '__askTimeoutEvents')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'ask_resolved',
      answer: null,
      reason: 'timeout',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      callId: 'ask',
      ok: true,
      result: expect.stringMatching(/^user didn't answer/),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'display',
      text: 'No answer arrived, so I abandoned the request.',
    }))
  })
})

describe('subagent ask_user relay e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    const orchestrator: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'spawn', name: 'spawn_agent', args: { kind: 'browse', task: 'plan the trip' } }] },
      { kind: 'tool_calls', calls: [{ id: 'results', name: 'agent_results', args: { wait: true } }] },
      { kind: 'tool_calls', calls: [{ id: 'relay', name: 'ask_user', args: { question: 'Which city should the trip use?' } }] },
      { kind: 'answer', speak: 'The relay worked.', display: 'The subagent clarification was answered.' },
    ]
    const subagent: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'sub-ask', name: 'ask_user', args: { question: 'Which city should the trip use?' } }] },
    ]
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestrator),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(subagent),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('routes a subagent clarification through the orchestrator ask tool', async () => {
    await harness.dashboardEval(`
      window.__askRelayEvents = []
      window.bingbong.assistant.onEvent((event) => window.__askRelayEvents.push(event))
    `)
    expect(await harness.submitCommand('plan a trip')).toBe('submitted')

    const question = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.ask-question')?.textContent ?? ''`)
        return text === '' ? undefined : text
      },
      { timeoutMs: 20_000, intervalMs: 200 },
    )
    expect(question).toBe('Which city should the trip use?')
    expect(await harness.dashboardEval<string>(answerAskScript('Lisbon'))).toBe('answered')

    const events = await waitForEvents(harness, '__askRelayEvents')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      callId: 'results',
      ok: true,
      result: expect.stringContaining('ASK_USER: Which city should the trip use?'),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      callId: 'relay',
      ok: true,
      result: 'Lisbon',
    }))
  })
})
