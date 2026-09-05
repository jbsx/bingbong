import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { createPipelineEventTraceWriter, tracesPipelineEvent } from './pipelineEventTrace'
import { TRACE_TOOL_RESULT_MAX_CHARS, type TraceRecord } from './runTrace'
import type { RunId, SessionGeneration, SessionId } from '../session/sessionIdentity'

const runId = 'r-1' as RunId
const sessionId = 's-1' as SessionId
const generation = 1 as SessionGeneration

function collector(): { records: TraceRecord[]; sink: { write(record: TraceRecord): void } } {
  const records: TraceRecord[] = []
  return { records, sink: { write: (record) => void records.push(record) } }
}

function owned(event: PipelineEvent): PipelineEvent {
  return { ...event, runId, sessionId, sessionGeneration: generation }
}

describe('the pipeline_event tap (#185)', () => {
  it('records the event as published, under the identity it carries', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 1_700 })

    trace(owned({ type: 'run_plan', turnId: 't-1', objective: 'find the fare', headline: 'searching', effortTier: 'investigation', source: 'model', at: 5 }))

    expect(records).toEqual([
      {
        v: 1,
        at: 1_700,
        turnId: 't-1',
        runId,
        sessionId,
        generation,
        kind: 'pipeline_event',
        event: owned({ type: 'run_plan', turnId: 't-1', objective: 'find the fare', headline: 'searching', effortTier: 'investigation', source: 'model', at: 5 }),
      },
    ])
  })

  it('drops the streaming chunks and keeps everything else', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })

    trace({ type: 'llm_delta', turnId: 't-1', kind: 'reasoning', text: 'thinking', at: 1 })
    trace({ type: 'llm_tool_intent', turnId: 't-1', index: 0, name: 'click', args: '{"ref"', at: 2 })
    trace({ type: 'status', turnId: 't-1', status: 'acting', at: 3 })
    trace({ type: 'done', turnId: 't-1', outcome: 'done', at: 4 })

    expect(records.map((record) => 'event' in record && record.event.type)).toEqual(['status', 'done'])
    expect(tracesPipelineEvent({ type: 'llm_delta' })).toBe(false)
    expect(tracesPipelineEvent({ type: 'tool_result' })).toBe(true)
  })

  it('cuts a tool_result at the cap and says how long the result really was', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })
    const page = 'p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS + 4_000)

    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-1', name: 'read_page', ok: true, result: page, at: 9 })

    const [record] = records
    if (record === undefined || !('event' in record) || record.event.type !== 'tool_result') throw new Error('no record')
    expect(record.event.result).toBe('p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS))
    expect(record.chars).toBe(page.length)
  })

  it('leaves a short result whole and a non-text result untouched', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })

    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-1', name: 'click', ok: true, result: 'clicked', at: 1 })
    trace({ type: 'tool_result', turnId: 't-2', callId: 'c-2', name: 'agent_results', ok: true, result: { agents: 2 }, at: 2 })

    expect(records.map((record) => ('event' in record && record.event.type === 'tool_result' ? record.event.result : null))).toEqual([
      'clicked',
      { agents: 2 },
    ])
    // A text result always says its length, cut or not — same shape as
    // `reasoning`, so a reader never has to guess whether one was cut. A
    // result that is not text carries no length claim at all.
    expect(records.map((record) => ('chars' in record ? record.chars : undefined))).toEqual([7, undefined])
  })

  it('names only the identities the event carries — a lifecycle boundary has no turn', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })

    trace({ type: 'session_started', sessionId, sessionGeneration: generation, at: 1 })

    const [record] = records
    expect(record).toMatchObject({ sessionId, generation, kind: 'pipeline_event' })
    expect(record !== undefined && 'turnId' in record).toBe(false)
    expect(record !== undefined && 'runId' in record).toBe(false)
  })

  it('never lets a throwing sink fail the publication', () => {
    const trace = createPipelineEventTraceWriter({
      sink: {
        write() {
          throw new Error('logs dir is gone')
        },
      },
      now: () => 0,
    })

    expect(() => trace({ type: 'status', turnId: 't-1', status: 'thinking', at: 1 })).not.toThrow()
  })
})
