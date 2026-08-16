import type { LlmClient, AssistantTurn } from '../../core/ports/llm'
import type { TtsSpeaker } from '../../core/ports/tts'
import { systemClock, type Clock } from '../../core/ports/clock'
import type { BrowserController } from '../../core/ports/browser'
import { createCommandPipeline, type CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { createSingleShotPipeline } from '../../core/pipeline/singleShotPipeline'
import { createBrowserTools } from '../../core/pipeline/browserTools'
import { resolveModelEndpoint } from '../../core/agent/modelRouting'
import { ScriptedLlm, silentTts, UnavailableLlm } from '../../core/testing/doubles'
import { createOpenAiLlmClient } from './openAiLlmClient'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestratorPrompt'

export interface AssistantPipelineDeps {
  controller: BrowserController
  env: Record<string, string | undefined>
  fetchFn?: typeof fetch
  clock?: Clock
  tts?: TtsSpeaker
}

function resolveLlm(env: Record<string, string | undefined>, fetchFn: typeof fetch, tools: ReturnType<typeof createBrowserTools>): LlmClient {
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

/** The text-driven assistant: browser tools + model-routed LLM behind the command pipeline. */
export function createAssistantPipeline(deps: AssistantPipelineDeps): CommandPipeline {
  const tools = createBrowserTools(deps.controller)
  const clock = deps.clock ?? systemClock
  const pipeline = createCommandPipeline({
    llm: resolveLlm(deps.env, deps.fetchFn ?? fetch, tools),
    tts: deps.tts ?? silentTts,
    clock,
    tools,
  })
  return createSingleShotPipeline(pipeline, clock)
}
