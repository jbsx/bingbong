import type { Clock } from '../../core/ports/clock'
import type { LlmClient } from '../../core/ports/llm'
import type { Tool } from '../../core/pipeline/tool'
import type { BrowserController } from '../../core/ports/browser'
import type { VisionDescriber } from '../../core/ports/vision'
import type { UsageRecord } from '../../core/agent/usageTracking'
import { withUsageTracking } from '../../core/agent/usageTracking'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { withPerfTracing } from '../../core/perf/perfTracing'
import { resolveModelEndpoint, routingEnvKeys } from '../../core/agent/modelRouting'
import { runSubagent } from '../../core/agent/subagentRunner'
import type { SubagentKind, SubagentSpec, SubagentTaskApi, SubagentTaskHooks } from '../../core/agent/subagentManager'
import { ScriptedLlm, UnavailableLlm } from '../../core/testing/doubles'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import { hostFromUrl } from '../../core/pipeline/blockerGate'
import { createLookTool } from '../../core/pipeline/visionGroundingTools'
import { createSubagentAskTool } from '../../core/pipeline/askUserTools'
import { withoutConfirmations } from '../../core/pipeline/subagentToolPolicy'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { SUBAGENT_SYSTEM_PROMPT } from './subagentPrompt'

// The manager's taskApi, backed by real workhorse loops (issue #13): each
// spawn resolves the subagent LLM fresh (deepseek-chat via the router; a
// scripted override for tests/keyless demos — every agent starts the script
// from the top), gets the tool catalog for its kind, and runs runSubagent.
// Every kind carries the escalation-only ask_user (issue #18): subagents
// cannot reach the user, so their ask returns a directive the report relays
// through the orchestrator. Kinds are browse (own visible tab; ADR 0009
// killed the off-screen fetcher, so all web work is on-screen GUI search)
// and background (approved download/file tools).

const SUBAGENT_SCRIPT_ENV = 'BINGBONG_SUBAGENT_LLM_SCRIPT'

/** Env keys that decide the subagent LLM (mirrors the orchestrator's LLM_ENV_KEYS). */
export const SUBAGENT_LLM_ENV_KEYS = [SUBAGENT_SCRIPT_ENV, ...routingEnvKeys('subagent')]

export interface SubagentWorkhorseDeps {
  getEnv(): Record<string, string | undefined>
  fetchFn: typeof fetch
  /** The pane controller behind a browsing agent's tab; background agents pass nothing. */
  controllerFor?(agentId: string): BrowserController | null
  backgroundTools?: Tool[]
  clock?: Clock
  maxToolRounds?: number
  onUsage?(record: UsageRecord): void
  vision?: VisionDescriber
  /**
   * Perf tracing (#29), the same wrapper seam as the orchestrator: when a
   * spec carries its spawning turn's id, every workhorse round becomes a
   * `subagent-llm` span keyed to that turn; without an id nothing logs.
   */
  tracer?: PerfTracer
}

/** The per-kind tool catalog, exported for the surface pin in the test. */
export function toolsForKind(
  kind: SubagentKind,
  deps: SubagentWorkhorseDeps,
  controller: BrowserController | null,
): Tool[] {
  if (kind === 'background') return [createSubagentAskTool(), ...(deps.backgroundTools ?? [])]
  return controller
    ? [
        createSubagentAskTool(),
        ...withoutConfirmations(createBrowserTools(controller, deps.vision)),
        ...(deps.vision ? [createLookTool(controller, deps.vision)] : []),
      ]
    : [createSubagentAskTool()]
}

function resolveSubagentLlm(deps: SubagentWorkhorseDeps, tools: Tool[]): LlmClient {
  const env = deps.getEnv()
  const script = env[SUBAGENT_SCRIPT_ENV]
  if (script !== undefined && script.trim() !== '') {
    try {
      const scripted = new ScriptedLlm(JSON.parse(script))
      return deps.onUsage ? withUsageTracking(scripted, 'subagent', () => 'scripted', deps.onUsage) : scripted
    } catch (err) {
      return new UnavailableLlm(`${SUBAGENT_SCRIPT_ENV} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  try {
    const endpoint = resolveModelEndpoint(env, 'subagent')
    const client = createOpenAiLlmClient({ endpoint, systemPrompt: SUBAGENT_SYSTEM_PROMPT, tools, fetchFn: deps.fetchFn })
    return deps.onUsage
      ? withUsageTracking(client, 'subagent', () => endpoint.model, deps.onUsage)
      : client
  } catch (err) {
    return new UnavailableLlm(err instanceof Error ? err.message : String(err))
  }
}

export function createSubagentTaskApi(deps: SubagentWorkhorseDeps): SubagentTaskApi {
  return {
    start(spec: SubagentSpec, hooks: SubagentTaskHooks) {
      // One controller lookup per spawn, claimed only by tab kinds —
      // background agents must not grab a tab (looking one up would). The
      // kind structure mirrors toolsForKind's: whatever isn't background is
      // a browser kind.
      const controller = spec.kind !== 'background' ? deps.controllerFor?.(spec.id) ?? null : null
      const tools = toolsForKind(spec.kind, deps, controller)
      // Perf outermost, the same order as the orchestrator's client: the
      // span times the whole round including usage bookkeeping.
      const llm = deps.tracer
        ? withPerfTracing(resolveSubagentLlm(deps, tools), deps.tracer, 'subagent-llm')
        : resolveSubagentLlm(deps, tools)
      const done = runSubagent(
        {
          llm,
          tools,
          ...(deps.clock ? { clock: deps.clock } : {}),
          ...(deps.maxToolRounds !== undefined ? { maxToolRounds: deps.maxToolRounds } : {}),
          // The host this agent's own tab is on — the same-wall Blocker
          // gate (#81) classifies non-navigate browser calls by it, the
          // same seam the orchestrator uses for its main pane.
          ...(controller ? { currentHost: () => hostFromUrl(controller.state().url ?? '') } : {}),
        },
        {
          task: spec.task,
          // The report carries its producer's id (#98) — the provenance the
          // orchestrator cites when committing these findings.
          agentId: spec.id,
          ...(spec.turnId !== undefined ? { turnId: spec.turnId } : {}),
          // The delegated Memory Entries (#98): the frozen slice the
          // orchestrator selected for this task rides every model round as
          // untrusted, source-attributed context.
          ...(spec.memory !== undefined ? { memory: spec.memory } : {}),
          isCancelled: hooks.isCancelled,
          waitIfPaused: hooks.waitIfPaused ?? (() => Promise.resolve()),
          onProgress: (progress) => hooks.onProgress(progress.step, progress.action),
        },
      )
      return { done }
    },
  }
}

