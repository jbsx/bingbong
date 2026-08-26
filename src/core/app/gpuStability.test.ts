import { describe, expect, it } from 'vitest'
import {
  GPU_CRASH_LOOP_WINDOW_MS,
  gpuDisableFlag,
  gpuDisableRelaunchArgs,
  isGpuCrashLoop,
  parseGpuCrashRecord,
  recordGpuDeath,
  resolveGpuLaunchDecision,
} from './gpuStability'

describe('parseGpuCrashRecord', () => {
  it('accepts a well-formed record', () => {
    expect(parseGpuCrashRecord('{"deaths":2,"firstAt":123}')).toEqual({ deaths: 2, firstAt: 123 })
  })

  it('rejects absent, malformed, and wrong-shaped input', () => {
    expect(parseGpuCrashRecord(null)).toBeNull()
    expect(parseGpuCrashRecord('not json')).toBeNull()
    expect(parseGpuCrashRecord('"text"')).toBeNull()
    expect(parseGpuCrashRecord('[]')).toBeNull()
    expect(parseGpuCrashRecord('{"deaths":"two","firstAt":123}')).toBeNull()
    expect(parseGpuCrashRecord('{"deaths":-1,"firstAt":123}')).toBeNull()
    expect(parseGpuCrashRecord('{"deaths":1,"firstAt":"soon"}')).toBeNull()
  })
})

describe('recordGpuDeath', () => {
  it('opens a fresh window on the first death', () => {
    expect(recordGpuDeath(null, 1_000)).toEqual({ deaths: 1, firstAt: 1_000 })
  })

  it('counts deaths inside the window against the first', () => {
    const first = recordGpuDeath(null, 1_000)
    expect(recordGpuDeath(first, 1_000 + GPU_CRASH_LOOP_WINDOW_MS - 1)).toEqual({ deaths: 2, firstAt: 1_000 })
  })

  it('resets the window once the earlier deaths lapsed', () => {
    const first = recordGpuDeath(recordGpuDeath(null, 1_000), 2_000)
    expect(recordGpuDeath(first, 1_000 + GPU_CRASH_LOOP_WINDOW_MS)).toEqual({ deaths: 1, firstAt: 1_000 + GPU_CRASH_LOOP_WINDOW_MS })
  })
})

describe('isGpuCrashLoop', () => {
  it('is a loop at two deaths in the window and not before', () => {
    expect(isGpuCrashLoop(null)).toBe(false)
    expect(isGpuCrashLoop({ deaths: 1, firstAt: 0 })).toBe(false)
    expect(isGpuCrashLoop({ deaths: 2, firstAt: 0 })).toBe(true)
  })
})

describe('resolveGpuLaunchDecision', () => {
  it('keeps the GPU on by default', () => {
    expect(resolveGpuLaunchDecision({ argv: ['electron', '.'], env: {}, record: null }).disableGpu).toBe(false)
  })

  it('disables on the argv switch or the env knob', () => {
    expect(resolveGpuLaunchDecision({ argv: ['electron', '.', gpuDisableFlag()], env: {}, record: null }).disableGpu).toBe(true)
    expect(resolveGpuLaunchDecision({ argv: ['electron', '.'], env: { BINGBONG_DISABLE_GPU: '1' }, record: null }).disableGpu).toBe(true)
  })

  it('disables after a previous run persisted a crash loop', () => {
    expect(resolveGpuLaunchDecision({ argv: ['electron', '.'], env: {}, record: { deaths: 2, firstAt: 1 } }).disableGpu).toBe(true)
    expect(resolveGpuLaunchDecision({ argv: ['electron', '.'], env: {}, record: { deaths: 1, firstAt: 1 } }).disableGpu).toBe(false)
  })
})

describe('gpuDisableRelaunchArgs', () => {
  it('carries this run argv minus the executable, plus the switch', () => {
    expect(gpuDisableRelaunchArgs(['/usr/bin/electron', '.', '--kiosk'])).toEqual(['.', '--kiosk', gpuDisableFlag()])
  })
})
