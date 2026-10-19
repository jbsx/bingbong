import type { WebContents } from 'electron'

// Typing on the Idle Screen goes to the Prompt Bar: the first printable key
// wakes the dashboard, opens the panel and lands in the bar, and the rest
// follow it there because the overlay now owns focus. Heard in main, on
// every input surface, like the idle shortcut: while the screen is up the
// pane may still own focus, and its keydowns never reach the dashboard.
// Whitespace does not start a line — a space or Enter still only wakes.

export function isIdleTypingKey(
  input: Pick<Electron.Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'isComposing'>,
): boolean {
  if (input.type !== 'keyDown' || input.control || input.meta || input.alt || input.isComposing) return false
  return [...input.key].length === 1 && input.key.trim() !== ''
}

/** Hears a typed key on `contents` while `shown()` holds; the returned release stops hearing. */
export function attachIdleTyping(contents: WebContents, deps: { shown: () => boolean; onType: (text: string) => void }): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    if (!deps.shown() || !isIdleTypingKey(input)) return
    event.preventDefault()
    deps.onType(input.key)
  }
  contents.on('before-input-event', onBeforeInput)
  return () => {
    if (!contents.isDestroyed()) contents.removeListener('before-input-event', onBeforeInput)
  }
}
