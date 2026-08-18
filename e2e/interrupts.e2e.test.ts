import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'

function vadUtterance(): number[] {
  return [
    ...Array.from({ length: 6 }, () => 0.01),
    ...Array.from({ length: 8 }, () => 0.95),
    ...Array.from({ length: 40 }, () => 0.01),
  ]
}

const feedAudioScript = `(() => {
  for (let i = 0; i < 60; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
  return 'fed'
})()`

const armScript = `(async () => {
  await window.bingbong.voice.arm()
  return 'armed'
})()`

function interruptScript(fixture: FixtureServer, final = 'This answer should not run.'): AssistantTurn[] {
  return [
    { kind: 'tool_calls', calls: [{ id: 'nav', name: 'navigate', args: { url: fixture.url('/risky') } }] },
    { kind: 'tool_calls', calls: [{ id: 'submit', name: 'click', args: { ref: 7 } }] },
    { kind: 'answer', speak: final, display: final },
  ]
}

async function waitForConfirmation(harness: Harness): Promise<void> {
  await waitFor(
    () => harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`),
    { timeoutMs: 20_000, intervalMs: 250 },
  )
}

async function transcript(harness: Harness): Promise<string> {
  return harness.dashboardEval<string>(
    `Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n')`,
  )
}

async function expectCancelledWithoutSubmit(harness: Harness): Promise<void> {
  try {
    await waitFor(
      () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--cancelled')`),
      { timeoutMs: 20_000, intervalMs: 250 },
    )
  } catch (error) {
    const state = await harness.dashboardEval(`({
      orb: document.querySelector('.status-orb')?.className ?? '',
      hint: document.querySelector('.voice-hint')?.textContent ?? '',
      transcript: Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n'),
      confirmation: !!document.querySelector('.confirmation-card')
    })`)
    throw new Error(`cancelled status not shown: ${JSON.stringify(state)}`, { cause: error })
  }
  try {
    await waitFor(
      async () => (await transcript(harness)).includes('Stopped.') || undefined,
      { timeoutMs: 20_000, intervalMs: 250 },
    )
  } catch (error) {
    throw new Error(`stopped acknowledgement not shown; transcript=${JSON.stringify(await transcript(harness))}`, {
      cause: error,
    })
  }
  expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)).toBe(false)
  expect(await harness.paneEval<string>('document.title')).toBe('risky fixture')
}

describe('run interruption e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('aborts a pending action from the Stop button without changing the page', async () => {
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(interruptScript(fixture)) },
    })
    try {
      expect(await harness.dashboardEval<string>(commandBoxScript('send the contact form'))).toBe('submitted')
      await waitForConfirmation(harness)

      await harness.clickDashboardElement('.assistant-stop')

      await expectCancelledWithoutSubmit(harness)
    } finally {
      await harness.quit()
    }
  })

  it('fans abort out to a running subagent', async () => {
    const orchestrator: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'nav', name: 'navigate', args: { url: fixture.url('/risky') } }] },
      { kind: 'tool_calls', calls: [{ id: 'spawn', name: 'spawn_agent', args: { kind: 'research', task: 'read the slow fixture' } }] },
      { kind: 'tool_calls', calls: [{ id: 'submit', name: 'click', args: { ref: 7 } }] },
      { kind: 'answer', speak: 'Should not finish.', display: 'Should not finish.' },
    ]
    const subagent: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'read', name: 'read_url', args: { url: fixture.url('/slow') } }] },
      { kind: 'answer', speak: 'done', display: 'Slow read finished.' },
    ]
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestrator),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(subagent),
      },
    })
    try {
      expect(await harness.dashboardEval<string>(commandBoxScript('research, then send the form'))).toBe('submitted')
      await waitFor(
        () => harness.dashboardEval<boolean>(`!!document.querySelector('.subagent-card--running')`),
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      await waitForConfirmation(harness)

      await harness.clickDashboardElement('.assistant-stop')

      await expectCancelledWithoutSubmit(harness)
      await waitFor(
        () => harness.dashboardEval<boolean>(`!!document.querySelector('.subagent-card--cancelled')`),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(await transcript(harness)).not.toContain('Slow read finished.')
    } finally {
      await harness.quit()
    }
  })

  it('captures Escape while the embedded page owns focus', async () => {
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(interruptScript(fixture)) },
    })
    try {
      expect(await harness.dashboardEval<string>(commandBoxScript('send the contact form'))).toBe('submitted')
      await waitForConfirmation(harness)
      await harness.focusPane()
      const paneSessionId = harness.paneSessionId()
      if (!paneSessionId) throw new Error('pane session not found')

      await harness.cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      }, paneSessionId)

      await expectCancelledWithoutSubmit(harness)
    } finally {
      await harness.quit()
    }
  })

  it('intercepts spoken stop only while the run is active', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(interruptScript(fixture)),
        BINGBONG_STT_SCRIPT: JSON.stringify(['stop']),
        BINGBONG_VAD_SCRIPT: JSON.stringify(vadUtterance()),
      },
    })
    try {
      expect(await harness.dashboardEval<string>(commandBoxScript('send the contact form'))).toBe('submitted')
      await waitForConfirmation(harness)

      expect(await harness.dashboardEval<string>(feedAudioScript)).toBe('fed')

      await expectCancelledWithoutSubmit(harness)
      expect(await transcript(harness)).toContain('heard "stop" (stopping)')
    } finally {
      await harness.quit()
    }
  })

  it('routes spoken stop as an ordinary command while idle', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'answer', speak: 'Idle stop was a command.', display: 'Handled stop normally.' },
        ]),
        BINGBONG_STT_SCRIPT: JSON.stringify(['stop']),
        BINGBONG_VAD_SCRIPT: JSON.stringify(vadUtterance()),
      },
    })
    try {
      expect(await harness.dashboardEval<string>(armScript)).toBe('armed')
      expect(await harness.dashboardEval<string>(feedAudioScript)).toBe('fed')

      await waitFor(
        async () => (await transcript(harness)).includes('Idle stop was a command.') || undefined,
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(await transcript(harness)).toContain('you stop')
      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--cancelled')`)).toBe(false)
    } finally {
      await harness.quit()
    }
  })

  it('pauses spoken work without a timeout and injects steering into the next turn', async () => {
    const steeringAnswer = 'Steering received: $steering'
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(interruptScript(fixture, steeringAnswer)),
        BINGBONG_STT_SCRIPT: JSON.stringify(['hold on', 'use Paris instead']),
        BINGBONG_VAD_SCRIPT: JSON.stringify([...vadUtterance(), ...vadUtterance()]),
      },
    })
    try {
      expect(await harness.dashboardEval<string>(commandBoxScript('send the contact form'))).toBe('submitted')
      await waitForConfirmation(harness)

      expect(await harness.dashboardEval<string>(feedAudioScript)).toBe('fed')
      await waitFor(
        () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--paused')`),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      await waitFor(
        async () => {
          const hint = await harness.dashboardEval<string>(`document.querySelector('.voice-hint')?.textContent ?? ''`)
          return hint === 'paused — say resume or steer me' ? hint : undefined
        },
        { timeoutMs: 5_000, intervalMs: 100 },
      )

      expect(await harness.dashboardEval<string>(feedAudioScript)).toBe('fed')
      await waitFor(
        async () => (await transcript(harness)).includes('Steering received: use Paris instead') || undefined,
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      expect(await harness.paneEval<string>('document.title')).toBe('risky fixture')
      expect(await transcript(harness)).toContain('heard "use Paris instead" (steering)')
    } finally {
      await harness.quit()
    }
  })

  it('resumes spoken work without changing its pending confirmation', async () => {
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(interruptScript(fixture, 'Form sent after resume.')),
        BINGBONG_STT_SCRIPT: JSON.stringify(['hold on', 'resume']),
        BINGBONG_VAD_SCRIPT: JSON.stringify([...vadUtterance(), ...vadUtterance()]),
      },
    })
    try {
      expect(await harness.dashboardEval<string>(commandBoxScript('send the contact form'))).toBe('submitted')
      await waitForConfirmation(harness)

      expect(await harness.dashboardEval<string>(feedAudioScript)).toBe('fed')
      await waitFor(
        () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--paused')`),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(await harness.dashboardEval<string>(feedAudioScript)).toBe('fed')
      await waitFor(
        async () => (await transcript(harness)).includes('heard "resume" (resumed)') || undefined,
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)).toBe(true)
      await harness.clickDashboardElement('.confirmation-actions button')
      await waitFor(
        async () => (await harness.paneEval<string>('document.title')) === 'submitted:contact' || undefined,
        { timeoutMs: 20_000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })
})
