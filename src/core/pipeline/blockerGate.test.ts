import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import {
  createBlockerGate,
  hostFromUrl,
  REFUSED_ROUNDS_BEFORE_FINALIZATION,
  subagentBlockerEscalation,
} from './blockerGate'

// Issue #80, ADR 0010: the same-wall Blocker gate — a marker line on a
// tool result arms it (flavor + host); while armed, browser calls
// targeting that host are refused pre-execution with the escalation
// instruction; a successful different-host interaction disarms it. See the
// module header for the full policy.

const WALLED_RESULT = 'page title: Whoa there\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'

function navigate(url: string): ToolCall {
  return { id: 'n', name: 'navigate', args: { url } }
}

function verb(name: string): ToolCall {
  return { id: 'v', name, args: {} }
}

const ok = (result: string): ToolResultOutcome => ({ ok: true, result })
const fail: ToolResultOutcome = { ok: false, error: 'boom' }

describe('hostFromUrl', () => {
  it('lowercases absolute-URL hostnames and rejects everything else', () => {
    expect(hostFromUrl('https://WWW.Reddit.com/r/x?y=1')).toBe('www.reddit.com')
    expect(hostFromUrl('http://example.com:8080/path')).toBe('example.com')
    expect(hostFromUrl('best mechanical keyboards')).toBeNull()
    expect(hostFromUrl('reddit.com')).toBeNull()
    expect(hostFromUrl('')).toBeNull()
    expect(hostFromUrl('about:blank')).toBeNull()
  })
})

describe('createBlockerGate', () => {
  it('lets the wall-detecting call itself execute — detection alone never blocks', () => {
    const gate = createBlockerGate()
    expect(gate.gate(navigate('https://www.reddit.com/search'))).toEqual({ ok: true })
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
  })

  it('refuses the second same-host browser call with the escalation instruction', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    const refusal = gate.gate(verb('click'))
    // click targets the page the tab is on: the walled host.
    expect(refusal).not.toEqual({ ok: true })
    if (!refusal.ok) {
      expect(refusal.reason).toMatch(/www\.reddit\.com/)
      expect(refusal.reason).toMatch(/challenge/)
      expect(refusal.reason).toMatch(/ask_user/)
      expect(refusal.reason).toMatch(/genuinely different site/)
    }
  })

  it('refuses a same-host navigate by its URL argument', () => {
    const gate = createBlockerGate()
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    expect(gate.gate(navigate('https://www.reddit.com/r/other')).ok).toBe(false)
  })

  it('never refuses read_page, look, or ask_user — and non-browser tools pass untouched', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    for (const call of [verb('read_page'), verb('look'), verb('ask_user'), verb('set_setting'), verb('spawn_agent')]) {
      expect(gate.gate(call)).toEqual({ ok: true })
    }
  })

  it('refuses every non-exempt browser verb on the armed host — exempt-first, fail-closed', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    // navigate is absent: it targets by its URL argument, not the tab's
    // current host — covered by the same-host-navigate test above.
    for (const name of ['click', 'type', 'scroll', 'back', 'go_forward']) {
      expect(gate.gate(verb(name)).ok).toBe(false)
    }
    expect(gate.gate(verb('read_page'))).toEqual({ ok: true })
  })

  it('passes navigate whose target cannot be classified (search terms, bare domain)', () => {
    const gate = createBlockerGate()
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    expect(gate.gate(navigate('best mechanical keyboards'))).toEqual({ ok: true })
    expect(gate.gate(navigate('reddit.com'))).toEqual({ ok: true })
  })

  it('passes same-kind calls on a different host', () => {
    const gate = createBlockerGate(() => 'example.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
    expect(gate.gate(navigate('https://old.reddit.com/other'))).toEqual({ ok: true })
  })

  it('passes a navigate to a third-party mirror host while the original host is walled (#140, ADR 0009)', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    // A Blocker arms on one host only: the mirror is a different host and an
    // ordinary distinct source — the gate never extends the wall to it.
    expect(gate.gate(navigate('https://mirror.example.net/same-material'))).toEqual({ ok: true })
  })

  it('arms ordinarily on a walled mirror host — no mirror exemption from the Blocker rules (#140)', () => {
    const gate = createBlockerGate()
    const walledMirror = 'title: Just a moment\nBLOCKER:challenge mirror.example.net\nThis page is a Blocker — a challenge wall.'
    gate.observe(navigate('https://mirror.example.net/same-material'), ok(walledMirror))
    // The mirror is judged like any other site: its own wall arms the gate
    // against the mirror host, exactly as it would for the original.
    expect(gate.gate(navigate('https://mirror.example.net/other-material')).ok).toBe(false)
    expect(gate.gate(navigate('https://www.reddit.com/search'))).toEqual({ ok: true })
  })

  it('disarms after a successful interaction with a different host', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    expect(gate.gate(verb('click')).ok).toBe(false)
    // The model moves elsewhere and successfully interacts there.
    gate.observe(navigate('https://example.com/article'), ok('read example'))
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
  })

  it('stays armed when the different-host interaction fails', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    gate.observe(navigate('https://example.com/article'), fail)
    expect(gate.gate(verb('click')).ok).toBe(false)
  })

  it('read_page neither disarms nor is refused — it re-shows the marker', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    gate.observe(verb('read_page'), ok(WALLED_RESULT))
    expect(gate.gate(verb('click')).ok).toBe(false)
    expect(gate.gate(verb('read_page'))).toEqual({ ok: true })
  })

  it('re-arms on the latest marker when the run walks into a different wall', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    const secondWall = 'title: Sign in\nBLOCKER:login-wall accounts.example.com\nThis page is a Blocker — a login wall.'
    gate.observe(navigate('https://accounts.example.com/login'), ok(secondWall))
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
    const refusal = gate.gate(navigate('https://accounts.example.com/other'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).toMatch(/login-wall/)
  })

  it('never arms on the (unknown) sentinel host or on marker-free results', () => {
    const gate = createBlockerGate()
    gate.observe(navigate('https://wherever.test/'), ok('BLOCKER:challenge (unknown)\nnudge text'))
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
    gate.observe(navigate('https://wherever.test/'), ok('an ordinary page result'))
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
  })

  it('matches hosts case-insensitively', () => {
    const gate = createBlockerGate()
    gate.observe(navigate('https://www.reddit.com/search'), ok('BLOCKER:challenge WWW.REDDIT.COM\nnudge'))
    expect(gate.gate(navigate('https://www.reddit.com/other')).ok).toBe(false)
  })

  it('ignores failed results entirely — a refusal error carries no marker it trusts', () => {
    const gate = createBlockerGate()
    gate.observe(navigate('https://www.reddit.com/search'), fail)
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
  })

  it('names the ASK_USER relay under the subagent escalation — one module, two wordings (#81)', () => {
    const gate = createBlockerGate(() => 'www.reddit.com', subagentBlockerEscalation)
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    const refusal = gate.gate(verb('click'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) {
      // The relay, not the orchestrator's direct ask: the directive rides
      // the subagent's report back.
      expect(refusal.reason).toMatch(/ASK_USER: <question>/)
      expect(refusal.reason).toMatch(/report/)
      expect(refusal.reason).not.toMatch(/say so and ask_user/)
      // Behavior otherwise identical: host, signal, and both options.
      expect(refusal.reason).toMatch(/www\.reddit\.com/)
      expect(refusal.reason).toMatch(/challenge/)
      expect(refusal.reason).toMatch(/genuinely different site/)
      expect(refusal.reason).toMatch(/read_page and look still work/)
    }
  })
})

// Issue #202, ADR 0037: keeping at the wall ends the run. The gate counts
// the Tool Rounds in which it refused a same-wall call — once per round,
// #197's rule — and the second such round in one armed episode trips
// Finalization for `blocker`. Reset is arm-scoped.
describe('the Blocker gate trips Finalization for `blocker` (#202)', () => {
  const LOGIN_WALL = 'title: Sign in\nBLOCKER:login-wall accounts.example.com\nThis page is a Blocker — a login wall.'

  /** An armed gate that has been told where its rounds begin. */
  function armedGate(host = 'www.reddit.com'): ReturnType<typeof createBlockerGate> {
    const gate = createBlockerGate(() => host)
    gate.beginRound()
    gate.observe(navigate(`https://${host}/search`), ok(WALLED_RESULT))
    return gate
  }

  it('takes two refused rounds — the count is the trip, and it is two', () => {
    expect(REFUSED_ROUNDS_BEFORE_FINALIZATION).toBe(2)
  })

  it('does not trip on one round of three refused same-wall calls (#197: one round, one count)', () => {
    const gate = armedGate()
    gate.beginRound()
    for (const call of [verb('click'), verb('type'), verb('scroll')]) {
      const refusal = gate.gate(call)
      expect(refusal.ok).toBe(false)
      // Each one is the recoverable refusal, not the stop.
      if (!refusal.ok) expect(refusal.reason).not.toMatch(/^Not executed — /)
    }
    expect(gate.finalizationDue()).toBeNull()
  })

  it('trips on a refusal in each of two rounds, and the tripping refusal carries the Finalize Instruction', () => {
    const gate = armedGate()
    gate.beginRound()
    expect(gate.gate(verb('click')).ok).toBe(false)
    expect(gate.finalizationDue()).toBeNull()
    gate.beginRound()
    const tripping = gate.gate(verb('click'))
    expect(tripping.ok).toBe(false)
    if (!tripping.ok) {
      // The wall sentence stands; the escalation and the lifting clause
      // are gone, because neither is true once the run is finalizing.
      expect(tripping.reason).toMatch(/^Not executed — /)
      expect(tripping.reason).toContain('www.reddit.com is walled for this run (Blocker: challenge)')
      expect(tripping.reason).toContain('The run kept interacting with www.reddit.com after it was walled')
      expect(tripping.reason).toContain('the user completing the challenge on screen in the browser tab')
      expect(tripping.reason).toMatch(/Finalize now/)
      expect(tripping.reason).not.toMatch(/genuinely different site/)
      expect(tripping.reason).not.toMatch(/lifts the refusal/)
    }
    expect(gate.finalizationDue()).toEqual({ signal: 'challenge', host: 'www.reddit.com' })
  })

  it('leaves the round after the trip to the closed-tool check — the gate refuses no more', () => {
    const gate = armedGate()
    gate.beginRound()
    gate.gate(verb('click'))
    gate.beginRound()
    gate.gate(verb('click'))
    // Siblings after the trip pass this gate: the run is finalizing, and
    // one round must read one reason (#201).
    expect(gate.gate(verb('type'))).toEqual({ ok: true })
  })

  it('resets when a successful different-host interaction lands between the two rounds', () => {
    const gate = armedGate()
    gate.beginRound()
    expect(gate.gate(verb('click')).ok).toBe(false)
    // The model demonstrably moved on: the episode is over.
    gate.observe(navigate('https://example.com/article'), ok('read example'))
    gate.beginRound()
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
    // Returning to the wall re-arms, and its patience starts again.
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    gate.beginRound()
    expect(gate.gate(verb('click')).ok).toBe(false)
    expect(gate.finalizationDue()).toBeNull()
  })

  it('starts a re-arm on a different wall at zero', () => {
    const gate = createBlockerGate(() => 'accounts.example.com')
    gate.beginRound()
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    gate.beginRound()
    // The tab is on accounts.example.com, so nothing here targets the
    // reddit wall — no refusal, no count.
    expect(gate.gate(verb('click'))).toEqual({ ok: true })
    gate.observe(navigate('https://accounts.example.com/login'), ok(LOGIN_WALL))
    gate.beginRound()
    const refusal = gate.gate(verb('click'))
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).not.toMatch(/^Not executed — /)
    expect(gate.finalizationDue()).toBeNull()
  })

  it('never lets re-reading the wall buy another round — a same-host re-arm keeps the count', () => {
    const gate = armedGate()
    gate.beginRound()
    expect(gate.gate(verb('click')).ok).toBe(false)
    // read_page re-shows the marker. That is inspection, not a new
    // episode: the next refused round still trips.
    gate.observe(verb('read_page'), ok(WALLED_RESULT))
    gate.beginRound()
    const tripping = gate.gate(verb('click'))
    expect(tripping.ok).toBe(false)
    if (!tripping.ok) expect(tripping.reason).toMatch(/^Not executed — /)
  })

  it('never counts read_page on the wall — it is never refused, so it never escalates', () => {
    const gate = armedGate()
    for (let round = 0; round < 5; round += 1) {
      gate.beginRound()
      expect(gate.gate(verb('read_page'))).toEqual({ ok: true })
    }
    expect(gate.finalizationDue()).toBeNull()
  })

  it('replan() clears the count and keeps the arm — a new objective earns fresh patience (#119)', () => {
    const gate = armedGate()
    gate.beginRound()
    expect(gate.gate(verb('click')).ok).toBe(false)
    gate.replan()
    gate.beginRound()
    const refusal = gate.gate(verb('click'))
    // Still armed — the wall is still there — but nudged rather than tripped.
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.reason).not.toMatch(/^Not executed — /)
    expect(gate.finalizationDue()).toBeNull()
  })

  it('never trips on a wall that never armed — the (unknown) sentinel host', () => {
    const gate = createBlockerGate(() => 'wherever.test')
    for (let round = 0; round < 4; round += 1) {
      gate.beginRound()
      gate.observe(navigate('https://wherever.test/'), ok('BLOCKER:challenge (unknown)\nnudge text'))
      expect(gate.gate(verb('click'))).toEqual({ ok: true })
    }
    expect(gate.finalizationDue()).toBeNull()
  })

  it('never trips a gate that is not told about rounds — one refusal in all', () => {
    const gate = createBlockerGate(() => 'www.reddit.com')
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    for (let call = 0; call < 5; call += 1) expect(gate.gate(verb('click')).ok).toBe(false)
    expect(gate.finalizationDue()).toBeNull()
  })

  it('carries the caller’s own Finalize Instruction when one is injected (#159/#202)', () => {
    const gate = createBlockerGate(
      () => 'www.reddit.com',
      subagentBlockerEscalation,
      (wall) => `Stopped at ${wall.host}. Reply now with ONLY your final report JSON.`,
    )
    gate.beginRound()
    gate.observe(navigate('https://www.reddit.com/search'), ok(WALLED_RESULT))
    gate.beginRound()
    gate.gate(verb('click'))
    gate.beginRound()
    const tripping = gate.gate(verb('click'))
    expect(tripping.ok).toBe(false)
    if (!tripping.ok) {
      expect(tripping.reason).toMatch(/^Not executed — /)
      expect(tripping.reason).toContain('Reply now with ONLY your final report JSON.')
      expect(tripping.reason).not.toMatch(/final answer JSON/)
    }
  })
})
