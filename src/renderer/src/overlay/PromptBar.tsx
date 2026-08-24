import { useState } from 'react'

/**
 * The Prompt Bar: the one typed-input surface, living in the feed panel's
 * footer. The verb follows the run-live signal at submit time — "run"
 * starts a command when none is live, "steer" directs the live run through
 * the same seam as spoken steering (#46). Never disabled: a false return
 * from main (an aborting run) restores the draft instead of silently
 * dropping it, and the draft survives verb flips mid-typing.
 */
export function PromptBar({ runActive }: { runActive: boolean }) {
  const [draft, setDraft] = useState('')

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '') return
    const taken = runActive
      ? await window.bingbong.assistant.steer(text)
      : await window.bingbong.assistant.submit(text)
    if (taken) setDraft('')
  }

  return (
    <form
      className="prompt-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <input
        className="prompt-input"
        type="text"
        placeholder={
          runActive ? 'steer — "use Paris instead"' : 'Type a command — "open youtube and play the first MKBHD result"'
        }
        aria-label="Prompt bar"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="prompt-verb" disabled={draft.trim() === ''}>
        {runActive ? 'steer' : 'run'}
      </button>
    </form>
  )
}
