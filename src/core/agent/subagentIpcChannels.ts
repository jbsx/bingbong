// Renderer↔main channels for the subagent surface (issue #13): the dashboard
// reports each live tab viewport's rect (same pattern as the main pane) and
// asks to reopen a closed tab from its retained card.

export const SUBAGENT_IPC = {
  /** renderer → main, fire-and-forget: (agentId, rect). */
  tabRect: 'subagent:tab-rect',
  /** renderer → main, invoke: (agentId) → boolean. */
  reopenTab: 'subagent:reopen-tab',
  /** renderer → main, invoke: (agentId) → boolean — the card's Cancel button. */
  cancel: 'subagent:cancel',
} as const
