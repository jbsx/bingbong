import type { LlmClient, AssistantTurn } from '../../core/ports/llm'
import type { TtsSpeaker } from '../../core/ports/tts'
import { systemClock, type Clock } from '../../core/ports/clock'
import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import type { VisionModel } from '../../core/ports/vision'
import type { SessionHistorySource, SessionResetSource } from '../../core/session/sessionMemory'
import { createCommandPipeline, type CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { createSingleShotPipeline } from '../../core/pipeline/singleShotPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { Tool } from '../../core/pipeline/tool'
import { createAskUserTool } from '../../core/pipeline/askUserTools'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import { hostFromUrl } from '../../core/pipeline/blockerGate'
import { createVisionGroundingTools } from '../../core/pipeline/visionGroundingTools'
import { createMediaTools } from '../../core/pipeline/mediaTools'
import { createNewSessionTool } from '../../core/pipeline/sessionTools'
import { createPanelTools, type PanelControls } from '../../core/pipeline/panelTools'
import { createAppControlTool, createSetSettingTool, type AppControls, type SettingsControls } from '../../core/pipeline/settingsTools'
import { resolveModelEndpoint, routingEnvKeys } from '../../core/agent/modelRouting'
import type { UsageSink } from '../../core/agent/usageTracking'
import { withUsageTracking } from '../../core/agent/usageTracking'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { withPerfTracing } from '../../core/perf/perfTracing'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import { ScriptedLlm, silentTts, UnavailableLlm } from '../../core/testing/doubles'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'
import { createZaiVisionApi } from '../vision/createZaiVisionApi'

export interface AssistantPipelineDeps {
  controller: BrowserController & VisualGroundingController
  env: Record<string, string | undefined>
  /**
   * Live env source (settings file layered over process.env). When provided,
   * the LLM is re-resolved on the next command after routing config changes,
   * so dashboard settings apply without a restart.
   */
  getEnv?: () => Record<string, string | undefined>
  /**
   * Live source for the orchestrator tool-round ceiling (the settings
   * slider): read at the start of each run, so changes apply to the next
   * command without a restart.
   */
  getMaxToolRounds?: () => number
  fetchFn?: typeof fetch
  clock?: Clock
  tts?: TtsSpeaker
  /** Delegation tools (spawn/cancel/agent_results) when subagents are on. */
  subagentTools?: Tool[]
  /** Fan-out controls shared with every running subagent. */
  subagentControl?: {
    cancelAll(): number
    pauseAll(): void
    resumeAll(): void
  }
  /** Receives per-turn orchestrator token usage (daily spend estimate). */
  onLlmUsage?: UsageSink
  /** Override for deterministic tests; production uses the Z.AI Vision MCP adapter. */
  vision?: VisionModel
  /**
   * Panel voice tools (#64, ADR 0006): toggle_panel/set_panel_mode on the
   * window's feed panel. Wired by main to the overlay attached to the same
   * window; absent in tests unless asserted.
   */
  panel?: PanelControls
  /**
   * Settings voice tool (#67, ADR 0006): set_setting writes through the
   * same settings-store seam the settings page drives, so changes apply
   * live. Wired by main to the app's settings store; absent in tests
   * unless asserted.
   */
  settings?: SettingsControls
  /**
   * App voice tool (#67, ADR 0006): app_control (quit/reload) behind the
   * yes/no confirmation gate, with a spoken ack before acting. Wired by
   * main per window; absent in tests unless asserted.
   */
  app?: AppControls
  /**
   * Session continuity (spec #23) and the model-invoked reset (spec #24):
   * prior distilled turns ride along with every orchestrator round, and the
   * model can clear them mid-run via the new_session tool. Created per
   * window by main and fed from the same run-observer seam as the history
   * recorder.
   */
  session?: SessionHistorySource & SessionResetSource
  /**
   * Always-on perf logging (#27/#28): the tracer mints the turn ids the
   * pipeline stamps on every event, so the perf log, the event stream, and
   * the history run rows share one id per turn.
   */
  tracer?: PerfTracer
  /**
   * Verbose browser sub-spans (#32): the same channel instance the browser
   * controller holds, so its internal delays and extra round-trips key to
   * the running turn. Absent (or the env flag off) — nothing below the
   * whole-action tool span is logged.
   */
  browserSubspans?: BrowserSubspans
  /**
   * Progress detail sink (#43): mid-await live signals (LLM retries, the
   * agent wait) reach the dashboard on the same pipeline event channel.
   * Wired by main to the window's emitter; absent in tests unless asserted.
   */
  emitDetail?: (event: PipelineEvent) => void
}

function resolveLlm(
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch,
  tools: Tool[],
  onUsage?: UsageSink,
  tracer?: PerfTracer,
): LlmClient {
  let client: LlmClient
  let model: string

  // Testing/demo hook: a scripted turn list instead of a live model. This is
  // what the e2e suite and keyless demos run against.
  const script = env.BINGBONG_LLM_SCRIPT
  if (script !== undefined && script.trim() !== '') {
    try {
      client = new ScriptedLlm(JSON.parse(script) as AssistantTurn[])
      model = 'scripted'
    } catch (err) {
      return new UnavailableLlm(`BINGBONG_LLM_SCRIPT is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    try {
      const endpoint = resolveModelEndpoint(env, 'orchestrator')
      client = createOpenAiLlmClient({ endpoint, systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT, tools, fetchFn })
      model = endpoint.model
    } catch (err) {
      return new UnavailableLlm(err instanceof Error ? err.message : String(err))
    }
  }

  const tracked = onUsage ? withUsageTracking(client, 'orchestrator', () => model, onUsage) : client
  // Perf sits outermost (#29): each orchestrator round is one `llm` span,
  // and retry attempts surface as their own events.
  return tracer ? withPerfTracing(tracked, tracer) : tracked
}

/** Env keys that decide which LLM client serves the orchestrator. */
const LLM_ENV_KEYS = ['BINGBONG_LLM_SCRIPT', ...routingEnvKeys('orchestrator')]

function llmSignature(env: Record<string, string | undefined>): string {
  return JSON.stringify(LLM_ENV_KEYS.map((key) => env[key] ?? ''))
}

function askTimeoutMs(env: Record<string, string | undefined>): number | undefined {
  const value = Number(env.BINGBONG_ASK_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Re-resolves the underlying client whenever the routing env changes between
 * commands. Resolution failures degrade to UnavailableLlm, so a half-edited
 * settings page never crashes the pipeline.
 */
function createDynamicLlm(
  getEnv: () => Record<string, string | undefined>,
  fetchFn: typeof fetch,
  tools: Tool[],
  onUsage?: UsageSink,
  tracer?: PerfTracer,
): LlmClient {
  let signature: string | null = null
  let client: LlmClient | null = null
  return {
    complete(request) {
      const env = getEnv()
      const nextSignature = llmSignature(env)
      if (client === null || nextSignature !== signature) {
        client = resolveLlm(env, fetchFn, tools, onUsage, tracer)
        signature = nextSignature
      }
      return client.complete(request)
    },
  }
}

/** The text-driven assistant: browser and media tools + model-routed LLM behind the command pipeline. */
export function createAssistantPipeline(deps: AssistantPipelineDeps): CommandPipeline {
  const fetchFn = deps.fetchFn ?? fetch
  const getEnv = deps.getEnv ?? (() => deps.env)
  const vision = deps.vision ?? createZaiVisionApi({ getEnv })
  const tools: Tool[] = [
    createAskUserTool(),
    ...createBrowserTools(deps.controller, vision),
    ...createVisionGroundingTools(deps.controller, vision),
    ...createMediaTools(deps.controller),
    ...(deps.subagentTools ?? []),
    // Panel voice tools (#64): silent, unconfirmed, model-invoked.
    ...(deps.panel ? createPanelTools(deps.panel) : []),
    // Settings voice tools (#67): set_setting immediate and silent;
    // app_control confirm-gated with a spoken ack.
    ...(deps.settings ? [createSetSettingTool(deps.settings)] : []),
    ...(deps.app ? [createAppControlTool(deps.app)] : []),
    // Offered only in rounds that carry history (requiresHistory), so a
    // fresh session's catalog stays lean (spec #24).
    ...(deps.session ? [createNewSessionTool(deps.session)] : []),
  ]
  const clock = deps.clock ?? systemClock
  const configuredAskTimeoutMs = askTimeoutMs(deps.env)
  const pipeline = createCommandPipeline({
    llm: createDynamicLlm(getEnv, fetchFn, tools, deps.onLlmUsage, deps.tracer),
    tts: deps.tts ?? silentTts,
    clock,
    tools,
    // Same-wall Blocker gate (#80, ADR 0010): the host current-page browser
    // verbs (click/type/scroll/…) target — the main tab's page.
    currentHost: () => hostFromUrl(deps.controller.state().url ?? ''),
    // Search-loop rail's GUI search signature (#82): typed searches are
    // classified from the typed ref's snapshot facts.
    describeRef: (ref) => deps.controller.describeRef(ref),
    ...(deps.session ? { session: deps.session } : {}),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
    ...(deps.browserSubspans ? { browserSubspans: deps.browserSubspans } : {}),
    ...(deps.emitDetail ? { emitDetail: deps.emitDetail } : {}),
    onAbort: () => deps.subagentControl?.cancelAll(),
    onPause: () => deps.subagentControl?.pauseAll(),
    onResume: () => deps.subagentControl?.resumeAll(),
    ...(configuredAskTimeoutMs !== undefined ? { askTimeoutMs: configuredAskTimeoutMs } : {}),
    ...(deps.getMaxToolRounds ? { getMaxToolRounds: deps.getMaxToolRounds } : {}),
  })
  return createSingleShotPipeline(pipeline, clock, { tracer: deps.tracer })
}
