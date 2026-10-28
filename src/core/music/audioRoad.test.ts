import { describe, expect, it } from 'vitest'
import { AUDIO_ROAD_ENV, audioRoadBinary } from './audioRoad'

describe("the audio road's yt-dlp (#502)", () => {
  it('is the one on PATH unless the env names a path', () => {
    expect(audioRoadBinary({})).toBe('yt-dlp')
    expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: '' })).toBe('yt-dlp')
    expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: ' /home/kiosk/.local/bin/yt-dlp ' })).toBe('/home/kiosk/.local/bin/yt-dlp')
  })

  it('the switch words it once carried name the one on PATH: on and off are the setting’s now', () => {
    for (const word of ['on', 'off', '0', '1', 'true', 'FALSE']) expect(audioRoadBinary({ [AUDIO_ROAD_ENV]: word })).toBe('yt-dlp')
  })
})
