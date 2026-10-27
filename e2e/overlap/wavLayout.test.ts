import { describe, expect, it } from 'vitest'
import { layoutWav } from './wavLayout'

describe('the fake mic’s one wav, every piece at its ms', () => {
  it('lays each piece at its time in silence, the whole as long as asked', () => {
    const pcm = layoutWav([{ pcm: new Float32Array([0.5, 0.5]), atMs: 1 }], 3, 1000)
    expect([...pcm]).toEqual([0, 0.5, 0.5])
  })

  it('a voice over another is heard mixed, never past full scale; a piece past the end is cut', () => {
    const pcm = layoutWav(
      [
        { pcm: new Float32Array([0.75, 0.75, 0.75]), atMs: 0 },
        { pcm: new Float32Array([0.5, -0.5, 0.5]), atMs: 1 },
      ],
      3,
      1000,
    )
    expect([...pcm]).toEqual([0.75, 1, 0.25])
  })
})
