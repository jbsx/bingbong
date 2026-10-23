import { describe, expect, it } from 'vitest'
import type { CommandPage } from './command'
import { dialogControls, dialogDismissal, dismissCommand, dismissalLadder, isDismissPhrase, obstacleOf, ruledDismissal } from './dismissDialog'

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

describe('the Dismissal Ladder (owner\'s rule 2026-10-19: the widest net)', () => {
  const ESCAPE = { verb: 'press', target: null, slot: null, key: { key: 'Escape' }, times: 1, dismiss: true }
  const click = (target: number) => ({ verb: 'click', target, slot: null, dismiss: true })
  /** Truth Social's TCF banner, 2026-10-19: the close is "Close this consent banner", beside Accept All and Reject Non-Essential. */
  const BANNER: CommandPage = {
    url: 'https://truthsocial.com/@realDonaldTrump',
    title: 'Truth Social',
    refs: [
      { ref: 1, kind: 'button', label: 'Close this consent banner Close this consent banner', href: null, inputType: null },
      { ref: 2, kind: 'link', label: 'Privacy Policy', href: 'https://help.truthsocial.com/legal/privacy-policy', inputType: null },
      { ref: 5, kind: 'input', label: 'Storage', href: null, inputType: 'checkbox' },
      { ref: 9, kind: 'button', label: 'Save', href: null, inputType: null },
      { ref: 10, kind: 'button', label: 'Accept All', href: null, inputType: null },
      { ref: 11, kind: 'button', label: 'Reject Non-Essential', href: null, inputType: null },
      { ref: 12, kind: 'link', label: 'Home', href: 'https://truthsocial.com/', inputType: null },
    ],
    dialog: { text: 'We and our 1 IAB TCF partners store and access information on your device', refs: [1, 2, 5, 9, 10, 11] },
  }

  it('a consent wall: the reject-style control first, then the close by its label, then Escape — never Accept All, never a link or a field', () => {
    expect(dismissalLadder(BANNER)).toEqual([click(11), click(1), ESCAPE])
    expect(dialogDismissal(BANNER)).toEqual(click(11))
  })

  it('a close is known by how its label begins, wherever it goes on from there: "Close this consent banner" is a close', () => {
    const notice: CommandPage = { ...BANNER, refs: BANNER.refs.filter((ref) => ref.ref === 1 || ref.ref === 2), dialog: { text: 'Welcome', refs: [1, 2] } }
    expect(dismissalLadder(notice)).toEqual([click(1), ESCAPE])
  })

  it.each(['Skip for now', 'No, thanks', 'Maybe later', 'Continue without an account', 'Not interested', 'Keep reading', 'X'])('"%s" is a close', (label) => {
    const page: CommandPage = { ...SHEET, refs: [...SHEET.refs.slice(0, 3), { ref: 9, kind: 'button', label, href: null, inputType: null }] }
    expect(dialogDismissal(page)).toEqual(click(9))
  })

  it('the controls a dismissal may click: the dialog layer\'s buttons that are no way through — never a link, a field, sign in, subscribe or accept', () => {
    const sheet: CommandPage = {
      ...SHEET,
      refs: [
        ...SHEET.refs,
        { ref: 10, kind: 'button', label: 'Subscribe', href: null, inputType: null },
        { ref: 11, kind: 'button', label: 'Create account', href: null, inputType: null },
        { ref: 12, kind: 'button', label: 'Nah', href: null, inputType: null },
        { ref: 13, kind: 'input', label: 'Email', href: null, inputType: 'email' },
      ],
      dialog: { text: 'Join', refs: [7, 8, 10, 11, 12, 13] },
    }
    expect(dialogControls(sheet).map((ref) => ref.ref)).toEqual([12])
    expect(dialogControls(BANNER).map((ref) => ref.ref)).toEqual([1, 9, 11])
  })

  it('Jev\'s sure choice comes before the label rung, its unsure one after, and Escape chosen sure comes first of all but the consent policy', () => {
    const sheet: CommandPage = { ...SHEET, refs: [...SHEET.refs, { ref: 12, kind: 'button', label: 'Nah', href: null, inputType: null }], dialog: { text: 'Join', refs: [7, 8, 9, 12] } }
    expect(dismissalLadder(sheet, { choice: { ref: 12 }, probability: 0.9 })).toEqual([click(12), click(9), ESCAPE])
    expect(dismissalLadder(sheet, { choice: { ref: 12 }, probability: 0.4 })).toEqual([click(9), click(12), ESCAPE])
    expect(dismissalLadder(sheet, { choice: 'escape', probability: 0.9 })).toEqual([ESCAPE, click(9)])
    expect(dismissalLadder(BANNER, { choice: { ref: 1 }, probability: 0.9 })).toEqual([click(11), click(1), ESCAPE])
  })

  it('Jev\'s choice of a way through, a link or a ref outside the dialog is not a rung: the guards hold whoever chose', () => {
    expect(dismissalLadder(SHEET, { choice: { ref: 8 }, probability: 0.95 })).toEqual([click(9), ESCAPE])
    expect(dismissalLadder(SHEET, { choice: { ref: 7 }, probability: 0.95 })).toEqual([click(9), ESCAPE])
    expect(dismissalLadder(SHEET, { choice: { ref: 1 }, probability: 0.95 })).toEqual([click(9), ESCAPE])
    expect(dismissalLadder(BANNER, { choice: { ref: 10 }, probability: 0.95 })).toEqual([click(11), click(1), ESCAPE])
  })

  it('a way through the label refuses is a way out: "Don\'t allow" and "Do not install" are offered, "No account? Sign up" is not', () => {
    const sheet: CommandPage = {
      ...SHEET,
      refs: [
        ...SHEET.refs,
        { ref: 20, kind: 'button', label: 'Don’t allow', href: null, inputType: null },
        { ref: 21, kind: 'button', label: 'Do not install', href: null, inputType: null },
        { ref: 22, kind: 'button', label: 'No account? Sign up', href: null, inputType: null },
        { ref: 23, kind: 'button', label: 'Allow', href: null, inputType: null },
      ],
      dialog: { text: 'Notifications', refs: [20, 21, 22, 23] },
    }
    expect(dialogControls(sheet).map((ref) => ref.ref)).toEqual([20, 21])
  })

  it('a consent wall whose reject the rule cannot read: a reject Jev is sure of goes before the accept, privacy first', () => {
    const wall: CommandPage = {
      ...BANNER,
      refs: [
        { ref: 20, kind: 'button', label: 'Accept all', href: null, inputType: null },
        { ref: 21, kind: 'button', label: 'I’d rather not', href: null, inputType: null },
      ],
      dialog: { text: 'We use cookies', refs: [20, 21] },
    }
    expect(dismissalLadder(wall)).toEqual([click(20), ESCAPE])
    expect(dismissalLadder(wall, { choice: { ref: 21 }, probability: 0.9 })).toEqual([click(21), click(20), ESCAPE])
    // The policy settles only a reject it reads; anything else is Jev's to choose.
    expect(ruledDismissal(wall)).toBeNull()
    expect(ruledDismissal(BANNER)).toEqual(click(11))
    expect(ruledDismissal(SHEET)).toBeNull()
  })

  it('each rung once: Jev choosing the labelled close leaves one click of it', () => {
    expect(dismissalLadder(SHEET, { choice: { ref: 9 }, probability: 0.9 })).toEqual([click(9), ESCAPE])
    expect(dismissalLadder(CLOSED)).toEqual([])
  })
})
