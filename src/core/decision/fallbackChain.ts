import type { DecisionAttempt, DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult } from '../ports/decisionModel'

// The Fallback Hosts (#477, ADR 0076 as amended; ADR 0068's note): one
// Decision Model over an ordered list of them — the live host first, then
// the hosts `BINGBONG_DECISION_FALLBACKS` names. An ask goes to the first;
// when it fails for any reason but the caller's abort — a 429 or another
// status, a timeout, a transport fault, a malformed answer, anything else
// — the same ask goes at once to the next, with no wait on the one that
// failed and no second request to it. The ask ends at the first answer,
// and "unavailable" means every host failed. Every attempt is on the
// result, so the record and the asks log name each host's try and the one
// that answered. Every ask starts at the live host: no host is remembered
// as down (a guess, cheapest to reverse: a 429 comes back in about 200 ms;
// the first attempt's latency in perf:report after a rate-limited session
// says whether a cool-down is the next change). The chain hides behind the
// port, so the runner never learns hosts, and it is the fallback for every
// ask kind — the Mark Ask included.

/** One host of the chain: its model, and the base URL the attempts name. */
export interface ChainHost {
  readonly model: DecisionModel
  readonly host: string
}

/** The reasons that end the chain where it stands: the caller aborted, so no host after this one is asked. */
const ENDS_CHAIN = new Set(['cancelled'])

/**
 * The hosts as one Decision Model. With one host the chain is that host,
 * its results untouched — the behaviour before #477. The chain's `model`,
 * `readsImages` and `cardBudget` are the live host's: the card is built
 * once, to the live routing, and every host reads the same bytes (ADR
 * 0088: one Card Budget).
 */
export function withFallbacks(hosts: readonly ChainHost[]): DecisionModel {
  const [live, ...rest] = hosts
  if (live === undefined) throw new Error('a fallback chain needs its live host')
  if (rest.length === 0) return live.model
  const attemptOf = (host: ChainHost, result: DecisionResult<DecisionQuestions>): DecisionAttempt => ({
    model: result.model,
    host: host.host,
    outcome: result.status === 'answered' ? 'answered' : result.reason,
    ...(result.status === 'unavailable' && result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    latencyMs: result.latencyMs,
  })
  return {
    model: live.model.model,
    ...(live.model.readsImages !== undefined ? { readsImages: live.model.readsImages } : {}),
    ...(live.model.cardBudget !== undefined ? { cardBudget: live.model.cardBudget } : {}),
    async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
      const attempts: DecisionAttempt[] = []
      let latencyMs = 0
      let last: DecisionResult<Q> | null = null
      for (const host of hosts) {
        const result = await host.model.ask(request)
        attempts.push(attemptOf(host, result as DecisionResult<DecisionQuestions>))
        latencyMs += result.latencyMs
        last = result
        if (result.status === 'answered' || ENDS_CHAIN.has(result.reason) || request.signal?.aborted === true) break
      }
      // The whole ask's cost is every attempt's; the record's latency is what the round paid.
      return { ...last!, latencyMs, attempts }
    },
  }
}
