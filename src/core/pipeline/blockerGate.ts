import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { BlockerSignal, BlockerWall } from '../browser/blockerNudge'
import { BLOCKER_HELP_BY_SIGNAL, parseBlockerMarker, UNKNOWN_BLOCKER_HOST } from '../browser/blockerNudge'
import { finalizeInstruction, notExecuted } from './effortEpoch'
import { reportFault } from '../trace/fault'

// Issue #80, ADR 0010: the same-wall Blocker gate. Detection (#78) puts a
// machine-readable marker line (`BLOCKER:<signal> <host>`) on the tool
// result the model sees; this gate consumes it. Created fresh per run in
// the orchestrator pipeline (like the vision budget and the search-loop
// rail), it arms when a result carries a marker — flavor plus host — and
// while armed refuses browser tool calls targeting that host pre-execution,
// with the escalation instruction naming the two real options (ask_user, or
// a genuinely different site). Detection alone never blocks a call: the
// interaction that hit the wall executed (worst case one wasted
// interaction, not forty — failed runs 46/47); only repeated same-wall
// interaction is refused. A successful interaction with a different host
// disarms it — the model demonstrably moved on, so a later return (the user
// may have signed in meanwhile) is allowed to try again.
//
// One module, two runners (#81): the same gate runs inside the subagent
// runner with one difference — subagents cannot ask the user directly, so
// the refusal names the ASK_USER relay (report back with
// "ASK_USER: <question>" per the delegation contract) instead of ask_user.
// Only the escalation wording differs; the arming, matching, and disarming
// behavior is identical.
//
// read_page, look, and ask_user are never refused (ADR 0010): re-reading
// the walled page re-shows the marker, vision verifies it, and ask_user is
// the escalation itself. Hosts compare exactly, lowercased — old.reddit.com
// is a different site from www.reddit.com, which is the point.
//
// Keeping at the wall ends the Run (#202, ADR 0037). Refusing a call costs
// nothing to execute but still costs the model round that proposed it, so
// a run that never takes either real option used to grind down to
// `budget_exhausted` — the cause that says least about what happened. The
// gate counts the Tool Rounds in which it refused something, once per
// round (#197: the calls of one round are all made before any result is
// read, so four same-wall calls are one mistake made four times), and the
// second such round in one armed episode trips Finalization for `blocker`.
// The first round's refusals keep the escalation wording and stay
// recoverable; the tripping one carries the Finalize Instruction instead
// and opens with `Not executed — `, so the eval's runtime-refusal scan
// sees the stop and not the nudge. Reset is arm-scoped: a successful
// different-host interaction disarms the gate and clears the count, a
// re-arm on a different wall starts at zero, and a Steering replan clears
// the count but keeps the arm — a new objective earns fresh patience, and
// the wall is still there.

export type BlockerGateVerdict = { ok: true } | { ok: false; reason: string }

/**
 * Tool Rounds with a same-wall refusal, within one armed episode, after
 * which the run finalizes for `blocker` (#202). Two: the first refusal is
 * the nudge — the model has not yet read one — and the round after it is
 * the model choosing the wall again with the escalation in hand.
 */
export const REFUSED_ROUNDS_BEFORE_FINALIZATION = 2

export interface BlockerGate {
  /**
   * Pre-execution gate (vision-budget / search-loop pattern): refuses a
   * browser call targeting the armed host. Every other call — including
   * read_page, look, and ask_user, and every non-browser tool — passes
   * untouched.
   */
  gate(call: ToolCall): BlockerGateVerdict
  /**
   * Post-execution observation of every processed tool call: a marker line
   * on a successful result arms the gate (latest marker wins); a
   * successful browser interaction with a different host disarms it.
   */
  observe(call: ToolCall, outcome: ToolResultOutcome): void
  /**
   * A Tool Round begins (#197/#202): the round's same-wall refusals count
   * once, and only the executor knows where a round begins. A gate never
   * told about rounds counts one refusal in all and so never trips.
   */
  beginRound(): void
  /**
   * A Steering replan (#119/#202): the corrected objective faces the wall
   * with the count cleared and the arm intact.
   */
  replan(): void
  /**
   * The wall the run must finalize at, or null (#202). Read by the
   * executor after each call, the way the no-progress rail's
   * `finalizationDue` is: the round's remaining acquisition siblings are
   * then refused by the closed-tool check, not by this gate.
   */
  finalizationDue(): BlockerWall | null
}

/**
 * Lowercased hostname of an absolute URL; null when it does not parse (a
 * search-terms navigate, a bare domain the controller will normalize, an
 * about: page — targets the gate cannot classify, so it passes them).
 */
export function hostFromUrl(value: string): string | null {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === '' ? null : host
  } catch (error) {
    reportFault('pipeline.blockerGate.hostFromUrl', error)
    return null
  }
}

/**
 * The browser verbs (the BrowserController tool surface in browserTools.ts).
 * Exported so toolSurface.test.ts can pin this set against the real
 * catalog — a verb added there must fail closed here, not slip through.
 */
export const BROWSER_TOOLS = new Set(['navigate', 'read_page', 'click', 'type', 'scroll', 'back', 'go_forward'])

/** Browser verbs exempt from the same-host refusal. read_page stays out — the model must be able to re-inspect the wall; every other browser verb is refused, so a verb added later fails closed. look/ground_visual (vision, not browser verbs) and ask_user never reach this check. */
const BLOCKER_EXEMPT_TOOLS = new Set(['read_page'])

/** The escalation sentence the refusal carries — the runner's only difference. */
export type BlockerEscalation = (signal: BlockerSignal) => string

/** The orchestrator's route (#80): it can ask the user directly. */
export const orchestratorBlockerEscalation: BlockerEscalation = (signal) =>
  `Two real options: say so and ask_user — what helps is ${BLOCKER_HELP_BY_SIGNAL[signal]} — ` + 'or navigate to a genuinely different site.'

/**
 * The subagent's route (#81): it cannot ask the user directly, so the
 * refusal names the ASK_USER relay — ask_user returns the directive, and
 * the final report carries it back to the orchestrator (delegation
 * contract; the runner returns the directive verbatim as the report).
 */
export const subagentBlockerEscalation: BlockerEscalation = (signal) =>
  `Two real options: call ask_user — its "ASK_USER: <question>" directive ends your task; ` +
  `your report relays it to the user, and what helps is ${BLOCKER_HELP_BY_SIGNAL[signal]} — ` +
  'or navigate to a genuinely different site.'

/**
 * The Finalize Instruction a tripping refusal carries — the caller's own
 * wording (#159/#202), the way the escalation sentence already is: a
 * Browse Subagent finalizes into a report, not an answer. The Run's by
 * default.
 */
export type BlockerFinalizeInstruction = (wall: BlockerWall) => string

export function createBlockerGate(
  currentHost: () => string | null = () => null,
  escalate: BlockerEscalation = orchestratorBlockerEscalation,
  finalizeAt: BlockerFinalizeInstruction = (wall) => finalizeInstruction('blocker', wall),
): BlockerGate {
  let armed: BlockerWall | null = null
  // Tool Rounds in this armed episode in which a same-wall call was
  // refused (#202), and whether this round is already one of them.
  let refusedRounds = 0
  let refusedThisRound = false
  // The wall the run must finalize at, once the count reaches the trip.
  let tripped: BlockerWall | null = null

  /** A fresh arm — or a replan — faces the wall with the count cleared. */
  function clearCount(): void {
    refusedRounds = 0
    refusedThisRound = false
  }

  // The host a browser call targets: the navigate argument's URL when it
  // parses, the page the tab is otherwise on. Null when unknowable — the
  // gate passes what it cannot classify.
  function targetHost(call: ToolCall): string | null {
    if (call.name !== 'navigate') return currentHost()
    const url = call.args.url
    return typeof url === 'string' && url.trim() !== '' ? hostFromUrl(url.trim()) : null
  }

  /** What the wall refusal opens on, whether it nudges or trips. */
  function wallSentence(a: BlockerWall, call: ToolCall): string {
    return (
      `${call.name} refused before execution: ${a.host} is walled for this run ` +
      `(Blocker: ${a.signal}) — interacting with that host again cannot succeed.`
    )
  }

  /** The recoverable refusal: the escalation, and how to lift it. */
  function refusal(a: BlockerWall, call: ToolCall): string {
    return (
      `${wallSentence(a, call)} ${escalate(a.signal)} ` +
      `read_page and look still work on ${a.host}; ` +
      'any successful interaction with a different host lifts the refusal.'
    )
  }

  /**
   * The tripping refusal (#202): the same wall sentence, with the
   * Finalize Instruction where the escalation used to be. The escalation
   * and the lifting clause both go — neither is true any more: the run is
   * finalizing, and every acquisition sibling after this one is closed.
   * The `Not executed — ` prefix is the eval's runtime-refusal contract
   * (acceptance.ts), which the recoverable refusal above deliberately
   * stays out of.
   */
  function trippingRefusal(a: BlockerWall, call: ToolCall): string {
    return notExecuted(`${wallSentence(a, call)} ${finalizeAt(a)}`)
  }

  return {
    gate(call) {
      // Once tripped the run is finalizing, and its closed-tool check
      // refuses what follows with the same cause — this gate refusing
      // again would only give the round a second reason (#201).
      if (armed === null || tripped !== null) return { ok: true }
      if (!BROWSER_TOOLS.has(call.name)) return { ok: true }
      if (BLOCKER_EXEMPT_TOOLS.has(call.name)) return { ok: true }
      const host = targetHost(call)
      if (host === null || host !== armed.host) return { ok: true }
      // One round, one count (#197): the round's later same-wall calls
      // were chosen before this refusal could be read.
      if (!refusedThisRound) {
        refusedThisRound = true
        refusedRounds += 1
      }
      if (refusedRounds < REFUSED_ROUNDS_BEFORE_FINALIZATION) {
        return { ok: false, reason: refusal(armed, call) }
      }
      tripped = armed
      return { ok: false, reason: trippingRefusal(armed, call) }
    },
    observe(call, outcome) {
      // Disarm before arming: a successful move to a different host that
      // itself turns out walled ends up armed on the new wall, not both.
      if (outcome.ok && armed !== null && BROWSER_TOOLS.has(call.name) && !BLOCKER_EXEMPT_TOOLS.has(call.name)) {
        const host = targetHost(call)
        if (host !== null && host !== armed.host) {
          armed = null
          // The model demonstrably moved on, so the episode is over: a
          // later return to the wall starts its patience again (#202).
          clearCount()
        }
      }
      if (outcome.ok && typeof outcome.result === 'string') {
        const marker = parseBlockerMarker(outcome.result)
        if (marker !== null && marker.host !== UNKNOWN_BLOCKER_HOST) {
          const host = marker.host.toLowerCase()
          // Re-arming on the wall the gate already holds is the marker
          // riding a re-read of the same page — not a new episode. Only a
          // different wall (or an arm after a disarm) starts at zero,
          // otherwise alternating read_page with a refused click would
          // buy the run unlimited rounds at the same wall.
          if (armed === null || armed.host !== host) clearCount()
          armed = { signal: marker.signal, host }
        }
      }
    },
    beginRound() {
      refusedThisRound = false
    },
    replan() {
      // A corrected objective earns fresh patience at the same wall
      // (#202): the count goes, the arm stays. `tripped` goes with the
      // count for symmetry with the no-progress rail's reset — in
      // practice a Run cannot replan out of a `blocker` Finalization,
      // which the epoch refuses to leave.
      clearCount()
      tripped = null
    },
    finalizationDue: () => tripped,
  }
}
