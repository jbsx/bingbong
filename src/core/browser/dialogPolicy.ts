// Dialog policy (issue #18, Tier 1): which open dialogs are trivial enough
// to dismiss deterministically in code, and which control to press. The
// consent-label regex is the same narrow precedent the risk gate applies to
// consent submits — a verb of consent followed by "all"/"cookies"/"consent",
// or by the optional/necessary/essential cookies a choice names (ADR 0061) —
// so the two layers can never drift apart.

/** Matches a consent-choice label ("Accept all", "Reject all cookies", "Reject optional cookies", …). */
export const CONSENT_LABEL_RE =
  /\b(accept|reject|allow|decline)\s+((optional|necessary|essential)\s+cookies?|all(\s+cookies?)?|cookies?(\s+consent)?|consent)\b|\b(accept|reject)\s+all\b/i

/**
 * A dialog is deterministically dismissable (Tier 1) only when one of its
 * controls carries a consent choice; prose alone is never enough to activate
 * a control. Everything else is Tier 2 (text + controls go to the model).
 */
export function isConsentDialog(_dialogText: string, controlLabels: string[]): boolean {
  return controlLabels.some((label) => CONSENT_LABEL_RE.test(label))
}

/**
 * Control labels that decline (preferred) or accept — privacy first. Taking
 * only the necessary or essential cookies declines the rest, and so does
 * going on without the optional ones (ADR 0061) — a phrase that declines
 * them, never the bare word, which a "Manage optional cookies" control or a
 * toggle carries too. This widening is the dismissal's alone: the risk gate
 * reads `CONSENT_LABEL_RE`.
 */
const REJECT_VERB_RE = /\b(reject|decline|deny|refuse|dismiss)\b/i
const NECESSARY_ONLY_RE = /\b(necessary|essential)\b.*\bonly\b|\bonly\b.*\b(necessary|essential)\b/i
const WITHOUT_OPTIONAL_RE = /\b(without|no|none of)\s+(the\s+)?optional\b/i
const ACCEPT_STYLE_RE = /\b(accept|allow|agree|ok|okay|got it)\b/i

function isRejectStyle(label: string): boolean {
  return REJECT_VERB_RE.test(label) || NECESSARY_ONLY_RE.test(label) || WITHOUT_OPTIONAL_RE.test(label)
}

/**
 * Pick the control a Tier-1 dismissal clicks: a reject-style control when one
 * exists, else an accept-style one. Null when no known consent choice exists.
 */
export function chooseConsentDismissal(controlLabels: string[]): number | null {
  if (controlLabels.length === 0) return null
  const reject = controlLabels.findIndex(isRejectStyle)
  if (reject !== -1) return reject
  const accept = controlLabels.findIndex((label) => ACCEPT_STYLE_RE.test(label))
  if (accept !== -1) return accept
  return null
}

/**
 * The one line a Tier-1 dismissal reports, wherever it ran — read, navigate,
 * a click that opened the wall, or a blocked action (ADR 0061). The Round
 * Audit counts dismissals by this line's head, pinned by its test.
 */
export function consentDismissalLine(ref: number, label: string): string {
  return `dismissed consent dialog: clicked [${ref}] ${JSON.stringify(label)}`
}

/**
 * What follows the dismissal line when a click or type the wall blocked was
 * retried in the same call (ADR 0061): the ref the model named, and whether
 * the retry still met a cover.
 */
export function consentRetryNote(ref: number, stillBlocked: boolean): string {
  return stillBlocked ? `(it covered [${ref}]; retried, still blocked)` : `(it covered [${ref}]; retried)`
}
