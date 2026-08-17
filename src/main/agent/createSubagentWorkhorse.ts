import type { Clock } from '../../core/ports/clock'
import type { LlmClient } from '../../core/ports/llm'
import type { SearchProvider } from '../../core/ports/search'
import type { Tool } from '../../core/pipeline/tool'
import type { BrowserController } from '../../core/ports/browser'
import type { UsageRecord } from '../../core/agent/usageTracking'
import { withUsageTracking } from '../../core/agent/usageTracking'
import { resolveModelEndpoint, routingEnvKeys } from '../../core/agent/modelRouting'
import { runSubagent } from '../../core/agent/subagentRunner'
import type { SubagentKind, SubagentSpec, SubagentTaskApi, SubagentTaskHooks } from '../../core/agent/subagentManager'
import { ScriptedLlm, UnavailableLlm } from '../../core/testing/doubles'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import { createSearchTools } from '../../core/pipeline/searchTools'
import { createReadUrlTool } from '../../core/pipeline/readUrlTool'
import { withoutConfirmations } from '../../core/pipeline/subagentToolPolicy'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { SUBAGENT_SYSTEM_PROMPT } from './subagentPrompt'

// The manager's taskApi, backed by real workhorse loops (issue #13): each
// spawn resolves the subagent LLM fresh (deepseek-chat via the router; a
// scripted override for tests/keyless demos — every agent starts the script
// from the top), gets the tool catalog for its kind, and runs runSubagent.

const SUBAGENT_SCRIPT_ENV = 'BINGBONG_SUBAGENT_LLM_SCRIPT'

/** Env keys that decide the subagent LLM (mirrors the orchestrator's LLM_ENV_KEYS). */
export const SUBAGENT_LLM_ENV_KEYS = [SUBAGENT_SCRIPT_ENV, ...routingEnvKeys('subagent')]

export interface SubagentWorkhorseDeps {
  getEnv(): Record<string, string | undefined>
  fetchFn: typeof fetch
  /** The pane controller behind a browsing agent's tab; research agents pass nothing. */
  controllerFor?(agentId: string): BrowserController | null
  backgroundTools?: Tool[]
  search?: SearchProvider
  clock?: Clock
  maxToolRounds?: number
  onUsage?(record: UsageRecord): void
}

function toolsForKind(
  kind: SubagentKind,
  deps: SubagentWorkhorseDeps,
  spec: SubagentSpec,
): Tool[] {
  if (kind === 'research') {
    const tools: Tool[] = []
    if (deps.search) tools.push(...createSearchTools(deps.search))
    tools.push(createReadUrlTool({ fetchFn: deps.fetchFn }))
    return tools
  }
  if (kind === 'background') return deps.backgroundTools ?? []
  const controller = deps.controllerFor?.(spec.id) ?? null
  return controller ? withoutConfirmations(createBrowserTools(controller)) : []
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
      const tools = toolsForKind(spec.kind, deps, spec)
      const llm = resolveSubagentLlm(deps, tools)
      const done = runSubagent(
        {
          llm,
          tools,
          ...(deps.clock ? { clock: deps.clock } : {}),
          ...(deps.maxToolRounds !== undefined ? { maxToolRounds: deps.maxToolRounds } : {}),
        },
        { task: spec.task, isCancelled: hooks.isCancelled, onProgress: (progress) => hooks.onProgress(progress.step, progress.action) },
      )
      return { done }
    },
  }
}
