import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { SnapshotRef } from '../browser/snapshot'
import { isSearchInputRef, refNumberOf, searchQueryFromUrl, similarQueries, typedQuery } from './progressFingerprints'

// Issue #74, run rails: the 80-round flail's signature is a blind search
// loop — consecutive searches rewording one query with no intervening
// read/click/navigate. Issue #82 re-targeted the rail's observable to the
// GUI search signature; #83 deleted the off-screen web_search tool, so the
// GUI signature is now the only observable (spec #75, on-screen browsing):
// one search observation is any of
// — a navigate whose URL carries a q= search param (plain search terms
//   normalize to exactly that), or
// — text typed into a search input (resolved via snapshot ref facts).
// The q= navigate close is the diagnosis hole from failed run 47: navigates
// to google.com/search?q=… and reddit search URLs were invisible resets
// that wiped the streak mid-flail — now they count as the searches they
// are.
//
// Run 53 closed the second hole: reading between searches does not escape
// a loop. search → read_page → search → read_page… reworded one intent 20
// ways for 73 rounds, and every read_page reset the streak, so the rail
// mathematically could not fire. read_page is now its own classification —
// observed, never resetting — and only escaping resets: a successful
// non-read, non-search tool call (opening a result by href or click, any
// other tool). A failed call consumed nothing, so the model is still blind
// (run 46: failing tools plus endless reworded searches). Run 47's real
// rewordings score ~0.4–0.6 against their neighbors, so the threshold sits
// below the old 0.6 at 0.45; the replay fixture in searchLoopRail.test.ts
// pins that the actual 80-call sequence produces refusals under the GUI
// signature alone. Known blind spot, still accepted: synonym rewordings
// that share no tokens ("best pizza near me" vs "top pizza places nearby")
// do not chain.
//
// #125 moved the pure signature functions (query tokens and similarity,
// URL → query extraction, search-input ref classification) into
// progressFingerprints.ts, generalized alongside the URL, action, and
// page-state fingerprints the no-progress rails (#126) will consume. This
// rail's behavior is unchanged by the move — same signatures, same
// thresholds, same refusal set.

/** Consecutive similar searches before the advisory nudge rides the result. */
export const SEARCH_LOOP_NUDGE_AFTER = 3

/** Consecutive similar searches before the gate refuses further ones. */
export const SEARCH_LOOP_REFUSE_AFTER = 5

// The rail's public signature surface now lives in progressFingerprints.ts;
// re-exported here so the module's consumers (and its tests) keep one
// import path.
export { similarQueries, searchQueryFromUrl, isSearchInputRef }

export type SearchLoopGate = { ok: true } | { ok: false; reason: string }

export interface SearchLoopRailDeps {
  /**
   * Resolves a type call's target ref to its snapshot facts (#82) — how the
   * rail knows typed text went into a search input. Absent, type calls
   * cannot be classified and pass as ordinary calls.
   */
  describeRef?: (ref: number) => Promise<SnapshotRef | undefined>
}

export interface SearchLoopRail {
  /**
   * Pre-execution gate (vision-budget pattern): refuses a search — q=
   * navigate or typed search box query — whose intent repeats the current
   * streak once the cap is reached. Every other call passes untouched.
   */
  gate(call: ToolCall): Promise<SearchLoopGate>
  /**
   * Post-execution observation of every processed tool call — this is what
   * tracks (and resets) the streak. A successful escaping call (anything
   * but a search or a read) resets it; reads never reset, failed calls
   * leave it alone. Returns the advisory nudge once the streak reaches the
   * nudge tier; null otherwise.
   */
  observe(call: ToolCall, outcome: ToolResultOutcome): Promise<string | null>
}

const NUDGE =
  'The last searches reword one intent (a q= navigate or a search box query) — more searches will not surface new results. Change strategy: open a promising result by its href, read the page (read_page), or answer from what you already have. If you cannot proceed, say so and ask_user.'

const REFUSAL = `Search loop limit (${SEARCH_LOOP_REFUSE_AFTER} consecutive similar searches — q= navigate or typed search box query) reached for this run — the queries repeat one intent. Change strategy or ask_user; only escaping clears the limit (open a result by its href or a click, or any successful tool call other than read_page).`

/**
 * What a call is to the rail: a search observation with its query, a read
 * (observed, never resets), or an escaping call (resets on success only).
 */
type Classification = { kind: 'search'; query: string } | { kind: 'read' } | { kind: 'other' }

export function createSearchLoopRail(deps: SearchLoopRailDeps = {}): SearchLoopRail {
  let lastQuery: string | null = null
  // The streak's first query: rewordings compare against both the previous
  // query and this anchor, so a drift that wanders one token per call — or
  // one that drifts out and returns to the original wording — stays caught.
  let anchor: string | null = null
  let streak = 0
  // describeRef memo between one call's gate and observe: the pipeline
  // classifies every call twice, and the ref's facts cannot change between
  // the pre-execution gate and the post-execution observation.
  let typeMemo: { call: ToolCall; query: string | null } | null = null

  function reset(): void {
    lastQuery = null
    anchor = null
    streak = 0
  }

  function continuesStreak(query: string): boolean {
    return (
      (lastQuery !== null && similarQueries(query, lastQuery)) ||
      (anchor !== null && similarQueries(query, anchor))
    )
  }

  async function typeSearchQuery(call: ToolCall): Promise<string | null> {
    if (typeMemo?.call === call) return typeMemo.query
    const ref = refNumberOf(call)
    let query: string | null = null
    if (ref !== null && deps.describeRef) {
      let facts: SnapshotRef | undefined
      try {
        facts = await deps.describeRef(ref)
      } catch {
        facts = undefined
      }
      const text = call.args.text
      if (facts && isSearchInputRef(facts) && typeof text === 'string') query = typedQuery(text)
    }
    typeMemo = { call, query }
    return query
  }

  async function classify(call: ToolCall): Promise<Classification> {
    // Reads never reset the streak (run 53): reading between reworded
    // searches is inspection, not escape.
    if (call.name === 'read_page') return { kind: 'read' }
    if (call.name === 'navigate') {
      const url = call.args.url
      if (typeof url !== 'string' || url.trim() === '') return { kind: 'other' }
      const query = searchQueryFromUrl(url)
      return query === null ? { kind: 'other' } : { kind: 'search', query }
    }
    if (call.name === 'type') {
      const query = await typeSearchQuery(call)
      return query === null ? { kind: 'other' } : { kind: 'search', query }
    }
    return { kind: 'other' }
  }

  return {
    async gate(call) {
      const classified = await classify(call)
      if (classified.kind !== 'search') return { ok: true }
      return streak >= SEARCH_LOOP_REFUSE_AFTER && continuesStreak(classified.query)
        ? { ok: false, reason: REFUSAL }
        : { ok: true }
    },
    async observe(call, outcome) {
      const classified = await classify(call)
      if (classified.kind === 'read') return null
      if (classified.kind === 'other') {
        // A successful escape consumed something, breaking the blind
        // loop; a failed one changes nothing, so the streak survives.
        if (outcome.ok) reset()
        return null
      }
      // Chain to the previous query and the anchor, not just the streak's
      // first query — drift must not walk out of the rail in either
      // direction.
      const continues = continuesStreak(classified.query)
      streak = continues ? streak + 1 : 1
      anchor = continues ? anchor : classified.query
      lastQuery = classified.query
      return streak >= SEARCH_LOOP_NUDGE_AFTER ? NUDGE : null
    },
  }
}
