import type { LlmClient, AssistantTurn } from '../../core/ports/llm'
import type { TtsSpeaker } from '../../core/ports/tts'
import { systemClock, type Clock } from '../../core/ports/clock'
import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import type { SearchProvider } from '../../core/ports/search'
import type { VisionLocator } from '../../core/ports/vision'
import { createCommandPipeline, type CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { createSingleShotPipeline } from '../../core/pipeline/singleShotPipeline'
import type { Tool } from '../../core/pipeline/tool'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import { createVisionGroundingTools } from '../../core/pipeline/visionGroundingTools'
import { createMediaTools } from '../../core/pipeline/mediaTools'
import { createSearchTools } from '../../core/pipeline/searchTools'
import { resolveModelEndpoint, routingEnvKeys } from '../../core/agent/modelRouting'
import type { UsageSink } from '../../core/agent/usageTracking'
import { withUsageTracking } from '../../core/agent/usageTracking'
import { ScriptedLlm, silentTts, UnavailableLlm } from '../../core/testing/doubles'
import { createDuckDuckGoSearchProvider } from '../search/createDuckDuckGoSearchProvider'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'
import { createZaiVisionLocator } from '../vision/createZaiVisionLocator'

export interface AssistantPipelineDeps {
  controller: BrowserController & VisualGroundingController
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
  /** Search provider behind web_search; DuckDuckGo HTML by default. */
  search?: SearchProvider
  /** Delegation tools (spawn/cancel/agent_results) when subagents are on. */
  subagentTools?: Tool[]
  /** Receives per-turn orchestrator token usage (daily spend estimate). */
  onLlmUsage?: UsageSink
  /** Override for deterministic tests; production uses the Z.AI Vision MCP adapter. */
  vision?: VisionLocator
}

function resolveLlm(
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch,
  tools: Tool[],
  onUsage?: UsageSink,
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

  return onUsage ? withUsageTracking(client, 'orchestrator', () => model, onUsage) : client
}

/** Env keys that decide which LLM client serves the orchestrator. */
const LLM_ENV_KEYS = ['BINGBONG_LLM_SCRIPT', ...routingEnvKeys('orchestrator')]

function llmSignature(env: Record<string, string | undefined>): string {
  return JSON.stringify(LLM_ENV_KEYS.map((key) => env[key] ?? ''))
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
): LlmClient {
  let signature: string | null = null
  let client: LlmClient | null = null
  return {
    complete(request) {
      const env = getEnv()
      const nextSignature = llmSignature(env)
      if (client === null || nextSignature !== signature) {
        client = resolveLlm(env, fetchFn, tools, onUsage)
        signature = nextSignature
      }
      return client.complete(request)
    },
  }
}

/** The text-driven assistant: browser, media and search tools + model-routed LLM behind the command pipeline. */
export function createAssistantPipeline(deps: AssistantPipelineDeps): CommandPipeline {
  const fetchFn = deps.fetchFn ?? fetch
  const search = deps.search ?? createDuckDuckGoSearchProvider({ fetchFn })
  const getEnv = deps.getEnv ?? (() => deps.env)
  const vision = deps.vision ?? createZaiVisionLocator({ getEnv })
  const tools: Tool[] = [
    ...createBrowserTools(deps.controller),
    ...createVisionGroundingTools(deps.controller, vision),
    ...createMediaTools(deps.controller),
    ...createSearchTools(search),
    ...(deps.subagentTools ?? []),
  ]
  const clock = deps.clock ?? systemClock
  const pipeline = createCommandPipeline({
    llm: createDynamicLlm(getEnv, fetchFn, tools, deps.onLlmUsage),
    tts: deps.tts ?? silentTts,
    clock,
    tools,
  })
  return createSingleShotPipeline(pipeline, clock)
}
