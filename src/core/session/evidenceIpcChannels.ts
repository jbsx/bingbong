import type { SessionEvidenceChange } from './sessionRuntime'
import type { SessionEvidenceSnapshot } from './sessionEvidence'

// The Evidence Browser's session-scoped IPC (#139): one pull channel and
// one change notification, both Session-stamped. Notifications carry
// identity only — a notified renderer responds by reading the complete
// authoritative snapshot, so the visible record can never diverge from
// what the Session runtime actually holds (and duplicate merges can never
// double-render).

export const EVIDENCE_IPC = {
  /** Either renderer → main: the live Session's Evidence snapshot (identity + generation + snapshot), or null with no Session. */
  get: 'session-evidence:get',
  /** Main → both Session-bearing renderers: an accepted Observation changed the evidence — re-read it. */
  changed: 'session-evidence:changed',
} as const

export type SessionEvidenceChangePayload = SessionEvidenceChange

export interface SessionEvidencePayload extends SessionEvidenceChange {
  readonly snapshot: SessionEvidenceSnapshot
}

export function isSessionEvidenceChangePayload(value: unknown): value is SessionEvidenceChangePayload {
  if (typeof value !== 'object' || value === null) return false
  const change = value as Record<string, unknown>
  return typeof change.sessionId === 'string' && change.sessionId !== '' && Number.isInteger(change.generation)
}

export function isSessionEvidencePayload(value: unknown): value is SessionEvidencePayload {
  if (!isSessionEvidenceChangePayload(value)) return false
  const snapshot = (value as { snapshot?: unknown }).snapshot
  if (typeof snapshot !== 'object' || snapshot === null) return false
  const { observations, candidates, contradictions } = snapshot as Record<string, unknown>
  return Array.isArray(observations) && Array.isArray(candidates) && Array.isArray(contradictions)
}
