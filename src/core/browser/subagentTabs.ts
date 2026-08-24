import type { Clock } from '../ports/clock'
import { SUBAGENT_LIMITS } from '../agent/subagentRails'

// The subagent tab rail's brain (issue #13): at most 3 subagent tabs beside
// the main pane; a finished agent's tab lingers 60 s (configurable for tests)
// and then auto-closes, keeping its last URL so the dashboard's reopen button
// can restore it. Electron glue maps phases to WebContentsView lifecycles;
// this module owns capacity, linger timing and phase transitions only.

export type SubagentTabPhase = 'active' | 'lingering' | 'closed'

export interface SubagentTab {
  /** The browsing subagent this tab belongs to — tabs are 1:1 with agents. */
  agentId: string
  phase: SubagentTabPhase
  /** Last known URL — retained after close so reopen can restore it. */
  url: string
  title: string
  /**
   * Latest in-memory capture of the tab's page (#57): a JPEG data URL the
   * card displays as a live thumbnail. Held in renderer memory only — the
   * capture path never touches disk. Retained after close like the URL, so
   * the finished card keeps its last frame.
   */
  thumbnail?: string
}

export interface SubagentTabsDeps {
  clock: Clock
  lingerMs?: number
  maxTabs?: number
}

type OpenResult = { ok: true; tab: SubagentTab } | { ok: false; reason: string }
type ReopenResult = OpenResult

export interface SubagentTabs {
  /** Claim a tab for a browsing subagent starting at `startUrl`. */
  open(agentId: string, startUrl: string): OpenResult
  /** The agent finished (any outcome) — the tab lingers, then auto-closes. */
  finish(agentId: string): void
  /** Bring a lingering or closed tab back into active use; a closed tab restores its retained URL. */
  reopen(agentId: string): ReopenResult
  /** Close every open tab now, skipping the linger — Session end discards its transient surfaces (#96). */
  closeAll(): number
  /** Navigation updates for the card (URL/title); emits like phase changes. */
  update(agentId: string, patch: { url?: string; title?: string; thumbnail?: string }): void
  snapshot(): SubagentTab[]
  /** Fires on every phase change or navigation update with the tab (a copy). */
  subscribe(listener: (tab: SubagentTab) => void): () => void
}

export function createSubagentTabs(deps: SubagentTabsDeps): SubagentTabs {
  const { clock } = deps
  const lingerMs = deps.lingerMs ?? SUBAGENT_LIMITS.tabLingerMs
  const maxTabs = deps.maxTabs ?? SUBAGENT_LIMITS.maxSubagentTabs
  const tabs = new Map<string, SubagentTab>()
  const lingerTimers = new Map<string, () => void>()
  const listeners = new Set<(tab: SubagentTab) => void>()

  function occupyingCount(): number {
    return [...tabs.values()].filter((tab) => tab.phase !== 'closed').length
  }

  function fullReason(): string {
    return `subagent tab limit (${maxTabs}) reached — wait for a tab to auto-close or finish with fewer browsing agents`
  }

  function emit(tab: SubagentTab): void {
    // Copies: listeners keep what they saw (a phase at a point in time).
    const snapshot = { ...tab }
    for (const listener of listeners) listener(snapshot)
  }

  function closeAfterLinger(agentId: string): void {
    const tab = tabs.get(agentId)
    if (!tab || tab.phase !== 'lingering') return
    closeTab(tab)
  }

  /** Disarm the linger timer and close the tab, announcing the phase change. */
  function closeTab(tab: SubagentTab): void {
    lingerTimers.get(tab.agentId)?.()
    lingerTimers.delete(tab.agentId)
    tab.phase = 'closed'
    emit(tab)
  }

  return {
    open(agentId, startUrl) {
      const existing = tabs.get(agentId)
      if (existing && existing.phase !== 'closed') return { ok: true, tab: existing }
      if (occupyingCount() >= maxTabs) return { ok: false, reason: fullReason() }

      lingerTimers.get(agentId)?.()
      const tab: SubagentTab = { agentId, phase: 'active', url: startUrl, title: '' }
      tabs.set(agentId, tab)
      emit(tab)
      return { ok: true, tab }
    },

    finish(agentId) {
      const tab = tabs.get(agentId)
      if (!tab || (tab.phase !== 'active' && tab.phase !== 'lingering')) return
      if (tab.phase === 'lingering') return

      tab.phase = 'lingering'
      emit(tab)
      lingerTimers.set(
        agentId,
        clock.setTimer(lingerMs, () => closeAfterLinger(agentId)),
      )
    },

    reopen(agentId) {
      const tab = tabs.get(agentId)
      if (!tab || tab.phase === 'active') {
        return { ok: false, reason: tab ? `tab is ${tab.phase}, not closed` : 'no such subagent tab' }
      }
      // A lingering tab already occupies the rail; only a closed reopen
      // claims a new slot. Both paths disarm the linger timer — a pane the
      // user moved into the main browsing area (#57) must not auto-close
      // mid-interaction.
      if (tab.phase === 'closed' && occupyingCount() >= maxTabs) return { ok: false, reason: fullReason() }

      lingerTimers.get(agentId)?.()
      lingerTimers.delete(agentId)
      tab.phase = 'active'
      emit(tab)
      return { ok: true, tab }
    },

    closeAll() {
      let count = 0
      for (const tab of tabs.values()) {
        if (tab.phase === 'closed') continue
        closeTab(tab)
        count += 1
      }
      return count
    },

    update(agentId, patch) {
      const tab = tabs.get(agentId)
      if (!tab) return
      if (patch.url !== undefined) tab.url = patch.url
      if (patch.title !== undefined) tab.title = patch.title
      if (patch.thumbnail !== undefined) tab.thumbnail = patch.thumbnail
      // Cards follow navigation while the agent works, so updates emit too.
      emit(tab)
    },

    snapshot: () => [...tabs.values()].map((tab) => ({ ...tab })),

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
