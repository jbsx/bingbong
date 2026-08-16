import type { PipelineEvent } from './events'
import type { Tool, ToolContext } from './tool'
import type { Clock } from '../ports/clock'
import type { LlmClient, ToolCall, ToolResult, ToolResultOutcome } from '../ports/llm'
import type { TtsSpeaker } from '../ports/tts'

export interface CommandPipelineDeps {
  llm: LlmClient
  tts: TtsSpeaker
  clock: Clock
  tools: Tool[]
  confirmTimeoutMs?: number
  maxToolRounds?: number
}

interface ConfirmationDecision {
  approved: boolean
  reason: 'user' | 'timeout'
}

export interface CommandPipeline {
  execute(command: string): AsyncIterable<PipelineEvent>
  resolveConfirmation(confirmationId: string, approved: boolean): void
}

export function createCommandPipeline(deps: CommandPipelineDeps): CommandPipeline {
  const { llm, tts, clock, tools } = deps
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 60_000
  const maxToolRounds = deps.maxToolRounds ?? 8
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const toolContext: ToolContext = { clock }
  const pendingConfirmations = new Map<string, (decision: ConfirmationDecision) => void>()
  let confirmationCounter = 0

  async function* execute(command: string): AsyncIterable<PipelineEvent> {
    yield { type: 'command', text: command, at: clock.now() }
    yield { type: 'status', status: 'thinking', at: clock.now() }

    try {
      const toolResults: ToolResult[] = []
      let rounds = 0

      for (;;) {
        if (rounds >= maxToolRounds) {
          yield {
            type: 'error',
            message: `tool round limit (${maxToolRounds}) reached`,
            at: clock.now(),
          }
          break
        }
        const turn = await llm.complete({ command, toolResults })
        if (turn.kind === 'answer') {
          yield { type: 'display', text: turn.display, at: clock.now() }
          yield { type: 'status', status: 'speaking', at: clock.now() }
          yield { type: 'speak', text: turn.speak, at: clock.now() }
          await tts.speak(turn.speak)
          break
        }

        yield { type: 'status', status: 'acting', at: clock.now() }
        rounds += 1
        for (const call of turn.calls) {
          yield { type: 'tool_call', callId: call.id, name: call.name, args: call.args, at: clock.now() }
          const outcome = yield* runConfirmedTool(call)
          toolResults.push({ call, outcome })
          yield {
            type: 'tool_result',
            callId: call.id,
            name: call.name,
            ok: outcome.ok,
            ...(outcome.ok ? { result: outcome.result } : { error: outcome.error }),
            at: clock.now(),
          }
        }
        yield { type: 'status', status: 'thinking', at: clock.now() }
      }
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err), at: clock.now() }
    }
    yield { type: 'done', at: clock.now() }
  }

  async function* runConfirmedTool(call: ToolCall): AsyncGenerator<PipelineEvent, ToolResultOutcome> {
    const tool = toolsByName.get(call.name)
    if (!tool) return { ok: false, error: `unknown tool: '${call.name}'` }

    if (tool.requiresConfirmation) {
      const confirmationId = `confirm-${++confirmationCounter}`
      const prompt = tool.confirmationPrompt?.(call) ?? `Run ${call.name}?`
      const decision = waitForConfirmation(confirmationId)
      yield {
        type: 'confirmation_requested',
        confirmationId,
        callId: call.id,
        toolName: call.name,
        prompt,
        at: clock.now(),
      }
      const resolved = await decision
      yield {
        type: 'confirmation_resolved',
        confirmationId,
        approved: resolved.approved,
        reason: resolved.reason,
        at: clock.now(),
      }
      if (!resolved.approved) {
        return { ok: false, error: resolved.reason === 'timeout' ? 'denied by timeout' : 'denied by user' }
      }
    }

    try {
      const result = await tool.execute(call, toolContext)
      return { ok: true, result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  function waitForConfirmation(confirmationId: string): Promise<ConfirmationDecision> {
    return new Promise((resolve) => {
      const settle = (decision: ConfirmationDecision) => {
        pendingConfirmations.delete(confirmationId)
        cancelTimer()
        resolve(decision)
      }
      const cancelTimer = clock.setTimer(confirmTimeoutMs, () =>
        settle({ approved: false, reason: 'timeout' }),
      )
      pendingConfirmations.set(confirmationId, (decision) => settle({ ...decision, reason: 'user' }))
    })
  }

  return {
    execute,
    resolveConfirmation: (confirmationId, approved) => {
      pendingConfirmations.get(confirmationId)?.({ approved, reason: 'user' })
    },
  }
}
