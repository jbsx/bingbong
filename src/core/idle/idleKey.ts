// What a key does on the Idle Screen (#361), wherever it is heard: main's
// before-input-event on every input surface, and the dashboard's own
// keydown for a key main was never handed (a key that types a character
// can reach the renderer as a key down main does not hear). The first
// printable key opens the Idle Prompt with that key in it; a key that types
// nothing (PgUp, Home, Enter, an arrow) does nothing — it neither wakes the
// dashboard nor scrolls the hidden pane. A chord with Ctrl, Alt or Meta is
// a shortcut and passes on to whoever hears it.

/** A key as either side hears it: Electron's Input, or a DOM keydown mapped onto it. */
export interface IdleKeyInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  isComposing: boolean
}

/** What a key does on the Idle Screen: `type` its character, `open` the Prompt empty (Space), `swallow` it, or `pass` it on. */
export type IdleKeyAction = { kind: 'type'; text: string } | { kind: 'open' } | { kind: 'swallow' } | { kind: 'pass' }

export function idleKeyAction(input: IdleKeyInput): IdleKeyAction {
  if (input.control || input.meta || input.alt || input.isComposing) return { kind: 'pass' }
  // A key up is swallowed with its key down: neither reaches the page.
  if (input.type !== 'keyDown') return input.type === 'keyUp' ? { kind: 'swallow' } : { kind: 'pass' }
  if (input.key === ' ') return { kind: 'open' }
  if ([...input.key].length === 1 && input.key.trim() !== '') return { kind: 'type', text: input.key }
  return { kind: 'swallow' }
}

/** The text a key opens the Idle Prompt with: its character, '' for Space, or null for a key that does not open it. */
export function idlePromptText(action: IdleKeyAction): string | null {
  return action.kind === 'type' ? action.text : action.kind === 'open' ? '' : null
}
