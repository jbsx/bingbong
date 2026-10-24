import { describe, expect, it } from 'vitest'
import { parseBrightness, parseDetect } from './ddc'

// `ddcutil detect --terse` on the appliance (#413), with an invalid display
// beside the two it can drive.
const DETECT = `Display 1
   I2C bus:          /dev/i2c-0
   DRM connector:    card0-HDMI-A-1
   Monitor:          PHL:PHL 325E1:UK02123456789

Display 2
   I2C bus:          /dev/i2c-1
   DRM connector:    card0-DVI-D-1
   Monitor:          WAN:27MQ95FSHDRU:0000000001

Invalid display
   I2C bus:          /dev/i2c-5
   DRM connector:    card0-eDP-1
   Monitor:          BOE::
`

describe('ddc', () => {
  it('lists each display ddcutil can drive by its model and connector, with the bus it is on now', () => {
    expect(parseDetect(DETECT)).toEqual([
      { bus: 0, model: 'PHL 325E1', connector: 'HDMI-A-1' },
      { bus: 1, model: '27MQ95FSHDRU', connector: 'DVI-D-1' },
    ])
  })

  it('lists none when no display answers', () => {
    expect(parseDetect('No displays found.\n')).toEqual([])
    expect(parseDetect('')).toEqual([])
  })

  it('takes a display with no connector by its bus', () => {
    expect(parseDetect('Display 1\n   I2C bus:          /dev/i2c-3\n   Monitor:          DEL:DELL U2415:X\n')).toEqual([{ bus: 3, model: 'DELL U2415', connector: 'i2c-3' }])
  })

  it('reads the brightness and its maximum from getvcp --terse', () => {
    expect(parseBrightness('VCP 10 C 40 100\n')).toEqual({ current: 40, max: 100 })
  })

  it('reads none from an error or anything else', () => {
    expect(parseBrightness('VCP 10 ERR\n')).toBeNull()
    expect(parseBrightness('Display not found\n')).toBeNull()
  })
})
