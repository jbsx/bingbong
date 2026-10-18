import { describe, expect, it } from 'vitest'
import type { PageSnapshot, SnapshotRef } from '../browser/snapshot'
import { commandPageOf } from './command'

// The page a Command is read against (#324): its address, title and refs —
// and, with a dialog open, the dialog (#336).

function ref(n: number, label: string, layer: 'dialog' | 'page'): SnapshotRef {
  return {
    ref: n,
    kind: 'button',
    label,
    inputType: null,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    src: null,
    href: null,
    downloadsFile: false,
    submitsForm: false,
    credentialField: false,
    paymentField: false,
    inForm: false,
    formHasCredential: false,
    formHasPayment: false,
    searchField: false,
    formHasSearch: false,
    layer,
  }
}

const SNAPSHOT = {
  url: 'https://x.com/',
  title: 'X',
  dialogOpen: true,
  dialogText: 'Sign in to X',
  viewportText: '',
  refs: [ref(1, 'Home', 'page'), ref(2, 'Close', 'dialog'), ref(3, 'Sign in', 'dialog')],
} as unknown as PageSnapshot

describe('commandPageOf', () => {
  it('carries the dialog flag, its text and the refs in the dialog layer', () => {
    expect(commandPageOf(SNAPSHOT).dialog).toEqual({ text: 'Sign in to X', refs: [2, 3] })
  })

  it('carries no dialog when none is open', () => {
    expect(commandPageOf({ ...SNAPSHOT, dialogOpen: false, dialogText: '' }).dialog).toBeUndefined()
  })
})
