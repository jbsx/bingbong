import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { answerRetryMessage, parseAssistantAnswer } from '../src/core/agent/answerContract'
import { resolveModelEndpoint } from '../src/core/agent/modelRouting'
import { systemClock } from '../src/core/ports/clock'
import type { LlmAttemptSent } from '../src/core/ports/llm'
import { LLM_REQUEST_TIMEOUT_MS } from '../src/core/pipeline/effortEpoch'
import { createOpenAiLlmClient } from '../src/main/agent/openAiLlmClient'
import { orchestratorSystemPrompt } from '../src/main/agent/orchestratorPrompt'
import { loadProductionEnv } from './eval/routing'

// #245 AC5: the Answer Retry, probed at the request level. The Run Trace
// keeps a request's hash and size, not its messages, and the reply this
// answers occurred once in every capture, so neither a whole-session replay
// nor a capture pass can reach it. This sends what the issue names and no
// more: the current orchestrator prompt, the Eurostar command, the recorded
// round-7 reply as the assistant's message, and the retry message exactly as
// the runtime builds it — three times, at the rung round 7 ran at (`high`,
// read from its llm_round record). It offers no tools and no tool history:
// round 7 carried ten tool results, which the trace cannot give back.
//
// Like the #221 replay it rides no vitest config (the unit suite excludes
// `e2e/**/*.probe.test.ts`) and spends real model budget, so it is run by
// hand, with a config outside the repo:
//
//   // <job tmp>/retry245.config.ts
//   import { defineConfig } from 'vitest/config'
//   export default defineConfig({
//     root: '<repo>',
//     test: { include: ['e2e/retry245.probe.test.ts'], testTimeout: 15 * 60_000 },
//   })
//
//   npx vitest run --config <job tmp>/retry245.config.ts
//
// It needs the repo `.env` (production routing) and no Electron. The bar —
// at least two of three replies on contract — is the issue's to read, so
// nothing here asserts the model's behaviour; broken measurement fails.

const ROUND_7 = readFileSync(fileURLToPath(new URL('../src/core/agent/fixtures/eurostar-round-7-reply.txt', import.meta.url)), 'utf8')

/** baseline-1's Eurostar initial command, verbatim from its capture. */
const COMMAND =
  'An adult is travelling London to Paris in Eurostar Standard. They can safely carry everything themselves: two ordinary suitcases, each 70 cm at its longest point, one small daypack, and an acoustic guitar in a case 90 cm long. Is the complete load included in the ordinary luggage allowance? Resolve whether the guitar is allowed despite its length, whether it consumes an allowance slot, and the smallest reduction in the carried items that would make the load fit. Distinguish the guitar rule from the rule for medium-sized instruments such as cellos. Use current official rules for this route. Do not book, buy, log in or contact anyone.'

const CALLS = 3
const OUT_DIR = fileURLToPath(new URL('./retry-245/', import.meta.url))

describe('#245 Answer Retry probe', () => {
  it('sends the retry three times and records each reply’s parser shape', async () => {
    const env = await loadProductionEnv()
    const endpoint = resolveModelEndpoint(env, 'orchestrator')
    const client = createOpenAiLlmClient({
      endpoint,
      systemPrompt: () => orchestratorSystemPrompt(systemClock),
      tools: [],
      fetchFn: fetch,
      requestTimeoutMs: LLM_REQUEST_TIMEOUT_MS,
    })

    // The fixture has to be the Malformed Answer it stands for, or the
    // message below is not the one the runtime would send.
    const malformed = parseAssistantAnswer(ROUND_7)
    expect(malformed.shape).toBe('malformed')
    const answerRetry = { reply: ROUND_7.trim(), message: answerRetryMessage(malformed.malformedError ?? '') }

    const calls: Record<string, unknown>[] = []
    for (let call = 1; call <= CALLS; call += 1) {
      const started = Date.now()
      let sent: LlmAttemptSent | undefined
      try {
        const turn = await client.complete({
          command: COMMAND,
          toolResults: [],
          reasoningEffort: 'high',
          answerRetry,
          onAttempt: (attempt) => {
            sent = attempt
          },
        })
        calls.push({
          call,
          elapsedMs: Date.now() - started,
          model: sent?.model ?? null,
          reasoningEffort: sent?.reasoningEffort ?? null,
          promptHash: sent?.promptHash ?? null,
          kind: turn.kind,
          ...(turn.kind === 'answer'
            ? {
                shape: turn.shape ?? null,
                ...(turn.malformedError !== undefined ? { malformedError: turn.malformedError } : {}),
                finalizationCause: turn.finalizationCause ?? null,
                resolution: turn.resolution ?? null,
                evidenceIds: turn.evidenceIds ?? null,
                speak: turn.speak,
                display: turn.display,
              }
            : { calls: turn.calls.map((toolCall) => toolCall.name) }),
          usage: turn.usage ?? null,
        })
      } catch (error) {
        calls.push({ call, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) })
      }
    }

    const onContract = calls.filter((entry) => entry.shape === 'on_contract').length
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(
      `${OUT_DIR}replies.json`,
      `${JSON.stringify({ issue: 245, ranAt: new Date().toISOString(), model: endpoint.model, retryMessage: answerRetry.message, bar: 'at least 2 of 3 on contract', onContract, calls }, null, 2)}\n`,
    )
    // Broken measurement fails; the model's replies are the issue's to read.
    expect(calls.filter((entry) => entry.error !== undefined)).toEqual([])
  })
})
