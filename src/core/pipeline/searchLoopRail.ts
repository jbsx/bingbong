import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { SnapshotRef } from '../browser/snapshot'
import { landedOnNotFoundPage } from '../browser/notFoundPage'
import { landedOnUnavailablePage } from '../browser/unavailablePage'
import { wasBlockedOrInert } from '../browser/actionOutcome'
import { isSearchInputRef, refNumberOf, searchQueryFromUrl, typedQuery } from './progressFingerprints'
import {
  isSearchInspection,
  SEARCH_LOOP_NUDGE_AFTER,
  SEARCH_LOOP_REFUSE_AFTER,
  searchStreakAfter,
  searchStreakMoveOf,
  similarQueries,
  type SearchCallKind,
  type SearchSignature,
} from './searchLoopRule'
import { reportFault } from '../trace/fault'

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
// (run 46: failing tools plus endless reworded searches). The replay
// fixture in searchLoopRail.test.ts pins that the actual 80-call sequence
// produces refusals under the GUI signature alone. Until #259 the streak
// also asked whether two searches reworded one intent (token similarity at
// 0.45, tuned to run 47's rewordings); that blind spot — rewordings that
// share no tokens — is what the live web turned out to be made of.
//
// #125 moved the pure signature functions (query tokens and similarity,
// URL → query extraction, search-input ref classification) into
// progressFingerprints.ts, generalized alongside the URL, action, and
// page-state fingerprints the no-progress rails (#126) will consume. This
// rail's behavior is unchanged by the move — same signatures, same
// thresholds, same refusal set.
//
// #238 (ADR 0048) changed two things the rail compares. Similarity is over
// Search Intent — the terms with scope (a search operator and its argument,
// an uppercase connective, a bare hostname) removed — so a site: search on an
// engine and the same terms typed into the site's own box are one intent.
// And a Look or a scroll joins read_page as inspection: each looks at what
// the search returned without leaving it, so none resets the streak. Both
// rules live in searchLoopRule.ts, which the Round Audit replays.
//
// #243 (ADR 0049) made the verdict a value: `observe` returns the nudge and,
// for a call it classified as a search, a Search Observation — the query as
// the rail read it, the signature it ran under and the streak it left. The
// Tool Round records the observation to the Run Trace; the rail itself stays
// free of any trace dependency beyond the fault route.
//
// #259 (ADR 0058) dropped the same-intent comparison from the streak. On the
// live web the rewordings of one intent rarely share words — the fix-257
// capture recorded 103 Search Observations and never reached streak 3 while
// the reviewer placed 47 rounds in Search Loops — so the streak now asks
// only what did not happen between two searches: a search after a search
// with no escape between them is streak + 1, whatever its terms, engine or
// surface. The rule itself (`searchStreakAfter`, `searchStreakMoveOf`) and
// the tiers live in searchLoopRule.ts, which the Round Audit replays.
// Search Intent stays as the no-progress fingerprint; the rail no longer
// reads it.
//
// #260 (ADR 0059) widened the navigate half from `q=` to the Search URL: a
// parameter named for terms (`query`, `keywords`, …) or the final path
// segment after `search` with no query string. A museum whose own box
// settles on `/collections/objects/search/<terms>` was invisible, so each
// hand-composed search there was an opening and the streak never left 1.
// The one test is `parseSearchUrl` in urlInput.ts, which the Composed
// Address rail, the Not-found detector and the Round Audit share.
//
// #261 (note on ADR 0058) closed the other side of escape: a Blocked Action
// (a click or a type a cover refused) and an inert click (no URL, dialog,
// element state or page signature moved) come back `ok`, yet consumed
// nothing, so they hold the streak as a Not-found Landing does. A click that
// changed the page signature — a consent banner dismissed by hand — is still
// escape. A blocked type into a search input stays a search: the gate
// classifies it from the ref's facts before any outcome exists. The one
// reading of the port's heads is `blockedOrInertAction` in actionOutcome.ts,
// which the Round Audit replays.
//
// #262 (ADR 0060) added the Not-found Landing's sibling: a call that settled
// on an Unavailable Page — the site's outage, not an opening — holds the
// streak too, read from its `UNAVAILABLE:` marker by
// `landedOnUnavailablePage` in unavailablePage.ts.

// The tiers and the signature surface live in searchLoopRule.ts and
// progressFingerprints.ts; re-exported here so the module's consumers (and
// its tests) keep one import path.
export { SEARCH_LOOP_NUDGE_AFTER, SEARCH_LOOP_REFUSE_AFTER, similarQueries, searchQueryFromUrl, isSearchInputRef }

export type SearchLoopGate = { ok: true } | { ok: false; reason: string }

export type { SearchSignature }

/**
 * What the rail saw in one call it classified as a search (#243, ADR 0049):
 * the query as it read it (a navigate's Search URL terms, decoded; the typed text of
 * a type), the signature, and the streak after the call — whatever the
 * call's outcome, refused searches included.
 */
export interface SearchObservation {
  readonly query: string
  readonly signature: SearchSignature
  readonly streak: number
}

/** One observed call's verdict: the advisory nudge it earned, and the observation when it was a search. */
export interface SearchLoopVerdict {
  readonly notice: string | null
  readonly observation: SearchObservation | null
}

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
   * Pre-execution gate (vision-budget pattern): refuses a search — a
   * navigate to a Search URL or a typed search box query — once the streak has reached the
   * cap. Every other call passes untouched.
   */
  gate(call: ToolCall): Promise<SearchLoopGate>
  /**
   * Post-execution observation of every processed tool call — this is what
   * tracks (and resets) the streak. A successful escaping call (anything
   * but a search or inspection) resets it; inspection never resets, failed
   * calls leave it alone. The verdict carries the advisory nudge once the
   * streak reaches the nudge tier, and a Search Observation for every
   * search (#243).
   */
  observe(call: ToolCall, outcome: ToolResultOutcome): Promise<SearchLoopVerdict>
}

const NO_VERDICT: SearchLoopVerdict = { notice: null, observation: null }

// Both state the rule the rail runs (#260, ADR 0059): consecutive searches
// with nothing opened between them, whatever their terms (ADR 0058).
export const SEARCH_LOOP_NUDGE =
  'The last searches ran one after another with nothing opened between them (each a navigate to a search URL or a search box query) — more searches will not surface new results. Change strategy: open a promising result by its ref or its href, read the page (read_page), or answer from what you already have. If you cannot proceed, say so and ask_user.'

const REFUSAL = `Search loop limit (${SEARCH_LOOP_REFUSE_AFTER} consecutive searches with nothing opened between them — each a navigate to a search URL or a search box query) reached for this run. Change strategy or ask_user; only escaping clears the limit (open a result by its ref or its href, or any successful tool call other than read_page, look or scroll).`

/**
 * What a call is to the rail: a search observation with its query,
 * inspection (observed, never resets), or an escaping call (resets on
 * success only).
 */
type Classification = { kind: 'search'; query: string; signature: SearchSignature } | { kind: Exclude<SearchCallKind, 'search'> }

export function createSearchLoopRail(deps: SearchLoopRailDeps = {}): SearchLoopRail {
  let streak = 0
  // describeRef memo between one call's gate and observe: the pipeline
  // classifies every call twice, and the ref's facts cannot change between
  // the pre-execution gate and the post-execution observation.
  let typeMemo: { call: ToolCall; query: string | null } | null = null

  async function typeSearchQuery(call: ToolCall): Promise<string | null> {
    if (typeMemo?.call === call) return typeMemo.query
    const ref = refNumberOf(call)
    let query: string | null = null
    if (ref !== null && deps.describeRef) {
      let facts: SnapshotRef | undefined
      try {
        facts = await deps.describeRef(ref)
      } catch (error) {
        reportFault('pipeline.searchLoopRail.describeRef', error)
        facts = undefined
      }
      const text = call.args.text
      if (facts && isSearchInputRef(facts) && typeof text === 'string') query = typedQuery(text)
    }
    typeMemo = { call, query }
    return query
  }

  async function classify(call: ToolCall): Promise<Classification> {
    // Inspection never resets the streak (run 53, ADR 0048): reading,
    // looking at or scrolling a page between reworded searches is not escape.
    if (isSearchInspection(call.name)) return { kind: 'inspection' }
    if (call.name === 'navigate') {
      const url = call.args.url
      if (typeof url !== 'string' || url.trim() === '') return { kind: 'other' }
      const query = searchQueryFromUrl(url)
      return query === null ? { kind: 'other' } : { kind: 'search', query, signature: 'url' }
    }
    if (call.name === 'type') {
      const query = await typeSearchQuery(call)
      return query === null ? { kind: 'other' } : { kind: 'search', query, signature: 'input' }
    }
    return { kind: 'other' }
  }

  return {
    async gate(call) {
      const classified = await classify(call)
      if (classified.kind !== 'search') return { ok: true }
      return streak >= SEARCH_LOOP_REFUSE_AFTER ? { ok: false, reason: REFUSAL } : { ok: true }
    },
    async observe(call, outcome) {
      const classified = await classify(call)
      // A successful escape consumed something, breaking the blind loop; a
      // failed one changes nothing, so the streak survives. A call that
      // landed on a Not-found Page (#239, ADR 0050) consumed nothing either:
      // it has not left the results any more than a scroll has, so it is
      // inspection — observed, never resetting. Nor did a Blocked Action or
      // an inert click (#261): the port reports it as success, but nothing
      // was clicked or typed, or nothing on the page moved. Nor did a call
      // that landed on an Unavailable Page (#262, ADR 0060): the site put
      // nothing in front of the Run.
      const consumed = outcome.ok && !landedOnNotFoundPage(outcome) && !landedOnUnavailablePage(outcome) && !wasBlockedOrInert(outcome)
      streak = searchStreakAfter(streak, searchStreakMoveOf(classified.kind, consumed))
      if (classified.kind !== 'search') return NO_VERDICT
      return {
        notice: streak >= SEARCH_LOOP_NUDGE_AFTER ? SEARCH_LOOP_NUDGE : null,
        observation: { query: classified.query, signature: classified.signature, streak },
      }
    },
  }
}
