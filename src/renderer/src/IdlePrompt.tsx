import { useEffect, useRef, useState } from 'react'
import { foldIdleReply, NO_REPLY, sentReply, type IdleReply } from '../../core/idle/idlePrompt'

/**
 * The Idle Prompt (#361): the Prompt Bar over the Idle Screen, with no Feed
 * beneath it. A key typed on the screen opens it with that key in it; Enter
 * runs the line as a Command, as the Prompt Bar would. One that opens a
 * page wakes the dashboard and this goes with the screen; one that leaves
 * the screen up answers here. Escape, or a tap outside, closes it.
 *
 * It tells main its field holds focus (`onFocused`) only once it does —
 * until then main hands each key over IPC, so a key typed fast after the
 * first is never lost.
 */
export function IdlePrompt({ draft, onDraft, onClose, onFocused }: { draft: string; onDraft: (draft: string) => void; onClose: () => void; onFocused: (focused: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [reply, setReply] = useState<IdleReply>(NO_REPLY)

  useEffect(() => {
    // Told from the field itself, not its focus event: StrictMode mounts this
    // twice, and the second focus() on a field already focused fires none —
    // main would go on swallowing Backspace and Space for it.
    const input = inputRef.current
    input?.focus()
    onFocused(input !== null && document.activeElement === input)
    return () => onFocused(false)
  }, [])

  useEffect(() => window.bingbong.assistant.onEvent((event) => setReply((current) => foldIdleReply(current, event))), [])

  const submit = (): void => {
    const text = draft.trim()
    if (text === '') return
    onDraft('')
    setReply(sentReply(text))
    void window.bingbong.assistant.submit(text).then((taken) => {
      if (!taken) setReply({ kind: 'answer', text, task: '', turns: [], answer: 'No window took the command — try again.', failure: true, muted: false })
    })
  }

  return (
    // The tap that closes it is the Prompt's alone: it never reaches the Idle Screen's wake.
    <div
      className="idle-prompt-backdrop"
      onPointerDown={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <form
        className="idle-prompt"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          ref={inputRef}
          className="idle-prompt-input"
          type="text"
          aria-label="Idle prompt"
          placeholder="Type a command"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onFocus={() => onFocused(true)}
          onBlur={() => onFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        />
        {reply.kind === 'none' ? null : (
          <p
            className={`idle-prompt-reply${reply.kind === 'answer' && reply.failure ? ' idle-prompt-reply--failure' : ''}${reply.kind === 'answer' && reply.muted ? ' idle-prompt-reply--muted' : ''}`}
            role="status"
          >
            <span className="idle-prompt-said">{reply.text}</span>
            <span className="idle-prompt-answer">{reply.kind === 'answer' ? reply.answer : '…'}</span>
          </p>
        )}
      </form>
    </div>
  )
}
