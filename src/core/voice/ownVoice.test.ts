import { describe, expect, it } from 'vitest'
import { isOwnVoice, ownShare, resolveOverSpeech, soundLetters } from './ownVoice'

const READ = 'Let Down (Remastered). Radiohead - Topic 153,268,931 views. If playback doesn’t begin shortly, try restarting your device. Videos that you watch may be added to the TV’s watch history and influence TV recommendations. 4:32Radiohead - Let Down + Choir (Complete) NEW VERSIONDanny Kuroki34m • 1 yr agoLivePlaylist ()Mix (50+)4:28Exit Music (For A Film)Radiohead53m • 10 yr agoLivePlaylist ()Mix (50+)'

describe('the app’s own voice in the mic (#490)', () => {
  it('is a stretch of the sentence being said, however the ear wrote it (the gate’s own captures, Parakeet)', () => {
    expect(isOwnVoice('If playback doesn\'t, begin shortly, try restarting your device.', READ)).toBe(true)
    expect(isOwnVoice('and influence T V recommendations.', READ)).toBe(true)
    expect(isOwnVoice('Radio hit Topic 153 million 268 931 views', READ)).toBe(true)
    expect(isOwnVoice('4 32 radio hit let down plus choir complete NEW version Danny Kuroki 34 M 1 or a go live playlist mits 50 plus', READ)).toBe(true)
    expect(isOwnVoice('B double E version Danny Kuroki 34 M Wanner A Go Life playlist mitts 50 plus score', READ)).toBe(true)
  })

  it('is not the person’s line over it, a short one above all', () => {
    expect(isOwnVoice('Move on.', READ)).toBe(false)
    expect(isOwnVoice('stop', READ)).toBe(false)
    expect(isOwnVoice('play let down', READ)).toBe(false)
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
    expect(ownShare('device your restarting try', READ)).toBeLessThan(0.7)
    expect(ownShare('move on', '')).toBe(0)
    expect(ownShare('', READ)).toBe(0)
  })

  it('takes its arm from BINGBONG_OVER_SPEECH, else off (the ruled reversal, #490)', () => {
    expect(resolveOverSpeech({})).toBe('off')
    expect(resolveOverSpeech({ BINGBONG_OVER_SPEECH: 'duck' })).toBe('duck')
    expect(resolveOverSpeech({ BINGBONG_OVER_SPEECH: ' Stop ' })).toBe('stop')
    expect(resolveOverSpeech({ BINGBONG_OVER_SPEECH: 'off' })).toBe('off')
    expect(resolveOverSpeech({ BINGBONG_OVER_SPEECH: 'loud' })).toBe('off')
  })

  it('a stretch may run from anywhere in one sentence into the head of the next: a stopped read, then "Stopped." (#490)', () => {
    const read = 'Mac DeMarco 4.3m. Moonlight on the River, Mac DeMarco, 4.3m views. Listening to RADIOHEAD For the First Time'
    expect(ownShare('Light on the river stopped.', read)).toBeLessThan(0.75)
    expect(isOwnVoice('Light on the river stopped.', [read, 'Stopped.'])).toBe(true)
    // Never into the middle of the next, nor from the second back into the first.
    expect(ownShare('stopped light on the river', [read, 'Stopped.'])).toBeLessThan(0.75)
    expect(isOwnVoice('click on the first video', [read, 'Stopped.'])).toBe(false)
  })

  it('a short echo is the app’s own when its words are found in what the app said; a short line found nowhere is the person’s (the orchestrator’s ruling, #490)', () => {
    const read = "Cigarettes After Sex — late night playlist. Classic Rock Songs 70s 80s 90s Full Album Nirvana, Guns N' Roses, AC/DC, Bon Jovi"
    // The gate's four short echoes read as Commands at c7e80bf0 (narrow18–20).
    expect(isOwnVoice('After sex', read)).toBe(true)
    expect(isOwnVoice('Nirvana', read)).toBe(true)
    expect(isOwnVoice('A C Slash D C', read)).toBe(true)
    expect(isOwnVoice('Stopped.', [read, 'Stopped.'])).toBe(true)
    // The person's stop and back are heard: the app did not say them.
    expect(isOwnVoice('stop', read)).toBe(false)
    expect(isOwnVoice('back', read)).toBe(false)
    expect(isOwnVoice('Move on.', read)).toBe(false)
    // Found means the words themselves, whole: a word inside a word, or a near one, is not found.
    expect(isOwnVoice('Roses', read)).toBe(true)
    expect(isOwnVoice('Rose', read)).toBe(false)
    expect(isOwnVoice('Nirvanas', read)).toBe(false)
    expect(isOwnVoice('page.', 'There’s no page to go back to. Try “resume”.')).toBe(true)
    expect(isOwnVoice('stop', '')).toBe(false)
  })

  it('held against what just sounded, a short capture is the app’s own when it is near a stretch of it: the window is too short to be near by chance (narrow22)', () => {
    const read = 'Stop the Clocks Contents (Top) 1 Background 2 Content 3 Cover'
    expect(isOwnVoice('Content', read, 'Clocks Contents (Top) 1')).toBe(true)
    expect(isOwnVoice('Content', read)).toBe(true)
    expect(isOwnVoice('Contents', 'Stop the Clocks Contents', 'released in November 2006. The album')).toBe(false)
    expect(isOwnVoice('Stop.', read, 'released in November 2006. The album')).toBe(false)
    expect(isOwnVoice('Stop.', read, 'Background 2 Content 3 Cover')).toBe(false)
    expect(isOwnVoice('Stop.', read, '')).toBe(false)
  })
})
