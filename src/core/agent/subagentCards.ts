import type { Clock } from '../ports/clock'
import type { PipelineEvent, SubagentCard, SubagentCardTab } from '../pipeline/events'
import type { SubagentEvent, SubagentManager } from './subagentManager'
import { subagentAnnouncement } from './subagentManager'
import type { SubagentTab, SubagentTabs } from '../browser/subagentTabs'

// Merges the manager's lifecycle events and the tab machine's phase changes
// into the pipeline event stream: one agent_update per change (the dashboard
// keeps a card per agent id) plus a speak event when an agent completes or
// fails (the runtime also routes the line to TTS). Cancelled agents change
// the card but stay unannounced — the user asked for the cancellation.

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
    return { ...record, ...(tab ? { tab: tabCard(tab) } : {}) }
  }

  function emitCard(agentId: string): void {
    const card = cardFor(agentId)
    if (card) emit({ type: 'agent_update', agent: card, at: clock.now() })
  }

  return {
    onManagerEvent(event) {
      emitCard(event.record.id)
      if (event.type === 'finished') {
        const announcement = subagentAnnouncement(event.record)
        if (announcement) emit({ type: 'speak', text: announcement, at: clock.now() })
      }
    },
    onTabChange(tab) {
      emitCard(tab.agentId)
    },
  }
}
