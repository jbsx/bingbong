import { inflateSync } from 'node:zlib'

// A PNG decoder for the tests that read a capture's pixels: 8-bit RGB or
// RGBA, not interlaced — what Chrome's Page.captureScreenshot writes.

export interface DecodedPng {
  readonly width: number
  readonly height: number
  /** Four bytes a pixel, RGBA. */
  readonly rgba: Uint8Array
}

export function decodePng(png: Uint8Array): DecodedPng {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let width = 0
  let height = 0
  let channels = 0
  const data: Uint8Array[] = []
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const body = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const [depth, colour, , , interlace] = body.subarray(8, 13)
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`unsupported PNG: depth ${depth}, colour ${colour}, interlace ${interlace}`)
      channels = colour === 6 ? 4 : 3
    } else if (type === 'IDAT') data.push(body)
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x]!
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels]! : 0
      const predicted =
        filter === 0 ? 0
        : filter === 1 ? left
        : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2)
        : paeth(left, up, upLeft)
      pixels[y * stride + x] = (value + predicted) & 0xff
    }
  }
  if (channels === 4) return { width, height, rgba: pixels }
  const rgba = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    rgba.set(pixels.subarray(index * 3, index * 3 + 3), index * 4)
    rgba[index * 4 + 3] = 255
  }
  return { width, height, rgba }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)]
  return a <= b && a <= c ? left : b <= c ? up : upLeft
}

/** The pixel at (x, y) as [r, g, b]. */
export function pixelAt(image: DecodedPng, x: number, y: number): [number, number, number] {
  const at = (Math.round(y) * image.width + Math.round(x)) * 4
  return [image.rgba[at]!, image.rgba[at + 1]!, image.rgba[at + 2]!]
}
