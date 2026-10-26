import { describe, expect, it, vi } from 'vitest'
import type { PlannerRequest } from '../../core/ports/plannerModel'
import type { ChatClient, ChatResult } from './chatCompletion'
import { createPlannerModel, plannerModelOver } from './createPlannerModel'

const facts = { model: 'glm-5.3', thinking: false, latencyMs: 812, waitedMs: 3, promptTokens: 2100, completionTokens: 40 }
const request: PlannerRequest = { goalLine: 'Add this to my playlist.', page: { url: 'https://www.youtube.com/watch?v=x', title: 'v' }, verbs: {}, memory: { steps: [], captures: [], card: null } }

function chatAnswering(result: ChatResult): ChatClient & { complete: ReturnType<typeof vi.fn> } {
  return { model: 'glm-5.3', thinking: false, complete: vi.fn(async () => result) }
}

describe('the Planner over the chat adapter (#465)', () => {
  it('asks with the Planner’s two messages and reads the first JSON object as its answer, with the call’s facts', async () => {
    const chat = chatAnswering({ status: 'answered', content: 'Here:\n{"next":"ask","question":"Which playlist?"}', ...facts })
    const result = await plannerModelOver(chat).plan(request)
    expect(chat.complete.mock.calls[0]![0]).toEqual([
      { role: 'system', content: expect.stringMatching(/exactly one JSON object/) },
      { role: 'user', content: expect.stringMatching(/^Goal Line: Add this to my playlist\.\n/) },
    ])
    expect(result).toEqual({ status: 'answered', answer: { next: 'ask', question: 'Which playlist?' }, ...facts })
  })

  it('is unavailable as unparsable for a reply with no JSON object, and as malformed for one that is no answer', async () => {
    expect(await plannerModelOver(chatAnswering({ status: 'answered', content: 'I would click the box.', ...facts })).plan(request)).toEqual({
      status: 'unavailable',
      reason: 'unparsable',
      message: 'no JSON object in the reply: I would click the box.',
      ...facts,
    })
    expect(await plannerModelOver(chatAnswering({ status: 'answered', content: '{"next":"act","action":{"kind":"evaluate"},"class":"stays"}', ...facts })).plan(request)).toMatchObject({
      status: 'unavailable',
      reason: 'malformed',
      message: expect.stringMatching(/^action kind "evaluate" is not one of/),
    })
  })

  it('passes the chat’s own unavailable through with its reason and status', async () => {
    const result = await plannerModelOver(chatAnswering({ status: 'unavailable', reason: 'http', httpStatus: 429, message: 'slow down', ...facts })).plan(request)
    expect(result).toEqual({ status: 'unavailable', reason: 'http', httpStatus: 429, message: 'slow down', ...facts })
  })

  it('fires one planner-step span per call, with what it came to', async () => {
    const onStep = vi.fn()
    await plannerModelOver(chatAnswering({ status: 'answered', content: '{"next":"done","sentence":"Added."}', ...facts }), { onStep }).plan(request)
    await plannerModelOver(chatAnswering({ status: 'answered', content: 'nothing', ...facts }), { onStep }).plan(request)
    expect(onStep.mock.calls.map(([span]) => span)).toEqual([
      { durMs: 812, detail: { model: 'glm-5.3', thinking: false, outcome: 'done', promptTokens: 2100, completionTokens: 40, waitedMs: 3 } },
      { durMs: 812, detail: { model: 'glm-5.3', thinking: false, outcome: 'unavailable', reason: 'unparsable', promptTokens: 2100, completionTokens: 40, waitedMs: 3 } },
    ])
  })

  it('is built from the env, or none without a key', () => {
    expect(createPlannerModel({})).toBeNull()
    expect(createPlannerModel({ ZAI_API_KEY: 'zk', BINGBONG_PLANNER_THINKING: 'on' })).toMatchObject({ model: 'glm-5.3', thinking: true })
  })
})
