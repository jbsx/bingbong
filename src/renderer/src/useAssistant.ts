import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineEvent, PipelineStatus, SubagentCard } from '../../core/pipeline/events'
import type { VoiceHeardEvent } from '../../core/voice/ipcChannels'
import { describeToolAction } from '../../core/pipeline/toolCallDisplay'

export type OrbStatus = 'idle' | 'listening' | PipelineStatus

export type TranscriptEntry =
  | { id: number; kind: 'command'; text: string }
  | { id: number; kind: 'tool'; text: string }
  | { id: number; kind: 'display'; text: string }
  | { id: number; kind: 'speak'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'voice'; text: string }

export interface PendingConfirmation {
  confirmationId: string
  prompt: string
  /** Wall-clock auto-deny deadline — the card counts down to it. */
  expiresAt: number
}

export interface PendingAsk {
  askId: string
  question: string
  /** Wall-clock deadline — the card counts down to it. */
  expiresAt: number
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
  /** A heard-but-not-a-command transcript (voice yes/no, undecided answers). */
  appendVoiceHeard(heard: VoiceHeardEvent): void
  /** Mic/engine failures from the voice half. */
  appendVoiceError(message: string): void
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

  const append = useCallback((entry: Omit<TranscriptEntry, 'id'>) => {
    setEntries((current) => [...current, { ...entry, id: nextId.current++ }])
  }, [])

  useEffect(() => {
    return window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      switch (event.type) {
        case 'command':
          append({ kind: 'command', text: event.text })
          return
        case 'status':
          setStatus(event.status)
          return
        case 'tool_call':
          append({ kind: 'tool', text: describeToolAction(event.name, event.args) })
          return
        case 'tool_result':
          if (!event.ok) append({ kind: 'error', text: `${event.name} failed: ${event.error}` })
          return
        case 'display':
          append({ kind: 'display', text: event.text })
          return
        case 'speak':
          append({ kind: 'speak', text: event.text })
          return
        case 'error':
          append({ kind: 'error', text: event.message })
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
          setStatus('idle')
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

  const appendVoiceHeard = useCallback((heard: VoiceHeardEvent) => {
    // Commands are echoed by the pipeline itself; only answers and undecided
    // words land here.
    if (heard.routed === 'command') return
    const suffix =
      heard.routed === 'confirmation'
        ? ' (answered)'
        : heard.routed === 'ask'
          ? ' (your answer)'
          : ' — not a yes or no'
    append({ kind: 'voice', text: `heard "${heard.text}"${suffix}` })
  }, [append])

  const appendVoiceError = useCallback((message: string) => {
    append({ kind: 'error', text: `voice: ${message}` })
  }, [append])

  return { status, entries, pendingConfirmation, pendingAsk, agents, submit, resolveConfirmation, resolveAsk, appendVoiceHeard, appendVoiceError }
}
