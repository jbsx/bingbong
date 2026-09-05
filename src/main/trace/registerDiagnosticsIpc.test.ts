import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '../../core/session/sessionIdentity'
import type { HostTraceRecord } from '../../core/trace/hostTrace'

// The renderer diagnostics handler (#187): what a page reports, what main
// is willing to write, and what happens with the flag off. Electron is
// stubbed down to the one thing the handler touches — the send registry.

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => {
      handlers.set(channel, handler)
    },
  },
}))

const { DIAGNOSTICS_IPC } = await import('../../core/trace/diagnosticsIpcChannels')
const { createHostTraceWriter, HOST_TRACE_VERSION } = await import('../../core/trace/hostTrace')
const { registerDiagnosticsIpc } = await import('./registerDiagnosticsIpc')

const NOW = 1_700_000_000_000
const SESSION = 'session-1' as SessionId

describe('the renderer diagnostics channel', () => {
  let written: HostTraceRecord[]

  const report = (value: unknown): void => {
    handlers.get(DIAGNOSTICS_IPC.report)!({ sender: { id: 1 } }, value)
  }

  const registerTracing = (activeSessionId: SessionId | null = SESSION): void => {
    registerDiagnosticsIpc({
      hostTrace: createHostTraceWriter({
        sink: { write: (record) => written.push(record) },
        now: () => NOW,
        activeSessionId: () => activeSessionId,
      }),
    })
  }

  beforeEach(() => {
    handlers.clear()
    written = []
  })

  it('writes each reported record to the Host Trace, stamped by main', () => {
    registerTracing()
    report({ kind: 'feed_cleared', surface: 'dashboard', cause: 'session_ended', entries: 7 })
    expect(written).toEqual([
      {
        v: HOST_TRACE_VERSION,
        at: NOW,
        sessionId: SESSION,
        kind: 'feed_cleared',
        surface: 'dashboard',
        cause: 'session_ended',
        entries: 7,
      },
    ])
  })

  it('names the Active Session main knows about, never one the page claimed', () => {
    registerTracing()
    report({
      kind: 'session_readopt',
      surface: 'feed_panel',
      source: 'resend',
      adopted: true,
      adoptedSessionId: 'session-9',
      adoptedGeneration: 2,
    })
    // The two ids disagreeing is exactly the re-adoption bug the record is
    // for, so they must both survive under their own names.
    expect(written[0]).toMatchObject({ sessionId: SESSION, adoptedSessionId: 'session-9', adoptedGeneration: 2 })
  })

  it('records a renderer window error as a fault', () => {
    registerTracing()
    report({
      kind: 'fault',
      site: 'renderer.dashboard.window.error',
      message: 'Cannot read properties of undefined',
      stack: 'at App (index.js:1:1)',
    })
    expect(written).toEqual([
      {
        v: HOST_TRACE_VERSION,
        at: NOW,
        sessionId: SESSION,
        kind: 'fault',
        site: 'renderer.dashboard.window.error',
        message: 'Cannot read properties of undefined',
        stack: 'at App (index.js:1:1)',
      },
    ])
  })

  it('writes the record main rebuilt, not the object the page sent', () => {
    registerTracing()
    report({
      kind: 'feed_panel',
      surface: 'dashboard',
      open: false,
      mode: 'overlay',
      feed: [{ kind: 'display', text: 'the flight leaves at nine' }],
    })
    expect(written[0]).not.toHaveProperty('feed')
    expect(Object.keys(written[0]!).sort()).toEqual(['at', 'kind', 'mode', 'open', 'sessionId', 'surface', 'v'])
  })

  it('drops a report it cannot rebuild, and never throws at the page', () => {
    registerTracing()
    expect(() => report({ kind: 'feed_cleared', surface: 'dashboard', cause: 'because' })).not.toThrow()
    expect(() => report(undefined)).not.toThrow()
    expect(() => report({ kind: 'fault', site: 'voice.stt.transcribe', message: 'mic closed' })).not.toThrow()
    expect(written).toEqual([])
  })

  it('records with no Session live, explicitly rather than by omission', () => {
    registerTracing(null)
    report({ kind: 'session_readopt', surface: 'dashboard', source: 'page_load', adopted: false })
    expect(written[0]).toMatchObject({ sessionId: null, adopted: false })
  })

  it('drops every report when the Host Trace is off', () => {
    // The preload always exposes the call, so the handler is always
    // registered; with no writer there is simply nothing behind it.
    registerDiagnosticsIpc({ hostTrace: null })
    expect(handlers.has(DIAGNOSTICS_IPC.report)).toBe(true)
    expect(() => report({ kind: 'feed_cleared', surface: 'dashboard', cause: 'page_load', entries: 0 })).not.toThrow()
    expect(written).toEqual([])
  })
})
