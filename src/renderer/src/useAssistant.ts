import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineEvent, PipelineStatus } from '../../core/pipeline/events'

export type OrbStatus = 'idle' | PipelineStatus

export type TranscriptEntry =
  | { id: number; kind: 'command'; text: string }
  | { id: number; kind: 'tool'; text: string }
  | { id: number; kind: 'display'; text: string }
  | { id: number; kind: 'speak'; text: string }
  | { id: number; kind: 'error'; text: string }

export interface PendingConfirmation {
  confirmationId: string
  prompt: string
}

export interface Assistant {
  status: OrbStatus
  entries: TranscriptEntry[]
  pendingConfirmation: PendingConfirmation | null
  submit(text: string): void
  resolveConfirmation(confirmationId: string, approved: boolean): void
}

/** Compact, human-readable rendering of a tool call for the transcript. */
function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'navigate':
      return `→ ${String(args.url ?? '')}`
    case 'click':
      return `click [${String(args.ref ?? '?')}]`
    case 'type':
      return `type "${String(args.text ?? '')}" into [${String(args.ref ?? '?')}]`
    case 'scroll':
      return `scroll ${String(args.direction ?? '')}`
    case 'read_page':
      return 'read page'
    case 'screenshot':
      return 'screenshot'
    case 'back':
      return 'go back'
    default:
      return `${name} ${JSON.stringify(args)}`
  }
}

export function useAssistant(): Assistant {
  const [status, setStatus] = useState<OrbStatus>('idle')
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
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
          append({ kind: 'tool', text: describeToolCall(event.name, event.args) })
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
          setPendingConfirmation({ confirmationId: event.confirmationId, prompt: event.prompt })
          return
        case 'confirmation_resolved':
          setPendingConfirmation((current) =>
            current?.confirmationId === event.confirmationId ? null : current,
          )
          return
        case 'done':
          setStatus('idle')
          setPendingConfirmation(null)
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

  return { status, entries, pendingConfirmation, submit, resolveConfirmation }
}
