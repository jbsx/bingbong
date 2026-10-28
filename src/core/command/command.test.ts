import { describe, expect, it } from 'vitest'
import type { PageSnapshot, SnapshotRef } from '../browser/snapshot'
import { commandKeepsIdle, commandPageOf, isMounting, sameCommand, type Command, type CommandPage, type CommandVerb } from './command'

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
  viewportText: ['Clear', 'Gurugram, India'],
  refs: [ref(1, 'Home', 'page'), ref(2, 'Close', 'dialog'), ref(3, 'Sign in', 'dialog')],
} as unknown as PageSnapshot

describe('commandPageOf', () => {
  it('carries the dialog flag, its text and the refs in the dialog layer', () => {
    expect(commandPageOf(SNAPSHOT).dialog).toEqual({ text: 'Sign in to X', refs: [2, 3] })
  })

  it('carries no dialog when none is open', () => {
    expect(commandPageOf({ ...SNAPSHOT, dialogOpen: false, dialogText: '' }).dialog).toBeUndefined()
  })

  it('keeps the text in view (#390), so the Verdict can see what the page shows', () => {
    expect(commandPageOf(SNAPSHOT).viewportText).toEqual(['Clear', 'Gurugram, India'])
  })

  it("carries a media ref's own facts (#372), and none for a ref that has none", () => {
    const media = { paused: false, ended: false, currentTime: 16, duration: 111, volume: 1, muted: false, loop: true, rate: 1, seekable: { start: 0, end: 111 }, tracks: 0, captions: null, hiddenTrack: false, buffering: false, failed: false }
    const page = commandPageOf({ ...SNAPSHOT, refs: [{ ...ref(1, 'Highs and Lows', 'page'), kind: 'media', media }, ref(2, 'Home', 'page')] } as unknown as PageSnapshot)
    expect(page.refs[0]).toMatchObject({ kind: 'media', media })
    expect(page.refs[1]).not.toHaveProperty('media')
  })
})

describe('isMounting (post mortem 2026-10-19 23:26)', () => {
  const page = (refs: number, dialog?: CommandPage['dialog']): CommandPage => ({
    url: 'https://truthsocial.com/@realDonaldTrump',
    title: 'Truth Social',
    refs: Array.from({ length: refs }, (_, i) => ({ ref: i + 1, kind: 'link', label: `Link ${i + 1}`, href: null, inputType: null })),
    ...(dialog !== undefined ? { dialog } : {}),
  })

  it('a page with at most one ref is still mounting', () => {
    expect(isMounting(page(0))).toBe(true)
    expect(isMounting(page(1))).toBe(true)
    expect(isMounting(page(2))).toBe(false)
  })

  it('a dialog with no text and no controls is a loading signal, not an Obstacle', () => {
    expect(isMounting(page(5, { text: ' ', refs: [] }))).toBe(true)
    expect(isMounting(page(5, { text: '', refs: [1] }))).toBe(false)
    expect(isMounting(page(5, { text: 'Sign up to see more', refs: [] }))).toBe(false)
  })
})

describe('commandKeepsIdle on a blank pane (#361)', () => {
  const command = (verb: CommandVerb): Command => ({ verb, target: null, slot: null })

  it('keeps the Idle Screen up for every Command but one that opens a page', () => {
    for (const verb of ['scroll_down', 'read', 'click', 'back', 'reload', 'press', 'screenshot', 'help'] as const) expect(commandKeepsIdle(command(verb), false)).toBe(true)
    for (const verb of ['navigate', 'search', 'resume'] as const) expect(commandKeepsIdle(command(verb), false)).toBe(false)
  })

  it('wakes for a `play` Jev read as a video, blank pane or not (#502): it opens the watch page to be watched', () => {
    const video: Command = { verb: 'play', target: null, slot: 'mkbhd', music: { kind: 'search', place: 'now', video: true } }
    expect(commandKeepsIdle(video, false)).toBe(false)
    expect(commandKeepsIdle(video, true)).toBe(false)
    expect(commandKeepsIdle({ ...video, music: { kind: 'search', place: 'now' } }, true)).toBe(true)
  })

  it('wakes for a pane Command with a page in the pane, as before', () => {
    expect(commandKeepsIdle(command('scroll_down'), true)).toBe(false)
    expect(commandKeepsIdle(command('timer'), true)).toBe(true)
  })

  it('keeps it for the app op that brings the Idle Screen back (#458), and wakes for every other view', () => {
    expect(commandKeepsIdle({ verb: 'app', target: null, slot: null, app: { kind: 'view', view: 'idle' } }, true)).toBe(true)
    expect(commandKeepsIdle({ verb: 'app', target: null, slot: null, app: { kind: 'view', view: 'dashboard' } }, true)).toBe(false)
  })
})

describe('sameCommand (#494)', () => {
  const back: Command = { verb: 'back', target: null, slot: null }
  it('is the same Command whatever order its fields were read in', () => {
    const a = { verb: 'media', target: 3, slot: null, mediaOp: { op: 'volume', level: 0.5 } } as unknown as Command
    const b = { mediaOp: { level: 0.5, op: 'volume' }, slot: null, target: 3, verb: 'media' } as unknown as Command
    expect(sameCommand(a, b)).toBe(true)
    expect(sameCommand(back, { ...back })).toBe(true)
  })
  it('differs on any field: the verb, the target, the Slot, an op', () => {
    expect(sameCommand(back, { verb: 'forward', target: null, slot: null })).toBe(false)
    expect(sameCommand({ verb: 'click', target: 3, slot: null }, { verb: 'click', target: 4, slot: null })).toBe(false)
    expect(sameCommand({ verb: 'search', target: null, slot: 'hurt' }, { verb: 'search', target: null, slot: 'hurt by johnny cash' })).toBe(false)
    expect(sameCommand({ verb: 'timer', target: null, slot: null, durationMs: 60_000 }, { verb: 'timer', target: null, slot: null })).toBe(false)
  })
})
