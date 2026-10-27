/**
 * The Sound Mute: one app-global switch, off at launch, that silences the
 * pane's audio and the app's own speech and chime while on. The Timer's
 * alarm still rings through it, so a mute never costs a missed alarm.
 */
export interface SoundMute {
  muted(): boolean
  set(on: boolean): void
  toggle(): boolean
  /** Called on every change; returns the unsubscribe. */
  onChange(listener: (muted: boolean) => void): () => void
}

export function createSoundMute(): SoundMute {
  let muted = false
  const listeners = new Set<(muted: boolean) => void>()
  const set = (on: boolean): void => {
    if (on === muted) return
    muted = on
    for (const listener of listeners) listener(muted)
  }
  return {
    muted: () => muted,
    set,
    toggle() {
      set(!muted)
      return muted
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
