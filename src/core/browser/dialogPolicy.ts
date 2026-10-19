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

/** Whether a consent control's label declines the optional cookies, by the rule. */
export function isRejectStyle(label: string): boolean {
  return REJECT_VERB_RE.test(label) || NECESSARY_ONLY_RE.test(label) || WITHOUT_OPTIONAL_RE.test(label)
}

/** Whether a consent control's label accepts and does not decline: never a choice that declines. */
export function isAcceptStyle(label: string): boolean {
  return ACCEPT_STYLE_RE.test(label) && !isRejectStyle(label)
}

/** The control the rule reads as declining, first of them; null when none does. */
export function consentRejectOf(controlLabels: readonly string[]): number | null {
  const reject = controlLabels.findIndex(isRejectStyle)
  return reject === -1 ? null : reject
}

/** The control the rule reads as accepting, first of them; null when none does. */
export function consentAcceptOf(controlLabels: readonly string[]): number | null {
  const accept = controlLabels.findIndex((label) => ACCEPT_STYLE_RE.test(label))
  return accept === -1 ? null : accept
}

/**
 * Pick the control a Tier-1 dismissal clicks: a reject-style control when one
 * exists, else an accept-style one. Null when no known consent choice exists.
 * A reject the rule cannot read ("Continue without accepting") is Jev's to
 * find before the accept ({@link ConsentChooser}, owner's rule 2026-10-19).
 */
export function chooseConsentDismissal(controlLabels: string[]): number | null {
  return consentRejectOf(controlLabels) ?? consentAcceptOf(controlLabels)
}

/**
 * Finds the control that declines a consent wall's optional cookies when
 * the rule reads none as declining (owner's rule 2026-10-19: the widest net,
 * Jev chooses): the index of a control among the labels, or null when none
 * declines, or no one could be asked. Never an accept-style control.
 */
export type ConsentChooser = (dialogText: string, controlLabels: readonly string[]) => Promise<number | null>

/**
 * The one line a Tier-1 dismissal reports, wherever it ran — read, navigate,
 * a click that opened the wall, or a blocked action (ADR 0061). The Round
 * Audit counts dismissals by this line's head, pinned by its test.
 */
export function consentDismissalLine(ref: number, label: string): string {
  return `dismissed consent dialog: clicked [${ref}] ${JSON.stringify(label)}`
}

/**
 * What follows the dismissal line when a click or type met a Blocked Action
 * under an open consent wall (ADR 0061): the retry landed, or still met a
 * cover — or was never run, because the target was Not Shown and no
 * dismissal reaches that (ADR 0062).
 */
export function consentRetryNote(ref: number, retry: 'landed' | 'stillBlocked' | 'notRetried'): string {
  if (retry === 'notRetried') return '(not retried)'
  return retry === 'stillBlocked' ? `(it covered [${ref}]; retried, still blocked)` : `(it covered [${ref}]; retried)`
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A dismissal followed by a note saying the wall stayed, built from the two builders above for any ref. */
const CONSENT_WALL_STAYED_RE = new RegExp(
  `${escape(consentDismissalLine(0, '').split('clicked')[0]!)}.*(?:${escape(consentRetryNote(0, 'stillBlocked')).replace('\\[0\\]', '\\[\\d+\\]')}|${escape(consentRetryNote(0, 'notRetried'))})`,
)

/**
 * Whether a Blocked Action's outcome says a consent wall stayed over its
 * target (#327, ADR 0061): a dismissal ran, and the retry was still
 * blocked or never ran. What the spoken failure line names a consent wall.
 */
export function consentWallStayed(text: string): boolean {
  return CONSENT_WALL_STAYED_RE.test(text)
}
