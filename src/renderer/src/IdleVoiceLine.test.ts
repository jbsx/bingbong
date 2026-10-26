import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VoiceLine, type IdleVoice } from './IdleScreen'

// The Voice Prompt on the Idle Screen (#360, AC4): the first Clock Line says
// the ear's real state in the Status Capsule's word.

const AT_REST: IdleVoice = { listening: false, transcribing: false, hearing: false, monitoring: true, partial: '' }
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

  it('asks for a command until speech starts, then says "…" — still Listening — until the first partial (#441)', () => {
    expect(text(render({ ...AT_REST, listening: true }))).toBe('say a command Listening')
    const hearing = render({ ...AT_REST, listening: true, hearing: true })
    expect(hearing).toContain('idle-voice--hearing')
    expect(hearing).not.toContain('idle-voice-said--waiting')
    expect(text(hearing)).toBe('… Listening')
  })

  it('says Transcribing while the words are read, with their seconds (#442), and says the microphone is off when nothing listens', () => {
    expect(text(render({ ...AT_REST, transcribing: true, partial: 'play some jazz', since: Date.now() }))).toBe('“play some jazz” · 0s Transcribing')
    expect(text(render({ ...AT_REST, transcribing: true, since: Date.now() - 2_500 }))).toBe('your words · 2s Transcribing')
    const off = render({ ...AT_REST, monitoring: false })
    expect(text(off)).toBe('Microphone off — start typing')
    expect(off).not.toContain('voice-wave')
  })

  it('never invites speech while the ear cannot hear yet: STARTING, the ear loading and its seconds, no waveform (#442)', () => {
    const starting = render({ ...AT_REST, loading: 'ear', since: Date.now() - 3_200 })
    expect(text(starting)).toBe('loading the ear · 3s Starting')
    expect(starting).not.toContain('Bing Bong')
    expect(starting).not.toContain('voice-wave')
  })

  it('holds a line taken before the ear can read it as STARTING, with its words and seconds (#442)', () => {
    expect(text(render({ ...AT_REST, transcribing: true, loading: 'words', since: Date.now() - 1_100 }))).toBe('your words · 1s Starting')
  })
})
