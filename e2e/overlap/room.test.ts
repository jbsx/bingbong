import { describe, expect, it } from 'vitest'
import { roomLeaks } from './room'

describe('roomLeaks (#490)', () => {
  const modules = '0\tmodule-native-protocol-unix\tsocket=/tmp/r/native auth-anonymous=1\t\n1\tmodule-null-sink\tsink_name=room rate=16000 channels=1\t\n2\tmodule-remap-source\tmaster=room.monitor source_name=mic\t\n'
  const sinks = '0\troom\tmodule-null-sink.c\ts16le 1ch 16000Hz\tIDLE\n'

  it('passes a room of its socket, one null sink and the microphone over its monitor', () => {
    expect(roomLeaks(modules, sinks)).toBeNull()
  })

  it('refuses a room with a device module in it', () => {
    expect(roomLeaks(`${modules}2\tmodule-alsa-sink\tdevice=hw:0\t\n`, sinks)).toBe('the room loaded module-alsa-sink')
  })

  it('refuses a sink that is not the null sink', () => {
    expect(roomLeaks(modules, '0\talsa_output.pci\tmodule-alsa-card.c\ts16le 2ch 44100Hz\tIDLE\n')).toBe("the room's sink is alsa_output.pci on module-alsa-card.c")
    expect(roomLeaks(modules, `${sinks}1\tother\tmodule-null-sink.c\ts16le 1ch 16000Hz\tIDLE\n`)).toBe('the room has 2 sinks')
  })
})
