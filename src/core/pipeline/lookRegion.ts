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
 * The most of the viewport one region may cover, in percent of its area.
 * Larger regions are refused rather than shown at a magnification that
 * misleads: on the #195 page the vision model read titles that were not
 * there from a half-viewport band at 2x and read the row exactly from a
 * quarter at 3x. The cap also bounds the capture — a quarter at 3x is
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

function refusal(): Error {
  return new Error(`look: 'region' must be ${LOOK_REGION_FORMAT}`)
}

function tooLarge(): Error {
  return new Error(
    `look: 'region' must cover at most a quarter of the viewport (width × height ≤ ${LOOK_REGION_MAX_AREA_PERCENT * 100} in percent, e.g. "0,0,100,25" or "25,0,50,50"); aim a smaller region at the target — it is magnified more`,
  )
}

/** What the model's region argument turned out to be: nothing, a region, or a refusal to hand back. */
type ReadLookRegion = { kind: 'none' } | { kind: 'region'; region: LookRegion } | { kind: 'refused'; error: Error }

function readLookRegion(value: unknown): ReadLookRegion {
  if (value === undefined || value === null) return { kind: 'none' }
  if (typeof value !== 'string') return { kind: 'refused', error: refusal() }
  const text = value.trim()
  if (text === '') return { kind: 'none' }
  const parts = text.split(',').map((part) => part.replace(/%/g, '').trim())
  if (parts.length !== 4 || parts.some((part) => part === '' || !/^\d+(\.\d+)?$/.test(part))) {
    return { kind: 'refused', error: refusal() }
  }
  const [left, top, width, height] = parts.map((part) => Math.round(Number(part))) as [number, number, number, number]
  if (width < 1 || height < 1 || left + width > 100 || top + height > 100) return { kind: 'refused', error: refusal() }
  if (width * height > LOOK_REGION_MAX_AREA_PERCENT * 100) return { kind: 'refused', error: tooLarge() }
  return { kind: 'region', region: { left, top, width, height } }
}

/**
 * Reads the model's region argument. Absent or blank means no region — a
 * plain Look. Anything else must be four percentages that describe a
 * non-empty area inside the viewport, at most a quarter of it; percent
 * signs, spaces and decimals are tolerated (decimals round to whole
 * percent), everything else is refused with the expected format in the
 * message, so the model's next call can be well-formed.
 */
export function parseLookRegion(value: unknown): LookRegion | undefined {
  const read = readLookRegion(value)
  if (read.kind === 'refused') throw read.error
  return read.kind === 'region' ? read.region : undefined
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

/** The region as the model wrote it, normalized — what the trace and the fingerprint keep. */
export function formatLookRegion(region: LookRegion): string {
  return `${region.left},${region.top},${region.width},${region.height}`
}

/**
 * The region as the no-progress rail identifies it: a well-formed region
 * normalized the way the tool reads it, so "0, 0, 100, 20" and
 * "0,0,100,20.4" are the same region; a malformed one kept as written
 * (stripped of spaces and percent signs), so two identical mistakes are
 * still a repeat. Absent for no region.
 */
export function lookRegionFingerprint(value: unknown): string | undefined {
  const read = readLookRegion(value)
  if (read.kind === 'region') return formatLookRegion(read.region)
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
