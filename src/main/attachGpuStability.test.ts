import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { attachGpuStability, gpuCrashRecordPath, type GpuStabilityAppSurface } from './attachGpuStability'

interface Harness {
  recordPath: string
  switches: string[]
  relaunches: string[][]
  quits: number
  gone(details: { type: string; reason: string }): void
  cleanup(): void
}

function harness(record: string | null, argv: readonly string[] = ['/usr/bin/electron', '.']): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'bingbong-gpu-'))
  const recordPath = gpuCrashRecordPath(dir)
  if (record !== null) writeFileSync(recordPath, record)
  const switches: string[] = []
  const relaunches: string[][] = []
  let quits = 0
  let onGone: ((_event: unknown, details: { type: string; reason: string }) => void) | undefined
  const app = {
    commandLine: { appendSwitch: (name: string) => switches.push(name) },
    on: (_event: 'child-process-gone', listener: (_event: unknown, details: { type: string; reason: string }) => void) => {
      onGone = listener
    },
    relaunch: (options: { args: string[] }) => relaunches.push(options.args),
    quit: () => {
      quits += 1
    },
  } as unknown as GpuStabilityAppSurface
  attachGpuStability({
    app,
    argv,
    env: {},
    recordPath,
    now: () => 1_000,
    log: () => {},
  })
  return {
    recordPath,
    switches,
    relaunches,
    get quits() {
      return quits
    },
    gone: (details) => onGone?.(undefined, details),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const dirs: (() => void)[] = []
afterEach(() => {
  while (dirs.length > 0) dirs.pop()!()
})

function tracked(record: string | null, argv?: readonly string[]): Harness {
  const h = harness(record, argv)
  dirs.push(h.cleanup)
  return h
}

describe('attachGpuStability', () => {
  it('leaves the GPU on and the record absent after a clean boot', () => {
    const h = tracked(null)
    expect(h.switches).toEqual([])
    expect(h.relaunches).toEqual([])
    expect(h.quits).toBe(0)
    expect(reading(h.recordPath)).toBeNull()
  })

  it('boots with the GPU disabled after a persisted crash loop, then clears the record', () => {
    const h = tracked('{"deaths":2,"firstAt":500}\n')
    expect(h.switches).toEqual(['disable-gpu'])
    expect(reading(h.recordPath)).toBeNull()
  })

  it('boots with the GPU disabled on the env switch', () => {
    const h = tracked(null, ['/usr/bin/electron', '.', '--disable-gpu'])
    expect(h.switches).toEqual(['disable-gpu'])
  })

  it('persists a single GPU death without relaunching', () => {
    const h = tracked(null)
    h.gone({ type: 'GPU', reason: 'crashed' })
    expect(reading(h.recordPath)).toBe('{"deaths":1,"firstAt":1000}\n')
    expect(h.relaunches).toEqual([])
    expect(h.quits).toBe(0)
  })

  it('relaunches with the switch on the second GPU death in the window — once', () => {
    const h = tracked(null)
    h.gone({ type: 'GPU', reason: 'crashed' })
    h.gone({ type: 'GPU', reason: 'oom' })
    expect(h.relaunches).toEqual([['.', '--disable-gpu']])
    expect(h.quits).toBe(1)
    h.gone({ type: 'GPU', reason: 'crashed' })
    expect(h.relaunches).toHaveLength(1)
    expect(h.quits).toBe(1)
    expect(reading(h.recordPath)).toBe('{"deaths":3,"firstAt":1000}\n')
  })

  it('never relaunches a launch that already runs with the GPU disabled', () => {
    const h = tracked(null, ['/usr/bin/electron', '.', '--disable-gpu'])
    h.gone({ type: 'GPU', reason: 'crashed' })
    h.gone({ type: 'GPU', reason: 'crashed' })
    expect(h.relaunches).toEqual([])
    expect(h.quits).toBe(0)
  })

  it('ignores non-GPU deaths and clean GPU exits', () => {
    const h = tracked(null)
    h.gone({ type: 'Renderer', reason: 'crashed' })
    h.gone({ type: 'Utility', reason: 'oom' })
    h.gone({ type: 'GPU', reason: 'clean-exit' })
    expect(reading(h.recordPath)).toBeNull()
    expect(h.relaunches).toEqual([])
  })
})

function reading(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
