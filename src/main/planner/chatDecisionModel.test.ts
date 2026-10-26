import { describe, expect, it, vi } from 'vitest'
import type { ChatClient, ChatResult } from './chatCompletion'
import { chatDecisionModel } from './chatDecisionModel'

const facts = { model: 'glm-5.3-flash', thinking: false, latencyMs: 1400, waitedMs: 0, promptTokens: 3000, completionTokens: 30 }
const questions = {
  action: { type: 'choice', instructions: 'Which one action?', options: { 'click-3': 'click [3] "Play"', back: null, none: 'not a command' } },
  stated: { type: 'noul', instructions: 'Does the page show a video?' },
} as const

function chatAnswering(content: string): ChatClient & { complete: ReturnType<typeof vi.fn> } {
  return { model: 'glm-5.3-flash', thinking: false, complete: vi.fn(async (): Promise<ChatResult> => ({ status: 'answered', content, ...facts })) }
}

describe('the Jev corpus asked of the chat adapter (#465, pnpm jev:gate --chat)', () => {
  it('puts the state and every question with its options in the user message, and reads one choice and its stated confidence per question', async () => {
    const chat = chatAnswering('{"action":{"choice":"click-3","confidence":0.9},"stated":{"noul":0.2}}')
    const model = chatDecisionModel(chat)
    const result = await model.ask({ state: 'The user said: "play it"', questions })
    const [messages] = chat.complete.mock.calls[0]!
    expect(messages[0]).toMatchObject({ role: 'system', content: expect.stringMatching(/exactly one JSON object/) })
    expect(messages[1].content).toBe(
      ['The user said: "play it"', '', 'Questions:', '', 'action (choice): Which one action?', '- click-3: click [3] "Play"', '- back', '- none: not a command', '', 'stated (noul): Does the page show a video?'].join('\n'),
    )
    expect(result).toEqual({
      status: 'answered',
      answers: { action: { type: 'choice', choice: 'click-3', confidence: 0.9, probabilities: { 'click-3': 0.9, back: 0, none: 0 } }, stated: { type: 'noul', noul: 0.2 } },
      latencyMs: 1400,
      model: 'glm-5.3-flash',
      inputTokens: 3000,
    })
    expect(model.readsImages).toBe(false)
  })

  it('takes a choice with no confidence as sure', async () => {
    const result = await chatDecisionModel(chatAnswering('{"action":{"choice":"back"},"stated":{"noul":1}}')).ask({ state: 's', questions })
    expect(result).toMatchObject({ status: 'answered', answers: { action: { choice: 'back', confidence: 1, probabilities: { back: 1 } } } })
  })

  it.each([
    ['no JSON', 'I pick click-3'],
    ['a label not offered', '{"action":{"choice":"click-9"},"stated":{"noul":0.1}}'],
    ['a question left out', '{"action":{"choice":"back"}}'],
  ])('is malformed on %s', async (_name, content) => {
    expect(await chatDecisionModel(chatAnswering(content)).ask({ state: 's', questions })).toMatchObject({ status: 'unavailable', reason: 'malformed', latencyMs: 1400, model: 'glm-5.3-flash' })
  })

  it('fires one planner-step span per ask: a choice, or unavailable with its reason', async () => {
    const onStep = vi.fn()
    await chatDecisionModel(chatAnswering('{"action":{"choice":"back"},"stated":{"noul":1}}'), { onStep }).ask({ state: 's', questions })
    await chatDecisionModel(chatAnswering('nope'), { onStep }).ask({ state: 's', questions })
    expect(onStep.mock.calls.map(([span]) => [span.durMs, span.detail.outcome, span.detail.reason])).toEqual([
      [1400, 'choice', undefined],
      [1400, 'unavailable', 'unparsable'],
    ])
  })
})
