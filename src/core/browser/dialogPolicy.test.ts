import { describe, expect, it } from 'vitest'
import { chooseConsentDismissal, CONSENT_LABEL_RE, isConsentDialog } from './dialogPolicy'

// Tier 1 classification (issue #18): a dialog is deterministically
// "trivial" (auto-dismissable) when one of its controls carries a consent
// choice — the same narrow label precedent the risk gate uses for consent
// submits. Everything else is Tier 2: the model decides.

describe('CONSENT_LABEL_RE', () => {
  it('matches consent-choice labels like the YouTube wall', () => {
    for (const label of ['Accept all', 'Reject all', 'Accept all cookies', 'Allow cookies', 'Decline consent', 'Accept cookies consent']) {
      expect(CONSENT_LABEL_RE.test(label)).toBe(true)
    }
  })

  it('does not match unrelated labels', () => {
    for (const label of ['Send me cookies news', 'Sign in', 'Not now', 'Submit', 'OK']) {
      expect(CONSENT_LABEL_RE.test(label)).toBe(false)
    }
  })
})

describe('isConsentDialog', () => {
  it('classifies a dialog whose controls include a consent choice', () => {
    expect(isConsentDialog('Before you continue', ['Accept all', 'Reject all'])).toBe(true)
  })

  it('does not activate an unrelated control based on consent prose alone', () => {
    expect(isConsentDialog('Accept all cookies to continue?', ['Continue', 'Purchase'])).toBe(false)
  })

  it('rejects dialogs without any consent signal', () => {
    expect(isConsentDialog('Sign in to continue', ['Sign in', 'Not now'])).toBe(false)
    expect(isConsentDialog('', [])).toBe(false)
  })
})

describe('chooseConsentDismissal', () => {
  it('prefers the reject-style control over accept', () => {
    const choice = chooseConsentDismissal(['Accept all', 'Reject all'])
    expect(choice).toBe(1)
  })

  it('falls back to the accept-style control when reject is absent', () => {
    expect(chooseConsentDismissal(['Accept all'])).toBe(0)
  })

  it('returns null when neither control is a known consent choice', () => {
    expect(chooseConsentDismissal(['Continue', 'Maybe later'])).toBeNull()
  })

  it('returns null for a dialog with no controls', () => {
    expect(chooseConsentDismissal([])).toBeNull()
  })
})
