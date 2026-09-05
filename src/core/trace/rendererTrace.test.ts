import { describe, expect, it } from 'vitest'
import type { SessionEvidencePayload } from '../session/evidenceIpcChannels'
import type { EvidenceViewState } from '../session/evidenceView'
import type { SessionId } from '../session/sessionIdentity'
import {
  evidenceRenderedEvent,
  rendererReportOf,
  RENDERER_FAULT_SITE_PREFIX,
  TRACE_RENDERER_MESSAGE_MAX_CHARS,
  TRACE_RENDERER_STACK_MAX_CHARS,
} from './rendererTrace'

// The renderer's records are the only ones written from the page (#187),
// and the page is the side of the app closest to the user's own words. So
// the tests that matter here are shape tests: what a report may say, and
// what it cannot smuggle in however it is written.

const SESSION = 'session-1' as SessionId

/** One Observation as the wire carries it — text and all. */
const observation = (text: string) => ({ id: 'memory-1', text, sourceKind: 'page', references: [] })

describe('the report main is willing to write', () => {
  it('rebuilds a record from declared fields and drops everything else', () => {
    const smuggled = rendererReportOf({
      kind: 'feed_cleared',
      surface: 'dashboard',
      cause: 'session_ended',
      entries: 12,
      // Everything below is what a renderer must never put on a record:
      // the lines it just wiped, and the evidence it was rendering.
      text: 'what the user said',
      feed: [{ kind: 'command', text: 'book the flight' }],
      observations: [observation('the fare was 412 dollars')],
    })
    expect(smuggled).toEqual({ kind: 'feed_cleared', surface: 'dashboard', cause: 'session_ended', entries: 12 })
    expect(Object.keys(smuggled!).sort()).toEqual(['cause', 'entries', 'kind', 'surface'])
  })

  it('keeps an evidence record to counts, whatever the report says', () => {
    const report = rendererReportOf({
      kind: 'evidence_rendered',
      surface: 'feed_panel',
      answered: 'session',
      received: { observations: 3, candidates: 1, contradictions: 0 },
      rendered: { observations: 0, candidates: 0, contradictions: 0 },
      snapshot: { observations: [observation('the fare was 412 dollars')] },
    })
    expect(report).toEqual({
      kind: 'evidence_rendered',
      surface: 'feed_panel',
      answered: 'session',
      received: { observations: 3, candidates: 1, contradictions: 0 },
      rendered: { observations: 0, candidates: 0, contradictions: 0 },
    })
  })

  it('takes a no_session answer without counts it was never given', () => {
    expect(
      rendererReportOf({
        kind: 'evidence_rendered',
        surface: 'dashboard',
        answered: 'no_session',
        rendered: { observations: 0, candidates: 0, contradictions: 0 },
      }),
    ).toEqual({
      kind: 'evidence_rendered',
      surface: 'dashboard',
      answered: 'no_session',
      rendered: { observations: 0, candidates: 0, contradictions: 0 },
    })
  })

  it('rejects a session answer with no counts beside it', () => {
    expect(
      rendererReportOf({
        kind: 'evidence_rendered',
        surface: 'dashboard',
        answered: 'session',
        rendered: { observations: 0, candidates: 0, contradictions: 0 },
      }),
    ).toBeNull()
  })

  it('takes a fault under a renderer site and cuts its message and stack', () => {
    const report = rendererReportOf({
      kind: 'fault',
      site: 'renderer.dashboard.window.error',
      message: 'x'.repeat(TRACE_RENDERER_MESSAGE_MAX_CHARS + 50),
      stack: 'y'.repeat(TRACE_RENDERER_STACK_MAX_CHARS + 50),
    })
    expect(report).toMatchObject({ kind: 'fault', site: 'renderer.dashboard.window.error' })
    expect((report as { message: string }).message).toHaveLength(TRACE_RENDERER_MESSAGE_MAX_CHARS)
    expect((report as { stack: string }).stack).toHaveLength(TRACE_RENDERER_STACK_MAX_CHARS)
  })

  it('refuses a fault filed under a site the renderer does not own', () => {
    // A page may say a page failed. It may not say the voice pipeline did.
    expect(rendererReportOf({ kind: 'fault', site: 'voice.stt.transcribe', message: 'mic closed' })).toBeNull()
    expect(RENDERER_FAULT_SITE_PREFIX).toBe('renderer.')
  })

  it('records a re-adoption that adopted nothing, and one that did', () => {
    expect(
      rendererReportOf({ kind: 'session_readopt', surface: 'dashboard', source: 'page_load', adopted: false }),
    ).toEqual({ kind: 'session_readopt', surface: 'dashboard', source: 'page_load', adopted: false })
    expect(
      rendererReportOf({
        kind: 'session_readopt',
        surface: 'feed_panel',
        source: 'resend',
        adopted: true,
        adoptedSessionId: SESSION,
        adoptedGeneration: 3,
      }),
    ).toEqual({
      kind: 'session_readopt',
      surface: 'feed_panel',
      source: 'resend',
      adopted: true,
      adoptedSessionId: SESSION,
      adoptedGeneration: 3,
    })
  })

  it('drops a panel record whose mode is not one', () => {
    expect(rendererReportOf({ kind: 'feed_panel', surface: 'dashboard', open: true, mode: 'fullscreen' })).toBeNull()
    expect(rendererReportOf({ kind: 'feed_panel', surface: 'dashboard', open: true, mode: 'docked' })).toEqual({
      kind: 'feed_panel',
      surface: 'dashboard',
      open: true,
      mode: 'docked',
    })
  })

  it('drops a report from a page that does not exist, or of a kind that does not', () => {
    expect(rendererReportOf({ kind: 'feed_cleared', surface: 'settings', cause: 'page_load', entries: 0 })).toBeNull()
    expect(rendererReportOf({ kind: 'feed_cleared', surface: 'dashboard', cause: 'nobody_knows', entries: 0 })).toBeNull()
    expect(rendererReportOf({ kind: 'voice_wake', head: 'wake' })).toBeNull()
    expect(rendererReportOf(null)).toBeNull()
    expect(rendererReportOf('feed_cleared')).toBeNull()
  })
})

describe('the evidence render record', () => {
  const view = (observations: number): EvidenceViewState => ({
    identity: { sessionId: SESSION, generation: 1 },
    observations: Array.from({ length: observations }, (_, i) => observation(`observation ${i}`)) as never,
    candidates: [],
    contradictions: [],
  })

  const answered = (observations: number): SessionEvidencePayload =>
    ({
      sessionId: SESSION,
      generation: 1,
      snapshot: {
        observations: Array.from({ length: observations }, (_, i) => observation(`observation ${i}`)),
        candidates: [],
        contradictions: [],
      },
    }) as never

  it('puts what main answered beside what the view kept', () => {
    expect(evidenceRenderedEvent({ surface: 'feed_panel', payload: answered(3), view: view(3) })).toEqual({
      kind: 'evidence_rendered',
      surface: 'feed_panel',
      answered: 'session',
      received: { observations: 3, candidates: 0, contradictions: 0 },
      rendered: { observations: 3, candidates: 0, contradictions: 0 },
    })
  })

  it('separates a store that lost evidence from a fold that discarded it', () => {
    // Three answered, none kept: the fold threw the answer away (a foreign
    // Session, or a read that crossed a clear) — the store was fine.
    expect(evidenceRenderedEvent({ surface: 'dashboard', payload: answered(3), view: view(0) })).toMatchObject({
      received: { observations: 3 },
      rendered: { observations: 0 },
    })
  })

  it('names a no_session answer as one, rather than as an empty Session', () => {
    expect(evidenceRenderedEvent({ surface: 'dashboard', payload: null, view: view(0) })).toEqual({
      kind: 'evidence_rendered',
      surface: 'dashboard',
      answered: 'no_session',
      rendered: { observations: 0, candidates: 0, contradictions: 0 },
    })
  })
})
