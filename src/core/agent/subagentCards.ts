import type { Clock } from '../ports/clock'
import type { PipelineEvent, SubagentCard, SubagentCardTab } from '../pipeline/events'
import type { SubagentEvent, SubagentManager, SubagentRecord } from './subagentManager'
import { subagentAnnouncement } from './subagentManager'
import type { SubagentTab, SubagentTabs } from '../browser/subagentTabs'

// Merges the manager's lifecycle events and the tab machine's phase changes
// into the pipeline event stream: one agent_update per change (the dashboard
// keeps a card per agent id) plus a speak event when an agent completes or
// fails (the runtime also routes the line to TTS). Cancelled agents change
// the card but stay unannounced — the user asked for the cancellation.
// Every event carries the spawning Session's identity (#97), so the window
// gate rejects late progress or completion from an ended or foreign Session.

export interface SubagentCardBridgeDeps {
  manager: SubagentManager
  tabs: SubagentTabs
  clock: Clock
  emit(event: PipelineEvent): void
}

export interface SubagentCardBridge {
  onManagerEvent(event: SubagentEvent): void
  onTabChange(tab: SubagentTab): void
}

/** Stamps an event with the record's owner, when it has one (#97). */
function withOwner(event: PipelineEvent, owner: SubagentRecord['owner']): PipelineEvent {
  return owner ? { ...event, sessionId: owner.sessionId, sessionGeneration: owner.generation } : event
}

export function createSubagentCardBridge(deps: SubagentCardBridgeDeps): SubagentCardBridge {
  const { manager, tabs, clock, emit } = deps

  function tabCard(tab: SubagentTab): SubagentCardTab {
    return {
      phase: tab.phase,
      url: tab.url,
      title: tab.title,
      ...(tab.thumbnail !== undefined ? { thumbnail: tab.thumbnail } : {}),
    }
  }

  function cardFor(agentId: string): SubagentCard | null {
    const record = manager.list().find((candidate) => candidate.id === agentId)
    if (!record) return null
    const tab = tabs.snapshot().find((candidate) => candidate.agentId === agentId)
    // The card is the user-facing surface: it keeps the report's prose
    // (result) but not the structured sections (#98) — those reconcile
    // through agent_results, not the dashboard.
    const card: SubagentCard & { report?: unknown } = { ...record }
    delete card.report
    return { ...card, ...(tab ? { tab: tabCard(tab) } : {}) }
  }

  function emitCard(agentId: string): void {
    const card = cardFor(agentId)
    if (card) emit(withOwner({ type: 'agent_update', agent: card, at: clock.now() }, card.owner))
  }

  return {
    onManagerEvent(event) {
      emitCard(event.record.id)
      if (event.type === 'finished') {
        const announcement = subagentAnnouncement(event.record)
        if (announcement) emit(withOwner({ type: 'speak', text: announcement, at: clock.now() }, event.record.owner))
      }
    },
    onTabChange(tab) {
      emitCard(tab.agentId)
    },
  }
}
