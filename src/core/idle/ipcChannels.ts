/** The Idle Screen on demand: main heard the idle shortcut, the dashboard enters the rest state. */
export const IDLE_IPC = {
  enter: 'idle:enter',
  /** Dashboard → main: the Idle Screen is up (true) or down (false); main hands a typed key to the Prompt Bar only while it is up. */
  shown: 'idle:shown',
  /** Main → dashboard: a key typed on the Idle Screen went to the Prompt Bar — wake. */
  wake: 'idle:wake',
} as const
