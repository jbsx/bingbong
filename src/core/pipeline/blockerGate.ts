import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { BlockerSignal } from '../browser/blockerNudge'
import { parseBlockerMarker, UNKNOWN_BLOCKER_HOST } from '../browser/blockerNudge'

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

export type BlockerGateVerdict = { ok: true } | { ok: false; reason: string }

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
  } catch {
    return null
  }
}

/**
 * The browser verbs (the BrowserController tool surface in browserTools.ts).
 * Exported so toolSurface.test.ts can pin this set against the real
 * catalog — a verb added there must fail closed here, not slip through.
 */
export const BROWSER_TOOLS = new Set(['navigate', 'read_page', 'click', 'type', 'scroll', 'screenshot', 'back', 'go_forward'])

/** Browser verbs exempt from the same-host refusal. read_page stays out — the model must be able to re-inspect the wall; every other browser verb is refused, so a verb added later fails closed. look/ground_visual (vision, not browser verbs) and ask_user never reach this check. */
const BLOCKER_EXEMPT_TOOLS = new Set(['read_page'])

/** What the refusal tells the model actually helps, per ADR 0010 flavor. */
const HELP_BY_SIGNAL: Record<BlockerSignal, string> = {
  challenge: 'the user completing the challenge on screen in the browser tab',
  'network-block': 'the user signing in to this site once in the browser tab, or picking a different route',
  'login-wall': 'the user signing in once in the browser tab',
}

/** The escalation sentence the refusal carries — the runner's only difference. */
export type BlockerEscalation = (signal: BlockerSignal) => string

/** The orchestrator's route (#80): it can ask the user directly. */
export const orchestratorBlockerEscalation: BlockerEscalation = (signal) =>
  `Two real options: say so and ask_user — what helps is ${HELP_BY_SIGNAL[signal]} — ` + 'or navigate to a genuinely different site.'

/**
 * The subagent's route (#81): it cannot ask the user directly, so the
 * refusal names the ASK_USER relay — ask_user returns the directive, and
 * the final report carries it back to the orchestrator (delegation
 * contract; the runner returns the directive verbatim as the report).
 */
export const subagentBlockerEscalation: BlockerEscalation = (signal) =>
  `Two real options: call ask_user — its "ASK_USER: <question>" directive ends your task; ` +
  `your report relays it to the user, and what helps is ${HELP_BY_SIGNAL[signal]} — ` +
  'or navigate to a genuinely different site.'

interface Armed {
  signal: BlockerSignal
  host: string
}

export function createBlockerGate(
  currentHost: () => string | null = () => null,
  escalate: BlockerEscalation = orchestratorBlockerEscalation,
): BlockerGate {
  let armed: Armed | null = null

  // The host a browser call targets: the navigate argument's URL when it
  // parses, the page the tab is otherwise on. Null when unknowable — the
  // gate passes what it cannot classify.
  function targetHost(call: ToolCall): string | null {
    if (call.name !== 'navigate') return currentHost()
    const url = call.args.url
    return typeof url === 'string' && url.trim() !== '' ? hostFromUrl(url.trim()) : null
  }

  function refusal(a: Armed, call: ToolCall): string {
    return (
      `${call.name} refused before execution: ${a.host} is walled for this run ` +
      `(Blocker: ${a.signal}) — interacting with that host again cannot succeed. ` +
      `${escalate(a.signal)} ` +
      `read_page and look still work on ${a.host}; ` +
      'any successful interaction with a different host lifts the refusal.'
    )
  }

  return {
    gate(call) {
      if (armed === null) return { ok: true }
      if (!BROWSER_TOOLS.has(call.name)) return { ok: true }
      if (BLOCKER_EXEMPT_TOOLS.has(call.name)) return { ok: true }
      const host = targetHost(call)
      if (host === null || host !== armed.host) return { ok: true }
      return { ok: false, reason: refusal(armed, call) }
    },
    observe(call, outcome) {
      // Disarm before arming: a successful move to a different host that
      // itself turns out walled ends up armed on the new wall, not both.
      if (outcome.ok && armed !== null && BROWSER_TOOLS.has(call.name) && !BLOCKER_EXEMPT_TOOLS.has(call.name)) {
        const host = targetHost(call)
        if (host !== null && host !== armed.host) armed = null
      }
      if (outcome.ok && typeof outcome.result === 'string') {
        const marker = parseBlockerMarker(outcome.result)
        if (marker !== null && marker.host !== UNKNOWN_BLOCKER_HOST) {
          armed = { signal: marker.signal, host: marker.host.toLowerCase() }
        }
      }
    },
  }
}
