import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineEvent, PipelineStatus, SubagentCard } from '../../core/pipeline/events'
import type { VoiceHeardEvent } from '../../core/voice/ipcChannels'
import { describeHeard } from '../../core/voice/heardDisplay'
import type { TranscriptEvent } from '../../core/history/historyStore'
import { projectPipelineEvent } from '../../core/history/transcriptProjection'

export type OrbStatus = 'idle' | 'listening' | PipelineStatus

export interface TranscriptEntry extends TranscriptEvent {
  id: number
}

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
  entries: TranscriptEntry[]
  pendingConfirmation: PendingConfirmation | null
  /** An open ask_user question awaiting a spoken or typed free-text answer. */
  pendingAsk: PendingAsk | null
  /** Live subagent cards, newest last; history persists after tabs close. */
  agents: SubagentCard[]
  submit(text: string): void
  resolveConfirmation(confirmationId: string, approved: boolean): void
  resolveAsk(askId: string, answer: string): void
  abort(): void
  /** A heard-but-not-a-command transcript (voice yes/no, undecided answers). */
  appendVoiceHeard(heard: VoiceHeardEvent): void
  /** Mic/engine failures from the voice half. */
  appendVoiceError(message: string, at?: number): void
}

/** Cards kept in history after their tab closes — bounded for long sessions. */
const MAX_AGENT_CARDS = 20

export function useAssistant(): Assistant {
  const [status, setStatus] = useState<OrbStatus>('idle')
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null)
  const [agents, setAgents] = useState<SubagentCard[]>([])
  const nextId = useRef(0)
  const lastStatus = useRef<OrbStatus>('idle')

  const append = useCallback((entry: TranscriptEvent) => {
    setEntries((current) => [...current, { ...entry, id: nextId.current++ }])
  }, [])

  useEffect(() => {
    return window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      const projected = projectPipelineEvent(event)
      if (projected) append(projected)
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
      }
    })
  }, [append])

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

  const appendVoiceHeard = useCallback((heard: VoiceHeardEvent) => {
    // Commands are echoed by the pipeline itself; only answers and undecided
    // words land here.
    if (heard.routed === 'command') return
    append({ kind: 'voice', text: describeHeard(heard), at: heard.at ?? Date.now() })
  }, [append])

  const appendVoiceError = useCallback((message: string, at = Date.now()) => {
    append({ kind: 'error', text: `voice: ${message}`, at })
  }, [append])

  return { status, entries, pendingConfirmation, pendingAsk, agents, submit, resolveConfirmation, resolveAsk, abort, appendVoiceHeard, appendVoiceError }
}
