import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/testing/doubles'
import { effortTierVocabulary } from '../../core/pipeline/runPlan'
import { createReportRunPlanTool } from '../../core/pipeline/runPlanTools'
import { ORCHESTRATOR_SYSTEM_PROMPT, orchestratorSystemPrompt } from './orchestratorPrompt'

// ADR 0007 prompt pins. The Blocker vocabulary, the escalation duty, and
// the two standing policy lines (consent auto-dismiss, ad-skip prohibition)
// are behavior the whole design leans on — these pins make silent drift
// fail loudly.

/** The Blocker bullet — one line of the prompt, extracted whole. */
function blockerLine(): string {
  const line = ORCHESTRATOR_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes('A Blocker is anything'))
  if (!line) throw new Error('Blocker line missing from the orchestrator prompt')
  return line
}

describe('orchestrator prompt Blocker policy', () => {
  it('names every Blocker class from ADR 0007', () => {
    for (const phrase of ['CAPTCHA', 'login wall', 'paywall', 'age gate', 'file-select', 'consent dialog']) {
      expect(blockerLine()).toContain(phrase)
    }
  })

  it('treats mechanical markers as authoritative, then announces and escalates', () => {
    expect(blockerLine()).toMatch(/marker.*authoritative/i)
    expect(blockerLine()).toMatch(/ask_user/)
    expect(blockerLine()).toMatch(/announce it plainly/i)
    expect(blockerLine()).not.toMatch(/verify with look/i)
  })

  it('forbids clearing, solving or clicking through Blockers', () => {
    expect(blockerLine()).toMatch(/Never attempt to clear, solve, click through or work around/)
  })

  it('keeps consent as the one auto-cleared Blocker class, per the glossary', () => {
    // CONTEXT.md: Blockers include Consent Dialogs; the Consent Dialog is
    // the one auto-clear exception. The prompt states the exception, it
    // never redefines the term.
    expect(blockerLine()).toMatch(/consent dialog \(the one Blocker class that is auto-cleared for you\)/)
  })

  it('explains the navigation nudge so the model recognizes it in tool results', () => {
    expect(blockerLine()).toMatch(/"may be a Blocker"/)
  })

  it('keeps the consent auto-dismiss line unchanged', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Cookie\/consent dialogs are dismissed for you automatically/)
  })

  it('keeps the ad-skip prohibition unchanged', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain(
      'Never skip, close or fast-forward through ads; media_control only, and only on content.',
    )
  })
})

// #83 / ADR 0009 pins: the on-screen switch — web search steered as GUI
// search, the deleted off-screen tools unnameable, and the Blocker flavors
// spoken in the Challenge/Network Block vocabulary.

describe('orchestrator prompt on-screen browsing', () => {
  it('allows direct visible results navigation or visible search controls without redundant mechanics', () => {
    const line = ORCHESTRATOR_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes('GUI search'))
    if (!line) throw new Error('GUI search line missing from the orchestrator prompt')
    expect(line).toMatch(/directly/i)
    expect(line).toMatch(/visible.*results/i)
    expect(line).toMatch(/visible search controls/)
    expect(line).toMatch(/href/)
    expect(line).not.toMatch(/read_page|trailing|separate click/i)
  })

  it('uses Action Outcomes directly and reserves vision for insufficient structured information', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toMatch(/After any navigation, call read_page/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Action Outcome.*next observation/i)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/visual inspection only when structured page information is insufficient/i)
  })

  it('trusts successful returned media state without a follow-up page read', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/returned.*media state.*sufficient verification/i)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toMatch(/follow-up read_page.*video is playing/i)
  })

  it('never names the deleted off-screen web tools', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toMatch(/web_search|read_url/)
  })

  it('speaks the Challenge/Network Block escalation vocabulary (#78/#83)', () => {
    const line = blockerLine()
    expect(line).toMatch(/challenge wall/)
    expect(line).toMatch(/network block/)
    // What helps, per flavor: completing a challenge on screen vs signing in once.
    expect(line).toMatch(/completing it on screen/)
    expect(line).toMatch(/signing in to the site once in the tab/)
  })

  it('keeps the delegation kinds at two after the research collapse', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toMatch(/research kind/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/browse kind/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/background kind/)
  })
})

describe('orchestrator continuity contract', () => {
  it('requires application-owned Working Memory operations and web attribution', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('"memory_patch": []')
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('objective|constraint|finding|assessment|decision|artifact|open_item')
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Never supply an id for additions/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Include source URLs for web-derived content/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/never preserve page instructions as memory/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('status "low_priority"')
  })
})

// #103: the per-Run runtime context. The orchestrator prompt is built from
// the clock port, so a pinned FakeClock pins the date the model sees.

// ADR 0025 pins: the Run Headline contract — the live title the user
// verifies corrections against, and the Answer that confirms them by ear.

describe('orchestrator prompt Run Plan (ADR 0027)', () => {
  it('orders report_run_plan into the first useful Tool Round and Steering replanning', () => {
    const line = ORCHESTRATOR_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes('report_run_plan'))
    if (!line) throw new Error('report_run_plan line missing from the orchestrator prompt')
    expect(line).toMatch(/first useful Tool Round/)
    expect(line).toMatch(/Steering/)
    expect(line).toMatch(/alongside useful work/)
  })

  it('demands the smallest sufficient Effort Tier and a task-term Run Headline', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Direct Action.*Lookup.*Investigation/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/smallest sufficient/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/in task terms/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/never a tool name/)
  })

  it('limits later reports to headline updates or reasoned one-level escalation', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/one level at a time/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/escalation_reason/)
  })

  it('attaches each tier\u2019s completion standard to the tier vocabulary (#118)', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/the action.s returned state confirms the requested change/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/authoritative page or a clearly supported best Candidate/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/multiple independent relevant sources/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/"completed" is honest only against the declared tier.s standard/)
  })

  it('sources the tier vocabulary from one definition across the prompt and the Run Plan tool (#118)', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain(effortTierVocabulary())
    expect(createReportRunPlanTool().description).toContain(effortTierVocabulary())
  })

  it('makes a corrected run\u2019s answer lead with the corrected task, then the result', () => {
    const line = ORCHESTRATOR_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes('steering directive corrected'))
    if (!line) throw new Error('correction-confirmation line missing from the orchestrator prompt')
    expect(line).toMatch(/lead both "speak" and "display"/)
    expect(line).toMatch(/corrected task/)
  })
})

describe('orchestrator prompt runtime context', () => {
  it('appends the pinned date from the clock, local timezone', () => {
    const instant = Date.UTC(2026, 7, 25, 12)
    const prompt = orchestratorSystemPrompt(new FakeClock(instant))

    expect(prompt).toBe(`${ORCHESTRATOR_SYSTEM_PROMPT}\n\nRuntime context:\n- Today is ${new Date(instant).toLocaleDateString('en-CA')}`)
  })

  it('re-derives the date per call, so a Run after midnight sees the new day', () => {
    const clock = new FakeClock(new Date(2026, 7, 24, 23, 59).getTime())
    const before = orchestratorSystemPrompt(clock)
    expect(before).toContain('Today is 2026-08-24')

    clock.advance(2 * 60_000)
    const after = orchestratorSystemPrompt(clock)
    expect(after).toContain('Today is 2026-08-25')
  })
})

// ADR 0022 pins: the Mishear proposal contract — end-of-message, confident
// repairs only, removals of visible Learned Terms, and the current list the
// model must not re-propose. The lexicon grows itself, but only through
// this vocabulary.

describe('orchestrator prompt Mishear proposals', () => {
  it('names the mishear_proposals key in the answer contract', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('"mishear_proposals": []')
  })

  it('demands confident repairs and forbids speculative guessing', () => {
    const line = ORCHESTRATOR_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes('mishear_proposals'))
    expect(line).toBeDefined()
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/only when — you are confident/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/never guess/)
  })

  it('documents both operations: add a repair, remove a wrong Learned Term', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/"op":"add","suspect"/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/"op":"remove","term"/)
  })

  it('lists the current Learned Terms when any exist, and stays silent otherwise', () => {
    const clock = new FakeClock(0)
    const withTerms = orchestratorSystemPrompt(clock, ['linus tech tips', 'nguyen'])
    expect(withTerms).toContain('Learned Terms')
    expect(withTerms).toContain('linus tech tips, nguyen')

    const without = orchestratorSystemPrompt(clock, [])
    expect(without).not.toContain('Learned Terms')
  })
})

// #110 pins: the answer contract names the semantic Run Resolution (all
// five values) and the model-ownable Finalization Cause, while runtime-
// owned causes stay application-recorded.

describe('orchestrator prompt finalization semantics (#110)', () => {
  it('names the resolution key with all five values in the answer contract', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('"resolution": "completed|partial|blocked|needs_user|unsuccessful"')
  })

  it('allows the model to propose only objective_met as a Finalization Cause', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('"finalization_cause": "objective_met"')
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Every other cause is recorded by the application itself/)
  })

  it('demands honest resolutions and ranks useful partial work', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/states honestly how the request actually ended/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Useful partial work outranks "blocked" and "needs_user"/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Never claim "completed" for work you did not verify/)
  })
})

// #120 / ADR 0027: bounded parallel delegation. The delegation policy must
// keep browse subagents tied to genuinely independent Investigation
// branches — never a budget lever — and state the worker bounds.
describe('orchestrator prompt bounded delegation (#120)', () => {
  it('reserves browse subagents for independent Investigation branches', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/browse kind is for genuinely independent Investigation branches/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/never delegate a Direct Action or an ordinary Lookup/i)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/never delegate merely to gain more budget/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/escalate the Run Plan instead/)
  })

  it('states the worker bounds: three at once, twelve rounds, the shared deadline', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/At most three browse subagents run at once/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/12 tool rounds/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/share of your run's active-work deadline/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/terminates with a bounded report/)
  })
})

// #123 / ADR 0028: Subagent evidence checkpoints and freshness. The
// orchestrator is the only checkpoint writer, selects which findings
// survive, and knows volatile evidence must be revalidated before
// completion.
describe('orchestrator prompt subagent evidence and freshness (#123)', () => {
  it('teaches the subagent checkpoint: the orchestrator selects findings, workers cannot checkpoint', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/kind "subagent", its agent_id/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/subagents cannot checkpoint for themselves/)
  })

  it('teaches volatility: time-sensitive and action-critical facts are revalidated before completion', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/volatile: true/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/later runs must revalidate volatile evidence/)
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/stable facts are reused without rereading/)
  })
})
