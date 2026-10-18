import { describe, expect, it } from 'vitest'
import { voiceHint } from './voiceHint'

// The Status Capsule's voice hint (#331; the rule is in voiceHint.ts).

const quiet = { transcribing: false, listening: false, monitoring: false, partial: '' }

describe('voiceHint', () => {
  it('says nothing while transcribing — the pill already reads Transcribing…', () => {
    expect(voiceHint({ ...quiet, transcribing: true, listening: true })).toBeNull()
  })

  it('asks for a command while listening, without saying listening again', () => {
    expect(voiceHint({ ...quiet, listening: true })).toEqual({ kind: 'listening', text: 'say a command' })
  })

  it('shows the live partial transcript while the user speaks', () => {
    expect(voiceHint({ ...quiet, listening: true, partial: 'open you' })).toEqual({ kind: 'listening', text: '“open you…”' })
  })

  it('names the wake phrase and the hotkey while only the wake word listens', () => {
    expect(voiceHint({ ...quiet, monitoring: true })).toEqual({
      kind: 'monitoring',
      text: 'say “bing bong” or press Ctrl+Space',
    })
  })

  it('is empty with the mic closed', () => {
    expect(voiceHint(quiet)).toBeNull()
  })
})
