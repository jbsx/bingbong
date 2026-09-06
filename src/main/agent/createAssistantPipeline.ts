import type { LlmClient, AssistantTurn } from '../../core/ports/llm'
import type { TtsSpeaker } from '../../core/ports/tts'
import { systemClock, type Clock } from '../../core/ports/clock'
import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import type { VisionModel } from '../../core/ports/vision'
import { createCommandPipeline, type CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { Tool } from '../../core/pipeline/tool'
import { createAskUserTool } from '../../core/pipeline/askUserTools'
import { createReportRunPlanTool } from '../../core/pipeline/runPlanTools'
import { createRecordEvidenceTool } from '../../core/pipeline/evidenceTools'
import { createRecordCandidateTool } from '../../core/pipeline/candidateTools'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import type { BrowserCustody } from '../../core/browser/unsettledAction'
import { hostFromUrl } from '../../core/pipeline/blockerGate'
import { createVisionGroundingTools } from '../../core/pipeline/visionGroundingTools'
import type { VisionTraceReporter } from '../../core/trace/visionTrace'
import { createMediaTools } from '../../core/pipeline/mediaTools'
import { createNewSessionTool } from '../../core/pipeline/sessionTools'
import { createPanelTools, type PanelControls } from '../../core/pipeline/panelTools'
import { createAppControlTool, createSetSettingTool, type AppControls, type SettingsControls } from '../../core/pipeline/settingsTools'
import {
  REASONING_EFFORT_ENV_KEY,
  resolveModelEndpoint,
  resolveReasoningEffortOverride,
  routingEnvKeys,
} from '../../core/agent/modelRouting'
import type { LearnedTermsControls } from '../../core/voice/learnedTerms'
import type { UsageSink } from '../../core/agent/usageTracking'
import { withUsageTracking } from '../../core/agent/usageTracking'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { withPerfTracing } from '../../core/perf/perfTracing'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import type { ObservationRecord } from '../../core/session/observationLedger'
import type { CollectedSubagentReport } from '../../core/agent/subagentManager'
import { ScriptedLlm, silentTts, UnavailableLlm } from '../../core/testing/doubles'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { orchestratorSystemPrompt } from './orchestratorPrompt'
import { createZaiVisionApi } from '../vision/createZaiVisionApi'

export interface AssistantPipelineDeps {
  /**
   * The shared browsing resource, in custody (#205, ADR 0038). A custody
   * rather than a controller because the pipeline is not this resource's
   * owner: whoever holds it — main, the CLI harness, the failure screenshot
   * — must reach it through the same custody, or a withheld pane would be
   * acted on behind the Run's back. Taking the handle here makes handing
   * over an unguarded controller a type error rather than an oversight.
   */
  browser: BrowserCustody<BrowserController & VisualGroundingController>
  env: Record<string, string | undefined>
  /**
   * Live env source (settings file layered over process.env). When provided,
   * the LLM is re-resolved on the next command after routing config changes,
   * so dashboard settings apply without a restart.
   */
  getEnv?: () => Record<string, string | undefined>
  fetchFn?: typeof fetch
  clock?: Clock
  tts?: TtsSpeaker
  /** Delegation tools (spawn/cancel/agent_results) when subagents are on. */
  subagentTools?: Tool[]
  /**
   * Delegated workers' retained observations (#123, ADR 0028), by agent
   * id — the grounding for kind "subagent" Evidence Checkpoints. Wired by
   * main to the subagent runtime's report lookup; absent in tests unless
   * asserted.
   */
  subagentObservations?: (agentId: string) => readonly ObservationRecord[] | null
  /** Fan-out controls shared with every running subagent. */
  subagentControl?: {
    cancelAll(): number
    pauseAll(): void
    resumeAll(): void
    /** The parent Run entered Finalization (#199, ADR 0035): told, never cancelled. */
    tellParentFinalizing?(): number
    /** Resolves once every worker running at the call has settled (#199). */
    settledAll?(): Promise<void>
    /** The Report Grace ended (#199): still-running workers abandon their round. */
    endReportGrace?(): number
    collectCompleted?(turnId: string): CollectedSubagentReport[]
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
   * Live source for the Learned Terms list (ADR 0022): read as each round's
   * system prompt is built, so the model always sees the current lexicon —
   * what not to re-propose and what it may remove.
   */
  getLearnedTerms?: () => readonly string[]
  /**
   * The ledger seam (ADR 0022): done runs' validated Mishear proposals and
   * the per-run transcript LRU touch, wired by main to the app-global
   * lexicon store. Absent in tests unless asserted.
   */
  learnedTerms?: LearnedTermsControls
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
   * Always-on perf logging (#27/#28): the tracer mints the turn ids the
   * pipeline stamps on every event, so the perf log, the event stream, and
   * the history run rows share one id per turn.
   */
  tracer?: PerfTracer
  /**
   * The vision seam's reporter (#186, ADR 0031): what a Look, an
   * auto-vision Describe or a ground_visual Locate records through, routed
   * by the ids the tool had. Absent when neither trace family is on.
   */
  traceVision?: VisionTraceReporter
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
  clock: Clock,
  onUsage?: UsageSink,
  tracer?: PerfTracer,
  getLearnedTerms?: () => readonly string[],
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
      const effortOverride = resolveReasoningEffortOverride(env)
      client = createOpenAiLlmClient({
        endpoint,
        // The runtime context getter (#103): the client below is cached
        // across Runs, so the date is re-derived when each round's messages
        // are built — a Run started after midnight sees the new date. The
        // learned-terms getter (ADR 0022) rides the same closure.
        systemPrompt: () => orchestratorSystemPrompt(clock, getLearnedTerms?.()),
        tools,
        fetchFn,
        // The experiment override (#166): set, it forces every round to
        // one rung. Unset, each round carries the Effort Tier's own.
        ...(effortOverride !== undefined ? { reasoningEffort: effortOverride } : {}),
      })
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
const LLM_ENV_KEYS = ['BINGBONG_LLM_SCRIPT', REASONING_EFFORT_ENV_KEY, ...routingEnvKeys('orchestrator')]

function llmSignature(env: Record<string, string | undefined>): string {
  return JSON.stringify(LLM_ENV_KEYS.map((key) => env[key] ?? ''))
}

function askTimeoutMs(env: Record<string, string | undefined>): number | undefined {
  const value = Number(env.BINGBONG_ASK_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Test/e2e override for every tier's active-work deadline (#135):
 * `BINGBONG_ACTIVE_WORK_DEADLINE_MS` lets time-based coverage reproduce
 * a deadline crossing in seconds. Production never sets it.
 */
function activeWorkDeadlineMs(env: Record<string, string | undefined>): number | undefined {
  const value = Number(env.BINGBONG_ACTIVE_WORK_DEADLINE_MS)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Test/e2e override for the Report Grace (#199, ADR 0035):
 * `BINGBONG_REPORT_GRACE_MS` lets coverage reproduce a grace that
 * elapses in milliseconds. Zero is honoured — it is how a suite that
 * delegates opts out of the wait entirely. Production never sets it.
 */
function reportGraceMs(env: Record<string, string | undefined>): number | undefined {
  const raw = env.BINGBONG_REPORT_GRACE_MS
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
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
  clock: Clock,
  onUsage?: UsageSink,
  tracer?: PerfTracer,
  getLearnedTerms?: () => readonly string[],
): LlmClient {
  let signature: string | null = null
  let client: LlmClient | null = null
  return {
    complete(request) {
      const env = getEnv()
      const nextSignature = llmSignature(env)
      if (client === null || nextSignature !== signature) {
        client = resolveLlm(env, fetchFn, tools, clock, onUsage, tracer, getLearnedTerms)
        signature = nextSignature
      }
      return client.complete(request)
    },
  }
}

/** The text-driven assistant: browser and media tools + model-routed LLM behind the command pipeline. */
export function createAssistantPipeline(deps: AssistantPipelineDeps): CommandPipeline {
  const fetchFn = deps.fetchFn ?? fetch
  // Every tool, gate, and rail below reaches the pane through the custody
  // its owner handed in, which outlives any one Run — so a Run that
  // abandoned an action leaves the *next* Run refused too.
  const custody = deps.browser
  const controller = custody.controller
  const getEnv = deps.getEnv ?? (() => deps.env)
  const vision = deps.vision ?? createZaiVisionApi({ getEnv })
  const tools: Tool[] = [
    createAskUserTool(),
    // The Run Plan (#116, ADR 0025/0027): the orchestrator declares the
    // objective, Run Headline, and Effort Tier; the pipeline re-emits
    // them for the Peek Card, policy, and telemetry.
    createReportRunPlanTool(),
    // The Evidence Checkpoint (#121, ADR 0028): grounded web Observations
    // enter Session Evidence mid-Run and survive the Run's outcome.
    // Orchestrator-only — Subagents report findings; the orchestrator
    // checkpoints them.
    createRecordEvidenceTool(),
    // The Candidate Checkpoint (#122, ADR 0028): grounded Candidates and
    // their terminal decisions, citing live supporting Observations.
    // Orchestrator-only bookkeeping, like record_evidence.
    createRecordCandidateTool(),
    ...createBrowserTools(controller, vision),
    ...createVisionGroundingTools(controller, vision),
    ...createMediaTools(controller),
    ...(deps.subagentTools ?? []),
    // Panel voice tools (#64): silent, unconfirmed, model-invoked.
    ...(deps.panel ? createPanelTools(deps.panel) : []),
    // Settings voice tools (#67): set_setting immediate and silent;
    // app_control confirm-gated with a spoken ack.
    ...(deps.settings ? [createSetSettingTool(deps.settings)] : []),
    ...(deps.app ? [createAppControlTool(deps.app)] : []),
    // The model-invoked Session Reset boundary (#99): offered only in
    // rounds that carry continuity, so a fresh Session's catalog stays
    // lean (spec #24).
    createNewSessionTool(),
  ]
  const clock = deps.clock ?? systemClock
  const configuredAskTimeoutMs = askTimeoutMs(deps.env)
  const configuredActiveWorkDeadlineMs = activeWorkDeadlineMs(deps.env)
  const configuredReportGraceMs = reportGraceMs(deps.env)
  // Stop and Steering cancel delegated work (#119/#120): Stop ends the
  // run, and a directive supersedes everything spawned under the
  // corrected-away objective. Finalization no longer joins them (#199,
  // ADR 0035) — it tells its workers instead and waits the Report Grace.
  const cancelSubagents = (): void => {
    deps.subagentControl?.cancelAll()
  }
  // Stop also lets go of whatever the pane is doing (#205, ADR 0038): the
  // Run's wait ends now, the pane stays withheld until that action is
  // observed to end. Two boundaries, not one — nothing here claims the
  // action was undone.
  const stopBrowsing = (): void => {
    custody.abandon()
    cancelSubagents()
  }
  const pipeline = createCommandPipeline({
    llm: createDynamicLlm(getEnv, fetchFn, tools, clock, deps.onLlmUsage, deps.tracer, deps.getLearnedTerms),
    tts: deps.tts ?? silentTts,
    clock,
    tools,
    // Same-wall Blocker gate (#80, ADR 0010): the host current-page browser
    // verbs (click/type/scroll/…) target — the main tab's page.
    currentHost: () => hostFromUrl(controller.state().url ?? ''),
    // Search-loop rail's GUI search signature (#82): typed searches are
    // classified from the typed ref's snapshot facts.
    describeRef: (ref) => controller.describeRef(ref),
    // Observation ledger source URLs (#111): the visible tab's current page.
    currentPageUrl: () => controller.state().url ?? null,
    // No-progress rails (#126, ADR 0027): the visible tab's settled page
    // state — the Progress fingerprints' comparison input, read at gate
    // time and after each successful page-facing action.
    settledPageState: () => controller.settledState(),
    // Worker observations (#123): completed reports' hidden provenance,
    // for kind "subagent" Evidence Checkpoint grounding.
    ...(deps.subagentObservations ? { subagentObservations: deps.subagentObservations } : {}),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
    ...(deps.traceVision ? { traceVision: deps.traceVision } : {}),
    ...(deps.browserSubspans ? { browserSubspans: deps.browserSubspans } : {}),
    ...(deps.emitDetail ? { emitDetail: deps.emitDetail } : {}),
    ...(deps.learnedTerms ? { learnedTerms: deps.learnedTerms } : {}),
    onAbort: stopBrowsing,
    onPause: () => deps.subagentControl?.pauseAll(),
    onResume: () => deps.subagentControl?.resumeAll(),
    // A Steering directive corrects the objective (#119): delegated
    // work spawned under the stale one is cancelled, not resumed.
    onSteer: cancelSubagents,
    // Finalization tells its live workers rather than cancelling them
    // (#199, ADR 0035), and the Run waits the Report Grace for each
    // one's report before the bookkeeping round it can be checkpointed in.
    onFinalize: () => {
      deps.subagentControl?.tellParentFinalizing?.()
    },
    ...(deps.subagentControl?.settledAll
      ? { subagentReportsSettled: () => deps.subagentControl!.settledAll!() }
      : {}),
    ...(deps.subagentControl?.endReportGrace
      ? {
          onReportGraceEnd: () => {
            deps.subagentControl!.endReportGrace!()
          },
        }
      : {}),
    ...(configuredReportGraceMs !== undefined ? { reportGraceMs: configuredReportGraceMs } : {}),
    ...(deps.subagentControl?.collectCompleted
      ? { collectCompletedSubagentResults: (turnId: string) => deps.subagentControl!.collectCompleted!(turnId) }
      : {}),
    ...(configuredAskTimeoutMs !== undefined ? { askTimeoutMs: configuredAskTimeoutMs } : {}),
    ...(configuredActiveWorkDeadlineMs !== undefined ? { activeWorkDeadlineMs: configuredActiveWorkDeadlineMs } : {}),
  })
  return pipeline
}
