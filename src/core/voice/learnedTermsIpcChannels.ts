// Learned Terms IPC (ADR 0022): the Settings page's view of the Bias
// Lexicon's learned half. The list is app-managed — proposals grow it
// autonomously — so these channels are the one human surface: look, add,
// remove. Changes broadcast to every window the same way settings do.
export const LEARNED_TERMS_IPC = {
  /** renderer → main, invoke: () → readonly string[] (admission order). */
  list: 'learned-terms:list',
  /** renderer → main, invoke: (raw: string) → boolean (false: invalid or seed-only). */
  add: 'learned-terms:add',
  /** renderer → main, invoke: (raw: string) → boolean (plants a rejection). */
  remove: 'learned-terms:remove',
  /** main → renderer: the admitted list changed (auto or manual). */
  changed: 'learned-terms:changed',
} as const
