import { describe, expect, it } from 'vitest'
import type { MediaFacts } from '../browser/snapshot'
import { rateLevel, secondsInWords, volumeLevel } from './mediaOp'

const FACTS: MediaFacts = {
  paused: false,
  ended: false,
  currentTime: 30,
  duration: 300,
  volume: 0.5,
  muted: false,
  loop: false,
  rate: 1,
  seekable: { start: 0, end: 300 },
  tracks: 0,
  captions: null,
  hiddenTrack: false,
  buffering: false,
  failed: false,
}

describe('volumeLevel', () => {
  it.each([
    // turn-mvp2v0eu-vc, as heard on the kiosk (#457).
    ['Set music code to a hundred percent.', 100],
    ['one hundred percent', 100],
    ['volume to seventy percent', 70],
    ['set the volume to 80%', 80],
    ['volume to zero', 0],
  ])('sets %j to %d', (words, level) => {
    expect(volumeLevel('to', words, FACTS)).toBe(level)
  })

  it('moves by a number said in words', () => {
    expect(volumeLevel('down-step', 'turn it down by twenty five', FACTS)).toBe(25)
  })

  it('finds no level past a hundred', () => {
    expect(volumeLevel('to', 'volume to two hundred', FACTS)).toBeNull()
  })
})

describe('rateLevel', () => {
  it.each([
    // turn-mvm67q4j-5 and its retype turn-mvm681vw-6 (#457).
    ['play at one point five times speed', 1.5],
    ['one and a half times speed', 1.5],
    ['zero point seven five speed', 0.75],
    ['three quarters speed', 0.75],
    ['play at 1.5x', 1.5],
    ['2x speed', 2],
    ['speed 1.25', 1.25],
    ['normal speed', 1],
    ['double speed', 2],
    ['half speed', 0.5],
    ['two times speed', 2],
  ])('sets %j to %d', (words, rate) => {
    expect(rateLevel('to', words, FACTS)).toBe(rate)
  })

  it('finds no rate in words that name none', () => {
    expect(rateLevel('to', 'change the speed', FACTS)).toBeNull()
  })
})

describe('secondsInWords', () => {
  it.each([
    ['skip forward thirty seconds', 30],
    ['1 minute 30 seconds', 90],
    ['a minute', 60],
    ['twenty five minutes', 1500],
    ['forward ninety', 90],
    ['one hundred and twenty seconds', 120],
    ['a minute and a half', 90],
    ['one and a half minutes', 90],
    ['half a minute', 30],
    ['two point five seconds', 2.5],
  ])('reads %j as %d seconds', (words, seconds) => {
    expect(secondsInWords(words)).toBe(seconds)
  })

  it('names no length in words with no number', () => {
    expect(secondsInWords('skip ahead a bit')).toBeNull()
  })
})
