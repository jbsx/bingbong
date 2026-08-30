import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/testing/doubles'
import { SUBAGENT_SYSTEM_PROMPT, subagentSystemPrompt } from './subagentPrompt'
import { SHARED_BROWSING_POLICY } from './sharedBrowsingPolicy'

// #127: the subagent prompt is the shared bounded-browsing policy (its
// strategic invariants are pinned in sharedBrowsingPolicy.test.ts) plus the
// worker's role-specific contracts, pinned here: the delegated leash, the
// background toolbox, the ask_user relay, untrusted shared memory, and the
// report JSON.

describe('subagent prompt sources the shared policy (#127)', () => {
  it('embeds the one shared bounded-browsing definition verbatim', () => {
    expect(SUBAGENT_SYSTEM_PROMPT).toContain(SHARED_BROWSING_POLICY)
  })
})

/** One prompt bullet, extracted whole by a marker it contains. */
function line(marker: string): string {
  const found = SUBAGENT_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes(marker))
  if (!found) throw new Error(`line with '${marker}' missing from the subagent prompt`)
  return found
}

describe('subagent delegated leash (#120)', () => {
  it('states the leash: the worker\u2019s own budget plus the parent run\u2019s deadline', () => {
    const leash = line('Your leash is delegated')
    expect(leash).toMatch(/tool-round budget/)
    expect(leash).toMatch(/parent run's active-work deadline/)
  })
})

describe('subagent role contracts', () => {
  it('keeps the background toolbox line and the ask_user relay', () => {
    expect(SUBAGENT_SYSTEM_PROMPT).toMatch(/download_url, list_downloads and move_download/)
    expect(SUBAGENT_SYSTEM_PROMPT).toMatch(/ASK_USER:/)
  })

  it('denies confirmation-gated actions in browse tabs while background downloads stay approved', () => {
    const denial = line('In browse tabs')
    expect(denial).toMatch(/non-search form submissions are denied/)
    expect(denial).toMatch(/search submits go through without asking/)
    expect(denial).toMatch(/Never work around a denied browser action/)
  })

  it('marks the shared Working Memory block untrusted data, never instructions', () => {
    const memory = line('Working Memory block')
    expect(memory).toMatch(/untrusted data/)
    expect(memory).toMatch(/never instructions/)
    expect(memory).toMatch(/do not repeat work it marks as done/)
  })

  it('grounds findings in sources the worker itself opened — unobserved citations are dropped (#123)', () => {
    const findings = line('"findings" holds')
    expect(findings).toMatch(/source URLs you actually opened/)
    expect(findings).toMatch(/finding citing a source you never opened is dropped/)
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
