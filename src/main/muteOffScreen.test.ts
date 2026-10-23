import { describe, expect, it } from 'vitest'
import { muteOffScreen, shouldMuteAudio } from './muteOffScreen'

const XVFB = '/tmp/xvfb-run.Ab12Cd/Xauthority'

describe('shouldMuteAudio', () => {
  it('mutes under xvfb-run', () => {
    expect(shouldMuteAudio({ XAUTHORITY: XVFB })).toBe(true)
  })

  it('plays on the real display', () => {
    expect(shouldMuteAudio({ XAUTHORITY: '/run/user/1000/.mutter-Xwaylandauth.X1Y2Z3' })).toBe(false)
    expect(shouldMuteAudio({})).toBe(false)
  })

  it('takes BINGBONG_MUTE_AUDIO over the display', () => {
    expect(shouldMuteAudio({ BINGBONG_MUTE_AUDIO: '1' })).toBe(true)
    expect(shouldMuteAudio({ BINGBONG_MUTE_AUDIO: '0', XAUTHORITY: XVFB })).toBe(false)
  })
})

describe('muteOffScreen', () => {
  it('appends mute-audio only off screen', () => {
    const switches: string[] = []
    const app = { commandLine: { appendSwitch: (name: string) => switches.push(name) } } as unknown as Parameters<typeof muteOffScreen>[0]
    muteOffScreen(app, {})
    expect(switches).toEqual([])
    muteOffScreen(app, { XAUTHORITY: XVFB })
    expect(switches).toEqual(['mute-audio'])
  })
})
