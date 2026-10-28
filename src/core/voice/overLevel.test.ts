import { describe, expect, it } from 'vitest'
import { createOverLevel, frameLevel, OVER_LEVEL_END_FRAMES, OVER_LEVEL_SETTLE_FRAMES } from './overLevel'

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

  it('finds a loud stretch once it has ended, with the frames ahead of it', () => {
    const found = readAll([...echo(40), ...loud(10), ...echo(30)])
    expect(found).toMatchObject({ from: 30, to: 50 })
    expect(found!.at).toBe(49 + OVER_LEVEL_END_FRAMES)
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
