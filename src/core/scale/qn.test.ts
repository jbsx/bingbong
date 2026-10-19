import { describe, expect, it } from 'vitest'
import { decodeFrame, fromHex, replyTo, toHex } from './qn'

// Frames and replies captured by the probe on 2026-10-19 (#350): the owner's QN-Scale, protocol type 0x15.

describe('decodeFrame', () => {
  it('reads a moving weight', () => {
    expect(decodeFrame(fromHex('100b151fae0000000000fd'))).toEqual({ kind: 'reading', protocolType: 0x15, kg: 81.1, stable: false, r1: 0, r2: 0 })
  })

  it('reads a settled weight with both resistances', () => {
    expect(decodeFrame(fromHex('100b151fbd01020001f404'))).toEqual({ kind: 'reading', protocolType: 0x15, kg: 81.25, stable: true, r1: 512, r2: 500 })
    expect(decodeFrame(fromHex('100b151fbd0101ff01f604'))).toEqual({ kind: 'reading', protocolType: 0x15, kg: 81.25, stable: true, r1: 511, r2: 502 })
  })

  it('reads 0 kg when the owner steps off', () => {
    expect(decodeFrame(fromHex('100b150000000000000030'))).toMatchObject({ kind: 'reading', kg: 0, stable: false })
  })

  it('reads the scale info and its ÷100 flag, and the acknowledgement', () => {
    expect(decodeFrame(fromHex('120f1558c6f738c1a43f013f01046c'))).toEqual({ kind: 'info', protocolType: 0x15, divisor: 100 })
    expect(decodeFrame(fromHex('140b150000010000000035'))).toEqual({ kind: 'ack', protocolType: 0x15 })
  })

  it('reads a weight with a ÷10 scale when the info said so', () => {
    expect(decodeFrame(fromHex('100b1503290000000000'), 10)).toMatchObject({ kg: 80.9 })
  })

  it('passes over a frame it does not know or one too short to read', () => {
    expect(decodeFrame(fromHex('a10215'))).toEqual({ kind: 'other', protocolType: 0x15 })
    expect(decodeFrame(fromHex('100b'))).toEqual({ kind: 'other', protocolType: null })
  })
})

describe('replyTo', () => {
  // The probe's clock at 14:14:33 on 2026-10-19: QN epoch 0x32688de9.
  const at = (946_702_800 + 0x32688de9) * 1000

  it('answers the scale info with the unit set to kg, then the time', () => {
    expect(replyTo(decodeFrame(fromHex('120f1558c6f738c1a43f013f01046c')), at).map(({ characteristic, bytes }) => [characteristic, toHex(bytes)])).toEqual([
      ['ffe3', '130915011000000042'],
      ['ffe4', '02e98d6832'],
    ])
  })

  it('answers the acknowledgement with the time', () => {
    expect(replyTo(decodeFrame(fromHex('140b150000010000000035')), at).map(({ characteristic, bytes }) => [characteristic, toHex(bytes)])).toEqual([['ffe3', '200815e98d68324d']])
  })

  it('answers nothing else', () => {
    expect(replyTo(decodeFrame(fromHex('100b151fbd01020001f404')), at)).toEqual([])
  })
})
