import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import {
  isSessionEvidenceChangePayload,
  isSessionEvidencePayload,
} from '../../core/session/evidenceIpcChannels'
import { createEvidenceView, type EvidenceViewState } from '../../core/session/evidenceView'
import { useSessionAdoption } from './useSessionAdoption'
import { reportEvidenceRendered, reportRendererFault } from './diagnostics'

// The Evidence Browser's renderer wiring (#139), shared by both
// Session-bearing pages: the dashboard keeps the live count honest and
// the feed panel overlay renders the view. Every visible state comes from
// one authoritative read (`evidence.get`); notifications only prompt that
// read, and the view fold discards anything of a foreign Session.

export function useSessionEvidence(): EvidenceViewState {
  const [state, setState] = useState<EvidenceViewState>(() => ({
    identity: null,
    observations: [],
    candidates: [],
    contradictions: [],
  }))
  const view = useRef(createEvidenceView())
  // One sync point, like the feed projection: mutators close over stable
  // things only, so the first-render closures subscribers capture stay live.
  const sync = (): void => setState(view.current.state())
  const read = (): void => {
    // Stamp the read at issue time: a response landing after a Session
    // boundary crossed the view's clear and is discarded there.
    const stamp = view.current.beginRead()
    void window.bingbong.evidence
      .get()
      .then((payload) => {
        const answer = isSessionEvidencePayload(payload) ? payload : null
        view.current.applyResponse(answer, stamp)
        sync()
        // The renderer half of #181's record: main says what it answered
        // with, this says what survived the fold. A correct store beside
        // an empty panel is the gap between the two counts.
        reportEvidenceRendered(answer, view.current.state())
      })
      .catch((error: unknown) => reportRendererFault('evidence.read', error))
  }

  useEffect(() => {
    // The mount pull is renderer recovery (#139): a reloaded or recovered
    // page restores the current Session's Observation snapshot.
    read()
    const unsubChanged = window.bingbong.evidence.onChanged((change) => {
      if (isSessionEvidenceChangePayload(change) && view.current.shouldRead(change)) read()
    })
    const unsubEvents = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      if (event.type === 'session_started') {
        view.current.onSessionStarted({ sessionId: event.sessionId, generation: event.sessionGeneration })
      } else if (event.type === 'session_ended') {
        view.current.onSessionEnded({ sessionId: event.sessionId, generation: event.sessionGeneration })
      } else {
        return
      }
      sync()
    })
    return () => {
      unsubChanged()
      unsubEvents()
    }
    // The view object's identity is ref-backed — subscribing once is correct.
  }, [])

  // Re-adoption (ADR 0017): a reloaded page's adoption answer re-hydrates
  // the evidence of the still-live Session.
  useSessionAdoption((identity) => {
    view.current.onAdopted(identity)
    sync()
    read()
  })

  return state
}
