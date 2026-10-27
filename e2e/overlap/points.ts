// The points a Sequence Case runs at (#486). A fixed time is one point; a
// window, or a span a person could see (`while`), is run at `points` points
// chosen by the seed, one in each equal part of it so the points spread over
// the whole window; a moment (`after`) is one point. Every timed line of a
// case takes its i-th sample at point i. The seed, the case id and the item
// fix the samples, so a run reported with its seed and points reruns exactly.

import type { CaseLine, CaseNoise, LineTime, NamedAfter, NamedWhile } from './sequenceCase.ts'

export type PlacedTime = { readonly kind: 'ms'; readonly ms: number } | { readonly kind: 'while'; readonly span: NamedWhile; readonly fraction: number } | { readonly kind: 'after'; readonly event: NamedAfter }

export interface CasePoint {
  /** 1-based. */
  readonly index: number
  readonly label: string
  /** One per line; the first line is the clock's zero and has none. */
  readonly lines: readonly (PlacedTime | null)[]
  readonly noise: readonly PlacedTime[]
}

/** A small seeded generator (mulberry32): the same seed, the same numbers, on every machine. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function hash(text: string): number {
  let h = 2_166_136_261
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16_777_619)
  return h >>> 0
}

const varies = (at: LineTime): boolean => ('ms' in at && Array.isArray(at.ms)) || 'while' in at

function place(at: LineTime, share: number): PlacedTime {
  if ('after' in at) return { kind: 'after', event: at.after }
  if ('while' in at) return { kind: 'while', span: at.while, fraction: Math.round(share * 100) / 100 }
  if (Array.isArray(at.ms)) {
    const [from, to] = at.ms as readonly [number, number]
    return { kind: 'ms', ms: Math.floor(from + share * (to - from)) }
  }
  return { kind: 'ms', ms: at.ms as number }
}

export function describePlaced(placed: PlacedTime): string {
  if (placed.kind === 'ms') return `${placed.ms} ms`
  if (placed.kind === 'while') return `${placed.span} ${Math.round(placed.fraction * 100)}%`
  return `after ${placed.event}`
}

export function casePoints(sequence: { readonly id: string; readonly lines: readonly CaseLine[]; readonly noise: readonly CaseNoise[] }, options: { readonly seed: number; readonly points: number }): CasePoint[] {
  const timed = [...sequence.lines.slice(1).map((line) => line.at!), ...sequence.noise.map((item) => item.at)]
  const count = timed.some(varies) ? options.points : 1
  // One draw per item and point, from a stream of the seed and the case alone.
  const samples = timed.map((_, item) => {
    const next = generator(hash(`${options.seed}:${sequence.id}:${item}`))
    return Array.from({ length: count }, (_, i) => (i + next()) / count)
  })
  return Array.from({ length: count }, (_, i) => {
    const placed = timed.map((at, item) => place(at, samples[item]![i]!))
    const lines = [null, ...placed.slice(0, sequence.lines.length - 1)]
    const noise = placed.slice(sequence.lines.length - 1)
    return { index: i + 1, label: placed.length === 0 ? 'once' : placed.map(describePlaced).join(', '), lines, noise }
  })
}
