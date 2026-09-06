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
    expect(lane).toMatchObject({ scope: 'turn', key: 'turn:turn-1', turnId: 'turn-1', sessionId: 'sess-1', runId: 'run-a' })
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
      run({
        at: T0 + 50,
        sessionId: 'sess-1',
        kind: 'pipeline_event',
        event: { type: 'session_ended', sessionId: 'sess-1', sessionGeneration: 1, reason: 'lapsed', at: T0 + 50 },
      }),
    ])

    expect(timeline.lanes.map((lane) => [lane.scope, lane.key, lane.sessionId, lane.entries.length])).toEqual([
      ['session', 'session:', null, 2],
      ['session', 'session:sess-1', 'sess-1', 3],
    ])
    expect(timeline.lanes[0].entries.map((entry) => entry.label)).toEqual(['fault', 'evidence_answered'])
    expect(timeline.lanes[1].entries[2]).toMatchObject({ label: 'session_ended', summary: 'sess-1 lapsed' })
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
      run({
        at: T0 + 9,
        turnId: 'turn-1',
        kind: 'pipeline_event',
        event: { type: 'done', turnId: 'turn-1', outcome: 'done', resolution: 'answered', finalizationCause: 'objective_met', at: T0 + 9 },
      }),
      host({ at: T0 + 10, sessionId: 'sess-1', turnId: 'turn-1', kind: 'learned_term', source: 'proposals', admitted: ['pop up', 'panel'], removed: [] }),
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
      'done answered (objective_met)',
      'proposals: +[pop up, panel] -[]',
    ])
    expect(entries[2].agentId).toBe('agent-7')
    expect(entries[1].agentId).toBeUndefined()
  })

  it('summarizes the round identity and the failure screenshot, and names the models on a run_plan (#191)', () => {
    const timeline = buildTraceTimeline([
      run({
        at: T0 + 1,
        turnId: 'turn-1',
        kind: 'pipeline_event',
        models: { orchestrator: 'glm-5.3', subagent: 'deepseek-chat', vision: 'glm-4.6v' },
        event: { type: 'run_plan', turnId: 'turn-1', objective: 'find the fare', headline: 'Fares', effortTier: 'investigation', source: 'model', at: T0 + 1 },
      }),
      run({
        at: T0 + 2,
        turnId: 'turn-1',
        kind: 'llm_round',
        round: 3,
        attempt: 2,
        role: 'orchestrator',
        model: 'glm-5.3',
        reasoningEffort: 'high',
        usage: { promptTokens: 12_345, completionTokens: 210 },
        promptHash: 'deadbeefcafef00d',
        request: { toolResults: 4, chars: 38_000 },
      }),
      run({
        at: T0 + 3,
        turnId: 'turn-1',
        kind: 'llm_round',
        round: 1,
        attempt: 1,
        role: 'subagent',
        agentId: 'agent-7',
        request: { toolResults: 0, chars: 900 },
      }),
      run({
        at: T0 + 4,
        turnId: 'turn-1',
        kind: 'pipeline_event',
        event: { type: 'done', turnId: 'turn-1', outcome: 'done', finalizationCause: 'no_progress', at: T0 + 4 },
      }),
      run({ at: T0 + 5, turnId: 'turn-1', kind: 'failure_screenshot', cause: 'no_progress', path: '/home/dev/logs/run-trace-run-a-turn-1.png', bytes: 51_200 }),
    ])

    const entries = timeline.lanes[0].entries
    expect(entries.map((entry) => entry.summary)).toEqual([
      'investigation (model): find the fare [orchestrator glm-5.3, subagent deepseek-chat, vision glm-4.6v]',
      'round 3 attempt 2 orchestrator glm-5.3 @high 4 results / 38000 chars → 12345 in / 210 out prompt deadbeefcafef00d',
      'round 1 attempt 1 subagent 0 results / 900 chars',
      'done (no_progress)',
      'no_progress: run-trace-run-a-turn-1.png (51200 bytes)',
    ])
    expect(entries[2].agentId).toBe('agent-7')
    // The screenshot links from the `done` it was taken for as well as
    // from its own entry — by file name, never by the absolute path.
    expect(entries[3].screenshot).toBe('run-trace-run-a-turn-1.png')
    expect(entries[4].screenshot).toBe('run-trace-run-a-turn-1.png')
    expect(entries[0].screenshot).toBeUndefined()
  })

  it('summarizes a failed reserved round, orchestrator and worker alike (#198)', () => {
    const timeline = buildTraceTimeline([
      run({
        at: T0 + 1,
        turnId: 'turn-1',
        kind: 'off_contract_reply',
        role: 'orchestrator',
        shape: 'off_contract',
        text: 'Retrying with the observation id.',
        chars: 33,
        cause: 'no_progress',
      }),
      run({
        at: T0 + 2,
        turnId: 'turn-1',
        kind: 'off_contract_reply',
        role: 'subagent',
        agentId: 'agent-7',
        shape: 'off_contract',
        text: 'Let me try a narrower query.',
        chars: 28,
        cause: 'budget_exhausted',
      }),
    ])

    const entries = timeline.lanes[0].entries
    expect(entries.map((entry) => entry.summary)).toEqual([
      'orchestrator off_contract (no_progress): Retrying with the observation id.',
      'subagent agent-7 off_contract (budget_exhausted): Let me try a narrower query.',
    ])
    expect(entries[1].agentId).toBe('agent-7')
  })

  it('reads a vision attempt as milestones beside the outcome, omitting the ones that never happened (#204)', () => {
    const timeline = buildTraceTimeline([
      run({
        at: T0,
        turnId: 'turn-1',
        kind: 'vision_request',
        capability: 'describe',
        reason: 'look',
        durationMs: 8_004,
        outcome: 'deadline',
        deadlinePhase: 'first-token',
        attempt: {
          ending: 'first_token_deadline',
          firstTokenLimitMs: 8_000,
          wholeLookLimitMs: 15_000,
          model: 'GLM-4.6V',
          maxTokens: 128,
          thinking: 'disabled',
          responseAtMs: 214,
          responseStatus: 200,
          firstByteAtMs: 260,
          settledAtMs: 8_003,
          bytesRead: 96,
          streamEvents: 2,
          progressEvents: 0,
          malformedEvents: 0,
          sawDone: false,
          reasoningChars: 0,
          contentChars: 0,
        },
        message: 'Vision request did not begin answering within 8000ms',
      }),
    ])

    const entry = timeline.lanes[0].entries[0]
    // Headers and a first byte arrived; no recognized generation content ever
    // did — so no reasoning or content milestone is printed at all. The
    // failure sentence comes before the milestones, so the cut can only ever
    // cost a trailing count, never the words a developer greps for.
    expect(entry.summary).toBe(
      'describe (look) deadline in 8004 ms: Vision request did not begin answering within 8000ms ' +
        '[first_token_deadline, resp 214ms, byte 260ms, 0/2 events]',
    )
    expect(entry.summary).not.toContain('reasoning')
    // The line is a preview; the expander still has every milestone.
    expect((entry.record as { attempt: { ending: string } }).attempt.ending).toBe('first_token_deadline')
  })

  it('keeps the failure sentence when a full set of milestones outruns the summary cap (#204)', () => {
    const timeline = buildTraceTimeline([
      run({
        at: T0,
        turnId: 'turn-1',
        kind: 'vision_request',
        capability: 'describe',
        reason: 'look',
        durationMs: 15_004,
        outcome: 'deadline',
        deadlinePhase: 'whole-look',
        attempt: {
          ending: 'whole_look_deadline',
          firstTokenLimitMs: 8_000,
          wholeLookLimitMs: 15_000,
          model: 'GLM-4.6V',
          maxTokens: 128,
          thinking: 'disabled',
          responseAtMs: 214,
          responseStatus: 200,
          firstByteAtMs: 260,
          firstReasoningAtMs: 300,
          firstContentAtMs: 420,
          firstTokenKind: 'reasoning',
          settledAtMs: 15_003,
          bytesRead: 4_096,
          streamEvents: 12,
          progressEvents: 9,
          malformedEvents: 0,
          sawDone: false,
          reasoningChars: 240,
          contentChars: 18,
        },
        message: 'Vision request timed out after 15000ms',
      }),
    ])

    const summary = timeline.lanes[0].entries[0].summary
    expect(summary).toContain('Vision request timed out after 15000ms')
    expect(summary).toContain('[whole_look_deadline')
    // Cut, and what it cost is the tail of the milestones — nothing else.
    expect(summary.endsWith('…')).toBe(true)
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
