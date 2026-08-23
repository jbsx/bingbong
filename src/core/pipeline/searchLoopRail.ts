import type { ToolCall, ToolResultOutcome } from '../ports/llm'

// Issue #74, run rails: the 80-round flail's signature is a blind search
// loop — consecutive web_search calls rewording one query with no
// intervening read/click/navigate. This rail detects it with pure token
// similarity (the Blocker-nudge pattern: pattern → decision, no side
// effects) and answers in two tiers: an advisory nudge appended to results,
// then a pre-execution refusal alongside the vision budget. It never kills
// the run. The streak chains — each search compares to the previous one, so
// slow drift stays caught — and only a successful other tool call resets
// it: a failed read or navigate consumed nothing, so the model is still
// blind (run 46: failing tools plus endless reworded searches). Known blind
// spot, accepted for a first pass: synonym rewordings that share no tokens
// ("best pizza near me" vs "top pizza places nearby") do not chain.

/** Consecutive similar searches before the advisory nudge rides the result. */
export const SEARCH_LOOP_NUDGE_AFTER = 3

/** Consecutive similar searches before the gate refuses further ones. */
export const SEARCH_LOOP_REFUSE_AFTER = 5

/** Token-Jaccard similarity at or above which two queries share one intent. */
const SIMILARITY_THRESHOLD = 0.6

export type SearchLoopGate = { ok: true } | { ok: false; reason: string }

export interface SearchLoopRail {
  /**
   * Pre-execution gate (vision-budget pattern): refuses a web_search whose
   * query repeats the current streak's intent once the cap is reached.
   * Every other call passes untouched.
   */
  gate(call: ToolCall): SearchLoopGate
  /**
   * Post-execution observation of every processed tool call — this is what
   * tracks (and resets) the streak. A successful non-search call resets it;
   * a failed one leaves it alone. Returns the advisory nudge once the
   * streak reaches the nudge tier; null otherwise.
   */
  observe(call: ToolCall, outcome: ToolResultOutcome): string | null
}

const NUDGE =
  'The last web_search calls repeat the same intent with reworded queries — more searches will not surface new results. Change strategy: navigate to a promising result, read the page (read_page/read_url), or answer from what you already have. If you cannot proceed, say so and ask_user.'

const REFUSAL = `web_search loop limit (${SEARCH_LOOP_REFUSE_AFTER} consecutive similar searches) reached for this run — the queries repeat the same intent. Change strategy or ask_user; any successful other tool call clears the limit.`

/** Lowercase, punctuation-free tokens with a light plural fold (keyboard ≈ keyboards). */
function queryTokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token !== '')
      .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)),
  )
}

/**
 * Pure same-intent test: token-Jaccard similarity of the two normalized
 * queries at or above the threshold. Empty queries never match.
 */
export function similarQueries(a: string, b: string): boolean {
  const left = queryTokens(a)
  const right = queryTokens(b)
  if (left.size === 0 || right.size === 0) return false
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared / (left.size + right.size - shared) >= SIMILARITY_THRESHOLD
}

function usableQuery(call: ToolCall): string | null {
  const value = call.args.query
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function createSearchLoopRail(): SearchLoopRail {
  let lastQuery: string | null = null
  let streak = 0

  return {
    gate(call) {
      if (call.name !== 'web_search') return { ok: true }
      const query = usableQuery(call)
      if (query === null || lastQuery === null || !similarQueries(query, lastQuery)) return { ok: true }
      return streak >= SEARCH_LOOP_REFUSE_AFTER ? { ok: false, reason: REFUSAL } : { ok: true }
    },
    observe(call, outcome) {
      if (call.name !== 'web_search') {
        // A successful other tool consumed something, breaking the blind
        // loop; a failed one changes nothing, so the streak survives.
        if (outcome.ok) {
          lastQuery = null
          streak = 0
        }
        return null
      }
      const query = usableQuery(call)
      if (query === null) {
        // A malformed search starts over — there is nothing to chain to.
        lastQuery = null
        streak = 0
        return null
      }
      // Chain to the previous search, not the streak's first query —
      // one-token-per-call drift must not walk out of the rail.
      const continues = lastQuery !== null && similarQueries(query, lastQuery)
      streak = continues ? streak + 1 : 1
      lastQuery = query
      return streak >= SEARCH_LOOP_NUDGE_AFTER ? NUDGE : null
    },
  }
}
