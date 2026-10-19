/** The Timer (CONTEXT.md): pulled by the Idle Screen on mount; pushed as it changes. */
export const TIMER_IPC = {
  get: 'timer:get',
  changed: 'timer:changed',
} as const
