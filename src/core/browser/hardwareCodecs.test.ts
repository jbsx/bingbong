import { describe, expect, it } from 'vitest'
import type { Clock } from '../ports/clock'
import { CODEC_PROBE_BOUND_MS, CODEC_PROBE_HUNG, codecFamilyOf, codecProbeLine, refusedCodecs, runCodecProbe, type CodecProbeEvent } from './hardwareCodecs'

function fakeClock(): Clock & { advance(ms: number): void } {
  let now = 0
  let timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    now: () => now,
    setTimer: (ms, fn) => {
      const timer = { at: now + ms, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    advance(ms) {
      now += ms
      const due = timers.filter((t) => !t.cancelled && t.at <= now)
      timers = timers.filter((t) => !due.includes(t))
      for (const t of due) t.fn()
    },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const KIOSK = { av1: false, vp9: true, vp8: true, h264: true, hevc: true }

function probe() {
  const clock = fakeClock()
  const load = deferred<void>()
  const answer = deferred<unknown>()
  const events: CodecProbeEvent[] = []
  let evaluated = 0
  runCodecProbe(
    {
      loaded: () => load.promise,
      evaluate: () => {
        evaluated += 1
        return answer.promise
      },
      clock,
    },
    (event) => events.push(event),
  )
  return { clock, load, answer, events, evaluated: () => evaluated }
}

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

describe('the codec probe always settles (#425, 2026-10-26)', () => {
  it('answers with what the GPU decodes and what pages are refused', async () => {
    const p = probe()
    p.load.resolve()
    await flush()
    p.clock.advance(150)
    p.answer.resolve(KIOSK)
    await flush()
    expect(p.events).toEqual([{ kind: 'answer', inHardware: KIOSK, refused: ['av1'], ms: 150 }])
    expect(codecProbeLine(p.events[0])).toBe('[codecs] decoded on the GPU: vp9, vp8, h264, hevc; refused to pages: av1 (probe 150 ms)')
  })

  it('answers on a GPU that decodes nothing, as under Xvfb: refused to pages none', async () => {
    const p = probe()
    p.load.resolve()
    await flush()
    p.answer.resolve({ av1: false, vp9: false, vp8: false, h264: false, hevc: false })
    await flush()
    expect(codecProbeLine(p.events[0])).toBe('[codecs] decoded on the GPU: none; refused to pages: none (probe 0 ms)')
  })

  it('names the load when the probe page never finishes loading, and still asks once it does', async () => {
    const p = probe()
    p.clock.advance(CODEC_PROBE_BOUND_MS)
    expect(p.events).toEqual([{ kind: 'unsettled', step: 'load', message: `the probe page did not finish loading in ${CODEC_PROBE_BOUND_MS} ms`, ms: CODEC_PROBE_BOUND_MS }])
    expect(p.evaluated()).toBe(0)
    expect(codecProbeLine(p.events[0])).toBe(`[codecs] probe unsettled at load after ${CODEC_PROBE_BOUND_MS} ms: the probe page did not finish loading in ${CODEC_PROBE_BOUND_MS} ms; refused to pages: none`)

    p.load.resolve()
    await flush()
    p.answer.resolve(KIOSK)
    await flush()
    expect(p.events.map((event) => event.kind)).toEqual(['unsettled', 'answer'])
  })

  it('names the evaluate when the page never runs the probe script', async () => {
    const p = probe()
    p.load.resolve()
    await flush()
    p.clock.advance(2 * CODEC_PROBE_BOUND_MS - 1)
    expect(p.events).toEqual([])
    p.clock.advance(1)
    expect(p.events).toEqual([{ kind: 'unsettled', step: 'evaluate', message: `the page did not run the probe script in ${2 * CODEC_PROBE_BOUND_MS} ms`, ms: 2 * CODEC_PROBE_BOUND_MS }])
  })

  it('names decodingInfo and each family the GPU never answered, and refuses nothing', async () => {
    const p = probe()
    p.load.resolve()
    await flush()
    p.clock.advance(CODEC_PROBE_BOUND_MS)
    p.answer.resolve({ av1: false, vp9: CODEC_PROBE_HUNG, vp8: true, h264: CODEC_PROBE_HUNG, hevc: true })
    await flush()
    expect(p.events).toEqual([
      { kind: 'unsettled', step: 'decodingInfo', message: `mediaCapabilities.decodingInfo did not answer for vp9, h264 in ${CODEC_PROBE_BOUND_MS} ms`, ms: CODEC_PROBE_BOUND_MS },
    ])
  })

  it('names the evaluate when the script throws or answers something unreadable', async () => {
    const thrown = probe()
    thrown.load.resolve()
    await flush()
    thrown.answer.reject(new Error('Script failed to execute'))
    await flush()
    expect(thrown.events).toEqual([{ kind: 'unsettled', step: 'evaluate', message: 'Script failed to execute', ms: 0 }])

    const odd = probe()
    odd.load.resolve()
    await flush()
    odd.answer.resolve({ av1: 'maybe' })
    await flush()
    expect(odd.events).toEqual([{ kind: 'unsettled', step: 'evaluate', message: 'unreadable probe: {"av1":"maybe"}', ms: 0 }])
  })

  it('says nothing twice: an answer inside the bound cancels both timers', async () => {
    const p = probe()
    p.load.resolve()
    await flush()
    p.answer.resolve(KIOSK)
    await flush()
    p.clock.advance(10 * CODEC_PROBE_BOUND_MS)
    expect(p.events).toHaveLength(1)
  })
})
