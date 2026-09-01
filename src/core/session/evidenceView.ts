import type { SessionGeneration, SessionId } from './sessionIdentity'
import type {
  ObservationContradiction,
  SessionCandidate,
  SessionObservation,
} from './sessionEvidence'
import type { SessionEvidenceChangePayload, SessionEvidencePayload } from './evidenceIpcChannels'

// The Evidence Browser's view model (#139): a pure fold over the Session
// boundary, the same shape as the feed projection. Two laws hold
// everywhere: the visible record is always the complete snapshot read
// from main (never a patch assembled from notifications), and any
// response or notification of a foreign Session identity or generation is
// discarded — Session Evidence never crosses its Session's end, so a
// renderer may only ever show the live Session's own Observations.

export interface EvidenceViewIdentity {
  readonly sessionId: SessionId
  readonly generation: SessionGeneration
}

export interface EvidenceViewState {
  /** The live Session this view holds evidence for; null with no Session. */
  readonly identity: EvidenceViewIdentity | null
  readonly observations: readonly SessionObservation[]
  readonly candidates: readonly SessionCandidate[]
  /** The snapshot's retained contradictions (#143) — grouping and Answer warnings derive from them. */
  readonly contradictions: readonly ObservationContradiction[]
}

const EMPTY_STATE: EvidenceViewState = Object.freeze({
  identity: null,
  observations: Object.freeze([]),
  candidates: Object.freeze([]),
  contradictions: Object.freeze([]),
})

export function createEvidenceView(): {
  /**
   * A session_started (ADR 0005's rule, mirrored): a start only opens an
   * unheld view — it never wipes, and a foreign or stale start never
   * rewinds one. Clearing is a matching session_ended's alone.
   */
  onSessionStarted(identity: EvidenceViewIdentity): void
  /**
   * A re-adoption pull's answer (ADR 0017): main's authoritative word on
   * the live Session right now, so a different identity replaces the held
   * one — its stale evidence drops with it.
   */
  onAdopted(identity: EvidenceViewIdentity): void
  /** A session_ended: only the view's own Session clears it. */
  onSessionEnded(identity: EvidenceViewIdentity): void
  /** Whether a change notification warrants a fresh authoritative read. */
  shouldRead(change: SessionEvidenceChangePayload): boolean
  /**
   * Stamps a read at issue time — pass the stamp to `applyResponse`, which
   * discards any response whose read predates the last clear.
   */
  beginRead(): number
  /** Applies — or discards — an authoritative read's response. */
  applyResponse(payload: SessionEvidencePayload | null, readStamp?: number): void
  state(): EvidenceViewState
} {
  let state: EvidenceViewState = EMPTY_STATE
  // Bumped by every clear: a response to a read issued before the last
  // clear is stale — applying it would resurrect an ended Session's
  // Observations, the one race the identity rules cannot see (the view
  // holds no identity to compare against right after a clear).
  let clearedAt = 0

  return {
    onSessionStarted(identity) {
      const current = state.identity
      // Stale replay of an ended generation, or a foreign Session's
      // start: never opens, never rewinds.
      if (current !== null && (current.sessionId !== identity.sessionId || identity.generation <= current.generation)) return
      // A start never wipes (ADR 0005): an unheld view opens empty, and a
      // newer generation of the same Session keeps its applied snapshot.
      state = current === null ? { ...EMPTY_STATE, identity } : { ...state, identity }
    },
    onAdopted(identity) {
      const current = state.identity
      if (current !== null && current.sessionId === identity.sessionId && current.generation >= identity.generation) return
      state = { ...EMPTY_STATE, identity }
      clearedAt += 1
    },
    onSessionEnded(identity) {
      const current = state.identity
      if (current === null || current.sessionId !== identity.sessionId || current.generation !== identity.generation) return
      state = EMPTY_STATE
      clearedAt += 1
    },
    shouldRead(change) {
      const current = state.identity
      // With no Session known, a notification may prove one went live.
      if (current === null) return true
      return current.sessionId === change.sessionId && current.generation === change.generation
    },
    beginRead: () => clearedAt,
    applyResponse(payload, readStamp = clearedAt) {
      // A read that crossed a clear is dead, whatever it carries.
      if (readStamp < clearedAt) return
      // Null is the definitive no-Session answer — main had none at read
      // time, whatever the renderer believed.
      if (payload === null) {
        state = EMPTY_STATE
        clearedAt += 1
        return
      }
      const current = state.identity
      if (current !== null && (current.sessionId !== payload.sessionId || current.generation !== payload.generation)) {
        // A foreign Session's response is discarded whole.
        return
      }
      state = {
        identity: { sessionId: payload.sessionId, generation: payload.generation },
        observations: payload.snapshot.observations,
        candidates: payload.snapshot.candidates,
        contradictions: payload.snapshot.contradictions,
      }
    },
    state: () => state,
  }
}
