import { describe, expect, it } from 'vitest'
import { applyDuck, FRAME, FRAME_S, frameAt, lineOnsets, mergeSpans, oracleSpans, RATE, scoreLine, scoreRun } from './score'

describe('scoreLine (#515)', () => {
  it('counts the frames, the longest run and where speech first shows', () => {
    expect(scoreLine([0, 0.6, 0.9, 0.1, 0.5, 0.5, 0.5, 0])).toEqual({ frames: 5, of: 8, run: 3, onset: FRAME_S })
  })

  it('has no onset where nothing scored', () => {
    expect(scoreLine([0, 0.49]).onset).toBeNull()
  })
})

describe('scoreRun (#515)', () => {
  it('reads the lines and the echo stretches from the frames of the take, past the read start', () => {
    const readStart = 1
    const scores = new Array<number>(Math.ceil((125 * RATE) / FRAME) + 100).fill(0)
    // The first line of the first insert over the read, whole, and two false frames.
    for (let f = frameAt(40.25, readStart); f < frameAt(40.75, readStart); f++) scores[f] = 1
    scores[frameAt(25, readStart)] = 1
    scores[frameAt(25, readStart) + 1] = 1
    const pcm = new Float32Array(130 * RATE).fill(0.1)
    const run = scoreRun(scores, pcm, readStart)
    expect(run.over[0]).toMatchObject({ frames: run.over[0]!.of, onset: 0 })
    expect(run.over.slice(1).every((line) => line.frames === 0)).toBe(true)
    expect(run.overFrames).toBe(run.over[0]!.of)
    expect(run.falseFrames).toBe(2)
    expect(run.echoDb).toBeCloseTo(-20, 1)
  })
})

describe('the duck (#515)', () => {
  it('merges spans that touch', () => {
    expect(mergeSpans([{ from: 5, to: 6 }, { from: 0, to: 2 }, { from: 1.5, to: 3 }])).toEqual([{ from: 0, to: 3 }, { from: 5, to: 6 }])
  })

  it('holds an oracle duck from each line, past its landing, to the hold after it, with lines that touch as one', () => {
    const spans = oracleSpans([0.3, 1.5, 6.5], 0.25)
    expect(spans[0]).toEqual({ from: 40.55, to: 43.25 })
    expect(spans[1]).toEqual({ from: 46.75, to: 48.25 })
    expect(spans).toHaveLength(6)
  })

  it('scales only the spans, every channel', () => {
    const out = applyDuck(new Float32Array(8).fill(1), 2, 2, [{ from: 0.5, to: 1 }], 0.15)
    expect([...out].map((v) => Number(v.toFixed(2)))).toEqual([1, 1, 0.15, 0.15, 1, 1, 1, 1])
  })
})

describe('lineOnsets (#515)', () => {
  it('finds each line where its level rises, and falls back on the window when none does', () => {
    const piece = new Float32Array(Math.round(7.5 * RATE))
    piece.fill(0.1, Math.round(0.4 * RATE), Math.round(0.6 * RATE))
    piece.fill(0.1, Math.round(1.4 * RATE), Math.round(2 * RATE))
    const [first, second, third] = lineOnsets(piece)
    expect(first).toBeCloseTo(0.4, 1)
    expect(second).toBeCloseTo(1.4, 1)
    expect(third).toBe(6.5)
  })
})
