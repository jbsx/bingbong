import { describe, expect, it } from 'vitest'
import type { SessionId } from './sessionIdentity'
import { createEvidenceBrowserViewFold, DEFAULT_EVIDENCE_BROWSER_VIEW } from './evidenceBrowserView'
import type { PipelineEvent } from '../pipeline/events'

// The Session-owned Activity/Evidence view selection (#145): default
// Activity, human selections stick within the Session, and every Session
// boundary — a new Session's start, the live one's end — returns it to
// Activity. Never persisted, never an application preference.

const started = (sessionId: string): PipelineEvent => ({
  type: 'session_started',
  sessionId: sessionId as SessionId,
  sessionGeneration: 0,
  at: 0,
})

const ended = (sessionId: string): PipelineEvent => ({
  type: 'session_ended',
  sessionId: sessionId as SessionId,
  sessionGeneration: 0,
  reason: 'reset',
  at: 1,
})

describe('evidence browser view fold', () => {
  it('defaults to Activity', () => {
    expect(createEvidenceBrowserViewFold().state()).toBe('activity')
    expect(DEFAULT_EVIDENCE_BROWSER_VIEW).toBe('activity')
  })

  it('a human selection sticks — including across runs and unrelated events', () => {
    const fold = createEvidenceBrowserViewFold()
    fold.onEvent(started('session-a'))
    fold.setView('evidence')

    // Run-level events never move the selection: runs come and go inside a
    // Session while the selected view holds.
    fold.onEvent({ type: 'done', turnId: 'turn-1', outcome: 'done', at: 2 })
    fold.onEvent({ type: 'session_expiring', sessionId: 'session-a' as SessionId, sessionGeneration: 0, expiresAt: 3, at: 2 })
    fold.onEvent({ type: 'session_extended', sessionId: 'session-a' as SessionId, sessionGeneration: 0, expiresAt: 4, at: 3 })
    expect(fold.state()).toBe('evidence')

    fold.setView('activity')
    expect(fold.state()).toBe('activity')
  })

  it('every Session boundary returns the default — Activity', () => {
    for (const boundary of [ended('session-a'), started('session-b')]) {
      const fold = createEvidenceBrowserViewFold()
      fold.onEvent(started('session-a'))
      fold.setView('evidence')
      fold.onEvent(boundary)
      expect(fold.state()).toBe('activity')
    }
  })

  it('refuses junk selections without disturbing the held view', () => {
    const fold = createEvidenceBrowserViewFold()
    fold.setView('evidence')
    fold.setView('history' as never)
    fold.setView(undefined as never)
    expect(fold.state()).toBe('evidence')
  })
})
