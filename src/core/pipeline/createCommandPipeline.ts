import type { PipelineEvent } from './events'
import type { RiskVerdict, Tool, ToolContext } from './tool'
import type { Clock } from '../ports/clock'
import type { LlmClient, ToolCall, ToolResult, ToolResultOutcome } from '../ports/llm'
import type { TtsSpeaker } from '../ports/tts'
import { spokenErrorLine } from '../agent/answerContract'
import { createVisionBudget, type VisionBudget } from '../agent/subagentRails'

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

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface CommandPipeline {
  execute(command: string): AsyncIterable<PipelineEvent>
  resolveConfirmation(confirmationId: string, approved: boolean): void
}

export function createCommandPipeline(deps: CommandPipelineDeps): CommandPipeline {
  const { llm, tts, clock, tools } = deps
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 60_000
  const maxToolRounds = deps.maxToolRounds ?? 20
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const toolContext: ToolContext = { clock }
  const pendingConfirmations = new Map<string, (decision: ConfirmationDecision) => void>()
  let confirmationCounter = 0

  async function* speakLine(text: string): AsyncGenerator<PipelineEvent> {
    yield { type: 'status', status: 'speaking', at: clock.now() }
    yield { type: 'speak', text, at: clock.now() }
    const outcome = await tts.speak(text)
    if (!outcome.ok) {
      // Voice is gone — the text is already on the dashboard, so the failure
      // itself degrades to a displayed one-liner.
      yield { type: 'error', message: spokenErrorLine(outcome.error), at: clock.now() }
    }
  }

  async function* execute(command: string): AsyncIterable<PipelineEvent> {
    yield { type: 'command', text: command, at: clock.now() }
    yield { type: 'status', status: 'thinking', at: clock.now() }

    try {
      const toolResults: ToolResult[] = []
      const visionBudget = createVisionBudget()
      let rounds = 0

      for (;;) {
        if (rounds >= maxToolRounds) {
          throw new Error(`tool round limit (${maxToolRounds}) reached`)
        }
        const turn = await llm.complete({ command, toolResults })
        if (turn.kind === 'answer') {
          yield { type: 'display', text: turn.display, at: clock.now() }
          yield* speakLine(turn.speak)
          break
        }

        yield { type: 'status', status: 'acting', at: clock.now() }
        rounds += 1
        for (const call of turn.calls) {
          yield { type: 'tool_call', callId: call.id, name: call.name, args: call.args, at: clock.now() }
          const outcome = yield* runGatedTool(call, visionBudget)
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
      // Errors are spoken as one-liners; the full detail reaches the
      // dashboard via the error event.
      const message = toErrorMessage(err)
      const spoken = spokenErrorLine(message)
      yield { type: 'error', message, at: clock.now() }
      yield* speakLine(spoken)
    }
    yield { type: 'done', at: clock.now() }
  }

  async function* runGatedTool(
    call: ToolCall,
    visionBudget: VisionBudget,
  ): AsyncGenerator<PipelineEvent, ToolResultOutcome> {
    const tool = toolsByName.get(call.name)
    if (!tool) return { ok: false, error: `unknown tool: '${call.name}'` }

    // Hard policy lives here, in code: a denied call never reaches execute,
    // even if the user would have approved it.
    const verdict = await assessCall(tool, call)
    if (verdict.kind === 'deny') {
      return { ok: false, error: verdict.reason }
    }
    if (verdict.kind === 'confirm') {
      const confirmationId = `confirm-${++confirmationCounter}`
      const decision = waitForConfirmation(confirmationId)
      yield {
        type: 'confirmation_requested',
        confirmationId,
        callId: call.id,
        toolName: call.name,
        prompt: verdict.prompt,
        expiresAt: clock.now() + confirmTimeoutMs,
        at: clock.now(),
      }
      // The prompt is both shown (dialog) and spoken; voice yes/no lands in T9.
      yield* speakLine(verdict.prompt)
      const resolved = await decision
      yield {
        type: 'confirmation_resolved',
        confirmationId,
        approved: resolved.approved,
        reason: resolved.reason,
        at: clock.now(),
      }
      if (!resolved.approved) {
        const detail =
          resolved.reason === 'timeout'
            ? 'denied — the user did not respond in time; do not retry this action'
            : 'denied by the user; do not retry this action'
        return { ok: false, error: detail }
      }
    }

    if (tool.usesVision) {
      const grant = visionBudget.tryAcquire()
      if (!grant.ok) return { ok: false, error: grant.reason }
    }

    try {
      const result = await tool.execute(call, toolContext)
      return { ok: true, result }
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) }
    }
  }

  async function assessCall(tool: Tool, call: ToolCall): Promise<RiskVerdict> {
    if (!tool.assessRisk) return { kind: 'allow' }
    try {
      return await tool.assessRisk(call)
    } catch {
      // Fail closed: when risk can't be assessed, ask the user.
      return { kind: 'confirm', prompt: `Run ${call.name}?` }
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
