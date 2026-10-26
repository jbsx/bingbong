import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from './events'
import { createStageSpans } from './stageSpans'

const status = (turnId: string, stage: 'thinking' | 'acting' | 'loading' | 'speaking' | 'cancelled', at: number, hop = 0): PipelineEvent => ({ type: 'status', turnId, status: stage, hop, at })
const done = (turnId: string, at: number): PipelineEvent => ({ type: 'done', turnId, at })

describe('createStageSpans (#442)', () => {
  it('times each stage from its start to the next stage or its turn’s end', () => {
    const spans: [string, number, { hop?: number }][] = []
    const onEvent = createStageSpans((stage, durMs, detail) => spans.push([stage, durMs, detail]))
    onEvent(status('t1', 'thinking', 1_000))
    onEvent(status('t1', 'acting', 1_400))
    onEvent(status('t1', 'loading', 1_500))
    onEvent(done('t1', 4_500))
    expect(spans).toEqual([
      ['stage-thinking', 400, { hop: 0 }],
      ['stage-acting', 100, { hop: 0 }],
      ['stage-loading', 3_000, { hop: 0 }],
    ])
  })

  it('keeps one span for a wait carried into the next hop’s turn, as the hint keeps its seconds', () => {
    const spans: [string, number][] = []
    const onEvent = createStageSpans((stage, durMs) => spans.push([stage, durMs]))
    onEvent(status('t1', 'loading', 1_000, 0))
    onEvent(status('t2', 'loading', 1_800, 0))
    onEvent(status('t2', 'thinking', 3_000, 1))
    expect(spans).toEqual([['stage-loading', 2_000]])
  })

  it('times no Stop', () => {
    const spans: string[] = []
    const onEvent = createStageSpans((stage) => spans.push(stage))
    onEvent(status('t1', 'cancelled', 1_000))
    onEvent(done('t1', 2_000))
    expect(spans).toEqual([])
  })
})
