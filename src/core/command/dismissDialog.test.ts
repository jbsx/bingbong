import { describe, expect, it } from 'vitest'
import type { CommandPage } from './command'
import { dialogDismissal, dismissCommand, isDismissPhrase, obstacleOf } from './dismissDialog'

// The dismiss rule (#336, ADR 0076): with a dialog open, a dismiss phrase
// closes it — its close control clicked, else Escape pressed — decided
// before Jev and settled like the Local Match. It never navigates; with no
// dialog open the words read as they always did.

const SHEET: CommandPage = {
  url: 'https://x.com/elonmusk',
  title: 'Elon Musk (@elonmusk) / X',
  refs: [
    { ref: 1, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null },
    { ref: 7, kind: 'link', label: 'Cancel', href: 'https://x.com/home', inputType: null },
    { ref: 8, kind: 'button', label: 'Sign in', href: null, inputType: null },
    { ref: 9, kind: 'button', label: 'Close', href: null, inputType: null },
  ],
  dialog: { text: 'Don’t miss what’s happening. People on X are the first to know.', refs: [7, 8, 9] },
}

/** The same page with no dialog open. */
const CLOSED: CommandPage = { url: SHEET.url, title: SHEET.title, refs: SHEET.refs }

describe('a dismiss phrase', () => {
  it.each(['exit', 'exit out of this', 'close', 'close the pop-up', 'Close the popup.', 'dismiss it', 'get rid of this', 'go away', 'cancel', 'x', 'no thanks', 'close the dialog', 'close that'])(
    '"%s" is one',
    (words) => {
      expect(isDismissPhrase(words)).toBe(true)
    },
  )

  it.each(['close the tab', 'exit the page now', 'cancel my order', 'xbox', 'open x.com', 'thanks'])('"%s" is not', (words) => {
    expect(isDismissPhrase(words)).toBe(false)
  })
})

describe('closing an open dialog', () => {
  it('clicks the dialog-layer control labelled close — never a link, which would navigate', () => {
    expect(dismissCommand('exit out of this', SHEET)).toEqual({ verb: 'click', target: 9, slot: null, dismiss: true })
  })

  it.each(['×', '✕', 'Dismiss', 'Not now', 'No thanks', 'cancel'])('finds a close control labelled "%s"', (label) => {
    const page: CommandPage = { ...SHEET, refs: [...SHEET.refs.slice(0, 3), { ref: 9, kind: 'button', label, href: null, inputType: null }] }
    expect(dismissCommand('close', page)).toMatchObject({ verb: 'click', target: 9 })
  })

  it('presses Escape when the dialog has no close control of its own', () => {
    const page: CommandPage = { ...SHEET, dialog: { text: 'Sign in', refs: [7, 8] } }
    expect(dismissCommand('close this', page)).toEqual({ verb: 'press', target: null, slot: null, key: { key: 'Escape' }, times: 1, dismiss: true })
  })

  it('reads nothing when no dialog is open, or the words are no dismiss phrase', () => {
    expect(dismissCommand('exit out of this', CLOSED)).toBeNull()
    expect(dismissCommand('click sign in', SHEET)).toBeNull()
  })
})

describe('a Task stepping aside (#354)', () => {
  it('the dismissal is the dismiss phrase\'s Command, whatever the words: the close control, else Escape, null with no dialog', () => {
    expect(dialogDismissal(SHEET)).toEqual(dismissCommand('close', SHEET))
    const noClose: CommandPage = { ...SHEET, dialog: { text: 'Sign in', refs: [7, 8] } }
    expect(dialogDismissal(noClose)).toEqual({ verb: 'press', target: null, slot: null, key: { key: 'Escape' }, times: 1, dismiss: true })
    expect(dialogDismissal(CLOSED)).toBeNull()
  })

  it('an Obstacle is the dialog\'s text and its controls, the same however its refs are numbered, and another dialog is another Obstacle', () => {
    const renumbered: CommandPage = {
      ...SHEET,
      refs: [
        { ref: 4, kind: 'link', label: 'Cancel', href: 'https://x.com/home', inputType: null },
        { ref: 5, kind: 'button', label: 'Sign in', href: null, inputType: null },
        { ref: 6, kind: 'button', label: 'Close', href: null, inputType: null },
        { ref: 7, kind: 'link', label: 'Elon Musk', href: 'https://x.com/elonmusk', inputType: null },
      ],
      dialog: { text: 'Don’t miss what’s happening. People on X are the first to know.', refs: [4, 5, 6] },
    }
    expect(obstacleOf(renumbered)).toBe(obstacleOf(SHEET))
    const cookies: CommandPage = { ...SHEET, dialog: { text: 'We use cookies', refs: [8, 9] } }
    expect(obstacleOf(cookies)).not.toBe(obstacleOf(SHEET))
    expect(obstacleOf(CLOSED)).toBeNull()
  })
})
