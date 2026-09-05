import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionTraceEntry } from '../../core/trace/runTrace'

// The evidence pull's own record (#181): every pull is answered and every
// answer is recorded — including a pull from a window with no Session
// attached, which is precisely the answer a view renders as an empty
// panel. Electron is stubbed down to the two things the handler touches:
// the invoke registry and the window a sender belongs to.

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const windowOf = new Map<number, object | null>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: {
    fromWebContents: (contents: { id: number }) => windowOf.get(contents.id) ?? null,
  },
}))

const { EVIDENCE_IPC } = await import('../../core/session/evidenceIpcChannels')
const { attachSessionToWindow, registerSessionIpc } = await import('./attachSession')

/** A window stub: only `on` and the two contents the handler compares. */
function fakeWindow(dashboardId: number) {
  const listeners = new Map<string, () => void>()
  return {
    win: {
      webContents: { id: dashboardId, on: () => undefined, isDestroyed: () => false, send: () => undefined },
      on: (event: string, fn: () => void) => listeners.set(event, fn),
      isDestroyed: () => false,
    },
    close: () => listeners.get('closed')?.(),
  }
}

/** A runtime stub holding one Session with the given evidence, or none. */
function fakeRuntime(evidence: { observations: number } | null) {
  return {
    state: () => (evidence === null ? { sessionId: null, generation: 0 } : { sessionId: 'session-1', generation: 2 }),
    evidenceStore: () =>
      evidence === null
        ? null
        : {
          snapshot: () => ({
            observations: Array.from({ length: evidence.observations }, (_, i) => ({ id: `memory-${i + 1}` })),
            candidates: [],
            contradictions: [],
          }),
        },
    on: () => undefined,
  }
}

/** A webContents stub for the overlay page. */
const overlayContents = (id: number) => ({ id, on: () => undefined, isDestroyed: () => false, send: () => undefined })

describe('the evidence pull record', () => {
  let traced: SessionTraceEntry[]

  beforeEach(() => {
    handlers.clear()
    windowOf.clear()
    traced = []
    registerSessionIpc({ trace: (entry) => traced.push(entry()) })
  })

  const pull = (senderId: number): unknown =>
    handlers.get(EVIDENCE_IPC.get)!({ sender: { id: senderId } }, undefined)

  it('records which view asked, the Session answered, and the counts it was given', () => {
    const { win } = fakeWindow(1)
    windowOf.set(1, win)
    windowOf.set(2, win)
    attachSessionToWindow(win as never, fakeRuntime({ observations: 2 }) as never, {
      overlayContents: () => overlayContents(2) as never,
    })

    pull(1)
    pull(2)

    expect(traced).toEqual([
      {
        kind: 'evidence_answered',
        sessionId: 'session-1',
        generation: 2,
        requester: 'dashboard',
        answered: 'session',
        counts: { observations: 2, candidates: 0, contradictions: 0 },
      },
      {
        kind: 'evidence_answered',
        sessionId: 'session-1',
        generation: 2,
        requester: 'feed_panel',
        answered: 'session',
        counts: { observations: 2, candidates: 0, contradictions: 0 },
      },
    ])
  })

  it('records the "no Session" answer of a live window that has none', () => {
    const { win } = fakeWindow(1)
    windowOf.set(1, win)
    attachSessionToWindow(win as never, fakeRuntime(null) as never)

    expect(pull(1)).toBeNull()
    expect(traced).toEqual([{ kind: 'evidence_answered', requester: 'dashboard', answered: 'no_session' }])
  })

  it('still records the answer when the asking window has no Session attached at all', () => {
    const { win, close } = fakeWindow(1)
    windowOf.set(1, win)
    attachSessionToWindow(win as never, fakeRuntime({ observations: 1 }) as never)
    close()

    expect(pull(1)).toBeNull()
    // The most diagnostic pull of all: answered with nothing, and said so.
    expect(traced).toEqual([{ kind: 'evidence_answered', requester: 'dashboard', answered: 'no_session' }])
  })

  it('answers without a trace when nothing is tracing', () => {
    handlers.clear()
    registerSessionIpc()
    const { win } = fakeWindow(1)
    windowOf.set(1, win)
    attachSessionToWindow(win as never, fakeRuntime(null) as never)

    expect(() => pull(1)).not.toThrow()
    expect(traced).toEqual([])
  })
})
