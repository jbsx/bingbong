import { describe, expect, it } from 'vitest'
import { isOwnVoice, ownShare, resolveOverSpeech, soundLetters } from './ownVoice'

const READ = 'Let Down (Remastered). Radiohead - Topic 153,268,931 views. If playback doesn’t begin shortly, try restarting your device. Videos that you watch may be added to the TV’s watch history and influence TV recommendations. 4:32Radiohead - Let Down + Choir (Complete) NEW VERSIONDanny Kuroki34m • 1 yr agoLivePlaylist ()Mix (50+)'

describe('the app’s own voice in the mic (#490)', () => {
  it('is a stretch of the sentence being said, however the ear wrote it (the gate’s own captures, Parakeet)', () => {
    expect(isOwnVoice('If playback doesn\'t, begin shortly, try restarting your device.', READ)).toBe(true)
    expect(isOwnVoice('and influence T V recommendations.', READ)).toBe(true)
    expect(isOwnVoice('Radio hit Topic 153 million 268 931 views', READ)).toBe(true)
    expect(isOwnVoice('4 32 radio hit let down plus choir complete NEW version Danny Kuroki 34 M 1 or a go live playlist mits 50 plus', READ)).toBe(true)
  })

  it('is not the person’s line over it, a short one above all', () => {
    expect(isOwnVoice('Move on.', READ)).toBe(false)
    expect(isOwnVoice('stop', READ)).toBe(false)
    expect(isOwnVoice('play let down', READ)).toBe(false)
    expect(isOwnVoice('page.', 'There’s no page to go back to. Try “resume”.')).toBe(false)
    expect(isOwnVoice('click on the first video', READ)).toBe(false)
  })

  it('reads numbers and signs as they are said, and parts words glued on the page', () => {
    expect(soundLetters('4:32')).toBe(soundLetters('four thirty two'))
    expect(soundLetters('Mix (50+)')).toBe('mixfiftyplus')
    expect(soundLetters('153,268,931')).toBe('onehundredfiftythreemilliontwohundredsixtyeightthousandninehundredthirtyone')
    expect(soundLetters('VERSIONDanny Kuroki34m')).toBe('versiondannykurokithirtyfourm')
    expect(soundLetters('2.9m')).toBe('twopointninem')
  })

  it('holds the transcript in one stretch, and nothing said is no match', () => {
    expect(ownShare('try restarting your device', READ)).toBe(1)
    expect(ownShare('device your restarting try', READ)).toBeLessThan(0.8)
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
