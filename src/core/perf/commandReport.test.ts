import { describe, expect, it } from 'vitest'
import type { CommandLogRecord, DecisionRecord, TaskEnded } from '../command/decisionRecord'
import type { PerfSpanRecord } from './perfTracer'
import { buildDecisionReport, buildReactionReport, formatCommandReport, tierOf } from './commandReport'

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
    expect(buildReactionReport([{ turnId: 't1', stage: 'stt', durMs: 100, at: AT, t: 0 }])).toEqual({ overall: null, byVerb: [], byFire: { early: null, endpoint: null }, firstSound: null, split: null, byReading: [], felt: null })
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
      asks: 3,
      jevAnswered: 2,
      jevLatency: { p50: 260, p95: 800 },
      jevRefused: {},
      fellOver: { count: 0, answered: 0 },
      jevInputTokens: null,
      // The answers before #406 carry no token count; the timeout is banded nowhere.
      jevLatencyByTokens: [{ card: 'page', model: 'jev-1.14.0', band: 'no count', count: 2, p50: 180, p95: 260 }],
      misfires: 3,
      misfiresBySignal: { back: 2, opposite_scroll: 1 },
      names: { page: 0, learned: 0 },
      earlyFire: { spoken: 5, utterances: 5, fired: 0, lead: null, partialCalls: 0, spokenJevAsked: 3 },
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
      'jev latency by input tokens:',
      'model       card    tokens  count    p50    p95',
      'jev-1.14.0  page  no count      1  220ms  220ms',
      '',
      'decisions: 2 commands | jev asked 1 (50%), answered 1, latency p50 220ms p95 220ms | fell over 0 | local match 1, jev 1, best guess 0 | misfires 1 (back 1) | names matched 0',
      'refusals per 100 asks: 0.0 (0 refused attempts over 1 asks)',
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
      'jev latency by input tokens:',
      'model       card    tokens  count    p50    p95',
      'jev-1.14.0  page  no count      1  220ms  220ms',
      '',
      'decisions: 4 commands | jev asked 1 (25%), answered 1, latency p50 220ms p95 220ms | fell over 0 | local match 3, jev 1, best guess 0 | misfires 0 | names matched 0',
      'refusals per 100 asks: 0.0 (0 refused attempts over 1 asks)',
      'early fire: 2 of 4 spoken (50%), lead p50 300ms p95 500ms | jev calls per spoken utterance 1.00 (3 on partials)',
    ])
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

  it('counts the asks that fell over to a Fallback Host beside the refusals, each attempt\'s refusal counted (#477)', () => {
    const attempt = (model: string, host: string, outcome: 'answered' | 'http' | 'timeout', latencyMs: number) => ({ model, host, outcome, ...(outcome === 'http' ? { httpStatus: 429 } : {}), latencyMs })
    const base = decision('t1', 'jev')
    const fellAndAnswered: DecisionRecord = { ...base, jev: { ...(base.jev as object), model: 'elephant', attempts: [attempt('mammoth', 'a', 'http', 200), attempt('elephant', 'b', 'answered', 900)] } as unknown as DecisionRecord['jev'] }
    const fellAndLost: DecisionRecord = { ...decision('t2', 'best_guess'), jev: { model: 'elephant', latencyMs: 2450, reason: 'timeout', attempts: [attempt('mammoth', 'a', 'http', 200), attempt('elephant', 'b', 'timeout', 2250)] } }
    const oneHost: DecisionRecord = { ...decision('t3', 'best_guess'), jev: { model: 'mammoth', latencyMs: 300, reason: 'http', httpStatus: 429, message: 'rate limited' } }
    const report = buildDecisionReport([fellAndAnswered, fellAndLost, oneHost, decision('t4', 'jev')])

    expect(report.fellOver).toEqual({ count: 2, answered: 1 })
    expect(report.jevRefused).toEqual({ 429: 3 })
    expect(formatCommandReport(buildReactionReport([]), report).join('\n')).toContain('jev refused 3 (429 3) | fell over 2 (answered by a fallback 1)')
  })

  it('prints the refusals by status and the hosts\' token counts, so a card over its budget reads from the report (#406, ADR 0088)', () => {
    const answered = (turnId: string, inputTokens: number): DecisionRecord => {
      const base = decision(turnId, 'jev')
      return { ...base, jev: { ...(base.jev as object), inputTokens } as DecisionRecord['jev'] }
    }
    const refused: DecisionRecord = { ...decision('t3', 'best_guess'), jev: { model: 'mammoth', latencyMs: 298, reason: 'http', httpStatus: 422, message: 'prompt has 16645 tokens, exceeding max_len 16384' } }
    const report = buildDecisionReport([answered('t1', 9000), answered('t2', 15000), refused, decision('t4', 'best_guess')])

    expect(report.jevRefused).toEqual({ 422: 1 })
    expect(report.fellOver).toEqual({ count: 0, answered: 0 })
    expect(report.jevInputTokens).toEqual({ p50: 9000, max: 15000 })
    expect(formatCommandReport(buildReactionReport([]), report).join('\n')).toContain('jev refused 1 (422 1) | fell over 0 | input tokens p50 9000 max 15000')
  })

  it('bands each model\'s answered latency by the host\'s token count, the answers without one apart and a refusal nowhere (#440)', () => {
    const asked = (turnId: string, model: string, latencyMs: number, inputTokens?: number): DecisionRecord => {
      const base = decision(turnId, 'jev', latencyMs)
      return { ...base, jev: { ...(base.jev as object), model, ...(inputTokens !== undefined ? { inputTokens } : {}) } as DecisionRecord['jev'] }
    }
    const report = buildDecisionReport([
      asked('a', 'mammoth', 600, 900),
      asked('b', 'mammoth', 700, 1499),
      asked('c', 'mammoth', 650, 1500),
      asked('d', 'mammoth', 1300, 6000),
      asked('e', 'mammoth', 1500, 9800),
      asked('f', 'mammoth', 700, 5999),
      asked('g', 'jev-1.14.0', 240),
      { ...decision('h', 'best_guess'), jev: { model: 'mammoth', latencyMs: 298, reason: 'http', httpStatus: 422, message: 'too long' } },
    ])

    expect(report.jevLatencyByTokens).toEqual([
      { card: 'page', model: 'mammoth', band: '< 1.5k', count: 2, p50: 600, p95: 700 },
      { card: 'page', model: 'mammoth', band: '1.5–3k', count: 1, p50: 650, p95: 650 },
      { card: 'page', model: 'mammoth', band: '3–6k', count: 1, p50: 700, p95: 700 },
      { card: 'page', model: 'mammoth', band: '6k+', count: 2, p50: 1300, p95: 1500 },
      { card: 'page', model: 'jev-1.14.0', band: 'no count', count: 1, p50: 240, p95: 240 },
    ])
    expect(formatCommandReport(buildReactionReport([]), report).join('\n')).toContain(
      ['jev latency by input tokens:', 'model       card    tokens  count     p50     p95', 'mammoth     page    < 1.5k      2   600ms   700ms', 'mammoth     page    1.5–3k      1   650ms   650ms'].join('\n'),
    )
  })

  it('splits the Reaction by how its line was read: the Local Match, or the last ask by model and whether it answered (#440)', () => {
    const spans = [reaction('l1', 'open', 150), reaction('l2', 'open', 170), reaction('j1', 'play', 800), reaction('j2', 'play', 900), reaction('d1', 'press', 700), reaction('g1', 'open', 1600), reaction('x', 'open', 50)]
    const where: DecisionRecord = { ...decision('j2', 'jev'), whereAsk: true }
    // A dismissal fires the runner's own Escape over an answered ask: Jev read it.
    const dismissal: DecisionRecord = { ...decision('d1', 'jev'), reading: 'local_match' }
    const report = buildReactionReport(spans, [decision('l1', 'local_match'), decision('l2', 'local_match'), decision('j1', 'jev'), decision('j2', 'local_match'), where, dismissal, decision('g1', 'best_guess'), misfire('x', 'back')])

    expect(report.byReading).toEqual([
      { verb: 'jev jev-1.14.0', count: 3, p50: 800, p95: 900, max: 900 },
      { verb: 'local match', count: 2, p50: 150, p95: 170, max: 170 },
      { verb: 'unanswered jev-1.14.0', count: 1, p50: 1600, p95: 1600, max: 1600 },
    ])
    expect(formatCommandReport(report, buildDecisionReport([])).join('\n')).toContain(
      ['reaction by reading:', 'reading                count     p50     p95     max', 'jev jev-1.14.0             3   800ms   900ms   900ms', 'local match                2   150ms   170ms   170ms'].join('\n'),
    )
  })

  // The Appliance Card (#485): the Felt Reaction by Tier and road, its own call in every per-call count, its band apart.
  const answer = (model: string, latencyMs: number, inputTokens?: number) => ({ model, latencyMs, ...(inputTokens !== undefined ? { inputTokens } : {}), confidence: { action: 0.9, slot: 0.8 }, probabilities: { action: {}, slot: {} } })
  const endOfSpeech = (turnId: string, durMs: number): PerfSpanRecord => ({ turnId, stage: 'end-of-speech', durMs, at: AT, t: 0, detail: { endedBy: 'turn' } })

  it('reads each spoken turn\'s Felt Reaction, end of speech plus Reaction, by Tier and by road, one per turn (#485)', () => {
    const exact: DecisionRecord = { ...decision('pause', 'local_match'), verb: 'play', music: { kind: 'pause' } }
    const viaAppliance: DecisionRecord = { ...decision('louder', 'jev'), verb: 'media', card: 'appliance' }
    const song: DecisionRecord = { ...decision('song', 'jev'), verb: 'play', music: { kind: 'search', place: 'now' }, card: 'appliance' }
    const onPage: DecisionRecord = { ...decision('link', 'jev'), verb: 'click', card: 'page', appliance: { ask: 'link-appliance', jev: answer('mammoth', 500), chose: 'page' } }
    // A record before #485 names no card: its Jev reading is the page card's.
    const old: DecisionRecord = { ...decision('old', 'jev'), verb: 'none' }
    const where: DecisionRecord = { ...decision('old', 'jev'), verb: 'click', whereAsk: true }
    const hop: DecisionRecord = { ...decision('old-1', 'jev'), verb: 'scroll_down', task: { id: 'old', hop: 1 } }
    // The Appliance Card's host failed and the Local Match's guess fired: a best guess.
    const failed: DecisionRecord = { ...decision('fail', 'local_match'), verb: 'scroll_down', jevAsked: true, card: 'appliance', jev: { model: 'mammoth', latencyMs: 300, reason: 'timeout' } }
    const typed: DecisionRecord = { ...decision('typed', 'local_match'), source: 'typed' }
    const spans = [
      endOfSpeech('pause', 700), reaction('pause', 'play', 100),
      endOfSpeech('louder', 800), reaction('louder', 'media', 900),
      endOfSpeech('song', 800), reaction('song', 'play', 2000),
      endOfSpeech('link', 900), reaction('link', 'click', 2500),
      endOfSpeech('old', 1000), reaction('old', 'none', 3000),
      endOfSpeech('old-1', 900), reaction('old-1', 'scroll_down', 50),
      endOfSpeech('fail', 700), reaction('fail', 'scroll_down', 400),
      endOfSpeech('typed', 0), reaction('typed', 'navigate', 600),
      // An Early Fire has no end-of-speech span of its own: counted out.
      reaction('early', 'scroll_down', 0),
    ]
    const report = buildReactionReport(spans, [exact, viaAppliance, song, onPage, old, where, hop, failed, typed, { ...decision('early', 'local_match'), verb: 'scroll_down' }])

    expect(report.felt).toEqual({
      byTier: [
        { verb: 'Instant', count: 3, p50: 1100, p95: 1700, max: 1700 },
        { verb: 'Quick', count: 2, p50: 2800, p95: 3400, max: 3400 },
        { verb: 'Task', count: 1, p50: 4000, p95: 4000, max: 4000 },
      ],
      byRoad: [
        { verb: 'exact', count: 1, p50: 800, p95: 800, max: 800 },
        { verb: 'appliance', count: 2, p50: 1700, p95: 2800, max: 2800 },
        { verb: 'page', count: 2, p50: 3400, p95: 4000, max: 4000 },
        { verb: 'best guess', count: 1, p50: 1100, p95: 1100, max: 1100 },
      ],
      noEndOfSpeech: 1,
    })
    expect(formatCommandReport(report, buildDecisionReport([])).slice(-11)).toEqual([
      'felt reaction (end of speech to first effect), spoken turns, 1 without an end-of-speech span left out:',
      'tier     n     p50     p95',
      'Instant  3  1100ms  1700ms',
      'Quick    2  2800ms  3400ms',
      'Task     1  4000ms  4000ms',
      '',
      'road        n     p50     p95',
      'exact       1   800ms   800ms',
      'appliance   2  1700ms  2800ms',
      'page        2  3400ms  4000ms',
      'best guess  1  1100ms  1100ms',
    ])
  })

  it('maps the verbs onto the Tiers, a play by its music kind (#485)', () => {
    expect(tierOf({ verb: 'play', music: { kind: 'skip' } })).toBe('Instant')
    expect(tierOf({ verb: 'play', music: { kind: 'search', place: 'end' } })).toBe('Quick')
    expect(['scroll_up', 'back', 'stop', 'press', 'timer'].map((verb) => tierOf({ verb: verb as DecisionRecord['verb'] }))).toEqual(['Instant', 'Instant', 'Instant', 'Instant', 'Instant'])
    expect(['navigate', 'search', 'click', 'capture'].map((verb) => tierOf({ verb: verb as DecisionRecord['verb'] }))).toEqual(['Quick', 'Quick', 'Quick', 'Quick'])
    expect(['say', 'read', 'none'].map((verb) => tierOf({ verb: verb as DecisionRecord['verb'] }))).toEqual(['Task', 'Task', 'Task'])
  })

  it('counts the Appliance Card\'s ask as a call of its own: per Utterance, in the refusals per 100 asks, its band apart (#485)', () => {
    const http = (model: string) => ({ model, host: 'a', outcome: 'http' as const, httpStatus: 429, latencyMs: 100 })
    const ok = (model: string) => ({ model, host: 'b', outcome: 'answered' as const, latencyMs: 400 })
    // Appliance, then page, then a Where Ask: three calls on one Utterance.
    const page: DecisionRecord = { ...decision('t1', 'jev', 2000), card: 'page', jev: answer('mammoth', 2000, 8000), appliance: { ask: 't1-appliance', jev: { ...answer('elephant', 400, 1200), attempts: [http('mammoth'), ok('elephant')] }, chose: 'page' } }
    const where: DecisionRecord = { ...decision('t1', 'jev', 1500), whereAsk: true, jev: answer('mammoth', 1500, 8100) }
    // The Appliance Card's own pick: one call.
    const own: DecisionRecord = { ...decision('t2', 'jev', 500), card: 'appliance', jev: answer('mammoth', 500, 1000) }
    const exact = decision('t3', 'local_match')
    const report = buildDecisionReport([page, where, own, exact])

    expect(report.asks).toBe(4)
    expect(report.jevRefused).toEqual({ 429: 1 })
    expect(report.fellOver).toEqual({ count: 1, answered: 1 })
    expect(report.earlyFire).toMatchObject({ spoken: 4, utterances: 3, spokenJevAsked: 4 })
    expect(report.jevLatencyByTokens).toEqual([
      { card: 'page', model: 'mammoth', band: '6k+', count: 2, p50: 1500, p95: 2000 },
      { card: 'appliance', model: 'elephant', band: '< 1.5k', count: 1, p50: 400, p95: 400 },
      { card: 'appliance', model: 'mammoth', band: '< 1.5k', count: 1, p50: 500, p95: 500 },
    ])
    const lines = formatCommandReport(buildReactionReport([]), report)
    expect(lines).toContain('refusals per 100 asks: 25.0 (1 refused attempts over 4 asks)')
    expect(lines.join('\n')).toContain('jev calls per spoken utterance 1.33 (0 on partials)')
    expect(lines.join('\n')).toContain('mammoth   appliance  < 1.5k')
  })

  it('prints nothing when neither family has a record', () => {
    expect(formatCommandReport(buildReactionReport([]), buildDecisionReport([]))).toEqual([])
  })
})
