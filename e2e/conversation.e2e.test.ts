import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Conversation separation e2e (#54): the feed reads as a chat between two
// voices — your commands right-aligned in muted bubbles, Bing Bong's
// answers as left-aligned railed cards at conversation size — and a turn's
// spoken line leaves the view once its display card renders (TTS-only),
// while a display-less spoken line still renders as a card.

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`

/** One utterance of VAD probabilities: pre-roll silence, speech, trailing silence. */
function vadScript(speechFrames = 8): string {
  return JSON.stringify([
    ...Array.from({ length: 6 }, () => 0.01),
    ...Array.from({ length: speechFrames }, () => 0.95),
    ...Array.from({ length: 40 }, () => 0.01),
  ])
}

const FEED_AUDIO_SCRIPT = `(() => {
  for (let i = 0; i < 60; i++) window.bingbong.voice.sendAudio(new Float32Array(512))
  return 'fed'
})()`

/** The rendered conversation's structure and styling, from the overlay. */
const CONVERSATION_LAYOUT = `(() => {
  const list = document.querySelector('.feed-list')
  const bubble = document.querySelector('.feed-entry--user.feed-entry--command .feed-bubble')
  const card = document.querySelector('.feed-entry--assistant.feed-entry--display .feed-card')
  if (!list || !bubble || !card) return null
  return {
    userAlign: getComputedStyle(bubble.closest('.feed-entry')).justifyContent,
    systemAlign: getComputedStyle(card.closest('.feed-entry')).justifyContent,
    cardRail: getComputedStyle(card).borderLeftWidth,
    cardRailColor: getComputedStyle(card).borderLeftColor,
    cardFont: getComputedStyle(card.querySelector('.feed-text')).fontSize,
    bubbleFont: getComputedStyle(bubble.querySelector('.feed-text')).fontSize,
    commandText: bubble.textContent ?? '',
    displayText: card.textContent ?? '',
    speakTexts: Array.from(document.querySelectorAll('.feed-entry--speak')).map((el) => el.textContent).join('|'),
  }
})()`

async function openPanel(harness: Harness): Promise<void> {
  await harness.clickDashboardElement('.feed-panel-toggle')
  await waitFor(() => harness.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
}

describe('conversation separation e2e (#54)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('renders your command as a right-aligned bubble and the answer as a left-aligned railed card, suppressing the spoken line', async () => {
    const script: AssistantTurn[] = [
      { kind: 'answer', speak: 'Spoken summary.', display: 'The full display card.' },
    ]
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      expect(await harness.submitCommand('what is the answer')).toBe('submitted')
      await waitFor(
        () =>
          harness.overlayEval<boolean>(
            `!!document.querySelector('.feed-entry--assistant.feed-entry--display .feed-card')`,
          ),
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // Open the panel so geometry reads on laid-out elements (the feed
      // stays mounted while collapsed, but rects would zero out).
      await openPanel(harness)

      const layout = await harness.overlayEval<{
        userAlign: string
        systemAlign: string
        cardRail: string
        cardRailColor: string
        cardFont: string
        bubbleFont: string
        commandText: string
        displayText: string
        speakTexts: string
      }>(CONVERSATION_LAYOUT)
      expect(layout).not.toBeNull()

      // Your words: right-aligned muted bubble carrying the command — no
      // handle (ADR 0013: the orb marks Bing Bong only).
      expect(layout.userAlign).toBe('flex-end')
      expect(layout.commandText).toBe('what is the answer')

      // Bing Bong's answer: left-aligned railed card at conversation size
      // (1.2rem × 17px root), its rail the speaking-green edge.
      expect(layout.systemAlign).toBe('flex-start')
      expect(layout.cardRail).toBe('4px')
      expect(layout.cardRailColor).toBe('rgb(52, 199, 89)') // #34c759
      expect(layout.cardFont).toBe('20.4px')
      expect(layout.displayText).toContain('The full display card.')

      // The bubble's text reads at conversation size too.
      expect(layout.bubbleFont).toBe('20.4px')

      // The spoken line never rendered — its display card owns the turn
      // (#54); the pipeline still spoke it (TTS is upstream of the feed).
      expect(layout.speakTexts.includes('Spoken summary.')).toBe(false)
    } finally {
      await harness.quit()
    }
  })

  it('still renders a spoken line as a card when its turn has no display', async () => {
    // A slow page holds the run open; stopping it cancels with a spoken
    // 'Stopped.' and no display card — the display-less speak renders.
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/slow') } }] },
    ]
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      await openPanel(harness)
      expect(await harness.submitCommand('open the slow page')).toBe('submitted')
      await waitFor(
        () => harness.dashboardEval<boolean>(`document.querySelector('.status-pill')?.textContent === 'Acting…'`),
        { timeoutMs: 20000, intervalMs: 250 },
      )
      await harness.clickOverlayElement('.panel-stop')

      await waitFor(
        async () => {
          const card = await harness.overlayEval<boolean>(
            `!!document.querySelector('.feed-entry--assistant.feed-entry--speak .feed-card')`,
          )
          const stopped = await harness.overlayEval<boolean>(
            `Array.from(document.querySelectorAll('.feed-entry--speak .feed-card')).some((el) => (el.textContent ?? '').includes('Stopped.'))`,
          )
          return card && stopped ? true : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })

  it('renders a heard transcription as a user bubble too', async () => {
    // ask_user routes a spoken free-text answer to the run without it
    // being a command — the heard line lands as a voice entry (#54: user
    // role, right-aligned bubble).
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
      await openPanel(harness)
      expect(await harness.submitCommand('book a hotel')).toBe('submitted')

      // The ask window opens the mic; feed the utterance through it.
      await waitFor(
        () => harness.dashboardEval<string>(`document.querySelector('.voice-hint')?.textContent ?? ''`).then(
          (text) => (text === 'listening — your answer' ? text : undefined),
        ),
        { timeoutMs: 5000, intervalMs: 100 },
      )
      expect(await harness.dashboardEval<string>(FEED_AUDIO_SCRIPT)).toBe('fed')

      await waitFor(
        () =>
          harness.overlayEval<boolean>(
            `(() => {
              const bubble = document.querySelector('.feed-entry--user.feed-entry--voice .feed-bubble')
              return bubble !== null && (bubble.textContent ?? '').includes('heard "Paris, France"') &&
                getComputedStyle(bubble.closest('.feed-entry')).justifyContent === 'flex-end'
            })()`,
          ),
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })
})
