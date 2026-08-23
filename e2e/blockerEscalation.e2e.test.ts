import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { PipelineEvent } from '../src/core/pipeline/events'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { answerAskScript, commandBoxScript } from './scripts'
import { waitFor } from './waitFor'

type ToolResultEvent = Extract<PipelineEvent, { type: 'tool_result' }>

// ADR 0007 end-to-end: a challenge-shaped page is passively flagged on
// navigation (nudge in the tool result), the agent verifies with vision
// (look), escalates through a spoken ask_user, and never attempts to clear
// the challenge itself. The sign-in wall gets the same passive nudge, and
// the consent wall keeps auto-clearing — never escalated.

const VISION_CHALLENGE_DESCRIPTION =
  'A Cloudflare Turnstile challenge widget sits mid-page with a checkbox; the page says "Just a moment..." and no content is reachable until it is solved.'

function blockerScript(fixture: FixtureServer): AssistantTurn[] {
  return [
    // Detect: navigate, and the passive nudge rides along on the result.
    { kind: 'tool_calls', calls: [{ id: 'challenge-nav', name: 'navigate', args: { url: fixture.url('/challenge') } }] },
    // Verify with vision before announcing.
    { kind: 'tool_calls', calls: [{ id: 'challenge-verify', name: 'look', args: {} }] },
    // Announce + escalate via spoken ask_user; the run waits for the answer.
    {
      kind: 'tool_calls',
      calls: [
        { id: 'challenge-ask', name: 'ask_user', args: { question: 'This page is blocked by a CAPTCHA. Solve it yourself, or should I try another site?' } },
      ],
    },
    { kind: 'answer', speak: 'Waiting on you at the challenge page.', display: 'Escalated the CAPTCHA to the user.' },
    // Login walls are nudged on navigation too (detect happens passively).
    { kind: 'tool_calls', calls: [{ id: 'signin-nav', name: 'navigate', args: { url: fixture.url('/signin') } }] },
    // #79: a mid-load self-redirect must land as a normal outcome on the
    // walled page — marker included — not a dead ERR_ABORTED error.
    {
      kind: 'tool_calls',
      calls: [{ id: 'abort-nav', name: 'navigate', args: { url: fixture.url('/mid-load-redirect') } }],
    },
    // Consent stays the auto-clear class: read_page dismisses it, no ask.
    {
      kind: 'tool_calls',
      calls: [
        { id: 'consent-nav', name: 'navigate', args: { url: fixture.url('/consent-wall') } },
        { id: 'consent-read', name: 'read_page', args: {} },
      ],
    },
    { kind: 'answer', speak: 'Handled every wall.', display: 'Challenge escalated; sign-in wall flagged; consent auto-cleared.' },
  ]
}

describe('blocker detect → verify → escalate e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(blockerScript(fixture)),
        BINGBONG_VISION_DESCRIPTION_SCRIPT: JSON.stringify([VISION_CHALLENGE_DESCRIPTION]),
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('nudges on a challenge landing, verifies with vision, escalates by spoken ask, never clears', async () => {
    await harness.dashboardEval(`
      window.__blockerEvents = []
      window.bingbong.assistant.onEvent((event) => window.__blockerEvents.push(event))
    `)
    expect(await harness.dashboardEval<string>(commandBoxScript('open the challenge page'))).toBe('submitted')

    // The spoken escalation renders while the run waits for the answer.
    const question = await waitFor(
      async () => {
        const text = await harness.dashboardEval<string>(`document.querySelector('.ask-question')?.textContent ?? ''`)
        return text === '' ? undefined : text
      },
      { timeoutMs: 45_000, intervalMs: 250 },
    )
    expect(question).toBe('This page is blocked by a CAPTCHA. Solve it yourself, or should I try another site?')
    expect(await harness.dashboardEval<string>(answerAskScript('I will solve it myself'))).toBe('answered')

    // Never auto-clear, observed at the page: while the challenge page was
    // the live pane, nothing touched its Continue button (the onclick marker
    // never fired — the title is still the interstitial's).
    expect(await harness.paneEval<string>('document.title')).toBe('Just a moment...')

    // Second command continues the scripted session: the login-wall nudge
    // and the consent contrast. The command input stays disabled while the
    // first run drains, so wait for it to reopen first.
    await waitFor(
      async () => {
        const enabled = await harness.dashboardEval<boolean>(`!document.querySelector('.command-input').disabled`)
        return enabled ? enabled : undefined
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    )
    expect(await harness.dashboardEval<string>(commandBoxScript('now the sign-in and consent walls'))).toBe('submitted')

    const events = await waitFor(
      async () => {
        const captured = await harness.dashboardEval<PipelineEvent[]>('window.__blockerEvents || []')
        return captured.filter((event) => event.type === 'done').length >= 2 ? captured : undefined
      },
      { timeoutMs: 45_000, intervalMs: 250 },
    )
    const failures = events.filter((event) => event.type === 'tool_result' && !event.ok)
    expect(failures).toEqual([])
    const results = events.filter((event): event is ToolResultEvent => event.type === 'tool_result' && event.ok)
    const byId = Object.fromEntries(results.map((event) => [event.callId, event.result]))

    // Detect: the navigation outcome carries the marker line + flavored nudge.
    expect(byId['challenge-nav']).toContain('navigated: url=')
    expect(byId['challenge-nav']).toContain('BLOCKER:challenge 127.0.0.1')
    expect(byId['challenge-nav']).toContain('This page is a Blocker — a challenge wall')
    expect(byId['challenge-nav']).toContain('look (vision)')
    expect(byId['challenge-nav']).toContain('ask_user')

    // Verify: the agent looked before announcing.
    expect(byId['challenge-verify']).toContain(VISION_CHALLENGE_DESCRIPTION)

    // Escalate: the spoken ask resolved with the user's answer.
    expect(events).toContainEqual(expect.objectContaining({
      type: 'ask_resolved',
      answer: 'I will solve it myself',
      reason: 'user',
    }))
    expect(byId['challenge-ask']).toBe('I will solve it myself')

    // Never auto-clear: no click or type was attempted anywhere in the run —
    // the challenge's Continue button and the sign-in form stayed untouched.
    expect(events.filter((event) => event.type === 'tool_call' && event.name === 'click')).toEqual([])
    expect(events.filter((event) => event.type === 'tool_call' && event.name === 'type')).toEqual([])

    // Login walls are nudged on navigation too.
    expect(byId['signin-nav']).toContain('BLOCKER:login-wall 127.0.0.1')
    expect(byId['signin-nav']).toContain('This page is a Blocker — a login wall')

    // #79: the aborted load recovered into a normal navigate outcome naming
    // the real landed URL, and the classifier judged the landing — marker
    // line present, no failed tool result.
    expect(byId['abort-nav']).toContain(`navigated: url=${fixture.url('/challenge')}`)
    expect(byId['abort-nav']).toContain('BLOCKER:challenge 127.0.0.1')

    // Consent keeps auto-clearing — dismissed deterministically, not escalated.
    expect(byId['consent-read']).toMatch(/^dismissed consent dialog: clicked \[2\] "Reject all(?: Reject all)?"/)
    expect(events.filter((event) => event.type === 'ask_resolved')).toHaveLength(1)
  })
})
