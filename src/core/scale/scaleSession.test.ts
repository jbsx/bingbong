import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from './qn'
import { createScaleSession } from './scaleSession'

// The probe's connection at 14:16:01 on 2026-10-19 (#350): the handshake, the owner already settled (the stable frame three times), stepping off.
const SETTLED_AND_OFF = [
  '120f1558c6f738c1a43f013f00046b',
  '140b150000010000000035',
  '100b151fbd01020001f404',
  '100b151fbd01020001f404',
  '100b151fbd01020001f404',
  '100b1520d0000000000020',
  '100b15217a0000000000cb',
  '100b151fbd00000000000c',
  '100b15112b00000000006c',
  '100b150235000000000067',
  '100b150000000000000030',
]

// The probe's connection at 14:16:13: the weight moving, settling unstable for a few seconds, then the stable frame three times.
const MOVING_THEN_SETTLED = [
  '120f1558c6f738c1a43f013f00056c',
  '140b150000010000000035',
  '100b1502fd00000000002f',
  '100b151ddd00000000002a',
  '100b15208a0000000000da',
  '100b151fbd00000000000c',
  '100b151fbd00000000000c',
  '100b151fbd0101ff01f604',
  '100b151fbd0101ff01f604',
  '100b151fbd0101ff01f604',
]

function replay(frames: readonly string[], start = 1_000_000) {
  const session = createScaleSession()
  return frames.map((hex, index) => session.receive(fromHex(hex), start + index * 200))
}

describe('a scale session', () => {
  it('answers the handshake: the kg config and the time to the info, the time to the ack', () => {
    const [info, ack] = replay(SETTLED_AND_OFF)
    expect(info.writes.map((write) => `${write.characteristic}:${toHex(write.bytes).slice(0, 2)}`)).toEqual(['ffe3:13', 'ffe4:02'])
    expect(ack.writes.map((write) => `${write.characteristic}:${toHex(write.bytes).slice(0, 2)}`)).toEqual(['ffe3:20'])
  })

  it('records exactly one Weigh-in though the stable frame repeats', () => {
    const results = replay(SETTLED_AND_OFF)
    const weighIns = results.flatMap((result) => (result.weighIn ? [result.weighIn] : []))
    expect(weighIns).toEqual([{ at: 1_000_400, kg: 81.25, r1: 512, r2: 500 }])
  })

  it('reports every reading for the pop-up, the settled ones marked, down to 0 kg on stepping off', () => {
    const readings = replay(SETTLED_AND_OFF).flatMap((result) => (result.reading ? [result.reading] : []))
    expect(readings[0]).toEqual({ kg: 81.25, stable: true })
    expect(readings.at(-1)).toEqual({ kg: 0, stable: false })
    expect(readings).toHaveLength(9)
  })

  it('records the first stable frame after the weight has moved', () => {
    const weighIns = replay(MOVING_THEN_SETTLED).flatMap((result) => (result.weighIn ? [result.weighIn] : []))
    expect(weighIns).toEqual([{ at: 1_001_400, kg: 81.25, r1: 511, r2: 502 }])
  })

  it('records a new Weigh-in when the owner steps off and on again in the same connection', () => {
    const weighIns = replay([...SETTLED_AND_OFF, ...MOVING_THEN_SETTLED.slice(2)]).flatMap((result) => (result.weighIn ? [result.weighIn] : []))
    expect(weighIns.map((weighIn) => weighIn.r1)).toEqual([512, 511])
  })

  it('ignores a stable reading under 5 kg', () => {
    const weighIns = replay(['100b1501f301000000000000', '100b1501f301000000000000']).flatMap((result) => (result.weighIn ? [result.weighIn] : []))
    expect(weighIns).toEqual([])
  })
})
