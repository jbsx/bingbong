import { describe, expect, it } from 'vitest'
import { createOverLevel, frameLevel, speechLevelDb, OVER_LEVEL_END_FRAMES, OVER_LEVEL_LEAD_FRAMES, OVER_LEVEL_SETTLE_FRAMES, OVER_LEVEL_TAIL_FRAMES } from './overLevel'

const frame = (level: number): Float32Array => new Float32Array(512).fill(level)

/** Every frame through one read: the first stretch it finds, and the frame it was found at. */
function readAll(levels: readonly number[]) {
  const read = createOverLevel()
  for (const [index, level] of levels.entries()) {
    const stretch = read.push(frame(level))
    if (stretch !== null) return { ...stretch, at: index }
  }
  return null
}

const echo = (n: number): number[] => Array.from({ length: n }, () => 0.02)
const loud = (n: number): number[] => Array.from({ length: n }, () => 0.2)

describe('the person’s voice over the ducked echo, by level (#490)', () => {
  it('reads a frame’s level as its root mean square', () => {
    expect(frameLevel(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
  })

  it('finds a loud stretch once it has ended, with a frame ahead of it and a little of the quiet after', () => {
    const found = readAll([...echo(40), ...loud(10), ...echo(30)])
    expect(found!.at).toBe(49 + OVER_LEVEL_END_FRAMES)
    expect(found).toMatchObject({ from: 40 - OVER_LEVEL_LEAD_FRAMES, to: 50 + OVER_LEVEL_TAIL_FRAMES })
  })

  it('never takes the app’s voice before the duck lands', () => {
    expect(readAll([...loud(OVER_LEVEL_SETTLE_FRAMES), ...echo(60)])).toBeNull()
  })

  it('takes a person who spoke first from the capture’s start', () => {
    expect(readAll([...loud(OVER_LEVEL_SETTLE_FRAMES + 10), ...echo(60)])).toMatchObject({ from: 0 })
  })

  it('a blip shorter than a word is not a stretch', () => {
    expect(readAll([...echo(40), ...loud(3), ...echo(40)])).toBeNull()
  })
})

describe('speechLevelDb: how loud an Utterance was said (#500)', () => {
  const frames = (count: number, amplitude: number): number[] => Array.from({ length: count * 512 }, () => amplitude)

  it('reads the loudest fifth of the frames in dBFS, so a short word in a capture of gaps reads as said', () => {
    expect(speechLevelDb(new Float32Array(frames(5, 0.1)))!).toBeCloseTo(-20, 5)
    // 4 frames at 0.5 among 16 at 0.01: the loudest fifth is the word, −6.02 dBFS.
    expect(speechLevelDb(new Float32Array([...frames(16, 0.01), ...frames(4, 0.5)]))!).toBeCloseTo(-6.02, 2)
  })

  it('has no level for silence or for a capture shorter than a frame', () => {
    expect(speechLevelDb(new Float32Array(512 * 3))).toBeNull()
    expect(speechLevelDb(new Float32Array(100))).toBeNull()
  })
})
