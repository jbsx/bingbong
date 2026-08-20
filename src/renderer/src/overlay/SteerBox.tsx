import { useState } from 'react'

/**
 * The typed steering entry point (#46): one directive, submitted to the
 * active run through the same seam as spoken "hold on" steering. Disabled
 * while no run is active so it never silently drops input; the feed echoes
 * the received directive ("steer: …") the moment main takes it.
 */
export function SteerBox({ disabled }: { disabled: boolean }) {
  const [draft, setDraft] = useState('')

  return (
    <form
      className="steer-form"
      onSubmit={(event) => {
        event.preventDefault()
        const text = draft.trim()
        if (text && !disabled) {
          void window.bingbong.assistant.steer(text)
          setDraft('')
        }
      }}
    >
      <input
        className="steer-input"
        type="text"
        placeholder={disabled ? 'steer — no active run' : 'steer — "use Paris instead"'}
        aria-label="Steer box"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="steer-submit" disabled={disabled || draft.trim() === ''}>
        steer
      </button>
    </form>
  )
}
