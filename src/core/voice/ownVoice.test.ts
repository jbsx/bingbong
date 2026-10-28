import { describe, expect, it } from 'vitest'
import { isOwnVoice, ownShare, resolveOverSpeech } from './ownVoice'

const READ = 'Let Down (Remastered). Radiohead - Topic. If playback doesn’t begin shortly, try restarting your device.'

describe('the app’s own voice in the mic (#490)', () => {
  it('is a stretch of the sentence being said, heard in order, a word or two misheard', () => {
    expect(isOwnVoice('if playback doesnt begin shortly', READ)).toBe(true)
    expect(isOwnVoice('If playback does not begin shortly, try restarting.', READ)).toBe(true)
  })

  it('is not the person’s line over it', () => {
    expect(isOwnVoice('Move on.', READ)).toBe(false)
    expect(isOwnVoice('move on try restarting', READ)).toBe(false)
    expect(isOwnVoice('page', 'There’s no page to go back to. Try “resume”.')).toBe(true)
  })

  it('needs the words in their order, and nothing said is no match', () => {
    expect(ownShare('device your restarting try', READ)).toBe(0.25)
    expect(ownShare('move on', '')).toBe(0)
    expect(ownShare('', READ)).toBe(0)
  })

  it('takes its arm from BINGBONG_OVER_SPEECH, else the duck', () => {
    expect(resolveOverSpeech({})).toBe('duck')
    expect(resolveOverSpeech({ BINGBONG_OVER_SPEECH: ' Stop ' })).toBe('stop')
    expect(resolveOverSpeech({ BINGBONG_OVER_SPEECH: 'off' })).toBe('off')
    expect(resolveOverSpeech({ BINGBONG_OVER_SPEECH: 'loud' })).toBe('duck')
  })
})
