// The measurement access guard (#224): an opt-in refusal of `file:` loads
// on the browse partition, for measured live-web captures only. The
// URL normalizer admits `file:` (a user typing a local path is a
// legitimate use of an appliance), and every browser path — the main
// pane, a worker tab, an auth popup, a redirect, a clicked link — reaches
// it through the same partition. During a measured capture the same
// machine holds the evaluator's private keys, the captures written so
// far, and the app's own environment under /proc, so a `file:` load is
// the one route by which evaluator material could reach the measured
// assistant. The guard closes that route at the partition, where every
// path passes, rather than at a tool argument, which clicks and
// redirects never pass through.
//
// Off unless `BINGBONG_MEASUREMENT_ACCESS_GUARD` is set: production
// behaviour is unchanged. What it does not do is as important: it is not
// a source allowlist, it blocks no http(s) origin, and it is no proof
// that public mirrors or the model's prior knowledge cannot carry the
// same material — those cannot be made secret, and the study flags
// contamination rather than pretending otherwise.

import { envFlagEnabled } from '../perf/envFlag'

/** Env opt-in for the guard: `BINGBONG_MEASUREMENT_ACCESS_GUARD=1`. */
export const MEASUREMENT_ACCESS_GUARD_ENV = 'BINGBONG_MEASUREMENT_ACCESS_GUARD'

/** Whether a launch asked for the guard. */
export function measurementAccessGuardEnabled(env: Record<string, string | undefined>): boolean {
  return envFlagEnabled(env, MEASUREMENT_ACCESS_GUARD_ENV)
}

/** The schemes the guard refuses: local files, by any spelling. */
const REFUSED_SCHEMES: ReadonlySet<string> = new Set(['file:'])

/**
 * Why the guard refuses a URL, or null when it lets it through. Reads
 * the scheme alone — a relative or unparseable string is not a file
 * load and passes to whatever would have handled it anyway.
 */
export function measurementGuardRefuses(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return REFUSED_SCHEMES.has(parsed.protocol) ? `measurement access guard: ${parsed.protocol} loads are refused during a measured capture` : null
}
