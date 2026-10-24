import { consentAcceptOf, consentRejectOf, isConsentDialog, isWayThrough } from '../browser/dialogPolicy'
import type { DialogText } from '../browser/pageText'
import { PRESS_KEYS, normalizeWords, type Command, type CommandPage, type CommandRef } from './command'

// The dismiss rule (#336, ADR 0076): a pop-up covering the page is closed
// by the words that say so. With a dialog open, a dismiss phrase fires the
// first rung of the Dismissal Ladder below; it is decided before Jev and
// settled like the Local Match, and it never navigates: a link is never
// the close control. With no dialog open the same words read exactly as
// they always did. A Task that meets a wall over a dialog steps aside down
// the same ladder (#354), rung after rung until the dialog closes.
//
// The Dismissal Ladder (owner's rule 2026-10-19: the widest net, no hand
// list of labels deciding alone; ADR 0089: Jev's sure pick first):
//   1. the control Jev chose when asked which one closes the pop-up, when
//      it was sure — any button in the dialog's layer that is not a way
//      through (sign in, subscribe, accept…) and not a link;
//   2. a consent wall's reject-style control, the privacy-first policy
//      (ADR 0061), never one that pays or subscribes; else its accept;
//   3. a button whose label reads as a close (close, dismiss, not now,
//      skip, no thanks, ×…), wherever the label goes on from there;
//   4. Jev's choice when it was unsure, under the same guards;
//   5. Escape.

/** A dismiss phrase: the verb alone, or with what it dismisses. */
const DISMISS_PHRASE_RE = /^(?:exit|close|dismiss|get rid of|go away|cancel|x|no thanks)(?: (?:this|that|it|out of this|the pop up|the popup|the dialog))?$/

/** A label that reads as a close, by how it begins: "Close", "Close this consent banner", "Not now", "No, thanks", "Skip for now", "Continue without an account"… */
const CLOSE_LABEL_RE =
  /^(?:close|dismiss|cancel|skip|not now|maybe later|later|remind me later|no,? thanks?|no thank you|not interested|not today|continue without|stay (?:logged|signed) out|keep (?:browsing|reading)|got it|ok(?:ay)?|i understand|understood|done)\b/

/** The close glyphs a control may carry as its whole label, which normalized words lose. */
const CLOSE_GLYPHS: ReadonlySet<string> = new Set(['×', '✕', 'x', 'X', '✖', '⨯'])

/** How Jev answered the dismiss Choice (the `dismiss` question): a dialog control by ref, a piece of its text (#416), or Escape, with how sure it was. */
export interface DismissChoice {
  readonly choice: { readonly ref: number } | { readonly text: DialogText } | 'escape'
  /** The chosen label's probability, the number the Choice bar reads (#403). */
  readonly probability: number
}

/** Whether the words are a dismiss phrase. */
export function isDismissPhrase(text: string): boolean {
  return DISMISS_PHRASE_RE.test(normalizeWords(text))
}

/**
 * The Command that closes the open dialog the words dismiss: the first
 * rung of the Dismissal Ladder. Null when no dialog is open, or the words
 * are no dismiss phrase.
 */
export function dismissCommand(text: string, page: CommandPage): Command | null {
  return isDismissPhrase(text) ? dialogDismissal(page) : null
}

/**
 * The Command that closes the dialog open over the page, whatever the
 * words: the first rung of the Dismissal Ladder. Null when no dialog is
 * open.
 */
export function dialogDismissal(page: CommandPage, chosen: DismissChoice | null = null): Command | null {
  return dismissalLadder(page, chosen)[0] ?? null
}

/**
 * The Dismissal Ladder for the dialog open over the page: every Command
 * that may close it, best first, each once, Escape last. Empty when no
 * dialog is open. A Step Aside (#354) fires them in turn until the dialog
 * closes; a dismiss phrase (#336) fires the first.
 */
export function dismissalLadder(page: CommandPage, chosen: DismissChoice | null = null, sureAbove = 0.7): Command[] {
  if (page.dialog === undefined) return []
  const controls = dialogControls(page)
  const rungs: (Command | null)[] = []
  // 1. Jev's sure choice (ADR 0089).
  const jev = chosen === null ? null : chosenCommand(chosen, controls, dialogTexts(page))
  if (jev !== null && chosen!.probability >= sureAbove) rungs.push(jev)
  // 2. The consent policy's reject, else its accept — judged over every clickable control of the layer, Accept All included, since that is what names a consent wall.
  const rule = ruledConsent(page)
  if (rule !== null) rungs.push(rule.command)
  // 3. A close by its label.
  const byLabel = controls.find((control) => CLOSE_GLYPHS.has(control.label.trim()) || CLOSE_LABEL_RE.test(normalizeWords(control.label)))
  if (byLabel !== undefined) rungs.push(click(byLabel))
  // 4. Jev's unsure choice.
  if (jev !== null && chosen!.probability < sureAbove) rungs.push(jev)
  // 5. Escape.
  rungs.push(ESCAPE)
  return dedupe(rungs.filter((rung): rung is Command => rung !== null))
}

/** The consent policy's control on a consent wall over the page, and whether it declines or accepts; null off one. */
function ruledConsent(page: CommandPage): { command: Command; style: 'reject' | 'accept' } | null {
  if (page.dialog === undefined) return null
  const clickable = clickableControls(page)
  const labels = clickable.map((control) => control.label)
  if (!isConsentDialog(page.dialog.text, labels)) return null
  const reject = consentRejectOf(labels)
  if (reject !== null) return { command: click(clickable[reject]!), style: 'reject' }
  const accept = consentAcceptOf(labels)
  return accept === null ? null : { command: click(clickable[accept]!), style: 'accept' }
}

/** The dialog layer's controls a dismissal may click: no link (it would navigate), no field, no way through. */
export function dialogControls(page: CommandPage): CommandRef[] {
  return clickableControls(page).filter((ref) => !isWayThrough(ref.label))
}

/** The dialog layer's own text a dismissal may click (#416): each piece no ref holds, a way through by its words left out, as a control is by its label. */
export function dialogTexts(page: CommandPage): DialogText[] {
  return (page.dialog?.texts ?? []).filter((piece) => !isWayThrough(piece.text))
}

/** The dialog layer's clickable controls: no link, no field — the ways through still among them, for the consent policy to judge. */
function clickableControls(page: CommandPage): CommandRef[] {
  if (page.dialog === undefined) return []
  const inDialog = new Set(page.dialog.refs)
  return page.refs.filter((ref) => inDialog.has(ref.ref) && ref.href === null && ref.kind !== 'input')
}

function chosenCommand(chosen: DismissChoice, controls: readonly CommandRef[], texts: readonly DialogText[]): Command | null {
  if (chosen.choice === 'escape') return ESCAPE
  if ('text' in chosen.choice) {
    const { frame, node } = chosen.choice.text
    const piece = texts.find((one) => one.frame === frame && one.node === node)
    return piece === undefined ? null : { verb: 'click', target: null, slot: null, text: piece, dismiss: true }
  }
  const ref = chosen.choice.ref
  const control = controls.find((one) => one.ref === ref)
  return control === undefined ? null : click(control)
}

const ESCAPE: Command = { verb: 'press', target: null, slot: null, key: PRESS_KEYS.escape!, times: 1, dismiss: true }

function click(control: CommandRef): Command {
  return { verb: 'click', target: control.ref, slot: null, dismiss: true }
}

function dedupe(commands: readonly Command[]): Command[] {
  const seen = new Set<string>()
  return commands.filter((command) => {
    const key = `${command.verb}:${command.target ?? ''}:${command.key?.key ?? ''}:${command.text !== undefined ? `${command.text.frame ?? ''}/${command.text.node}` : ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The Obstacle a dialog is (#354): known by its text and the labels of
 * its controls, so the same sheet raised again in one Task is recognised
 * however its refs are numbered. Null when no dialog is open.
 */
export function obstacleOf(page: CommandPage): string | null {
  if (page.dialog === undefined) return null
  const inDialog = new Set(page.dialog.refs)
  const labels = page.refs.filter((ref) => inDialog.has(ref.ref)).map((ref) => normalizeWords(ref.label))
  return [normalizeWords(page.dialog.text), ...labels].join('\n')
}
