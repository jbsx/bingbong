import { describe, expect, it } from 'vitest'
import { micMutedState } from './micMute'
import { earPhase } from './voicePrompt'
import { voiceHint } from './voiceHint'

describe('micMutedState', () => {
  it('shows an open, monitoring or cold ear shut, and says so as Microphone off', () => {
    const states = [
      { listening: true, reason: 'wake' as const, monitoring: true, transcribing: false, hearing: true },
      { listening: false, reason: null, monitoring: true, transcribing: true, hearing: false, loading: 'words' as const, since: 5 },
      { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false, loading: 'failed' as const },
    ]
    for (const state of states) {
      const shown = micMutedState(state)
      expect(shown).toEqual({ listening: false, reason: null, monitoring: false, transcribing: false, hearing: false, micMuted: true })
      expect(earPhase(shown)).toBe('off')
      expect(voiceHint({ ...shown, partial: '' })).toBeNull()
    }
  })
})
