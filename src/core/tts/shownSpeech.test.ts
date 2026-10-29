import { describe, expect, it, vi } from 'vitest'
import { createShownSpeech, type ShownLine } from './shownSpeech'
import type { LineChime } from './chime'

// The voice off (#513): every line the app would have said is shown on the
// Line Overlay and marked by a chime instead. Nothing is ever being said, so
// no capture is muted and nothing ducks under speech.

function shown() {
  const lines: ShownLine[] = []
  const chimes: LineChime[] = []
  const speech = createShownSpeech({ show: (line) => lines.push(line), chime: (kind) => chimes.push(kind) })
  return { speech, lines, chimes }
}

describe('shown speech', () => {
  it('shows each line and chimes done, or failed when the line tells a failure', async () => {
    const { speech, lines, chimes } = shown()
    await speech.tts.speak('Opened the BBC.')
    await speech.tts.speak('That link is covered.', { failure: true })
    expect(lines.map(({ text, failure }) => ({ text, failure }))).toEqual([
      { text: 'Opened the BBC.', failure: false },
      { text: 'That link is covered.', failure: true },
    ])
    expect(chimes).toEqual(['done', 'failed'])
  })

  it('shows the words without markdown, as the voice would have said them', async () => {
    const { speech, lines } = shown()
    await speech.tts.speak('**Rain** at [noon](https://example.com)')
    expect(lines[0]!.text).toBe('Rain at noon')
  })

  it('is never speaking: no capture waits on it and nothing ducks', async () => {
    const { speech } = shown()
    const change = vi.fn()
    speech.onSpeakingChange(change)
    const said = speech.tts.speak('Stopped.')
    expect(speech.isSpeaking()).toBe(false)
    await said
    await speech.waitIdle()
    expect(change).not.toHaveBeenCalled()
    expect(speech.speechText?.()).toBe('')
  })

  it('counts the line shown as its first sound, so the Reaction closes on it', async () => {
    const { speech } = shown()
    const onFirstSound = vi.fn()
    await expect(speech.tts.speak('Timer set for 5 minutes.', { onFirstSound })).resolves.toEqual({ ok: true })
    expect(onFirstSound).toHaveBeenCalledTimes(1)
  })
})
