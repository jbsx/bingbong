import type { SessionEvidenceChange } from './sessionRuntime'
import type { SessionEvidenceSnapshot } from './sessionEvidence'
import { isEvidenceBrowserView, type EvidenceBrowserView } from './evidenceBrowserView'

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

// The selected Activity/Evidence view (#145): Session-owned ephemeral state
// folded in main, never persisted — the pull restores it across docking,
// reload, and renderer crash within the Session, and Session boundaries
// return it to Activity.

export const EVIDENCE_VIEW_IPC = {
  /** Either renderer → main: the Session-owned selected view. */
  get: 'session-evidence-view:get',
  /** The overlay → main: select a view (the panel's tab controls). */
  set: 'session-evidence-view:set',
  /** Main → both Session-bearing renderers: the selected view changed. */
  changed: 'session-evidence-view:changed',
} as const

export interface EvidenceBrowserViewPayload {
  readonly view: EvidenceBrowserView
}

export function isEvidenceBrowserViewPayload(value: unknown): value is EvidenceBrowserViewPayload {
  if (typeof value !== 'object' || value === null) return false
  return isEvidenceBrowserView((value as { view?: unknown }).view)
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
