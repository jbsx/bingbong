// The shared report stats the dev-tooling reports agree on — nearest-rank
// percentiles and millisecond formatting — so perf (#33) and STT A/B (#39)
// rank and print latency the same way. Pure functions, one home.

/** Nearest-rank percentile: the smallest value at or above the p-th rank. */
export function nearestRankPercentile(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return 0
  const rank = Math.min(Math.max(Math.ceil((p / 100) * n), 1), n)
  return sorted[rank - 1]
}

export function formatMs(value: number): string {
  return `${Math.round(value)}ms`
}
