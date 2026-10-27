/**
 * A mute switch, app-global and off at launch: the Sound Mute (the pane's
 * audio, the app's own speech and chime; the Timer's alarm still rings
 * through it, so a mute never costs a missed alarm) and the Mic Mute (the
 * ear shut, the microphone released) are one each.
 */
export interface MuteSwitch {
  muted(): boolean
  set(on: boolean): void
  toggle(): boolean
  /** Called on every change; returns the unsubscribe. */
  onChange(listener: (muted: boolean) => void): () => void
}

export type SoundMute = MuteSwitch

export function createMuteSwitch(): MuteSwitch {
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
