import { describe, expect, it } from 'vitest'
import { AUDIO_ROAD_ENV, audioRoadBinary } from './audioRoad'

describe('the audio road switch (#502)', () => {
  it('is off unless the env turns it on', () => {
    expect(audioRoadBinary({})).toBeNull()
    expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: '' })).toBeNull()
    expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: 'off' })).toBeNull()
    expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: '0' })).toBeNull()
  })

  it('`on` runs the yt-dlp on PATH; a path runs that one', () => {
    expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: 'on' })).toBe('yt-dlp')
    expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: ' /home/kiosk/.local/bin/yt-dlp ' })).toBe('/home/kiosk/.local/bin/yt-dlp')
  })
})
