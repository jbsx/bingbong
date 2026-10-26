// The Jev corpus asked of the chat adapter (#465, `pnpm jev:gate --chat`):
// a Decision Model over a chat client, so the same 223 cases measure the
// Planner's models on the daily lines — arm D's latency and accuracy of
// ADR 0095, free on the Coding Plan. The card is the user message as Jev
// sees it (the state, then each question with its options), and the
// answer is one JSON object naming a label per Choice with the model's own
// confidence, or a probability per Noul. A chat model has no
// probabilities: the stated confidence stands for the chosen label's and
// every other label is 0, so a case judged by a bar reads what the model
// said of itself. Text only. Imports carry .ts extensions (#36).

import { plannerStepSpan } from '../../core/planner/plannerSpan.ts'
import { firstJsonObject } from '../../core/planner/plannerAsk.ts'
import { readDecisionAnswers, type DecisionModel, type DecisionQuestions, type DecisionResult, type DecisionUnavailableReason } from '../../core/ports/decisionModel.ts'
import type { ChatClient } from './chatCompletion.ts'
import type { PlannerStepHook } from './createPlannerModel.ts'

export const CHAT_DECISION_INSTRUCTIONS = [
  'You answer typed questions about the state the user message gives: what a person said to a web browser, and the page.',
  'For a choice question, choose exactly one of its option labels and say how sure you are, from 0 to 1. For a noul question, give the probability, from 0 to 1, that its statement holds.',
  'Reply with exactly one JSON object and nothing else, one entry per question, keyed by the question\'s name:',
  '{"<name>": {"choice": "<label>", "confidence": <0..1>}} for a choice, {"<name>": {"noul": <0..1>}} for a noul.',
  'Answer every question, even one whose instructions say it is ignored: choose its likeliest label.',
].join('\n')

/** The user message: the state as recorded, then each question, its instructions and its options. */
export function chatDecisionAsk(state: string, questions: DecisionQuestions): string {
  const blocks = Object.entries(questions).map(([name, question]) => {
    const head = `${name} (${question.type}): ${question.instructions}`
    if (question.type === 'noul') return head
    return [head, ...Object.entries(question.options).map(([label, what]) => (what === null ? `- ${label}` : `- ${label}: ${what}`))].join('\n')
  })
  return [state, '', 'Questions:', '', blocks.join('\n\n')].join('\n')
}

/** A reply's object as the vendor answers the port reads: a Choice's stated confidence on its label, 0 on the rest. */
function asVendorAnswers(questions: DecisionQuestions, raw: Record<string, unknown>): unknown {
  const answers: Record<string, unknown> = {}
  for (const [name, question] of Object.entries(questions)) {
    const given = raw[name]
    if (typeof given !== 'object' || given === null) continue
    const answer = given as Record<string, unknown>
    if (question.type === 'noul') {
      answers[name] = { type: 'noul', noul: answer.noul }
      continue
    }
    const confidence = answer.confidence === undefined ? 1 : answer.confidence
    const probabilities = Object.fromEntries(Object.keys(question.options).map((label) => [label, label === answer.choice ? confidence : 0]))
    answers[name] = { type: 'choice', choice: answer.choice, confidence, probabilities }
  }
  return answers
}

export function chatDecisionModel(chat: ChatClient, hooks: PlannerStepHook = {}): DecisionModel {
  return {
    model: chat.model,
    readsImages: false,
    async ask<const Q extends DecisionQuestions>(request: { state: string; questions: Q; signal?: AbortSignal }): Promise<DecisionResult<Q>> {
      const reply = await chat.complete(
        [
          { role: 'system', content: CHAT_DECISION_INSTRUCTIONS },
          { role: 'user', content: chatDecisionAsk(request.state, request.questions) },
        ],
        { signal: request.signal },
      )
      const unavailable = (reason: DecisionUnavailableReason, message: string, httpStatus?: number): DecisionResult<Q> => ({
        status: 'unavailable',
        reason,
        message,
        latencyMs: reply.latencyMs,
        model: reply.model,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      })
      if (reply.status === 'unavailable') {
        hooks.onStep?.(plannerStepSpan(reply, 'unavailable', reply.reason))
        return unavailable(reply.reason, reply.message, reply.httpStatus)
      }
      const raw = firstJsonObject(reply.content)
      const answers = raw === null ? null : readDecisionAnswers(request.questions, asVendorAnswers(request.questions, raw))
      hooks.onStep?.(answers !== null ? plannerStepSpan(reply, 'choice') : plannerStepSpan(reply, 'unavailable', raw === null ? 'unparsable' : 'malformed'))
      if (answers === null) return unavailable('malformed', `${raw === null ? 'no JSON object' : 'not the questions asked'}: ${reply.content.replace(/\s+/g, ' ').trim().slice(0, 160)}`)
      return { status: 'answered', answers, latencyMs: reply.latencyMs, model: reply.model, ...(reply.promptTokens !== undefined ? { inputTokens: reply.promptTokens } : {}) }
    },
  }
}
