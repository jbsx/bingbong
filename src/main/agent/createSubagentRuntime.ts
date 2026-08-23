import type { BrowserWindow } from 'electron'
import type { Clock } from '../../core/ports/clock'
import { systemClock } from '../../core/ports/clock'
import type { TtsSpeaker } from '../../core/ports/tts'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { Tool } from '../../core/pipeline/tool'
import type { UsageRecord } from '../../core/agent/usageTracking'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { SUBAGENT_LIMITS } from '../../core/agent/subagentRails'
import { createSubagentManager } from '../../core/agent/subagentManager'
import { createSubagentCardBridge, type SubagentCardBridge } from '../../core/agent/subagentCards'
import { createSubagentTabs } from '../../core/browser/subagentTabs'
import { createSubagentTools } from '../../core/pipeline/subagentTools'
import { createSubagentPanePool, type MainPaneRectSource, type SubagentPanePool } from '../browser/subagentPanePool'
import { createSubagentTaskApi } from './createSubagentWorkhorse'
import { createBackgroundTools } from './backgroundTools'
import { createZaiVisionApi } from '../vision/createZaiVisionApi'

// Composes the whole subagent surface for one window (issue #13): tab
// machine + pane pool (Electron), manager + bridge (core), workhorse taskApi
// (deepseek loops), and the orchestrator-facing tools. Pipeline events
// (agent_update cards, speak announcements) flow to the dashboard through
// `emit`; spoken announcements also reach TTS directly, like the download
// router's completions.

/** Overrides the 60 s tab linger (tests, e2e) — milliseconds. */
export const TAB_LINGER_ENV = 'BINGBONG_TAB_LINGER_MS'

export interface SubagentRuntimeDeps {
  win: BrowserWindow
  /** The persistent session shared with the main pane. */
  session: Electron.Session
  downloadsDir: string
  getEnv(): Record<string, string | undefined>
  fetchFn?: typeof fetch
  clock?: Clock
  tts: TtsSpeaker
  emit(event: PipelineEvent): void
  onUsage?(record: UsageRecord): void
  /** Escape while a subagent tab owns focus. */
  onEscape?(): boolean
  /** Called when a pooled view is reopened into the main browsing area — keeps the feed overlay above it. */
  onViewAdded?(): void
  /** Web-zoom setting (#53), applied to every subagent pane. */
  getZoomPercent?(): number
  /** The main browsing area — the cards' Reopen control moves panes there (#57). */
  mainPane?: MainPaneRectSource
  /** Perf tracing for subagent LLM rounds (#29); absent keeps them unlogged. */
  tracer?: PerfTracer
}

export interface SubagentRuntime {
  /** spawn_agent / cancel_agent / agent_results for the orchestrator. */
  tools: Tool[]
  /** The pane pool behind browsing agents (rect reporting, reopen). */
  pool: SubagentPanePool
  /** Direct card-cancel path (the dashboard button) — no LLM round-trip. */
  cancel(agentId: string): boolean
  cancelAll(): number
  pauseAll(): void
  resumeAll(): void
  dispose(): void
}

function resolveLingerMs(env: Record<string, string | undefined>): number {
  const raw = Number(env[TAB_LINGER_ENV])
  return Number.isFinite(raw) && raw > 0 ? raw : SUBAGENT_LIMITS.tabLingerMs
}

export function createSubagentRuntime(deps: SubagentRuntimeDeps): SubagentRuntime {
  const clock = deps.clock ?? systemClock
  const fetchFn = deps.fetchFn ?? fetch
  const lingerMs = resolveLingerMs(deps.getEnv())
  const vision = createZaiVisionApi({ getEnv: deps.getEnv })

  const tabs = createSubagentTabs({ clock, lingerMs })
  // The capture loop asks the manager who is running, but the manager needs
  // the pool — a late-bound ref breaks the cycle, like bridgeRef below.
  const managerRef: { current?: ReturnType<typeof createSubagentManager> } = {}
  const pool = createSubagentPanePool(deps.win, tabs, {
    session: deps.session,
    ...(deps.onEscape ? { onEscape: deps.onEscape } : {}),
    ...(deps.onViewAdded ? { onViewAdded: deps.onViewAdded } : {}),
    ...(deps.getZoomPercent ? { getZoomPercent: deps.getZoomPercent } : {}),
    ...(deps.mainPane ? { mainPane: deps.mainPane } : {}),
    clock,
    // #57: ~1fps in-memory thumbnails while an agent runs and its card is
    // visible; frames ride the existing agent_update payload via the tab
    // machine, so the dashboard refreshes like any other card change.
    isAgentRunning: (agentId) => managerRef.current?.isRunning(agentId) ?? false,
    onThumbnail: (agentId, dataUrl) => tabs.update(agentId, { thumbnail: dataUrl }),
  })

  // The manager needs an event sink and the bridge needs the manager — a
  // late-bound ref breaks the cycle without ordering hacks.
  const bridgeRef: { bridge?: SubagentCardBridge } = {}
  const manager = createSubagentManager({
    taskApi: createSubagentTaskApi({
      getEnv: deps.getEnv,
      fetchFn,
      controllerFor: (agentId) => pool.controllerFor(agentId),
      backgroundTools: createBackgroundTools({ downloadsDir: deps.downloadsDir, fetchFn }),
      clock,
      vision,
      ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
      ...(deps.tracer ? { tracer: deps.tracer } : {}),
    }),
    tabs: {
      openFor: (agentId) => tabs.open(agentId, ''),
      finish: (agentId) => tabs.finish(agentId),
    },
    clock,
    onEvent: (event) => bridgeRef.bridge?.onManagerEvent(event),
  })
  managerRef.current = manager
  bridgeRef.bridge = createSubagentCardBridge({
    manager,
    tabs,
    clock,
    emit: (event) => {
      deps.emit(event)
      if (event.type === 'speak') {
        void deps.tts.speak(event.text).then((outcome) => {
          if (!outcome.ok) {
            deps.emit({ type: 'error', message: `Voice unavailable: ${outcome.error}`, at: clock.now() })
          }
        })
      }
    },
  })
  // Tab phase changes (lingering → closed, reopen) refresh the cards too.
  tabs.subscribe((tab) => bridgeRef.bridge?.onTabChange(tab))

  return {
    tools: createSubagentTools(manager),
    pool,
    cancel: (agentId) => manager.cancel(agentId).ok,
    cancelAll: () => manager.cancelAll(),
    pauseAll: () => manager.pauseAll(),
    resumeAll: () => manager.resumeAll(),
    dispose: () => pool.dispose(),
  }
}
