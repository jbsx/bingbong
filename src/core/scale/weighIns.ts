// Weigh-ins (CONTEXT.md): what weighins.json in userData keeps — the time,
// the weight and the scale's two resistances, nothing worked out from
// them, so a Body Profile edit or a formula fix recomputes the history.

export interface WeighIn {
  /** When the reading settled, ms since the Unix epoch; a Weigh-in's key. */
  at: number
  kg: number
  /** The scale's two resistances (raw, as the scale sends them); 0 when it measured none. */
  r1: number
  r2: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** weighins.json as read from disk: the well-formed Weigh-ins, oldest first, the first kept of any two at the same time. */
export function sanitizeWeighIns(raw: unknown): WeighIn[] {
  const list = (raw as { weighIns?: unknown } | null | undefined)?.weighIns
  if (!Array.isArray(list)) return []
  const byTime = new Map<number, WeighIn>()
  for (const item of list) {
    const record = item as Partial<Record<keyof WeighIn, unknown>> | null
    if (record === null || typeof record !== 'object' || !finite(record.at) || !finite(record.kg) || record.kg <= 0) continue
    if (byTime.has(record.at)) continue
    byTime.set(record.at, { at: record.at, kg: record.kg, r1: finite(record.r1) ? record.r1 : 0, r2: finite(record.r2) ? record.r2 : 0 })
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at)
}

/** The latest Weigh-in's change (kg) against the last one at least `spanMs` before it; null with none that far back. */
export function changeSince(weighIns: readonly WeighIn[], spanMs: number): number | null {
  const latest = weighIns.at(-1)
  if (latest === undefined) return null
  const before = weighIns.filter((weighIn) => weighIn.at <= latest.at - spanMs).at(-1)
  return before === undefined ? null : latest.kg - before.kg
}

/** The Weigh-ins of the last `spanMs` before `now`; every one with no span (the page's All). */
export function since(weighIns: readonly WeighIn[], spanMs: number | null, now: number): WeighIn[] {
  return spanMs === null ? [...weighIns] : weighIns.filter((weighIn) => weighIn.at >= now - spanMs)
}
