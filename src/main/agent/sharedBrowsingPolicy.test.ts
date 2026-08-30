import { describe, expect, it } from 'vitest'
import { createReportRunPlanTool } from '../../core/pipeline/runPlanTools'
import { effortTierVocabulary } from '../../core/pipeline/runPlan'
import { SHARED_BROWSING_POLICY } from './sharedBrowsingPolicy'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'
import { SUBAGENT_SYSTEM_PROMPT } from './subagentPrompt'

// #127: the shared bounded-browsing policy — one definition of the
// strategic vocabulary every browser-facing role embeds. These tests pin
// strategic invariants (what the policy must teach), not exact prose;
// mechanical call sequences are the tool descriptions' job, and
// role-specific contracts are pinned in the role prompts' own tests.

/** One policy bullet, extracted whole by a marker it contains. */
function bullet(marker: string): string {
  const line = SHARED_BROWSING_POLICY.split('\n').find((candidate) => candidate.includes(marker))
  if (!line) throw new Error(`bullet with '${marker}' missing from the shared policy`)
  return line
}

/** Every browser-facing role prompt, for pins that must guard the whole prompt. */
const ROLE_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  ['orchestrator', ORCHESTRATOR_SYSTEM_PROMPT],
  ['subagent', SUBAGENT_SYSTEM_PROMPT],
]

describe('shared policy is the one source (#127/AC1)', () => {
  it.each(ROLE_PROMPTS)('the %s prompt embeds the shared policy verbatim', (_role, prompt) => {
    expect(prompt).toContain(SHARED_BROWSING_POLICY)
  })

  it('carries no mechanical call sequences — those live in tool descriptions (#127/AC2)', () => {
    expect(SHARED_BROWSING_POLICY).not.toMatch(/then retry|call read_page|trailing/i)
  })

  // Absence pins guard the full role prompts, not just the fragment: a
  // role bullet reintroducing a deleted tool or mechanic must fail loudly.
  it.each(ROLE_PROMPTS)('the %s prompt never names the deleted off-screen web tools (#83)', (_role, prompt) => {
    expect(prompt).not.toMatch(/web_search|read_url/)
  })

  it.each(ROLE_PROMPTS)('the %s prompt prescribes no mandatory post-navigation read (#83)', (_role, prompt) => {
    expect(prompt).not.toMatch(/After any navigation, call read_page/)
  })
})

describe('shared policy on-screen invariants (#83/ADR 0009)', () => {
  it('allows direct visible results navigation or visible search controls without redundant mechanics', () => {
    const line = bullet('Search is GUI search')
    expect(line).toMatch(/navigate directly/i)
    expect(line).toMatch(/visible.*results/i)
    expect(line).toMatch(/visible search controls/)
    expect(line).toMatch(/href/)
    expect(line).not.toMatch(/read_page|trailing|separate click/i)
  })

  it('uses Action Outcomes directly as the next observation', () => {
    const line = bullet('A browser Action Outcome')
    expect(line).toMatch(/Action Outcome.*next observation/i)
    expect(line).toMatch(/returned state is sufficient verification/i)
    expect(line).not.toMatch(/After any navigation, call read_page/)
  })

  it('reserves vision for insufficient structured information', () => {
    expect(bullet('Reference elements strictly')).toMatch(
      /visual inspection only when structured page information is insufficient/i,
    )
  })
})

describe('shared policy Progress and stopping invariants (#126, ADR 0027)', () => {
  it('defines Progress as decision-relevant evidence or a requested state change', () => {
    const line = bullet('Progress means')
    expect(line).toMatch(/decision-relevant evidence or a requested state change/i)
    expect(line).toMatch(/activity, not Progress/i)
  })

  it('demands a genuinely different Approach on no-progress results', () => {
    const line = bullet('Progress means')
    expect(line).toMatch(/change your Approach/i)
    expect(line).toMatch(/genuinely different strategy/i)
  })

  it('teaches obedience to redundancy refusals against unchanged state', () => {
    expect(bullet('Progress means')).toMatch(/unchanged page state/i)
  })

  it('teaches the exhausted-budget exit: stop acquiring, answer honestly (#117)', () => {
    const line = bullet('Work is bounded')
    expect(line).toMatch(/work budget is spent/i)
    expect(line).toMatch(/stop acquisition work/i)
    expect(line).toMatch(/terminal bookkeeping the notice still allows/i)
    expect(line).toMatch(/reply immediately with your final answer/i)
    expect(line).toMatch(/state honestly/i)
  })
})

describe('shared policy effort invariants (#118)', () => {
  it('sources the tier vocabulary — labels, ids, completion standards — from the one definition', () => {
    expect(SHARED_BROWSING_POLICY).toContain(effortTierVocabulary())
    // The same one definition feeds the Run Plan tool, so prompt and tool
    // cannot drift (#118's pin, now covering the shared policy too).
    expect(createReportRunPlanTool().description).toContain(effortTierVocabulary())
  })

  it('demands the smallest sufficient tier', () => {
    expect(bullet('Work is bounded')).toMatch(/smallest sufficient/i)
  })
})

describe('shared policy Blocker/ad/user invariants (ADR 0007)', () => {
  it('names every Blocker class', () => {
    for (const phrase of ['CAPTCHA', 'login wall', 'paywall', 'age gate', 'file-select', 'consent dialog']) {
      expect(bullet('A Blocker is anything')).toContain(phrase)
    }
  })

  it('treats mechanical markers as authoritative, then announces and escalates', () => {
    const line = bullet('A Blocker is anything')
    expect(line).toMatch(/marker.*authoritative/i)
    expect(line).toMatch(/ask_user/)
    expect(line).toMatch(/announce it plainly/i)
    expect(line).not.toMatch(/verify with look/i)
  })

  it('speaks the Challenge/Network Block escalation vocabulary (#78/#83)', () => {
    const line = bullet('A Blocker is anything')
    expect(line).toMatch(/challenge wall/)
    expect(line).toMatch(/network block/)
    expect(line).toMatch(/completing it on screen/)
    expect(line).toMatch(/signing in to the site once in the tab/)
  })

  it('forbids clearing, solving or clicking through Blockers', () => {
    expect(bullet('A Blocker is anything')).toMatch(/Never attempt to clear, solve, click through or work around/)
  })

  it('keeps consent as the one auto-cleared Blocker class, per the glossary', () => {
    expect(bullet('A Blocker is anything')).toMatch(/consent dialog \(the one Blocker class that is auto-cleared for you\)/)
  })

  it('explains the navigation nudge so the model recognizes it in tool results', () => {
    expect(bullet('A Blocker is anything')).toMatch(/"may be a Blocker"/)
  })

  it('keeps the consent auto-dismiss and dialog reporting', () => {
    expect(bullet('Cookie/consent dialogs')).toMatch(/dismissed for you automatically/)
  })

  it('keeps the ad-skip prohibition', () => {
    expect(bullet('Never skip, close or fast-forward')).toMatch(/Never skip, close or fast-forward through ads/i)
  })

  it('teaches ask_user clarification and safe abandonment when unanswered', () => {
    const line = bullet('ask_user is how')
    expect(line).toMatch(/any clarification you need/i)
    expect(line).toMatch(/Never guess in place of asking/i)
    expect(line).toMatch(/proceed safely or abandon/i)
  })
})

describe('shared policy evidence invariants (ADR 0028)', () => {
  it('grounds every claim in sources actually observed', () => {
    const line = bullet('Ground every claim')
    expect(line).toMatch(/cite the pages you opened/i)
    expect(line).toMatch(/never observed is dropped as unverified/i)
  })

  it('teaches Session Evidence survival, verbatim user words, and volatility', () => {
    const line = bullet('Ground every claim')
    expect(line).toMatch(/survives this run ending/i)
    expect(line).toMatch(/own words are kept verbatim/i)
    expect(line).toMatch(/volatile/i)
  })
})
