// The store and view records (#181, ADR 0030): what happened to an
// accepted checkpoint after the Run let go of it. The Run Trace already
// records how a checkpoint was graded (#180); these four say whether the
// retained change reached the store, what each view was told about it,
// which renderers heard the signal, and what the store held when the
// Session ended. Pure builders — every one of them takes what main
// already has in hand, so no record can describe a decision main did not
// actually make.

import type { SessionEvidencePayload } from '../session/evidenceIpcChannels'
import { evidenceCountsOf } from '../session/sessionEvidence'
import type { EndedSession, SessionEvidenceAcceptance, SessionEvidenceChange } from '../session/sessionRuntime'
import type { EvidenceRequester, SessionTraceEntry } from './runTrace'

/**
 * One retained evidence change as the store saw it: the counts it left
 * behind, whether the checkpoint merged into an existing Observation, and
 * what it contradicts. An accepted checkpoint that never appears here
 * never reached the store.
 */
export function evidenceAcceptedEntry(acceptance: SessionEvidenceAcceptance): SessionTraceEntry {
  return {
    kind: 'evidence_accepted',
    sessionId: acceptance.sessionId,
    generation: acceptance.generation,
    change: acceptance.change,
    entryId: acceptance.entryId,
    counts: acceptance.counts,
    merged: acceptance.merged,
    contradicted: [...acceptance.contradicted],
  }
}

/**
 * Which Session-bearing renderer a pull came from (#181). Both pages ask
 * on the same channel through the same window, so the overlay's own
 * contents is the only thing that tells them apart — anything else asking
 * through the window is the dashboard.
 */
export function evidenceRequesterOf(senderId: number, overlayId: number | null): EvidenceRequester {
  return overlayId !== null && senderId === overlayId ? 'feed_panel' : 'dashboard'
}

/**
 * One evidence pull as main answered it. A `no_session` answer names no
 * Session and no counts, because there was none to name — that is exactly
 * the answer a renderer renders as an empty panel, and the record has to
 * tell it apart from a live Session holding nothing.
 */
export function evidenceAnsweredEntry(input: {
  requester: EvidenceRequester
  payload: SessionEvidencePayload | null
}): SessionTraceEntry {
  const { requester, payload } = input
  if (payload === null) return { kind: 'evidence_answered', requester, answered: 'no_session' }
  return {
    kind: 'evidence_answered',
    sessionId: payload.sessionId,
    generation: payload.generation,
    requester,
    answered: 'session',
    counts: evidenceCountsOf(payload.snapshot),
  }
}

/**
 * One change signal and the renderers alive to receive it. An empty list
 * is the shape of a correct store beside a view nobody told.
 */
export function evidenceBroadcastEntry(input: {
  change: SessionEvidenceChange
  renderers: readonly EvidenceRequester[]
}): SessionTraceEntry {
  return {
    kind: 'evidence_broadcast',
    sessionId: input.change.sessionId,
    generation: input.change.generation,
    renderers: [...input.renderers],
  }
}

/**
 * What Session Evidence held when the Session ended, and why it ended.
 * The counts come off the ended Session because the store is already
 * cleared by the time anything in main hears about it.
 */
export function sessionEvidenceEndEntry(ended: EndedSession): SessionTraceEntry {
  return {
    kind: 'session_evidence_end',
    sessionId: ended.sessionId,
    generation: ended.generation,
    counts: ended.evidence,
    reason: ended.reason,
  }
}
