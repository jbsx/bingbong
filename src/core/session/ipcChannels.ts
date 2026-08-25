import type { SessionDecision } from './sessionRuntime'
import type { SessionGeneration, SessionId } from './sessionIdentity'

export const SESSION_IPC = {
  extend: 'session:extend',
  decline: 'session:decline',
  /** Renderer → main: the current Session identity — a reloaded page re-adopts the live Session (ADR 0017). */
  current: 'session:current',
  /** Main → renderer: re-send of the live Session identity on a late page load (ADR 0017). */
  readopt: 'session:readopt',
} as const

export type SessionDecisionRequest = SessionDecision

/**
 * The re-adoption payload (ADR 0017): identity only, never entries —
 * recovery is forward-only, so the fresh projection renders the
 * still-live Session's subsequent events and nothing else.
 */
export interface SessionAdoptionPayload {
  sessionId: SessionId
  generation: SessionGeneration
}
