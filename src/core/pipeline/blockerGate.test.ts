import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import { createBlockerGate, hostFromUrl, subagentBlockerEscalation } from './blockerGate'

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
