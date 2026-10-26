import { describe, expect, it } from 'vitest'
import { voiceHint } from './voiceHint'

// The Status Capsule's voice hint (#331; the rule is in voiceHint.ts).

const quiet = { transcribing: false, listening: false, hearing: false, monitoring: false, partial: '' }

describe('voiceHint', () => {
  it('says nothing while transcribing — the pill already reads Transcribing…', () => {
    expect(voiceHint({ ...quiet, transcribing: true, listening: true })).toBeNull()
  })

  it('asks for a command while listening, without saying listening again', () => {
    expect(voiceHint({ ...quiet, listening: true })).toEqual({ kind: 'listening', text: 'say a command' })
  })

  it('says "…" once speech has started, until the first partial lands (#441)', () => {
    expect(voiceHint({ ...quiet, listening: true, hearing: true })).toEqual({ kind: 'listening', text: '…' })
    expect(voiceHint({ ...quiet, listening: true, hearing: true, partial: 'next' })).toEqual({ kind: 'listening', text: '“next…”' })
  })

  it('shows the live partial transcript while the user speaks', () => {
    expect(voiceHint({ ...quiet, listening: true, partial: 'open you' })).toEqual({ kind: 'listening', text: '“open you…”' })
  })

  it('names the wake phrase and the hotkey while only the wake word listens', () => {
    expect(voiceHint({ ...quiet, monitoring: true })).toEqual({
      kind: 'monitoring',
      text: 'say “Bing Bong” or press Ctrl+Space',
    })
  })

  it('is empty with the mic closed', () => {
    expect(voiceHint(quiet)).toBeNull()
  })

  it('keeps the last spoken result in place of the wake instruction (#436)', () => {
    expect(voiceHint({ ...quiet, monitoring: true }, { result: 'Volume 38 percent.' })).toEqual({ kind: 'result', text: 'Volume 38 percent.' })
    expect(voiceHint(quiet, { result: 'Volume 38 percent.' })).toEqual({ kind: 'result', text: 'Volume 38 percent.' })
  })

  it('gives the live words the slot over the last result — they are the next input (#436)', () => {
    expect(voiceHint({ ...quiet, listening: true, partial: 'open you' }, { result: 'Volume 38 percent.' })).toEqual({ kind: 'listening', text: '“open you…”' })
  })

  it('says nothing while the Voice Prompt is on screen — the Prompt carries the words (#359)', () => {
    expect(voiceHint(quiet, { promptShown: true, result: 'Volume 38 percent.' })).toBeNull()
    expect(voiceHint({ ...quiet, listening: true, partial: 'open you' }, { promptShown: true })).toBeNull()
    expect(voiceHint({ ...quiet, monitoring: true }, { promptShown: true })).toBeNull()
  })
})
