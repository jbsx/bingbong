import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'

// Voice e2e (T9): the mic worklet needs real hardware, so the renderer's
// capture is bypassed — the test arms the session and pushes PCM through the
// same preload API the worklet uses, with BINGBONG_VAD_SCRIPT +
// BINGBONG_STT_SCRIPT standing in for Silero and whisper. Everything below
// the mic is real: IPC, endpointing, session routing, pipeline, pane, orb.

/** One utterance of VAD probabilities: pre-roll silence, speech, trailing silence. */
function vadScript(speechFrames = 8): string {
  return JSON.stringify([
    ...Array.from({ length: 6 }, () => 0.01),
    ...Array.from({ length: speechFrames }, () => 0.95),
    ...Array.from({ length: 40 }, () => 0.01),
  ])
}

const armScript = `(async () => {
  await window.bingbong.voice.arm()
  return 'armed'
})()`

const feedAudioScript = `(() => {
  for (let i = 0; i < 60; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
  return 'fed'
})()`

async function waitForOrb(harness: Harness, cls: string): Promise<void> {
  await waitFor(
    () => harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--${cls}')`),
    { timeoutMs: 20000, intervalMs: 250 },
  )
}

describe('voice e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('runs a spoken command through the identical pipeline as the text box', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/') } }] },
      { kind: 'answer', speak: 'Opened the fixture page.', display: 'Navigated to the fixture page.' },
    ]
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_STT_SCRIPT: JSON.stringify(['open the fixture page']),
        BINGBONG_VAD_SCRIPT: vadScript(),
      },
    })
    try {
      const armed = await harness.dashboardEval<string>(armScript)
      expect(armed).toBe('armed')
      await waitForOrb(harness, 'listening')

      const fed = await harness.dashboardEval<string>(feedAudioScript)
      expect(fed).toBe('fed')

      // The transcript heard the command (pipeline echo) and the pane moved.
      await harness.waitForPaneUrl(fixture.url('/'))
      await waitFor(
        async () => {
          const transcript = await harness.dashboardEval<string>(
            `Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n')`,
          )
          return transcript.includes('open the fixture page') && transcript.includes('Opened the fixture page.')
            ? transcript
            : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      await waitForOrb(harness, 'idle')
    } finally {
      await harness.quit()
    }
  })

  it('accepts a spoken yes inside the confirmation window', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/risky') } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: { ref: 7 } }] },
      { kind: 'answer', speak: 'Form sent.', display: 'The contact form was submitted.' },
    ]
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_STT_SCRIPT: JSON.stringify(['yeah']),
        BINGBONG_VAD_SCRIPT: vadScript(),
      },
    })
    try {
      await harness.dashboardEval<string>(commandBoxScript('send the contact form'))
      await harness.waitForPaneUrl(fixture.url('/risky'))

      // The confirmation prompt opens the 12 s voice window: orb → listening.
      await waitForOrb(harness, 'listening')
      const hint = await harness.dashboardEval<string>(`document.querySelector('.voice-hint')?.textContent ?? ''`)
      expect(hint).toBe('listening — yes or no?')

      await harness.dashboardEval<string>(feedAudioScript)

      // The spoken yes approved the form submit; the dialog is gone.
      await waitFor(
        async () => {
          const title = await harness.paneEval<string>(`document.title`)
          return title === 'submitted:contact' ? title : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      const cardShown = await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)
      expect(cardShown).toBe(false)

      // The heard answer shows in the transcript and the run completes.
      await waitFor(
        async () => {
          const transcript = await harness.dashboardEval<string>(
            `Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n')`,
          )
          return transcript.includes('heard "yeah" (answered)') && transcript.includes('Form sent.')
            ? transcript
            : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      await waitForOrb(harness, 'idle')
    } finally {
      await harness.quit()
    }
  })

  it('returns a spoken free-text answer through ask_user', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which city do you mean?' } }] },
      { kind: 'answer', speak: 'Using Paris.', display: 'Used the spoken answer.' },
    ]
    const harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_STT_SCRIPT: JSON.stringify(['Paris, France']),
        BINGBONG_VAD_SCRIPT: vadScript(),
      },
    })
    try {
      await harness.dashboardEval(`
        window.__askVoiceEvents = []
        window.bingbong.assistant.onEvent((event) => window.__askVoiceEvents.push(event))
      `)
      expect(await harness.dashboardEval<string>(commandBoxScript('book a hotel'))).toBe('submitted')

      await waitForOrb(harness, 'listening')
      const hint = await waitFor(
        async () => {
          const text = await harness.dashboardEval<string>(`document.querySelector('.voice-hint')?.textContent ?? ''`)
          return text === '' ? undefined : text
        },
        { timeoutMs: 5000, intervalMs: 100 },
      )
      expect(hint).toBe('listening — your answer')
      expect(await harness.dashboardEval<string>(feedAudioScript)).toBe('fed')

      const events = await waitFor(
        async () => {
          const captured = await harness.dashboardEval<PipelineEvent[]>('window.__askVoiceEvents || []')
          return captured.some((event) => event.type === 'done') ? captured : undefined
        },
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool_result',
        callId: 'a1',
        ok: true,
        result: 'Paris, France',
      }))
      const transcript = await harness.dashboardEval<string>(
        `Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n')`,
      )
      expect(transcript).toContain('heard "Paris, France" (your answer)')
      expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.ask-card')`)).toBe(false)
    } finally {
      await harness.quit()
    }
  })
})
