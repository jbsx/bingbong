import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SessionAdoptionPayload } from '../../core/session/ipcChannels'
import { useSessionAdoption } from './useSessionAdoption'

/** Explicit lifecycle projection: boot is absent and Run timestamps never infer Session state. */
export function useActiveSession(): boolean {
  const [active, setActive] = useState(false)
  const identity = useRef<SessionAdoptionPayload | null>(null)

  useEffect(() => window.bingbong.assistant.onEvent((event: PipelineEvent) => {
    const current = identity.current
    if (event.type === 'session_started') {
      if (current && (current.sessionId !== event.sessionId || current.generation !== event.sessionGeneration)) return
      identity.current = { sessionId: event.sessionId, generation: event.sessionGeneration }
      setActive(true)
    } else if (
      event.type === 'session_ended' &&
      current !== null &&
      event.sessionId === current.sessionId &&
      event.sessionGeneration === current.generation
    ) {
      identity.current = null
      setActive(false)
    }
  }), [])

  // Re-adoption (ADR 0017): a reloaded dashboard knows its Session is
  // active, so the idle screen never takes a live Session's dashboard.
  useSessionAdoption((adopted) => {
    identity.current = { sessionId: adopted.sessionId, generation: adopted.generation }
    setActive(true)
  })

  return active
}
