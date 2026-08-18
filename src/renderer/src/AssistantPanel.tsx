import { useEffect, useRef, useState } from 'react'
import type { Assistant, PendingAsk, PendingConfirmation, OrbStatus, TranscriptEntry } from './useAssistant'

export function StatusOrb({ status }: { status: OrbStatus }) {
  return <div className={`status-orb status-orb--${status}`} aria-label={`assistant ${status}`} />
}

export function CommandBox({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit: (text: string) => void
}) {
  const [draft, setDraft] = useState('')

  return (
    <form
      className="command-form"
      onSubmit={(event) => {
        event.preventDefault()
        const text = draft.trim()
        if (text && !disabled) {
          onSubmit(text)
          setDraft('')
        }
      }}
    >
      <input
        className="command-input"
        type="text"
        placeholder='Type a command — "open youtube and play the first MKBHD result"'
        aria-label="Command box"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
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

  const secondsLeft = Math.max(0, Math.ceil((pending.expiresAt - now) / 1000))

  return (
    <div className="confirmation-card" role="alertdialog" aria-label="Confirmation required">
      <span className="confirmation-prompt">{pending.prompt}</span>
      <span className="confirmation-countdown" aria-label="auto-deny countdown">
        {secondsLeft}s
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

  const secondsLeft = Math.max(0, Math.ceil((pending.expiresAt - now) / 1000))

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
        {secondsLeft}s
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

export function TranscriptLine({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case 'command':
      return (
        <p className="transcript-entry transcript-entry--command">
          <span className="transcript-speaker">you</span> {entry.text}
        </p>
      )
    case 'tool':
      return <p className="transcript-entry transcript-entry--tool">{entry.text}</p>
    case 'speak':
      return (
        <p className="transcript-entry transcript-entry--speak">
          <span className="transcript-speaker">bing bong</span> {entry.text}
        </p>
      )
    case 'display':
      return <p className="transcript-entry transcript-entry--display">{entry.text}</p>
    case 'voice':
      return <p className="transcript-entry transcript-entry--voice">{entry.text}</p>
    case 'error': {
      const summary = entry.text.split('\n', 1)[0]
      const trimmed = summary.length > 140 ? `${summary.slice(0, 140)}…` : summary
      if (trimmed === entry.text) {
        return <p className="transcript-entry transcript-entry--error">{entry.text}</p>
      }
      return (
        <details className="transcript-entry transcript-entry--error">
          <summary>{trimmed}</summary>
          <pre className="transcript-error-detail">{entry.text}</pre>
        </details>
      )
    }
  }
}

export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [entries])

  return (
    <div className="transcript" ref={listRef} aria-label="transcript" aria-live="polite">
      {entries.length === 0 ? <p className="transcript-empty">Say or type a command to begin.</p> : null}
      {entries.map((entry) => (
        <TranscriptLine key={entry.id} entry={entry} />
      ))}
    </div>
  )
}

export function AssistantPanel({ assistant }: { assistant: Assistant }) {
  return (
    <div className="assistant-panel">
      <CommandBox disabled={assistant.status !== 'idle'} onSubmit={assistant.submit} />
      {assistant.pendingConfirmation ? (
        <ConfirmationCard pending={assistant.pendingConfirmation} onResolve={assistant.resolveConfirmation} />
      ) : null}
      {assistant.pendingAsk ? <AskCard pending={assistant.pendingAsk} onAnswer={assistant.resolveAsk} /> : null}
      <Transcript entries={assistant.entries} />
    </div>
  )
}
