import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineEvent, PipelineStatus, SubagentCard } from '../../core/pipeline/events'
import type { VoiceHeardEvent } from '../../core/voice/ipcChannels'
import type { FeedEntry } from '../../core/history/feedProjection'
import { useFeedProjection } from './useFeedProjection'
import { createRunProgressTracker, type RunProgress } from '../../core/pipeline/runProgress'

export type OrbStatus = 'idle' | 'listening' | 'transcribing' | PipelineStatus

export interface PendingConfirmation {
  confirmationId: string
  prompt: string
  /** Wall-clock auto-deny deadline — the card counts down to it. */
  expiresAt: number | null
}

export interface PendingAsk {
  askId: string
  question: string
  /** Wall-clock deadline — the card counts down to it. */
  expiresAt: number | null
}

export interface Assistant {
  status: OrbStatus
  /**
   * The right-edge activity feed (#44): timestamped outcome lines plus
   * ephemeral detail (retries), folded from the event stream by the pure
    * feed projection. Session-scoped boundaries wipe eagerly; every launch
    * starts with an empty projection and Recorded History is review-only.
   */
  feed: FeedEntry[]
  /** The run currently in flight (#55) — its expander auto-opens. */
  liveRunId: string | null
  pendingConfirmation: PendingConfirmation | null
  /** An open ask_user question awaiting a spoken or typed free-text answer. */
  pendingAsk: PendingAsk | null
  /** Live subagent cards, newest last; history persists after tabs close. */
  agents: SubagentCard[]
  /**
   * The active run's progress (#43): stage + elapsed anchor + detail
   * signals, folded from the event stream. The hint ticks elapsed in the
   * renderer — no per-second IPC.
   */
  progress: RunProgress | null
  submit(text: string): void
  resolveConfirmation(confirmationId: string, approved: boolean): void
  resolveAsk(askId: string, answer: string): void
  abort(): void
  /** A heard-but-not-a-command line (voice yes/no, undecided answers). */
  appendVoiceHeard(heard: VoiceHeardEvent): void
  /** Mic/engine failures from the voice half. */
  appendVoiceError(message: string, at?: number): void
}

/** Cards kept in history after their tab closes — bounded for long sessions. */
const MAX_AGENT_CARDS = 20

export function useAssistant(): Assistant {
  const [status, setStatus] = useState<OrbStatus>('idle')
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null)
  const [agents, setAgents] = useState<SubagentCard[]>([])
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const lastStatus = useRef<OrbStatus>('idle')
  const progressTracker = useRef(createRunProgressTracker())
  // The feed's projection wiring (#44) is shared with the panel's overlay
  // page (#45): same events in, same entries out.
  const feedProjection = useFeedProjection()
  const feed = feedProjection.feed
  const liveRunId = feedProjection.liveRunId

  useEffect(() => {
    return window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      feedProjection.handleEvent(event)
      progressTracker.current.onEvent(event)
      setProgress(progressTracker.current.current())
      switch (event.type) {
        case 'command':
          return
        case 'status':
          lastStatus.current = event.status
          setStatus(event.status)
          return
        case 'tool_call':
        case 'tool_result':
        case 'display':
        case 'speak':
        case 'error':
        case 'llm_retry':
        case 'waiting_on_agents':
          return
        case 'confirmation_requested':
          setPendingConfirmation({
            confirmationId: event.confirmationId,
            prompt: event.prompt,
            expiresAt: event.expiresAt,
          })
          return
        case 'confirmation_resolved':
          setPendingConfirmation((current) =>
            current?.confirmationId === event.confirmationId ? null : current,
          )
          return
        case 'confirmation_deadline':
          setPendingConfirmation((current) =>
            current?.confirmationId === event.confirmationId
              ? { ...current, expiresAt: event.expiresAt }
              : current,
          )
          return
        case 'ask_requested':
          setPendingAsk({
            askId: event.askId,
            question: event.question,
            expiresAt: event.expiresAt,
          })
          return
        case 'ask_resolved':
          setPendingAsk((current) => (current?.askId === event.askId ? null : current))
          return
        case 'ask_deadline':
          setPendingAsk((current) =>
            current?.askId === event.askId ? { ...current, expiresAt: event.expiresAt } : current,
          )
          return
        case 'agent_update':
          setAgents((current) => {
            const index = current.findIndex((card) => card.id === event.agent.id)
            if (index === -1) return [...current, event.agent].slice(-MAX_AGENT_CARDS)
            const next = [...current]
            next[index] = event.agent
            return next
          })
          return
        case 'done':
          if (lastStatus.current !== 'cancelled') setStatus('idle')
          setPendingConfirmation(null)
          setPendingAsk(null)
          return
        case 'session_started':
          // Session-scoped feed (ADR 0005): the projection already wiped
          // on the event itself — eagerly, whether the lapse timer, a
          // lapsed command, or a model reset fired it.
          return
      }
    })
  }, [])

  const submit = useCallback(
    (text: string) => {
      void window.bingbong.assistant.submit(text)
    },
    [],
  )

  const resolveConfirmation = useCallback((confirmationId: string, approved: boolean) => {
    setPendingConfirmation(null)
    void window.bingbong.assistant.resolveConfirmation(confirmationId, approved)
  }, [])

  const resolveAsk = useCallback((askId: string, answer: string) => {
    const trimmed = answer.trim()
    if (trimmed === '') return
    setPendingAsk(null)
    void window.bingbong.assistant.resolveAsk(askId, trimmed)
  }, [])

  const abort = useCallback(() => {
    void window.bingbong.assistant.abort()
  }, [])

  const appendVoiceHeard = useCallback(
    (heard: VoiceHeardEvent) => {
      feedProjection.appendHeard(heard)
    },
    [feedProjection],
  )

  const appendVoiceError = useCallback(
    (message: string, at?: number) => {
      feedProjection.appendVoiceError(message, at)
    },
    [feedProjection],
  )

  return { status, feed, liveRunId, pendingConfirmation, pendingAsk, agents, progress, submit, resolveConfirmation, resolveAsk, abort, appendVoiceHeard, appendVoiceError }
}
