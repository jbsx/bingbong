import { useEffect, useState } from 'react'
import type { Assistant, PendingAsk, PendingConfirmation, OrbStatus } from './useAssistant'
import { describeRunProgress, type RunProgress } from '../../core/pipeline/runProgress'

function deadlineText(expiresAt: number | null, now: number): string {
  return expiresAt === null ? 'paused' : `${Math.max(0, Math.ceil((expiresAt - now) / 1000))}s`
}

export function StatusOrb({ status }: { status: OrbStatus }) {
  return <div className={`status-orb status-orb--${status}`} aria-label={`assistant ${status}`} />
}

/** The state names the pill can show (#50) — calm text beside the dot. */
const PILL_LABELS: Record<OrbStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  acting: 'Acting…',
  speaking: 'Speaking…',
  paused: 'Paused',
  cancelled: 'Cancelled',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
}

/**
 * The status pill (#50): the state, named in text beside the still orb —
 * readable from across the room without any motion.
 */
export function StatusPill({ status }: { status: OrbStatus }) {
  return (
    <span className={`status-pill status-pill--${status}`} role="status">
      {PILL_LABELS[status]}
    </span>
  )
}

/**
 * The header's live progress line (#43): stage + climbing elapsed counter,
 * rendered from event timestamps with a renderer-side tick — no heartbeat
 * IPC. A genuine hang reads as an honestly climbing number; Stop stays the
 * only escape.
 */
export function RunHint({ progress }: { progress: RunProgress }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className="run-hint" role="status">
      {describeRunProgress(progress, now)}
    </span>
  )
}

/**
 * The dashboard footer's transient cards: confirmations and asks. Typed
 * input lives in the feed panel's prompt bar (ADR 0011) — App renders the
 * footer only while a card is pending, so it collapses entirely otherwise.
 */
export function AssistantPanel({ assistant }: { assistant: Assistant }) {
  return (
    <div className="assistant-panel">
      {assistant.pendingConfirmation ? (
        <ConfirmationCard pending={assistant.pendingConfirmation} onResolve={assistant.resolveConfirmation} />
      ) : null}
      {assistant.pendingAsk ? <AskCard pending={assistant.pendingAsk} onAnswer={assistant.resolveAsk} /> : null}
    </div>
  )
}

export function ConfirmationCard({
  pending,
  onResolve,
}: {
  pending: PendingConfirmation
  onResolve: (confirmationId: string, approved: boolean) => void
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [pending.confirmationId])

  return (
    <div className="confirmation-card" role="alertdialog" aria-label="Confirmation required">
      <span className="confirmation-prompt">{pending.prompt}</span>
      <span className="confirmation-countdown" aria-label="auto-deny countdown">
        {deadlineText(pending.expiresAt, now)}
      </span>
      <span className="confirmation-actions">
        <button type="button" onClick={() => onResolve(pending.confirmationId, true)}>
          Approve
        </button>
        <button type="button" onClick={() => onResolve(pending.confirmationId, false)}>
          Deny
        </button>
      </span>
    </div>
  )
}

/** A free-text ask_user card: spoken prompt + typed answer + countdown. */
export function AskCard({
  pending,
  onAnswer,
}: {
  pending: PendingAsk
  onAnswer: (askId: string, answer: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    setDraft('')
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [pending.askId])

  return (
    <form
      className="ask-card"
      onSubmit={(event) => {
        event.preventDefault()
        const answer = draft.trim()
        if (answer) onAnswer(pending.askId, answer)
      }}
    >
      <label className="ask-question" htmlFor={`ask-input-${pending.askId}`}>
        {pending.question}
      </label>
      <span className="confirmation-countdown" aria-label="answer window countdown">
        {deadlineText(pending.expiresAt, now)}
      </span>
      <span className="ask-controls">
        <input
          id={`ask-input-${pending.askId}`}
          className="ask-input"
          type="text"
          placeholder="Type an answer — or just say it"
          autoComplete="off"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={draft.trim() === ''}>
          Answer
        </button>
      </span>
    </form>
  )
}

