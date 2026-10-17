import { useState } from 'react'

/**
 * The Prompt Bar: the one typed-input surface, living in the feed panel's
 * footer. Enter clears the field at once — the submit IPC resolves only
 * when the Command finishes, so waiting on it would leave the text sitting
 * there for the action's duration. A typed line is a Command read the same
 * way as a spoken one (#324, ADR 0076), and a Command typed while one is
 * in flight supersedes it — nothing is ever "busy". A false return from
 * main (no window took the line, or it was blank) restores the draft
 * instead of silently dropping it (ADR 0011) — unless new typing landed
 * meanwhile, which is never clobbered.
 *
 * The form reports an outstanding submit as `aria-busy`: the submit IPC
 * settles only after the Command unwinds, and that settlement is the one
 * signal a typed follow-up's readiness has to read.
 */
export function PromptBar() {
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const [pendingSubmits, setPendingSubmits] = useState(0)

  const submitCommand = async (text: string): Promise<boolean> => {
    setPendingSubmits((count) => count + 1)
    try {
      return await window.bingbong.assistant.submit(text)
    } finally {
      setPendingSubmits((count) => count - 1)
    }
  }

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    setFeedback('')
    const taken = await submitCommand(text)
    if (!taken) {
      setFeedback('No window took the command — try again.')
      setDraft((current) => (current === '' ? text : current))
    }
  }

  return (
    <form
      className="prompt-form"
      aria-busy={pendingSubmits > 0 ? true : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="prompt-controls">
        <input
          className="prompt-input"
          type="text"
          placeholder='Type a command — "open youtube", "click sign in", "scroll down", "read"'
          aria-label="Prompt bar"
          aria-describedby={feedback ? 'submission-feedback' : undefined}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="prompt-verb" disabled={draft.trim() === ''}>
          run
        </button>
      </div>
      <p id="submission-feedback" className="submission-feedback" aria-live="polite">
        {feedback}
      </p>
    </form>
  )
}
