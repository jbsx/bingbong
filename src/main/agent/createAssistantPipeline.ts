import type { LlmClient, AssistantTurn } from '../../core/ports/llm'
import type { TtsSpeaker } from '../../core/ports/tts'
import { systemClock, type Clock } from '../../core/ports/clock'
import type { BrowserController } from '../../core/ports/browser'
import type { SearchProvider } from '../../core/ports/search'
import { createCommandPipeline, type CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { createSingleShotPipeline } from '../../core/pipeline/singleShotPipeline'
import type { Tool } from '../../core/pipeline/tool'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import { createMediaTools } from '../../core/pipeline/mediaTools'
import { createSearchTools } from '../../core/pipeline/searchTools'
import { resolveModelEndpoint } from '../../core/agent/modelRouting'
import { ScriptedLlm, silentTts, UnavailableLlm } from '../../core/testing/doubles'
import { createDuckDuckGoSearchProvider } from '../search/createDuckDuckGoSearchProvider'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'

export interface AssistantPipelineDeps {
  controller: BrowserController
  env: Record<string, string | undefined>
  fetchFn?: typeof fetch
  clock?: Clock
  tts?: TtsSpeaker
  /** Search provider behind web_search; DuckDuckGo HTML by default. */
  search?: SearchProvider
}

function resolveLlm(env: Record<string, string | undefined>, fetchFn: typeof fetch, tools: Tool[]): LlmClient {
  // Testing/demo hook: a scripted turn list instead of a live model. This is
  // what the e2e suite and keyless demos run against.
  const script = env.BINGBONG_LLM_SCRIPT
  if (script !== undefined && script.trim() !== '') {
    try {
      return new ScriptedLlm(JSON.parse(script) as AssistantTurn[])
    } catch (err) {
      return new UnavailableLlm(`BINGBONG_LLM_SCRIPT is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  try {
    const endpoint = resolveModelEndpoint(env, 'orchestrator')
    return createOpenAiLlmClient({ endpoint, systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT, tools, fetchFn })
  } catch (err) {
    return new UnavailableLlm(err instanceof Error ? err.message : String(err))
  }
}

/** The text-driven assistant: browser, media and search tools + model-routed LLM behind the command pipeline. */
export function createAssistantPipeline(deps: AssistantPipelineDeps): CommandPipeline {
  const fetchFn = deps.fetchFn ?? fetch
  const search = deps.search ?? createDuckDuckGoSearchProvider({ fetchFn })
  const tools: Tool[] = [
    ...createBrowserTools(deps.controller),
    ...createMediaTools(deps.controller),
    ...createSearchTools(search),
  ]
  const clock = deps.clock ?? systemClock
  const pipeline = createCommandPipeline({
    llm: resolveLlm(deps.env, fetchFn, tools),
    tts: deps.tts ?? silentTts,
    clock,
    tools,
  })
  return createSingleShotPipeline(pipeline, clock)
}
