// The Planner (#465, ADR 0095) over the OpenAI-compatible chat adapter:
// the routing from `BINGBONG_PLANNER_*` (GLM-5.3 on Z.ai by default), the
// appliance's own limiter, the two messages of the ask and the reading of
// the reply. Every call fires one `planner-step` span through `onStep`
// when one is given. Nothing in the daily path asks it yet: the Errand
// loop is #467. Imports carry .ts extensions (#36).

import { createPlannerLimiter, type PlannerLimiter } from '../../core/planner/limiter.ts'
import { firstJsonObject, plannerMessages, readPlannerAnswer } from '../../core/planner/plannerAsk.ts'
import { resolvePlannerRouting, type ConfiguredPlannerRouting } from '../../core/planner/plannerRouting.ts'
import { plannerStepSpan, type PlannerStepDetail } from '../../core/planner/plannerSpan.ts'
import type { PlannerModel, PlannerResult } from '../../core/ports/plannerModel'
import { createChatClient, type ChatClient } from './chatCompletion.ts'

export interface PlannerStepHook {
  /** Hears one `planner-step` span per call. */
  readonly onStep?: (span: { durMs: number; detail: PlannerStepDetail }) => void
}

/** The Planner over one chat client. */
export function plannerModelOver(chat: ChatClient, hooks: PlannerStepHook = {}): PlannerModel {
  return {
    model: chat.model,
    thinking: chat.thinking,
    async plan(request) {
      const { system, user } = plannerMessages(request)
      const reply = await chat.complete(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { signal: request.signal },
      )
      let result: PlannerResult
      if (reply.status === 'unavailable') {
        result = reply
      } else {
        const { content, ...facts } = reply
        const raw = firstJsonObject(content)
        const answer = raw === null ? null : readPlannerAnswer(raw)
        if (answer === null) result = { ...facts, status: 'unavailable', reason: 'unparsable', message: `no JSON object in the reply: ${content.replace(/\s+/g, ' ').trim().slice(0, 160)}` }
        else if (typeof answer === 'string') result = { ...facts, status: 'unavailable', reason: 'malformed', message: answer }
        else result = { ...facts, status: 'answered', answer }
      }
      hooks.onStep?.(result.status === 'answered' ? plannerStepSpan(result, result.answer.next) : plannerStepSpan(result, 'unavailable', result.reason))
      return result
    },
  }
}

/** A chat client on the routing's endpoint, through the given limiter or one of the routing's own. */
export function plannerChatClient(routing: ConfiguredPlannerRouting, limiter?: PlannerLimiter, fetchImpl?: typeof fetch): ChatClient {
  return createChatClient(routing.endpoint, {
    timeoutMs: routing.timeoutMs,
    thinking: routing.thinking,
    limiter: limiter ?? createPlannerLimiter({ perSecond: routing.perSecond, inFlight: routing.inFlight }),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  })
}

/** The Planner the env names, or none when it has no key. */
export function createPlannerModel(env: Record<string, string | undefined>, hooks: PlannerStepHook = {}): PlannerModel | null {
  const routing = resolvePlannerRouting(env)
  if (!routing.configured) return null
  return plannerModelOver(plannerChatClient(routing), hooks)
}
