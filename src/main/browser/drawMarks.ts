import { nativeImage } from 'electron'
import { paintMarks, type Mark } from '../../core/browser/marks'
import { DECISION_IMAGE_LONG_EDGE_PX, fitImageToLongEdge } from '../../core/decision/decisionRouting'

// The Mark Ask's painter (#382, ADR 0084) over Electron's own image codec:
// the PNG capture decoded to a bitmap, scaled so its long edge is within
// what the image-reading host takes (#477: the routing's
// DECISION_IMAGE_LONG_EDGE_PX, 1568 px — the owner's 2560×1440 display got
// every Mark Ask a 400, turn-mvjdvzlf-3), the marks painted on its pixels
// at the same scale, so they keep their size relative to the image, and
// the result encoded as the JPEG Jev is sent. The page is never written to.

/** The JPEG quality the set-of-marks image was measured at in the grill (111 KB, 6/6 right). */
const MARK_JPEG_QUALITY = 70

/** The marks painted on a PNG capture, as a JPEG (#382, ADR 0084), scaled to the host's long edge (#477); null for bytes Electron cannot decode. */
export function drawMarks(png: Uint8Array, marks: readonly Mark[], cell: number): Uint8Array | null {
  const decoded = nativeImage.createFromBuffer(Buffer.from(png))
  if (decoded.isEmpty()) return null
  const fit = fitImageToLongEdge(decoded.getSize(), DECISION_IMAGE_LONG_EDGE_PX)
  const image = fit.scale === 1 ? decoded : decoded.resize({ width: fit.width, height: fit.height, quality: 'good' })
  const { width, height } = image.getSize()
  const scaled = fit.scale === 1 ? marks : marks.map((mark) => ({ ref: mark.ref, box: { x: mark.box.x * fit.scale, y: mark.box.y * fit.scale, width: mark.box.width * fit.scale, height: mark.box.height * fit.scale } }))
  // A native bitmap is BGRA on the little-endian machines Electron runs on.
  const data = new Uint8Array(image.toBitmap())
  paintMarks({ data, width, height, order: 'bgra' }, scaled, Math.max(2, Math.round(cell * fit.scale)))
  return new Uint8Array(nativeImage.createFromBitmap(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { width, height }).toJPEG(MARK_JPEG_QUALITY))
}
