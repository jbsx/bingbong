// Dialog policy (issue #18, Tier 1): which open dialogs are trivial enough
// to dismiss deterministically in code, and which control to press. The
// consent-label regex is the same narrow precedent the risk gate applies to
// consent submits — a verb of consent followed by "all"/"cookies"/"consent"
// — so the two layers can never drift apart.

/** Matches a consent-choice label ("Accept all", "Reject all cookies", …). */
export const CONSENT_LABEL_RE =
  /\b(accept|reject|allow|decline)\s+(all(\s+cookies?)?|cookies?(\s+consent)?|consent)\b|\b(accept|reject)\s+all\b/i

/**
 * A dialog is deterministically dismissable (Tier 1) only when one of its
 * controls carries a consent choice; prose alone is never enough to activate
 * a control. Everything else is Tier 2 (text + controls go to the model).
 */
export function isConsentDialog(_dialogText: string, controlLabels: string[]): boolean {
  return controlLabels.some((label) => CONSENT_LABEL_RE.test(label))
}

/** Control labels that decline (preferred) or accept — privacy first. */
const REJECT_STYLE_RE = /\b(reject|decline|deny|refuse|dismiss)\b/i
const ACCEPT_STYLE_RE = /\b(accept|allow|agree|ok|okay|got it)\b/i

/**
 * Pick the control a Tier-1 dismissal clicks: a reject-style control when one
 * exists, else an accept-style one. Null when no known consent choice exists.
 */
export function chooseConsentDismissal(controlLabels: string[]): number | null {
  if (controlLabels.length === 0) return null
  const reject = controlLabels.findIndex((label) => REJECT_STYLE_RE.test(label))
  if (reject !== -1) return reject
  const accept = controlLabels.findIndex((label) => ACCEPT_STYLE_RE.test(label))
  if (accept !== -1) return accept
  return null
}
