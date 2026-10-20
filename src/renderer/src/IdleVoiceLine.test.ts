import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VoiceLine, type IdleVoice } from './IdleScreen'

// The Voice Prompt on the Idle Screen (#360, AC4): the first Clock Line says
// the ear's real state in the Status Capsule's word.

const AT_REST: IdleVoice = { listening: false, transcribing: false, monitoring: true, partial: '' }
const render = (voice: IdleVoice): string => renderToStaticMarkup(createElement(VoiceLine, { voice }))
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('the idle Voice Prompt', () => {
  it('waits for the wake word with the orb, the hint and a still waveform — no LISTENING', () => {
    const html = render(AT_REST)
    expect(text(html)).toBe('Say “Bing Bong” or start typing')
    expect(html).toContain('idle-voice--rest')
    expect(html).toContain('voice-wave')
    expect(html).not.toContain('idle-voice-state')
  })

  it('says LISTENING with the live words while an Utterance is taken', () => {
    const html = render({ ...AT_REST, listening: true, partial: 'play some jazz' })
    expect(html).toContain('idle-voice--listening')
    expect(text(html)).toBe('“play some jazz…” Listening')
  })

  it('says Transcribing while the words are read, and says the microphone is off when nothing listens', () => {
    expect(text(render({ ...AT_REST, transcribing: true, partial: 'play some jazz' }))).toBe('“play some jazz…” Transcribing')
    const off = render({ ...AT_REST, monitoring: false })
    expect(text(off)).toBe('Microphone off — start typing')
    expect(off).not.toContain('voice-wave')
  })
})
