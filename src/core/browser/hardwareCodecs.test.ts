import { describe, expect, it } from 'vitest'
import { codecFamilyOf, refusedCodecs } from './hardwareCodecs'

describe('hardwareCodecs (#425)', () => {
  it('names the family of a codec string as a page asks for it', () => {
    expect(codecFamilyOf('av01.0.00M.08')).toBe('av1')
    expect(codecFamilyOf(' vp09.00.51.08 ')).toBe('vp9')
    expect(codecFamilyOf('vp9')).toBe('vp9')
    expect(codecFamilyOf('VP8')).toBe('vp8')
    expect(codecFamilyOf('avc1.640028')).toBe('h264')
    expect(codecFamilyOf('hev1.1.6.L93.B0')).toBe('hevc')
    expect(codecFamilyOf('opus')).toBeNull()
    expect(codecFamilyOf('mp4a.40.2')).toBeNull()
  })

  it('refuses each codec the GPU does not decode, as the kiosk has it: AV1 in software, VP9 and H.264 in hardware', () => {
    expect(refusedCodecs({ av1: false, vp9: true, vp8: true, h264: true, hevc: true })).toEqual(['av1'])
  })

  it('refuses nothing on a machine that decodes nothing in hardware: every codec is software there alike', () => {
    expect(refusedCodecs({ av1: false, vp9: false, vp8: false, h264: false, hevc: false })).toEqual([])
  })

  it('refuses nothing when the GPU decodes every codec', () => {
    expect(refusedCodecs({ av1: true, vp9: true, vp8: true, h264: true, hevc: true })).toEqual([])
  })
})
