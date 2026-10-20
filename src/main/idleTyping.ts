import type { WebContents } from 'electron'

// Typing on the Idle Screen goes to the Idle Prompt (#361): the first
// printable key opens it over the Idle Screen with that key in it, and the
// rest follow it there because the dashboard now owns focus. Heard in main,
// on every input surface, like the idle shortcut: while the screen is up the
// pane may still own focus, and its keydowns never reach the dashboard.
// A key that types nothing (PgUp, Home, Enter, an arrow) does nothing — it
// neither wakes the dashboard nor scrolls the hidden pane. A chord with
// Ctrl, Alt or Meta is a shortcut and passes on to whoever hears it.

/** What a key does on the Idle Screen: `type` its character, `open` the Prompt empty (Space), `swallow` it, or `pass` it on. */
export type IdleKeyAction = { kind: 'type'; text: string } | { kind: 'open' } | { kind: 'swallow' } | { kind: 'pass' }

export function idleKeyAction(input: Pick<Electron.Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'isComposing'>): IdleKeyAction {
  if (input.control || input.meta || input.alt || input.isComposing) return { kind: 'pass' }
  // A key up is swallowed with its key down: neither reaches the page.
  if (input.type !== 'keyDown') return input.type === 'keyUp' ? { kind: 'swallow' } : { kind: 'pass' }
  if (input.key === ' ') return { kind: 'open' }
  if ([...input.key].length === 1 && input.key.trim() !== '') return { kind: 'type', text: input.key }
  return { kind: 'swallow' }
}

/** Hears a key on `contents` while `shown()` holds (the Idle Screen up, its Prompt closed); `onType` gets the key's character, '' for Space. The returned release stops hearing. */
export function attachIdleTyping(contents: WebContents, deps: { shown: () => boolean; onType: (text: string) => void }): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    if (!deps.shown()) return
    const action = idleKeyAction(input)
    if (action.kind === 'pass') return
    event.preventDefault()
    if (action.kind === 'type') deps.onType(action.text)
    else if (action.kind === 'open') deps.onType('')
  }
  contents.on('before-input-event', onBeforeInput)
  return () => {
    if (!contents.isDestroyed()) contents.removeListener('before-input-event', onBeforeInput)
  }
}
