import { describe, expect, it } from 'vitest'
import type { CommandLogRecord, DecisionRecord, TaskEnded } from '../command/decisionRecord'
import type { PerfSpanRecord } from './perfTracer'
import { buildDecisionReport, buildReactionReport, formatCommandReport } from './commandReport'

// The Command half of the perf report (#324): Reaction p50/p95 per verb
// from the `reaction` spans, and the decision log's shares — Jev's share
// of calls and its latency, the readings, the Misfires.

const AT = 1_700_000_000_000

function reaction(turnId: string, verb: string, durMs: number): PerfSpanRecord {
  return { turnId, stage: 'reaction', durMs, at: AT, t: 0, detail: { verb, effect: 'settled', reading: 'local_match', source: 'spoken' } }
}

function decision(turnId: string, reading: 'local_match' | 'jev' | 'best_guess', latencyMs?: number): DecisionRecord {
  return {
    type: 'decision',
    turnId,
    at: AT,
    source: 'spoken',
    transcript: 'open youtube',
    reading,
    verb: 'navigate',
    target: null,
    slot: 'youtube',
    jevAsked: reading !== 'local_match',
    ...(reading === 'jev'
      ? { jev: { model: 'jev-1.14.0', latencyMs: latencyMs ?? 200, confidence: { action: 0.9, slot: 0.8 }, probabilities: { action: {}, slot: {} } } }
      : reading === 'best_guess'
        ? { jev: { model: 'jev-1.14.0', latencyMs: latencyMs ?? 800, reason: 'timeout' as const } }
        : {}),
  }
}

function misfire(turnId: string, signal: 'back' | 'clear' | 'escape' | 'opposite_scroll'): CommandLogRecord {
  return { type: 'misfire', turnId, at: AT, signal, signalTurnId: `${turnId}-next`, withinMs: 1200 }
}

describe('buildReactionReport', () => {
  it('ranks verbs by count and gives every verb its p50/p95/max, with an overall row', () => {
    const report = buildReactionReport([
      reaction('t1', 'open', 400),
      reaction('t2', 'open', 600),
      reaction('t3', 'open', 900),
      reaction('t4', 'click', 200),
      reaction('t5', 'click', 300),
      reaction('t6', 'scroll_down', 150),
      // Other stages never count as a Reaction.
      { turnId: 't6', stage: 'stt', durMs: 5000, at: AT, t: 0 },
    ])

    expect(report.overall).toEqual({ verb: 'all', count: 6, p50: 300, p95: 900, max: 900 })
    expect(report.byVerb).toEqual([
      { verb: 'open', count: 3, p50: 600, p95: 900, max: 900 },
      { verb: 'click', count: 2, p50: 200, p95: 300, max: 300 },
      { verb: 'scroll_down', count: 1, p50: 150, p95: 150, max: 150 },
    ])
  })

  it('is empty, not a crash, with no reaction spans; a span without a verb counts as unknown', () => {
    expect(buildReactionReport([{ turnId: 't1', stage: 'stt', durMs: 100, at: AT, t: 0 }])).toEqual({ overall: null, byVerb: [], byFire: { early: null, endpoint: null }, firstSound: null, firstSoundByEngine: [] })
    const report = buildReactionReport([{ turnId: 't1', stage: 'reaction', durMs: 100, at: AT, t: 0 }])
    expect(report.byVerb).toEqual([{ verb: 'unknown', count: 1, p50: 100, p95: 100, max: 100 }])
  })
})

describe('buildDecisionReport', () => {
  it('counts the readings, Jev share and latency, and the Misfires by signal', () => {
    const report = buildDecisionReport([
      decision('t1', 'local_match'),
      decision('t2', 'local_match'),
      decision('t3', 'jev', 180),
      decision('t4', 'jev', 260),
      decision('t5', 'best_guess', 800),
      misfire('t3', 'back'),
      misfire('t5', 'opposite_scroll'),
      misfire('t4', 'back'),
    ])

    expect(report).toEqual({
      commands: 5,
      readings: { local_match: 2, jev: 2, best_guess: 1 },
      jevAsked: 3,
      jevAnswered: 2,
      jevLatency: { p50: 260, p95: 800 },
      jevRefused: {},
      jevInputTokens: null,
      misfires: 3,
      misfiresBySignal: { back: 2, opposite_scroll: 1 },
      names: { page: 0, learned: 0 },
      earlyFire: { spoken: 5, fired: 0, lead: null, partialCalls: 0, spokenJevAsked: 3 },
      // Records from before #328 carry no Task.
      tasks: { count: 0, ended: {}, hops: null, overrunsByHop: {}, split: 0 },
      picks: { remembered: 0, searched: 0 },
    })
  })

  it('counts the Name Matches by whose spelling they carried (ADR 0077)', () => {
    const named = (turnId: string, heard: string, slot: string, slotFrom: 'page' | 'learned'): CommandLogRecord => ({
      ...(decision(turnId, 'local_match') as Extract<CommandLogRecord, { type: 'decision' }>),
      slot,
      slotHeard: heard,
      slotFrom,
    })
    const report = buildDecisionReport([
      named('t1', 'line stack tips', 'linus tech tips', 'page'),
      named('t2', 'your masks', 'elon musk', 'learned'),
      named('t3', 'liner stack tips', 'linus tech tips', 'page'),
      decision('t4', 'local_match'),
    ])
    expect(report.names).toEqual({ page: 2, learned: 1 })
    expect(formatCommandReport(buildReactionReport([]), report)[0]).toContain('| names matched 3 (page 2, learned 1)')
  })

  it('counts how often a song\'s search was skipped for a remembered pick (#345)', () => {
    const played = (turnId: string, pick: 'remembered' | 'searched'): CommandLogRecord => ({ ...decision(turnId, 'local_match'), verb: 'play', video: 'aaaaaaaaaaa', pick })
    const report = buildDecisionReport([played('t1', 'searched'), played('t2', 'remembered'), played('t3', 'searched'), played('t4', 'searched'), decision('t5', 'local_match')])
    expect(report.picks).toEqual({ remembered: 1, searched: 3 })
    expect(formatCommandReport(buildReactionReport([]), report)).toContain('songs: 4 picks | remembered 1 (25%), searched 3')
    expect(formatCommandReport(buildReactionReport([]), buildDecisionReport([decision('t1', 'local_match')])).some((line) => line.startsWith('songs:'))).toBe(false)
  })

  it('reports no latency when Jev was never asked', () => {
    const report = buildDecisionReport([decision('t1', 'local_match')])
    expect(report.jevAsked).toBe(0)
    expect(report.jevLatency).toBeNull()
  })
})

describe('formatCommandReport', () => {
  it('prints the Reaction table with the overall row first, then one decisions line', () => {
    const lines = formatCommandReport(
      buildReactionReport([reaction('t1', 'open', 400), reaction('t2', 'click', 200)]),
      buildDecisionReport([decision('t1', 'local_match'), decision('t2', 'jev', 220), misfire('t2', 'back')]),
    )

    expect(lines).toEqual([
      'reaction (Endpoint to first effect), by verb:',
      'verb   count    p50    p95    max',
      'all        2  200ms  400ms  400ms',
      'click      1  200ms  200ms  200ms',
      'open       1  400ms  400ms  400ms',
      '',
      'decisions: 2 commands | jev asked 1 (50%), answered 1, latency p50 220ms p95 220ms | local match 1, jev 1, best guess 0 | misfires 1 (back 1) | names matched 0',
      'early fire: 0 of 2 spoken (0%) | jev calls per spoken utterance 0.50 (0 on partials)',
    ])
  })

  it('splits the Reaction by Early Fire and prints its share, its lead and the Jev calls per spoken Utterance (#326)', () => {
    const early = (turnId: string, leadMs: number, partialCalls?: number): CommandLogRecord => ({
      ...decision(turnId, 'local_match'),
      earlyFire: { partial: 'scroll down', leadMs },
      ...(partialCalls !== undefined ? { partialCalls } : {}),
    })
    const earlySpan = (turnId: string, leadMs: number): PerfSpanRecord => ({ ...reaction(turnId, 'scroll_down', 0), detail: { verb: 'scroll_down', effect: 'scroll', reading: 'local_match', source: 'spoken', earlyFire: true, leadMs } })
    const lines = formatCommandReport(
      buildReactionReport([earlySpan('t1', 300), earlySpan('t2', 500), reaction('t3', 'open', 400), reaction('t4', 'click', 200)]),
      buildDecisionReport([early('t1', 300), early('t2', 500, 1), decision('t3', 'jev', 220), { ...decision('t4', 'local_match'), partialCalls: 2 } satisfies DecisionRecord]),
    )

    expect(lines).toEqual([
      'reaction (Endpoint to first effect), by verb:',
      'verb         count    p50    p95    max',
      'all              4    0ms  400ms  400ms',
      'scroll_down      2    0ms    0ms    0ms',
      'click            1  200ms  200ms  200ms',
      'open             1  400ms  400ms  400ms',
      '',
      'reaction by Early Fire:',
      'fired     count    p50    p95    max',
      'early         2    0ms    0ms    0ms',
      'endpoint      2  200ms  400ms  400ms',
      '',
      'decisions: 4 commands | jev asked 1 (25%), answered 1, latency p50 220ms p95 220ms | local match 3, jev 1, best guess 0 | misfires 0 | names matched 0',
      'early fire: 2 of 4 spoken (50%), lead p50 300ms p95 500ms | jev calls per spoken utterance 1.00 (3 on partials)',
    ])
  })

  it('splits first sound by engine once Kokoro has spoken, the untagged spans before it counted as Piper’s (#412)', () => {
    const firstSound = (turnId: string, durMs: number, engine?: string): PerfSpanRecord => ({ turnId, stage: 'tts-first-sound', durMs, at: AT, t: 0, ...(engine ? { detail: { engine } } : {}) })
    const report = buildReactionReport([firstSound('t1', 100), firstSound('t2', 120, 'piper'), firstSound('t3', 500, 'kokoro'), firstSound('t4', 700, 'kokoro')])
    expect(report.firstSoundByEngine).toEqual([
      { verb: 'tts-first-sound (kokoro)', count: 2, p50: 500, p95: 700, max: 700 },
      { verb: 'tts-first-sound (piper)', count: 2, p50: 100, p95: 120, max: 120 },
    ])
    expect(formatCommandReport(report, buildDecisionReport([]))).toEqual([
      'reaction (Endpoint to first effect), by verb:',
      'verb                      count    p50    p95    max',
      'tts-first-sound               4  120ms  700ms  700ms',
      'tts-first-sound (kokoro)      2  500ms  700ms  700ms',
      'tts-first-sound (piper)       2  100ms  120ms  120ms',
    ])
  })

  it('prints no engine rows while one engine has spoken', () => {
    const report = buildReactionReport([{ turnId: 't1', stage: 'tts-first-sound', durMs: 100, at: AT, t: 0 }])
    expect(report.firstSoundByEngine).toEqual([])
  })

  it('prints a spoken read as its own row and tts-first-sound p50/p95 beside the Reaction rows (#327, AC5)', () => {
    const spoken = (turnId: string, durMs: number): PerfSpanRecord => ({ ...reaction(turnId, 'read', durMs), detail: { verb: 'read', effect: 'spoken', reading: 'local_match', source: 'spoken' } })
    const firstSound = (turnId: string, durMs: number): PerfSpanRecord => ({ turnId, stage: 'tts-first-sound', durMs, at: AT, t: 0 })
    const report = buildReactionReport([
      { ...reaction('t1', 'read', 300), detail: { verb: 'read', effect: 'display', reading: 'local_match', source: 'spoken' } },
      spoken('t2', 900),
      spoken('t3', 1_100),
      firstSound('t2', 650),
      firstSound('t3', 800),
      firstSound('t4', 1_200),
    ])
    expect(report.firstSound).toEqual({ verb: 'tts-first-sound', count: 3, p50: 800, p95: 1_200, max: 1_200 })

    expect(formatCommandReport(report, buildDecisionReport([]))).toEqual([
      'reaction (Endpoint to first effect), by verb:',
      'verb             count    p50     p95     max',
      'all                  3  900ms  1100ms  1100ms',
      'read (spoken)        2  900ms  1100ms  1100ms',
      'read                 1  300ms   300ms   300ms',
      'tts-first-sound      3  800ms  1200ms  1200ms',
    ])
  })

  it('prints one Task line: counts by how they ended, hops p50, overruns per hop number (#328, AC11)', () => {
    const hop = (taskId: string, n: number, ended?: TaskEnded): CommandLogRecord => ({
      ...decision(`${taskId}-${n}`, n === 0 && ended === 'local_match' ? 'local_match' : 'jev'),
      task: { id: taskId, hop: n },
      ...(ended !== undefined ? { ended } : {}),
    })
    const overrun = (taskId: string, n: number): CommandLogRecord => ({ type: 'misfire', turnId: `${taskId}-${n}`, at: AT, signal: 'overrun', withinMs: 900, hop: n })
    const log: CommandLogRecord[] = [
      hop('a', 0),
      hop('a', 1),
      overrun('a', 1),
      hop('a', 2),
      hop('a', 3, 'done'),
      hop('b', 0, 'local_match'),
      hop('c', 0),
      hop('c', 1, 'unsure'),
      overrun('c', 1),
      overrun('c', 2),
      hop('d', 0, 'local_match'),
    ]
    const lines = formatCommandReport(buildReactionReport([]), buildDecisionReport(log))
    expect(lines.at(-1)).toBe('tasks: 4 | ended local_match 2, done 1, unsure 1 | hops p50 1, max 4 | overruns by hop: hop 1 2, hop 2 1')
    expect(buildDecisionReport(log).tasks).toEqual({ count: 4, ended: { local_match: 2, done: 1, unsure: 1 }, hops: { p50: 1, max: 4 }, overrunsByHop: { 1: 2, 2: 1 }, split: 0 })
  })

  it('counts each Step of a split line as its own Task, and the lines that split (#364)', () => {
    const step = (turnId: string, step: number, hop: number, ended?: TaskEnded): CommandLogRecord => ({
      ...decision(turnId, 'jev'),
      task: { id: 'line', hop, step, of: 2 },
      ...(ended !== undefined ? { ended } : {}),
    })
    const log: CommandLogRecord[] = [step('line', 1, 0, 'local_match'), step('s2', 2, 0), step('s2h1', 2, 1, 'done'), { ...decision('one', 'local_match'), task: { id: 'one', hop: 0 }, ended: 'local_match' }]
    const report = buildDecisionReport(log)
    expect(report.tasks).toMatchObject({ count: 3, hops: { p50: 1, max: 2 }, split: 1 })
    expect(formatCommandReport(buildReactionReport([]), report).at(-1)).toBe('tasks: 3 | ended local_match 2, done 1 | hops p50 1, max 2 | overruns by hop: none | lines split into Steps: 1')
  })

  it('prints the refusals by status and the hosts\' token counts, so a card over its budget reads from the report (#406, ADR 0088)', () => {
    const answered = (turnId: string, inputTokens: number): DecisionRecord => {
      const base = decision(turnId, 'jev')
      return { ...base, jev: { ...(base.jev as object), inputTokens } as DecisionRecord['jev'] }
    }
    const refused: DecisionRecord = { ...decision('t3', 'best_guess'), jev: { model: 'mammoth', latencyMs: 298, reason: 'http', httpStatus: 422, message: 'prompt has 16645 tokens, exceeding max_len 16384' } }
    const report = buildDecisionReport([answered('t1', 9000), answered('t2', 15000), refused, decision('t4', 'best_guess')])

    expect(report.jevRefused).toEqual({ 422: 1 })
    expect(report.jevInputTokens).toEqual({ p50: 9000, max: 15000 })
    expect(formatCommandReport(buildReactionReport([]), report).join('\n')).toContain('jev refused 1 (422 1) | input tokens p50 9000 max 15000')
  })

  it('prints nothing when neither family has a record', () => {
    expect(formatCommandReport(buildReactionReport([]), buildDecisionReport([]))).toEqual([])
  })
})
