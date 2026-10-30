// The Peek Card's rules that are not the line's own (ADR 0021, 0026, 0029):
// how long an ended line stays on screen (#470), and which one element the
// overlay slot shows. The line itself — the ear taking it, its stages, its
// end — is the Turn Card's fold (#474, core/idle/turnCard), which the
// Ledger Strip (#475) draws across the pane's bottom while the Feed Panel
// is shut and the Turn Card draws over the Idle Screen: one fold, two
// frames.

/**
 * How long an ended line stays past its sentence (#470): one constant for
 * every form of the card. The owner's guess (2026-10-26 grill) — no measure
 * in the repo can settle 10 s against 15 s; what would is the owner reading
 * a failure from the chair on a normal day and saying the card went too
 * soon or stayed too long.
 */
export const PEEK_CARD_LINGER_MS = 15_000

/**
 * When a bar running out at this deadline began, on the deadline's clock: a card shown late starts part drained, and
 * nothing pauses it. The Turn Card's bar (#474) reads it.
 */
export function lingerStartsAt(retiresAt: number): number {
  return retiresAt - PEEK_CARD_LINGER_MS
}

/**
 * Whether an open panel retires the line the band reports (#331, ADR 0026): an ended line, yes — the user saw it up
 * close, whether the panel opened over the end or the line ended while it was held open; a live one, never — closing
 * the panel mid-run revives the band.
 */
export function retiredByPanel(panelOpen: boolean, card: { phase: 'open' | 'hidden'; end: unknown }): boolean {
  return panelOpen && card.phase === 'open' && card.end !== null
}

/**
 * The overlay slot's one element (ADR 0029): a native view intercepts
 * input across its whole bounds, so the overlay shows exactly one of the
 * expanded panel, the Peek Card, or the collapsed edge tab — the card
 * replaces the tab while visible, and an open panel outranks both. The
 * Weigh-in pop-up (#350) never takes the slot: collapsed, it has a view of
 * its own in the card's place, so the edge tab stays; over an open panel it
 * rides the panel's top. Both renderers derive from this one rule: the
 * dashboard sizes the slot by it, the overlay renders by it, so geometry and
 * content cannot diverge.
 */
export type OverlaySlotContent = 'panel' | 'card' | 'tab'

export function overlaySlotContent(panelOpen: boolean, cardShown: boolean): OverlaySlotContent {
  if (panelOpen) return 'panel'
  return cardShown ? 'card' : 'tab'
}
