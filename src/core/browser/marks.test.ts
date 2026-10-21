import { describe, expect, it } from 'vitest'
import { paintMarks, type Bitmap } from './marks'

const WHITE = [255, 255, 255]
const RED = [255, 0, 0]

function whiteBitmap(width: number, height: number, order: Bitmap['order'] = 'rgba'): Bitmap {
  return { data: new Uint8Array(width * height * 4).fill(255), width, height, order }
}

/** The pixel at (x, y) as red, green, blue, whatever the channel order. */
function pixel(bitmap: Bitmap, x: number, y: number): number[] {
  const at = (y * bitmap.width + x) * 4
  const [a, b, c] = [bitmap.data[at]!, bitmap.data[at + 1]!, bitmap.data[at + 2]!]
  return bitmap.order === 'rgba' ? [a, b, c] : [c, b, a]
}

/** Every pixel of a region, as `r,g,b` strings. */
function colours(bitmap: Bitmap, x0: number, y0: number, x1: number, y1: number): Set<string> {
  const seen = new Set<string>()
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) seen.add(pixel(bitmap, x, y).join(','))
  return seen
}

describe('paintMarks (#382, ADR 0084)', () => {
  it('boxes a mark in red and leaves what it boxes untouched', () => {
    const bitmap = whiteBitmap(200, 120)
    paintMarks(bitmap, [{ ref: 7, box: { x: 60, y: 50, width: 40, height: 30 } }], 2)

    expect(pixel(bitmap, 60, 65)).toEqual(RED)
    expect(pixel(bitmap, 99, 65)).toEqual(RED)
    expect(pixel(bitmap, 80, 50)).toEqual(RED)
    expect(pixel(bitmap, 80, 79)).toEqual(RED)
    expect(pixel(bitmap, 80, 65)).toEqual(WHITE)
    expect(pixel(bitmap, 59, 65)).toEqual(WHITE)
  })

  it('writes the ref number in white on a red tag above the box', () => {
    const bitmap = whiteBitmap(200, 120)
    paintMarks(bitmap, [{ ref: 7, box: { x: 60, y: 50, width: 40, height: 30 } }], 2)

    // The tag is 9 cells high: one cell of red, seven of digit, one of red.
    const tag = colours(bitmap, 60, 32, 74, 50)
    expect(tag).toEqual(new Set(['255,0,0', '255,255,255']))
    expect(pixel(bitmap, 60, 32)).toEqual(RED)
    expect(pixel(bitmap, 60, 31)).toEqual(WHITE)
  })

  it('draws each number its own way, digit by digit', () => {
    const one = whiteBitmap(120, 80)
    const seven = whiteBitmap(120, 80)
    const seventeen = whiteBitmap(120, 80)
    paintMarks(one, [{ ref: 1, box: { x: 10, y: 40, width: 30, height: 20 } }], 2)
    paintMarks(seven, [{ ref: 7, box: { x: 10, y: 40, width: 30, height: 20 } }], 2)
    paintMarks(seventeen, [{ ref: 17, box: { x: 10, y: 40, width: 30, height: 20 } }], 2)

    expect(one.data).not.toEqual(seven.data)
    // Two digits make a wider tag: one cell of red, 5 + 1 + 5 of digits, one of red.
    expect(pixel(seventeen, 10 + 13 * 2 - 1, 30)).toEqual(RED)
    expect(pixel(seven, 10 + 13 * 2 - 1, 30)).toEqual(WHITE)
  })

  it('puts the tag inside the box when the box starts at the top of the image', () => {
    const bitmap = whiteBitmap(200, 120)
    paintMarks(bitmap, [{ ref: 3, box: { x: 20, y: 0, width: 60, height: 40 } }], 2)

    expect(pixel(bitmap, 21, 2)).toEqual(RED)
    expect(colours(bitmap, 20, 0, 34, 18).has('255,255,255')).toBe(true)
  })

  it('paints the same in BGRA, the order an Electron bitmap holds', () => {
    const bitmap = whiteBitmap(200, 120, 'bgra')
    paintMarks(bitmap, [{ ref: 7, box: { x: 60, y: 50, width: 40, height: 30 } }], 2)

    expect(pixel(bitmap, 60, 65)).toEqual(RED)
    expect(bitmap.data[(65 * 200 + 60) * 4 + 2]).toBe(255)
    expect(bitmap.data[(65 * 200 + 60) * 4]).toBe(0)
  })

  it('clips a box that runs off the image, never writing past it', () => {
    const bitmap = whiteBitmap(50, 40)
    const size = bitmap.data.length
    paintMarks(bitmap, [{ ref: 12, box: { x: 40, y: 30, width: 30, height: 30 } }], 2)

    expect(bitmap.data.length).toBe(size)
    expect(pixel(bitmap, 40, 35)).toEqual(RED)
  })
})
