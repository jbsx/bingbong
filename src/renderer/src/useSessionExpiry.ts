import { useCallback, useEffect, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SessionDecisionRequest } from '../../core/session/ipcChannels'

export interface SessionExpiry extends SessionDecisionRequest {
  expiresAt: number
}

export function useSessionExpiry(): {
  expiry: SessionExpiry | null
  extend(): void
  decline(): void
} {
  const [expiry, setExpiry] = useState<SessionExpiry | null>(null)

  useEffect(() => window.bingbong.assistant.onEvent((event: PipelineEvent) => {
    if (
      event.type === 'session_expiring' &&
      event.sessionId !== undefined &&
      event.sessionGeneration !== undefined
    ) {
      setExpiry({
        sessionId: event.sessionId,
        generation: event.sessionGeneration,
        expiresAt: event.expiresAt,
      })
      return
    }
    if (event.type === 'session_extended' || event.type === 'session_ended' || event.type === 'command') {
      setExpiry((current) => current &&
        event.sessionId === current.sessionId &&
        event.sessionGeneration === current.generation
        ? null
        : current)
    }
  }), [])

  const extend = useCallback(() => {
    if (expiry) void window.bingbong.session.extend(expiry)
  }, [expiry])
  const decline = useCallback(() => {
    if (expiry) void window.bingbong.session.decline(expiry)
  }, [expiry])

  return { expiry, extend, decline }
}
