import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/testing/doubles'
import { SUBAGENT_SYSTEM_PROMPT, subagentSystemPrompt } from './subagentPrompt'

// #83 / ADR 0009 pins for the subagent prompt: the research guidance is
// rewritten to GUI search in the agent's own visible tab — the off-screen
// tools are gone, so the prompt must neither name them nor hint at them.

describe('subagent prompt on-screen browsing', () => {
  it("allows direct visible results navigation or visible search controls in the agent's own tab", () => {
    const line = SUBAGENT_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes('on screen in your own visible tab'))
    if (!line) throw new Error('GUI search line missing from the subagent prompt')
    expect(line).toMatch(/directly/i)
    expect(line).toMatch(/visible.*results/i)
    expect(line).toMatch(/visible search controls/)
    expect(line).toMatch(/href/)
    expect(line).not.toMatch(/read_page|trailing|separate click/i)
  })

  it('continues from Action Outcomes instead of prescribing a post-navigation read', () => {
    expect(SUBAGENT_SYSTEM_PROMPT).toMatch(/Action Outcome.*next observation/i)
    expect(SUBAGENT_SYSTEM_PROMPT).not.toMatch(/After any navigation, call read_page/)
  })

  it('never names the deleted off-screen web tools', () => {
    expect(SUBAGENT_SYSTEM_PROMPT).not.toMatch(/web_search|read_url/)
  })

  it('keeps the background toolbox line and the ask_user relay', () => {
    expect(SUBAGENT_SYSTEM_PROMPT).toMatch(/download_url, list_downloads and move_download/)
    expect(SUBAGENT_SYSTEM_PROMPT).toMatch(/ASK_USER:/)
  })
})

// #103: the per-Run runtime context. The subagent prompt is built per spawn
// from the clock port, so a pinned FakeClock pins the date the model sees.

describe('subagent prompt runtime context', () => {
  it('appends the pinned date from the clock, local timezone', () => {
    const instant = Date.UTC(2026, 7, 25, 12)
    const prompt = subagentSystemPrompt(new FakeClock(instant))

    expect(prompt).toBe(`${SUBAGENT_SYSTEM_PROMPT}\n\nRuntime context:\n- Today is ${new Date(instant).toLocaleDateString('en-CA')}`)
  })

  it('re-derives the date per call, so a spawn after midnight sees the new day', () => {
    const clock = new FakeClock(new Date(2026, 7, 24, 23, 59).getTime())
    expect(subagentSystemPrompt(clock)).toContain('Today is 2026-08-24')

    clock.advance(2 * 60_000)
    expect(subagentSystemPrompt(clock)).toContain('Today is 2026-08-25')
  })
})
