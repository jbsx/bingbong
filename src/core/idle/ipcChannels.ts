/** What the dashboard tells main of the Idle Screen: whether it is up, whether its Prompt is open, and whether the Prompt's field holds focus (#361). */
export interface IdleShown {
  up: boolean
  open: boolean
  prompting: boolean
}

/** The Idle Screen on demand: main heard the idle shortcut, the dashboard enters the rest state. */
export const IDLE_IPC = {
  enter: 'idle:enter',
  /** Dashboard → main: an {@link IdleShown}. Main hands a typed key to the Idle Prompt only while the screen is up with the Prompt closed, and keeps the Feed shut while it is up. */
  shown: 'idle:shown',
  /** Main → dashboard: a key typed on the Idle Screen — open the Idle Prompt with this text in it ('' for Space). */
  typed: 'idle:typed',
} as const
