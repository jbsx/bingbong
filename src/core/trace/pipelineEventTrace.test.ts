import { describe, expect, it } from 'vitest'
import { composedAddressRewriteLine } from '../pipeline/composedAddressRail'
import type { PipelineEvent } from '../pipeline/events'
import { createPipelineEventTraceWriter, tracesPipelineEvent } from './pipelineEventTrace'
import { RUN_TRACE_VERSION, TRACE_TOOL_RESULT_MAX_CHARS, type TraceRecord } from './runTrace'
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
        v: RUN_TRACE_VERSION,
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

  it('stamps a run_plan record with the models each role is routed to (#191), and nothing else', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({
      sink,
      now: () => 0,
      models: () => ({ orchestrator: 'glm-5.3', vision: 'glm-4.6v', subagent: 'deepseek-chat' }),
    })

    trace(owned({ type: 'run_plan', turnId: 't-1', objective: 'find the fare', headline: null, effortTier: 'direct_action', source: 'fallback', at: 5 }))
    trace(owned({ type: 'status', turnId: 't-1', status: 'acting', at: 6 }))

    expect(records[0]).toMatchObject({ kind: 'pipeline_event', models: { orchestrator: 'glm-5.3', vision: 'glm-4.6v', subagent: 'deepseek-chat' } })
    expect(records[1]).not.toHaveProperty('models')
  })

  it('keeps a page read whole — the ref the model clicked is usually past the cut (#191)', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })
    const page = 'p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS + 4_000)

    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-1', name: 'read_page', ok: true, result: page, at: 9 })
    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-2', name: 'ground_visual', ok: true, result: page, at: 10 })

    for (const record of records) {
      if (!('event' in record) || record.event.type !== 'tool_result') throw new Error('not a tool_result record')
      expect(record.event.result).toBe(page)
      expect(record.chars).toBe(page.length)
    }
  })

  it('cuts every other tool_result at the cap and says how long the result really was', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })
    const page = 'p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS + 4_000)

    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-1', name: 'look', ok: true, result: page, at: 9 })

    const [record] = records
    if (record === undefined || !('event' in record) || record.event.type !== 'tool_result') throw new Error('no record')
    expect(record.event.result).toBe('p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS))
    expect(record.chars).toBe(page.length)
  })

  it('records a Not-found Landing as a field on the call, read before the cut (#239, ADR 0050)', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })
    const landing = `navigated: url=https://www.nasa.gov/x title="Page Not Found - NASA"\n${'p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS)}\nNOT-FOUND:404 www.nasa.gov\nThis address names nothing on nasa.gov.`

    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-1', name: 'navigate', ok: true, result: landing, at: 1 })
    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-2', name: 'navigate', ok: true, result: 'navigated: url=https://www.nasa.gov/ title="NASA"', at: 2 })
    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-3', name: 'navigate', ok: false, error: 'NOT-FOUND:404 www.nasa.gov', at: 3 })

    expect(records[0]).toMatchObject({ notFound: { basis: '404', host: 'www.nasa.gov' } })
    expect(records[1]).not.toHaveProperty('notFound')
    expect(records[2]).not.toHaveProperty('notFound')
  })

  it('records an Unavailable Landing as a sibling field, read before the cut (#262, ADR 0060)', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })
    const landing = `navigated: url=https://web.archive.org/web/2013/x title="Internet Archive: Temporarily Offline"\n${'p'.repeat(TRACE_TOOL_RESULT_MAX_CHARS)}\nUNAVAILABLE:title web.archive.org\narchive.org could not serve this page right now.`

    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-1', name: 'navigate', ok: true, result: landing, at: 1 })
    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-2', name: 'back', ok: true, result: 'went back\nUNAVAILABLE:503 www.jpl.nasa.gov\nadvice', at: 2 })
    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-3', name: 'navigate', ok: false, error: 'UNAVAILABLE:503 www.nasa.gov', at: 3 })

    expect(records[0]).toMatchObject({ unavailable: { basis: 'title', host: 'web.archive.org' } })
    expect(records[0]).not.toHaveProperty('notFound')
    expect(records[1]).toMatchObject({ unavailable: { basis: '503', host: 'www.jpl.nasa.gov' } })
    expect(records[2]).not.toHaveProperty('unavailable')
  })

  it('stamps a Composed Address rewrite from the event’s own field, a failed search included, never from the wording (#255, ADR 0055)', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })
    const search = 'https://duckduckgo.com/?q=voyager%20site%3Anasa.gov'
    const stamp = { site: 'nasa.gov', query: 'voyager site:nasa.gov' }
    const line = composedAddressRewriteLine({ ...stamp, from: 'https://www.nasa.gov/voyager', url: search, call: { id: 'c-1', name: 'navigate', args: { url: search } } })

    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-1', name: 'navigate', ok: true, result: `${line}\nnavigated: url=${search} title="DuckDuckGo"`, rewritten: stamp, at: 1 })
    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-2', name: 'navigate', ok: false, error: `${line}\nSearch loop limit reached`, rewritten: stamp, at: 2 })
    trace({ type: 'tool_result', turnId: 't-1', callId: 'c-3', name: 'navigate', ok: true, result: `${line}\nnavigated: url=${search} title="DuckDuckGo"`, at: 3 })

    expect(records[0]).toMatchObject({ rewritten: stamp })
    expect(records[1]).toMatchObject({ rewritten: stamp })
    expect(records[2]).not.toHaveProperty('rewritten')
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

  it('keeps the final Answer mark the pipeline stamped on a display (#224)', () => {
    const { records, sink } = collector()
    const trace = createPipelineEventTraceWriter({ sink, now: () => 0 })

    trace(owned({ type: 'display', turnId: 't-1', text: 'Here it is.', finalAnswer: true, at: 9 }))
    trace(owned({ type: 'display', turnId: 't-1', text: 'A worker line.', at: 10 }))

    expect(records.map((record) => ('event' in record && record.event.type === 'display' ? record.event.finalAnswer : null))).toEqual([true, undefined])
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
