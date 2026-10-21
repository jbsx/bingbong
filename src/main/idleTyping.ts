import type { WebContents } from 'electron'
import { idleKeyAction, idlePromptText } from '../core/idle/idleKey'

// Typing on the Idle Screen goes to the Idle Prompt (#361): the first
// printable key opens it over the Idle Screen with that key in it, and the
// rest follow it there because the dashboard now owns focus. Heard in main,
// on every input surface, like the idle shortcut: while the screen is up the
// pane may still own focus, and its keydowns never reach the dashboard.
// What each key does is idleKeyAction's (core/idle/idleKey).

/** Hears a key on `contents` while `shown()` holds (the Idle Screen up, its Prompt closed); `onType` gets the key's character, '' for Space. The returned release stops hearing. */
export function attachIdleTyping(contents: WebContents, deps: { shown: () => boolean; onType: (text: string) => void }): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    if (!deps.shown()) return
    const action = idleKeyAction(input)
    if (action.kind === 'pass') return
    event.preventDefault()
    const text = idlePromptText(action)
    if (text !== null) deps.onType(text)
  }
  contents.on('before-input-event', onBeforeInput)
  return () => {
    if (!contents.isDestroyed()) contents.removeListener('before-input-event', onBeforeInput)
  }
}
