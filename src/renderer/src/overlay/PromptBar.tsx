import { useEffect, useState } from 'react'

/**
 * The Prompt Bar: the one typed-input surface, living in the feed panel's
 * footer. The verb follows the run-live signal at submit time — "run"
 * starts a command when none is live, "steer" directs the live run through
 * the same seam as spoken steering (#46). Never disabled, and Enter clears
 * the field at once — the submit IPC resolves only when the whole Run
 * finishes, so waiting on it left the text sitting there for the Run's
 * duration. A false return from main (busy-rejected, an aborting run)
 * restores the draft instead of silently dropping it (ADR 0011) — unless
 * new typing landed meanwhile, which is never clobbered. The draft
 * survives verb flips mid-typing.
 *
 * The form reports an outstanding initial submit as `aria-busy` (#224):
 * the submit IPC settles only after the whole Run unwinds — later than
 * the Run's `done` event in some cases — and that settlement is the one
 * signal a typed follow-up's readiness has to read. Steering rides the
 * same input but never touches the flag: a steer settles per directive,
 * not per Run, and must not clear or set what the initial submit owns.
 */
export function PromptBar({ runActive }: { runActive: boolean }) {
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const [pendingSubmits, setPendingSubmits] = useState(0)

  useEffect(() => window.bingbong.assistant.onSubmissionFeedback((item) => setFeedback(item.message)), [])

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
    const taken = runActive ? await window.bingbong.assistant.steer(text) : await submitCommand(text)
    if (!taken) {
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
          placeholder={
            runActive ? 'steer — "use Paris instead"' : 'Type a command — "open youtube and play the first MKBHD result"'
          }
          aria-label="Prompt bar"
          aria-describedby={feedback ? 'submission-feedback' : undefined}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="prompt-verb" disabled={draft.trim() === ''}>
          {runActive ? 'steer' : 'run'}
        </button>
      </div>
      <p id="submission-feedback" className="submission-feedback" aria-live="polite">
        {feedback}
      </p>
    </form>
  )
}
