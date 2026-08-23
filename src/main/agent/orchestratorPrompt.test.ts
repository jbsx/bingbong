import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'

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
