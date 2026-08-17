import { describe, expect, it } from 'vitest'
import { applyMediaVolumesScript, COLLECT_MEDIA_VOLUMES_SCRIPT, DUCK_FACTOR, duckedVolumes } from './duckVolumes'

describe('duckedVolumes', () => {
  it('scales every element by the duck factor', () => {
    expect(duckedVolumes([1, 0.5, 0], 0.2)).toEqual([0.2, 0.1, 0])
  })

  it('never exceeds the HTMLMediaElement volume range', () => {
    expect(duckedVolumes([1], 1.5)).toEqual([1])
  })

  it('exposes a duck factor well below full volume', () => {
    expect(DUCK_FACTOR).toBeGreaterThan(0)
    expect(DUCK_FACTOR).toBeLessThan(0.5)
  })
})

describe('page scripts', () => {
  it('collect script reads volumes off audio/video elements', () => {
    expect(COLLECT_MEDIA_VOLUMES_SCRIPT).toContain('querySelectorAll')
    expect(COLLECT_MEDIA_VOLUMES_SCRIPT).toContain('.volume')
  })

  it('apply script embeds the target volumes and writes them back', () => {
    const script = applyMediaVolumesScript([0.1, 0.5])
    expect(script).toContain('[0.1,0.5]')
    expect(script).toContain('.volume')
  })
})
