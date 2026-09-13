// The region a questioned Look may be bounded to (#195). The #193
// recapture showed the loop stopping correctly — two questioned Looks,
// both answering "not legible" for the tier-list card titles rather than
// guessing — and then nothing left to try: dense image text is simply too
// small in a full-viewport screenshot. A region names the part of the
// viewport to re-render larger. It is written as percentages because the
// model never knows the viewport's pixel size and never needs to: "the
// top fifth" is `0,0,100,20` on every screen.

import type { ScreenshotOptions } from '../ports/browser'

/** A part of the viewport in whole percent: left and top offsets, then width and height. */
export interface LookRegion {
  left: number
  top: number
  width: number
  height: number
}

/** A region and the scale it is captured at — what one region Look asks the browser for. */
export interface LookCrop {
  region: LookRegion
  scale: number
}

/** The grammar, as the tool catalog and every refusal state it. */
export const LOOK_REGION_FORMAT = '"left,top,width,height" as percentages of the viewport, e.g. "0,0,100,25" for the top quarter'

/**
 * The most of the viewport one crop may show, in percent of its area.
 * A larger region is shrunk to it rather than shown at a magnification
 * that misleads: on the #195 page the vision model read titles that were
 * not there from a half-viewport band at 2x and read the row exactly from
 * a quarter at 3x. The cap also bounds the capture — a quarter at 3x is
 * about twice the full screenshot's pixels, never more.
 */
export const LOOK_REGION_MAX_AREA_PERCENT = 25

/** The least a region is magnified: below 3x a crop did not read better than the full screenshot (#195). */
export const LOOK_REGION_MIN_SCALE = 3

/**
 * The most a region is magnified. Beyond 4x a crop is being upscaled past
 * the source the page rasterizes from (a shrunk-to-fit image reaches its
 * native pixels around 3x), and the capture's byte size is the only thing
 * still growing.
 */
export const LOOK_REGION_MAX_SCALE = 4

const REGION_REFUSAL = `look: 'region' must be ${LOOK_REGION_FORMAT}`

/**
 * How the region shown differs from the region written (#236, ADR 0046):
 * not at all, clipped to the viewport, or shrunk to a quarter of it
 * (whether or not it was clipped first).
 */
export type LookRegionClamp = 'none' | 'clipped' | 'shrunk'

/**
 * What the model's region argument turned out to be: nothing, a region —
 * as written, and the crop it is shown as — or a refusal in the words the
 * model is given.
 */
export type LookRegionReading =
  | { kind: 'none' }
  | { kind: 'region'; written: LookRegion; clamp: LookRegionClamp; crop: LookCrop }
  | { kind: 'refused'; reason: string }

/** Where a side shrunk around its own centre starts: rounded, and kept inside the viewport. */
function centred(start: number, side: number, shownSide: number): number {
  return Math.min(100 - shownSide, Math.max(0, Math.round(start + (side - shownSide) / 2)))
}

/**
 * The crop a region names (ADR 0046), or undefined when it names no place.
 * Clipped first — the part past an edge cannot be shown, so the request is
 * the part inside — then, if still over a quarter, both sides shrunk by
 * the same factor around the region's own centre and floored, so the area
 * never exceeds the cap. No side is preferred: the shape drawn is kept.
 */
function clampLookRegion(written: LookRegion): { shown: LookRegion; clamp: LookRegionClamp } | undefined {
  const left = Math.min(written.left, 100)
  const top = Math.min(written.top, 100)
  const width = Math.min(written.left + written.width, 100) - left
  const height = Math.min(written.top + written.height, 100) - top
  if (width < 1 || height < 1) return undefined
  const clipped = width !== written.width || height !== written.height
  const cap = LOOK_REGION_MAX_AREA_PERCENT * 100
  if (width * height <= cap) return { shown: { left, top, width, height }, clamp: clipped ? 'clipped' : 'none' }
  const factor = Math.sqrt(cap / (width * height))
  // The epsilon keeps an exact product (100 × 0.5) from flooring a whole
  // percent short; it cannot lift an inexact one over the next integer.
  const shownWidth = Math.floor(width * factor + 1e-9)
  const shownHeight = Math.floor(height * factor + 1e-9)
  return {
    shown: {
      left: centred(left, width, shownWidth),
      top: centred(top, height, shownHeight),
      width: shownWidth,
      height: shownHeight,
    },
    clamp: 'shrunk',
  }
}

/**
 * Reads the model's region argument. Absent or blank means no region — a
 * plain Look. Anything else must be four percentages; percent signs,
 * spaces and decimals are tolerated (decimals round to whole percent).
 * A region that names a place is shown, clipped to the viewport and shrunk
 * to a quarter of it when it must be (ADR 0046); only a string that names
 * no place — not four numbers, a zero side, nothing inside the viewport —
 * is refused, with the expected format in the reason, so the model's next
 * call can be well-formed.
 */
export function readLookRegion(value: unknown): LookRegionReading {
  if (value === undefined || value === null) return { kind: 'none' }
  if (typeof value !== 'string') return { kind: 'refused', reason: REGION_REFUSAL }
  const text = value.trim()
  if (text === '') return { kind: 'none' }
  const parts = text.split(',').map((part) => part.replace(/%/g, '').trim())
  if (parts.length !== 4 || parts.some((part) => part === '' || !/^\d+(\.\d+)?$/.test(part))) {
    return { kind: 'refused', reason: REGION_REFUSAL }
  }
  const [left, top, width, height] = parts.map((part) => Math.round(Number(part))) as [number, number, number, number]
  if (width < 1 || height < 1) return { kind: 'refused', reason: REGION_REFUSAL }
  const written = { left, top, width, height }
  const clamped = clampLookRegion(written)
  if (clamped === undefined) return { kind: 'refused', reason: REGION_REFUSAL }
  return { kind: 'region', written, clamp: clamped.clamp, crop: lookCropOf(clamped.shown) }
}

/**
 * How much the region is magnified: the square root of the area ratio,
 * rounded up — enough that the crop carries about the full screenshot's
 * pixel count again — clamped to [{@link LOOK_REGION_MIN_SCALE},
 * {@link LOOK_REGION_MAX_SCALE}]. A quarter of the viewport renders at 3x,
 * less than a ninth at 4x.
 */
export function lookRegionScale(region: LookRegion): number {
  const areaFraction = (region.width * region.height) / 10_000
  return Math.min(LOOK_REGION_MAX_SCALE, Math.max(LOOK_REGION_MIN_SCALE, Math.ceil(Math.sqrt(1 / areaFraction) - 1e-9)))
}

/** The crop one region asks for: the region with the scale it earns. */
export function lookCropOf(region: LookRegion): LookCrop {
  return { region, scale: lookRegionScale(region) }
}

/** A region in the grammar the model writes it in — what the trace, the footer and the fingerprint name. */
export function formatLookRegion(region: LookRegion): string {
  return `${region.left},${region.top},${region.width},${region.height}`
}

/**
 * The region as the no-progress rail identifies it: a region that names a
 * place by the crop it shows, so "0, 0, 100, 20" and "0,0,100,20.4" are
 * the same region, and so are two oversize regions that clamp to one crop
 * (ADR 0046); a malformed one kept as written (stripped of spaces and
 * percent signs), so two identical mistakes are still a repeat. Absent for
 * no region.
 */
export function lookRegionFingerprint(value: unknown): string | undefined {
  const read = readLookRegion(value)
  if (read.kind === 'region') return formatLookRegion(read.crop.region)
  if (read.kind === 'none') return undefined
  const raw = typeof value === 'string' ? value.replace(/[\s%]+/g, '') : ''
  return raw === '' ? undefined : raw
}

/** The crop as the browser port takes it: fractions of the viewport, and the scale. */
export function screenshotOptionsOf(crop: LookCrop): ScreenshotOptions {
  const { region, scale } = crop
  return {
    region: { left: region.left / 100, top: region.top / 100, width: region.width / 100, height: region.height / 100 },
    scale,
  }
}
