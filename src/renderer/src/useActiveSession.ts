import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'

/** Explicit lifecycle projection: boot is absent and Run timestamps never infer Session state. */
export function useActiveSession(): boolean {
  const [active, setActive] = useState(false)
  const identity = useRef<{ sessionId: string; generation: number } | null>(null)

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

  return active
}
