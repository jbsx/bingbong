import { describe, expect, it } from 'vitest'
import { buildTraceTimeline, type TaggedTraceRecord, type TraceLine } from './traceTimeline'

// The Trace UI's model (#189): three file families joined on the ids each
// line carries. A turn's records — perf spans, Run Trace lines, and the
// Host Trace lines that happen to name a turn — fold into one lane sorted
// by `at`; everything that names no turn falls into a lane per Session,
// with `null` a Session of its own ("the app did this with no Session
// live" is a diagnosis, not missing data — ADR 0031).

const T0 = 1_700_000_000_000

function perf(turnId: string, stage: string, durMs: number, at: number): TaggedTraceRecord {
  return { family: 'perf', record: { turnId, stage, durMs, at, t: at - T0 } }
}

function run(record: TraceLine): TaggedTraceRecord {
  return { family: 'run', record: { v: 1, ...record } }
}

function host(record: TraceLine): TaggedTraceRecord {
  return { family: 'host', record: { v: 1, ...record } }
}

describe('buildTraceTimeline', () => {
  it('folds one turn across the three families into one lane ordered by `at`', () => {
    const timeline = buildTraceTimeline([
      perf('turn-1', 'llm', 400, T0 + 900),
      run({
        at: T0 + 100,
        turnId: 'turn-1',
        runId: 'run-a',
        sessionId: 'sess-1',
        generation: 1,
        kind: 'pipeline_event',
        event: { type: 'command', turnId: 'turn-1', text: 'open the news', at: T0 + 100 },
      }),
      host({ at: T0 + 950, sessionId: 'sess-1', kind: 'tts_line', text: 'Here is the news.', chars: 17, turnId: 'turn-1' }),
      perf('turn-1', 'stt', 120, T0 + 50),
    ])

    expect(timeline.lanes).toHaveLength(1)
    const lane = timeline.lanes[0]
    expect(lane).toMatchObject({ scope: 'turn', turnId: 'turn-1', sessionId: 'sess-1', runId: 'run-a' })
    expect(lane.startAt).toBe(T0 + 50)
    expect(lane.endAt).toBe(T0 + 950)
    expect(lane.entries.map((entry) => [entry.at - T0, entry.family, entry.label])).toEqual([
      [50, 'perf', 'stt'],
      [100, 'run', 'command'],
      [900, 'perf', 'llm'],
      [950, 'host', 'tts_line'],
    ])
  })

  it('gives every record without a turn a lane per Session, null included', () => {
    const timeline = buildTraceTimeline([
      host({ at: T0 + 10, sessionId: null, kind: 'fault', site: 'gpu.attach', message: 'no gpu' }),
      host({ at: T0 + 20, sessionId: 'sess-1', kind: 'voice_wake', head: 'wake', score: 0.9, threshold: 0.5, gateMax: 0.7, gate: 0.3 }),
      run({
        at: T0 + 30,
        sessionId: 'sess-1',
        generation: 1,
        kind: 'evidence_accepted',
        change: 'observation',
        entryId: 'e1',
        counts: { observations: 1, candidates: 0, contradictions: 0 },
        merged: false,
        contradicted: [],
      }),
      run({ at: T0 + 40, kind: 'evidence_answered', requester: 'dashboard', answered: 'no_session' }),
    ])

    expect(timeline.lanes.map((lane) => [lane.scope, lane.sessionId, lane.entries.length])).toEqual([
      ['session', null, 2],
      ['session', 'sess-1', 2],
    ])
    expect(timeline.lanes[0].entries.map((entry) => entry.label)).toEqual(['fault', 'evidence_answered'])
  })

  it('orders lanes by their first record and counts every family it was handed', () => {
    const timeline = buildTraceTimeline([
      perf('turn-2', 'stt', 100, T0 + 500),
      host({ at: T0 + 300, sessionId: 'sess-1', kind: 'voice_endpoint', speechMs: 1200, totalMs: 1900, truncated: false, reason: null }),
      perf('turn-1', 'stt', 100, T0 + 100),
    ])

    expect(timeline.lanes.map((lane) => (lane.scope === 'turn' ? lane.turnId : `session:${lane.sessionId}`))).toEqual([
      'turn-1',
      'session:sess-1',
      'turn-2',
    ])
    expect(timeline.counts).toEqual({ perf: 2, run: 0, host: 1 })
  })

  it('summarizes each record in the words a developer would grep for', () => {
    const timeline = buildTraceTimeline([
      perf('turn-1', 'llm', 412, T0 + 1),
      run({
        at: T0 + 2,
        turnId: 'turn-1',
        kind: 'pipeline_event',
        event: { type: 'tool_call', turnId: 'turn-1', callId: 'c1', name: 'navigate', args: { url: 'https://x.test' }, at: T0 + 2 },
      }),
      run({
        at: T0 + 3,
        turnId: 'turn-1',
        kind: 'pipeline_event',
        agentId: 'agent-7',
        event: { type: 'tool_result', turnId: 'turn-1', callId: 'c1', name: 'navigate', ok: false, error: 'timeout', at: T0 + 3 },
      }),
      run({ at: T0 + 4, turnId: 'turn-1', kind: 'fault', site: 'browser.navigate', message: 'boom' }),
      run({ at: T0 + 5, turnId: 'turn-1', kind: 'reasoning', round: 2, attempt: 1, text: 'I should look again', chars: 19 }),
      run({
        at: T0 + 6,
        turnId: 'turn-1',
        kind: 'evidence_checkpoint',
        tool: 'record_evidence',
        args: {},
        outcome: 'rejected:no_match',
        matched: false,
        graded: [],
      }),
      run({
        at: T0 + 7,
        turnId: 'turn-1',
        kind: 'vision_request',
        capability: 'describe',
        reason: 'look',
        durationMs: 800,
        outcome: 'deadline',
      }),
      host({ at: T0 + 8, sessionId: 'sess-1', turnId: 'turn-1', kind: 'tts_dropped', text: 'never mind', chars: 10, stage: 'queued' }),
    ])

    const entries = timeline.lanes[0].entries
    expect(entries.map((entry) => entry.summary)).toEqual([
      '412 ms',
      'navigate {"url":"https://x.test"}',
      'navigate failed: timeout',
      'browser.navigate: boom',
      'round 2 attempt 1: I should look again',
      'record_evidence rejected:no_match',
      'describe (look) deadline in 800 ms',
      'queued: never mind',
    ])
    expect(entries[2].agentId).toBe('agent-7')
    expect(entries[1].agentId).toBeUndefined()
  })

  it('cuts a long summary and keeps the whole record for the expander', () => {
    const text = 'x'.repeat(500)
    const timeline = buildTraceTimeline([
      run({
        at: T0,
        turnId: 'turn-1',
        kind: 'pipeline_event',
        event: { type: 'display', turnId: 'turn-1', text, at: T0 },
      }),
    ])
    const entry = timeline.lanes[0].entries[0]
    expect(entry.summary.length).toBeLessThan(text.length)
    expect(entry.summary.endsWith('…')).toBe(true)
    expect((entry.record as { event: { text: string } }).event.text).toBe(text)
  })
})
