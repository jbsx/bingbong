/** The Sound Mute: pulled by the mute buttons on mount, toggled by them, pushed as it changes. */
export const SOUND_IPC = {
  get: 'sound:get',
  toggle: 'sound:toggle',
  changed: 'sound:changed',
} as const
