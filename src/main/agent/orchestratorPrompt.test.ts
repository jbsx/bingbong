import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/testing/doubles'
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

  it('states the full escalation flow: verify with vision, announce, ask_user', () => {
    expect(blockerLine()).toMatch(/look \(vision\)/)
    expect(blockerLine()).toMatch(/ask_user/)
    expect(blockerLine()).toMatch(/announce it plainly/)
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
  it('steers GUI search: engine box + trailing newline, read results, open by href', () => {
    const line = ORCHESTRATOR_SYSTEM_PROMPT.split('\n').find((candidate) => candidate.includes('GUI search'))
    if (!line) throw new Error('GUI search line missing from the orchestrator prompt')
    expect(line).toMatch(/search box/)
    expect(line).toMatch(/\\n/)
    expect(line).toMatch(/read_page/)
    expect(line).toMatch(/href/)
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
