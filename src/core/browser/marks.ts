// The Mark Ask's marks (#382, ADR 0084): each Textless Ref boxed in red on
// a capture of the pane, its ref number written in white on a red tag at
// the box's corner. Drawn on the image's own pixels, never on the page
// (Vimium #2997: a page written to is a page changed), so this module only
// paints a decoded bitmap; the capture and the encoding are the caller's.
// The numbers are a 5×7 pixel font, each pixel a square of `cell` pixels,
// so they read at any zoom without a font to load.

/** A box in the image's own pixels (#382, ADR 0084). */
export interface MarkBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One mark (#382, ADR 0084): the ref number written on it, and the box it draws. */
export interface Mark {
  readonly ref: number
  readonly box: MarkBox
}

/** A decoded image (#382), four bytes a pixel, in the channel order its source holds (Electron's bitmaps are BGRA). */
export interface Bitmap {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  readonly order: 'rgba' | 'bgra'
}

/** The digits, seven rows of five pixels each. */
const DIGITS: readonly (readonly string[])[] = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
]

const RED = [255, 0, 0] as const
const WHITE = [255, 255, 255] as const

/** The tag's height in cells: a cell of red above and below the seven rows of a digit. */
const TAG_CELLS = 9

/**
 * Paint every mark on the bitmap, in place: the box's outline a `cell`
 * wide, inside its edges, and the tag above its top-left corner — inside
 * the box when the box starts too near the top for one. Whatever falls off
 * the image is not drawn.
 */
export function paintMarks(bitmap: Bitmap, marks: readonly Mark[], cell: number): void {
  const set = (x: number, y: number, [r, g, b]: readonly [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return
    const at = (y * bitmap.width + x) * 4
    bitmap.data[at] = bitmap.order === 'rgba' ? r : b
    bitmap.data[at + 1] = g
    bitmap.data[at + 2] = bitmap.order === 'rgba' ? b : r
  }
  const fill = (x0: number, y0: number, width: number, height: number, colour: readonly [number, number, number]): void => {
    for (let y = y0; y < y0 + height; y += 1) for (let x = x0; x < x0 + width; x += 1) set(x, y, colour)
  }
  for (const { ref, box } of marks) {
    const x = Math.round(box.x)
    const y = Math.round(box.y)
    const width = Math.max(1, Math.round(box.width))
    const height = Math.max(1, Math.round(box.height))
    fill(x, y, width, cell, RED)
    fill(x, y + height - cell, width, cell, RED)
    fill(x, y, cell, height, RED)
    fill(x + width - cell, y, cell, height, RED)
    const digits = String(ref).split('').map(Number)
    const tagWidth = (digits.length * 6 + 1) * cell
    const tagHeight = TAG_CELLS * cell
    const tagY = y >= tagHeight ? y - tagHeight : y
    fill(x, tagY, tagWidth, tagHeight, RED)
    digits.forEach((digit, place) => {
      DIGITS[digit]!.forEach((row, rowIndex) => {
        for (let column = 0; column < 5; column += 1) {
          if (row[column] === '1') fill(x + (1 + place * 6 + column) * cell, tagY + (1 + rowIndex) * cell, cell, cell, WHITE)
        }
      })
    })
  }
}
