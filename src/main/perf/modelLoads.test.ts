import { afterEach, describe, expect, it } from 'vitest'
import { setModelLoadSink, timeModelLoad, type ModelLoad } from './modelLoads'

// Each model's load timed where it happens (#429).

afterEach(() => setModelLoadSink(null))

describe('timeModelLoad', () => {
  it('passes the load through untouched with no sink named', async () => {
    await expect(timeModelLoad('vad', Promise.resolve(7))).resolves.toBe(7)
  })

  it('reports each load, the first that succeeds as first, and a failed one as failed', async () => {
    const loads: ModelLoad[] = []
    setModelLoadSink((load) => loads.push(load))
    await expect(timeModelLoad('stt-test', Promise.reject(new Error('missing')))).rejects.toThrow('missing')
    await expect(timeModelLoad('stt-test', Promise.resolve('sessions'))).resolves.toBe('sessions')
    await timeModelLoad('stt-test', Promise.resolve('again'))
    await Promise.resolve()
    expect(loads.map(({ model, first, failed }) => ({ model, first, failed }))).toEqual([
      { model: 'stt-test', first: false, failed: true },
      { model: 'stt-test', first: true, failed: false },
      { model: 'stt-test', first: false, failed: false },
    ])
    expect(loads.every((load) => load.durMs >= 0)).toBe(true)
  })

  it('reports the process RSS after each load and what the load added (#451), held while the load was', async () => {
    const loads: ModelLoad[] = []
    setModelLoadSink((load) => loads.push(load))
    let held: Uint8Array | null = null
    await timeModelLoad(
      'stt-rss',
      Promise.resolve().then(() => {
        held = new Uint8Array(64 * 1_048_576).fill(1)
      }),
    )
    await Promise.resolve()
    expect(loads[0].rssMb).toBeGreaterThan(64)
    expect(loads[0].rssDeltaMb).toBeGreaterThanOrEqual(60)
    expect(held).not.toBeNull()
  })

  it('never lets a sink that throws break the load', async () => {
    setModelLoadSink(() => {
      throw new Error('disk full')
    })
    await expect(timeModelLoad('wake-test', Promise.resolve(1))).resolves.toBe(1)
  })
})
