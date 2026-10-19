import { PRESS_KEYS, normalizeWords, type Command, type CommandPage } from './command'

// The dismiss rule (#336, ADR 0076): a pop-up covering the page is closed
// by the words that say so. With a dialog open, a dismiss phrase clicks the
// dialog's own close control, or presses Escape when it has none. It is
// decided before Jev and settled like the Local Match, and it never
// navigates: a link is never the close control. With no dialog open the
// same words read exactly as they always did. A Task that meets a wall
// over a dialog steps aside with the same dismissal (#354).

/** A dismiss phrase: the verb alone, or with what it dismisses. */
const DISMISS_PHRASE_RE = /^(?:exit|close|dismiss|get rid of|go away|cancel|x|no thanks)(?: (?:this|that|it|out of this|the pop up|the popup|the dialog))?$/

/** The labels a dialog's close control carries, as normalized words. */
const CLOSE_LABELS: ReadonlySet<string> = new Set(['close', 'dismiss', 'not now', 'cancel', 'no thanks'])

/** The close glyphs a control may carry as its whole label, which normalized words lose. */
const CLOSE_GLYPHS: ReadonlySet<string> = new Set(['×', '✕'])

/** Whether the words are a dismiss phrase. */
export function isDismissPhrase(text: string): boolean {
  return DISMISS_PHRASE_RE.test(normalizeWords(text))
}

/**
 * The Command that closes the open dialog the words dismiss: a click on
 * the dialog layer's close control — never a link — else Escape. Null
 * when no dialog is open, or the words are no dismiss phrase.
 */
export function dismissCommand(text: string, page: CommandPage): Command | null {
  return isDismissPhrase(text) ? dialogDismissal(page) : null
}

/**
 * The Command that closes the dialog open over the page, whatever the
 * words: its close control clicked — never a link — else Escape. Null
 * when no dialog is open. A Task steps aside with it (#354) as a dismiss
 * phrase does.
 */
export function dialogDismissal(page: CommandPage): Command | null {
  if (page.dialog === undefined) return null
  const inDialog = new Set(page.dialog.refs)
  const close = page.refs.find(
    (ref) => inDialog.has(ref.ref) && ref.href === null && (CLOSE_GLYPHS.has(ref.label.trim()) || CLOSE_LABELS.has(normalizeWords(ref.label))),
  )
  if (close !== undefined) return { verb: 'click', target: close.ref, slot: null, dismiss: true }
  return { verb: 'press', target: null, slot: null, key: PRESS_KEYS.escape!, times: 1, dismiss: true }
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
