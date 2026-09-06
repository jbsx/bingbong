// The region a questioned Look may be bounded to (#195). The #193
// recapture showed the loop stopping correctly — two questioned Looks,
// both answering "not legible" for the tier-list card titles rather than
// guessing — and then nothing left to try: dense image text is simply too
// small in a full-viewport screenshot. A region names the part of the
// viewport to re-render larger. It is written as percentages because the
// model never knows the viewport's pixel size and never needs to: "the
// top fifth" is `0,0,100,20` on every screen.

import type { ViewportRegion } from '../ports/browser'

/** A part of the viewport in whole percent: left and top offsets, then width and height. */
export interface LookRegion {
  left: number
  top: number
  width: number
  height: number
}

/** The grammar, as the tool catalog and every refusal state it. */
export const LOOK_REGION_FORMAT = '"left,top,width,height" as percentages of the viewport, e.g. "0,0,100,25" for the top quarter'

/**
 * The most of the viewport one region may cover, in percent of its area.
 * Larger regions are refused rather than shown at a magnification that
 * misleads: on the #195 page the vision model read titles that were not
 * there from a half-viewport band at 2x and read the row exactly from a
 * quarter at 3x. The cap also bounds the capture — a quarter at 3x is
 * about twice the full screenshot's pixels, never more.
 */
export const LOOK_REGION_MAX_AREA_PERCENT = 25

/** The least a region is magnified: below 3x a crop did not read better than the full screenshot (#195). */
export const LOOK_REGION_MIN_ZOOM = 3

/**
 * The most a region is magnified. Beyond 4x a crop is being upscaled past
 * the source the page rasterizes from (a shrunk-to-fit image reaches its
 * native pixels around 3x), and the capture's byte size is the only thing
 * still growing.
 */
export const LOOK_REGION_MAX_ZOOM = 4

function refusal(): Error {
  return new Error(`look: 'region' must be ${LOOK_REGION_FORMAT}`)
}

function tooLarge(): Error {
  return new Error(
    `look: 'region' must cover at most a quarter of the viewport (width × height ≤ ${LOOK_REGION_MAX_AREA_PERCENT * 100} in percent, e.g. "0,0,100,25" or "25,0,50,50"); aim a smaller region at the target — it is magnified more`,
  )
}

/**
 * Reads the model's region argument. Absent or blank means no region — a
 * plain Look. Anything else must be four percentages that describe a
 * non-empty area inside the viewport; percent signs, spaces and decimals
 * are tolerated (decimals round to whole percent), everything else is
 * refused with the expected format in the message, so the model's next
 * call can be well-formed.
 */
export function parseLookRegion(value: unknown): LookRegion | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw refusal()
  const text = value.trim()
  if (text === '') return undefined
  const parts = text.split(',').map((part) => part.replace(/%/g, '').trim())
  if (parts.length !== 4 || parts.some((part) => part === '' || !/^\d+(\.\d+)?$/.test(part))) throw refusal()
  const [left, top, width, height] = parts.map((part) => Math.round(Number(part))) as [number, number, number, number]
  if (width < 1 || height < 1 || left + width > 100 || top + height > 100) throw refusal()
  if (width * height > LOOK_REGION_MAX_AREA_PERCENT * 100) throw tooLarge()
  return { left, top, width, height }
}

/**
 * How much the region is magnified: the square root of the area ratio,
 * rounded up — enough that the crop carries about the full screenshot's
 * pixel count again — clamped to [{@link LOOK_REGION_MIN_ZOOM},
 * {@link LOOK_REGION_MAX_ZOOM}]. A quarter of the viewport renders at 3x,
 * a ninth or less at 4x.
 */
export function lookRegionZoom(region: LookRegion): number {
  const areaFraction = (region.width * region.height) / 10_000
  return Math.min(LOOK_REGION_MAX_ZOOM, Math.max(LOOK_REGION_MIN_ZOOM, Math.ceil(Math.sqrt(1 / areaFraction) - 1e-9)))
}

/** The region as the model wrote it, normalized — what the trace and the fingerprint keep. */
export function formatLookRegion(region: LookRegion): string {
  return `${region.left},${region.top},${region.width},${region.height}`
}

/** The region as the browser port takes it: fractions of the viewport. */
export function viewportRegionOf(region: LookRegion): ViewportRegion {
  return { left: region.left / 100, top: region.top / 100, width: region.width / 100, height: region.height / 100 }
}
