import { nativeImage } from 'electron'
import { paintMarks, type Mark } from '../../core/browser/marks'

// The Mark Ask's painter (#382, ADR 0084) over Electron's own image codec:
// the PNG capture decoded to a bitmap, the marks painted on its pixels,
// and the result encoded as the JPEG Jev is sent. The page is never
// written to.

/** The JPEG quality the set-of-marks image was measured at in the grill (111 KB, 6/6 right). */
const MARK_JPEG_QUALITY = 70

/** The marks painted on a PNG capture, as a JPEG (#382, ADR 0084); null for bytes Electron cannot decode. */
export function drawMarks(png: Uint8Array, marks: readonly Mark[], cell: number): Uint8Array | null {
  const image = nativeImage.createFromBuffer(Buffer.from(png))
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  // A native bitmap is BGRA on the little-endian machines Electron runs on.
  const data = new Uint8Array(image.toBitmap())
  paintMarks({ data, width, height, order: 'bgra' }, marks, cell)
  return new Uint8Array(nativeImage.createFromBitmap(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { width, height }).toJPEG(MARK_JPEG_QUALITY))
}
