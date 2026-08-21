// Renderer↔main channels for the subagent surface (issue #13): the dashboard
// reports each live card thumbnail frame's rect — visibility gates the ~1fps
// capture loop and the width sizes its frames (#57) — and asks to reopen a
// tab from its card, which moves the pane into the main browsing area.

export const SUBAGENT_IPC = {
  /** renderer → main, fire-and-forget: (agentId, cardRect). */
  tabRect: 'subagent:tab-rect',
  /** renderer → main, invoke: (agentId) → boolean. */
  reopenTab: 'subagent:reopen-tab',
  /** renderer → main, invoke: (agentId) → boolean — the card's Cancel button. */
  cancel: 'subagent:cancel',
} as const
