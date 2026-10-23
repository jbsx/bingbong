import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DecisionRecord } from '../../core/command/decisionRecord'
import type { AskRecord } from '../../core/decision/askRecord'
import type { DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult } from '../../core/ports/decisionModel'
import { caseFromLog, formatCandidates, gateCorpus, listCandidates, readCorpus, replayCorpus } from './jevCorpus'

// The Jev corpus (#338): saved asks with the answer each question should
// get, replayed against a Decision Model — the real Jev from the CLI, a
// fake one here — so a wording change is checked against every misread
// promoted so far.

const QUESTIONS: DecisionQuestions = {
  verb: { type: 'choice', instructions: 'Which verb?', options: { open: null, click: null } },
  target: { type: 'choice', instructions: 'Which element?', options: { none: null, 'ref-21': 'Pinned post', 'ref-27': 'Latest post' } },
}

/** A Decision Model that answers each state with the target the test gave it. */
class FakeJev implements DecisionModel {
  readonly model = 'jev-fake'
  readonly requests: DecisionRequest<DecisionQuestions>[] = []
  constructor(private readonly targets: Record<string, Record<string, number> | 'unavailable'>) {}

  async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    this.requests.push(request as DecisionRequest<DecisionQuestions>)
    const target = this.targets[request.state]
    if (target === undefined || target === 'unavailable') return { status: 'unavailable', reason: 'timeout', message: 'too slow', latencyMs: 1, model: this.model }
    const choice = Object.entries(target).sort((a, b) => b[1] - a[1])[0]![0]
    const answers = {
      verb: { type: 'choice', choice: 'click', confidence: 0.9, probabilities: { open: 0.1, click: 0.9 } },
      target: { type: 'choice', choice, confidence: target[choice], probabilities: target },
    }
    return { status: 'answered', answers: answers as never, latencyMs: 1, model: this.model }
  }
}

describe('pnpm jev:replay over a corpus folder', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-jev-corpus-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function saveCase(name: string, state: string, expect: unknown[]): void {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ transcript: 'open the latest post', expect, ask: { state, questions: QUESTIONS } }))
  }

  const probabilities = { none: 0.05, 'ref-21': 0.7, 'ref-27': 0.25 }

  it('passes a case whose expected label Jev chooses, and exits 0', async () => {
    saveCase('latest', 'state-a', [{ question: 'target', label: 'ref-27' }])
    const jev = new FakeJev({ 'state-a': { none: 0.05, 'ref-21': 0.1, 'ref-27': 0.85 } })
    const replay = await replayCorpus(dir, { env: {}, model: jev })
    expect(replay.code).toBe(0)
    expect(jev.requests).toEqual([{ state: 'state-a', questions: QUESTIONS }])
    expect(replay.report).toContain('PASS  latest')
    expect(replay.report).toContain('target=ref-27  chose ref-27 0.85')
    expect(replay.report).toContain('1 case: 1 passed, 0 failed')
  })

  it('fails a case Jev reads otherwise — the expected label\'s probability against the chosen one — and exits non-zero', async () => {
    saveCase('latest', 'state-a', [{ question: 'target', label: 'ref-27' }])
    const replay = await replayCorpus(dir, { env: {}, model: new FakeJev({ 'state-a': probabilities }) })
    expect(replay.code).toBe(1)
    expect(replay.report).toContain('FAIL  latest')
    expect(replay.report).toContain('target=ref-27  chose ref-21 0.70 · ref-27 0.25')
    expect(replay.report).toContain('1 case: 0 passed, 1 failed')
  })

  it('reads an exclusion: it passes while Jev chooses anything but the label', async () => {
    saveCase('not-pinned', 'state-a', [{ question: 'target', not: 'ref-27' }])
    saveCase('pinned', 'state-a', [{ question: 'target', not: 'ref-21' }])
    const replay = await replayCorpus(dir, { env: {}, model: new FakeJev({ 'state-a': probabilities }) })
    expect(replay.code).toBe(1)
    expect(replay.report).toContain('PASS  not-pinned\n  target!=ref-27  chose ref-21 0.70 · ref-27 0.25')
    expect(replay.report).toContain('FAIL  pinned\n  target!=ref-21  chose ref-21 0.70')
    expect(replay.report).toContain('2 cases: 1 passed, 1 failed')
  })

  it('reads a floor (#366): the label must be chosen at that probability or more — a sure answer, not a plurality', async () => {
    saveCase('sure', 'state-a', [{ question: 'target', label: 'ref-27', atLeast: 0.85 }])
    saveCase('surer', 'state-a', [{ question: 'target', label: 'ref-27', atLeast: 0.9 }])
    const replay = await replayCorpus(dir, { env: {}, model: new FakeJev({ 'state-a': { none: 0.05, 'ref-21': 0.1, 'ref-27': 0.85 } }) })
    expect(replay.code).toBe(1)
    expect(replay.report).toContain('PASS  sure\n  target=ref-27>=0.85  chose ref-27 0.85')
    expect(replay.report).toContain('FAIL  surer\n  target=ref-27>=0.90  chose ref-27 0.85')
  })

  it('reads a ceiling (#367): the question\'s top answer, whatever it is, must be chosen under that probability — an unsure answer a sure one outvotes', async () => {
    saveCase('unsure', 'state-a', [{ question: 'verb', below: 0.95 }])
    saveCase('sure', 'state-a', [{ question: 'verb', below: 0.9 }])
    const replay = await replayCorpus(dir, { env: {}, model: new FakeJev({ 'state-a': probabilities }) })
    expect(replay.code).toBe(1)
    expect(replay.report).toContain('PASS  unsure\n  verb<0.95  chose click 0.90')
    expect(replay.report).toContain('FAIL  sure\n  verb<0.90  chose click 0.90')
  })

  it('reads alternatives (#405): any of the labels between bars passes, `!=` refuses them all, and every one must be on offer', async () => {
    saveCase('either', 'state-a', [{ question: 'target', label: 'ref-21|ref-27' }])
    saveCase('neither', 'state-a', [{ question: 'target', label: 'none|ref-27' }])
    saveCase('none-of', 'state-a', [{ question: 'target', not: 'none|ref-21' }])
    saveCase('unoffered', 'state-a', [{ question: 'target', label: 'ref-27|ref-99' }])
    const replay = await replayCorpus(dir, { env: {}, model: new FakeJev({ 'state-a': probabilities }) })
    expect(replay.report).toContain('PASS  either\n  target=ref-21|ref-27  chose ref-21 0.70')
    expect(replay.report).toContain('FAIL  neither\n  target=none|ref-27  chose ref-21 0.70 · ref-27 0.25')
    expect(replay.report).toContain('FAIL  none-of\n  target!=none|ref-21  chose ref-21 0.70')
    expect(replay.report).toContain('FAIL  unoffered  not a case: "target" offers no label "ref-99"')
  })

  it("ends with Jev's latency over the asks it answered (#390), so a widening's cost is read off the same replay", async () => {
    for (let n = 1; n <= 10; n += 1) saveCase(`case-${String(n).padStart(2, '0')}`, `state-${n}`, [{ question: 'target', label: 'ref-27' }])
    saveCase('case-11', 'state-slow', [{ question: 'target', label: 'ref-27' }])
    const timed: DecisionModel = {
      model: 'jev-fake',
      async ask(request) {
        if (request.state === 'state-slow') return { status: 'unavailable', reason: 'timeout', message: 'too slow', latencyMs: 15_000, model: 'jev-fake' }
        const answers = { target: { type: 'choice', choice: 'ref-27', confidence: 0.9, probabilities: { 'ref-27': 0.9 } } }
        return { status: 'answered', answers: answers as never, latencyMs: Number(request.state.slice('state-'.length)) * 100, model: 'jev-fake' }
      },
    }
    const replay = await replayCorpus(dir, { env: {}, model: timed })
    expect(replay.report.split('\n').at(-1)).toBe('Jev latency over 10 answers: p50 500ms, p90 900ms, max 1000ms')
  })

  it('fails a case Jev did not answer, and one whose file cannot be read as a case', async () => {
    saveCase('slow', 'state-b', [{ question: 'target', label: 'ref-27' }])
    writeFileSync(join(dir, 'broken.json'), '{"ask": ')
    const replay = await replayCorpus(dir, { env: {}, model: new FakeJev({ 'state-b': 'unavailable' }) })
    expect(replay.code).toBe(1)
    expect(replay.report).toContain('FAIL  slow  Jev did not answer: timeout (too slow)')
    expect(replay.report).toMatch(/FAIL {2}broken {2}not a case: /)
  })

  it('fails a case whose question Jev left without a Choice, and still reports the rest', async () => {
    saveCase('a-silent', 'state-a', [{ question: 'target', label: 'ref-27' }])
    saveCase('b-latest', 'state-b', [{ question: 'target', label: 'ref-27' }])
    const silent: DecisionModel = {
      model: 'jev-fake',
      async ask(request) {
        const target = request.state === 'state-a' ? {} : { target: { type: 'choice', choice: 'ref-27', confidence: 0.9, probabilities: { 'ref-27': 0.9 } } }
        return { status: 'answered', answers: target as never, latencyMs: 1, model: 'jev-fake' }
      },
    }
    const replay = await replayCorpus(dir, { env: {}, model: silent })
    expect(replay.code).toBe(1)
    expect(replay.report).toContain('FAIL  a-silent  Jev gave no Choice for "target"')
    expect(replay.report).toContain('PASS  b-latest')
  })

  it('asks each case N times with --repeat and reports per question what was chosen how often: PASS, FLIP or FAIL per case', async () => {
    saveCase('a-steady', 'state-a', [{ question: 'target', label: 'ref-21' }])
    saveCase('b-flip', 'state-b', [{ question: 'target', label: 'ref-27' }])
    saveCase('c-fail', 'state-c', [{ question: 'target', label: 'ref-27' }])
    saveCase('d-unanswered', 'state-d', [{ question: 'target', label: 'ref-27' }])
    let turn = 0
    const wavering: DecisionModel = {
      model: 'jev-fake',
      async ask(request) {
        turn += 1
        if (request.state === 'state-d' && turn % 2 === 0) return { status: 'unavailable', reason: 'failed', message: 'no images', latencyMs: 1, model: 'jev-fake' }
        // state-b is a coin flip at the margin: ref-27 on odd runs, ref-21 on even; the rest hold still.
        const probabilities =
          request.state === 'state-a' ? { 'ref-21': 0.9, 'ref-27': 0.1 }
          : request.state === 'state-c' ? { 'ref-21': 0.8, 'ref-27': 0.2 }
          : turn % 2 === 1 ? { 'ref-21': 0.45, 'ref-27': 0.55 }
          : { 'ref-21': 0.52, 'ref-27': 0.48 }
        const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0]
        const answers = { target: { type: 'choice', choice, confidence: probabilities[choice as keyof typeof probabilities], probabilities } }
        return { status: 'answered', answers: answers as never, latencyMs: 1, model: 'jev-fake' }
      },
    }
    const replay = await replayCorpus(dir, { env: {}, model: wavering }, { repeat: 4 })
    expect(replay.code).toBe(1)
    expect(turn).toBe(16)
    const lines = replay.report.split('\n')
    expect(lines).toContain('PASS  a-steady  4/4')
    expect(lines).toContain('  target=ref-21  ref-21 ×4 0.90')
    expect(lines).toContain('FLIP  b-flip  2/4')
    expect(lines).toContain('  target=ref-27  ref-27 ×2 0.55 · ref-21 ×2 0.52')
    expect(lines).toContain('FAIL  c-fail  0/4')
    expect(lines).toContain('  target=ref-27  ref-21 ×4 0.80')
    expect(lines).toContain('FLIP  d-unanswered  2/4')
    expect(lines).toContain('  ×2 Jev did not answer: failed (no images)')
    expect(lines).toContain('4 cases × 4 runs: 1 steady pass, 2 flip, 1 steady fail (jev-fake)')
    expect(lines.at(-1)).toBe('Jev latency over 14 answers: p50 1ms, p90 1ms, max 1ms')
  })

  it('says plainly that it needs TYPESAFE_API_KEY when no key is set, and asks nothing', async () => {
    saveCase('latest', 'state-a', [{ question: 'target', label: 'ref-27' }])
    const replay = await replayCorpus(dir, { env: {} })
    expect(replay.code).toBe(2)
    expect(replay.report).toContain('jev:replay asks the real Jev and needs its key')
    expect(replay.report).toContain('TYPESAFE_API_KEY')
  })

  it('jev:gate asks every model once and passes a case only when every model it was asked of does; an image case is not run on a model that reads none', async () => {
    saveCase('a-both', 'state-a', [{ question: 'target', label: 'ref-21' }])
    saveCase('b-one', 'state-b', [{ question: 'target', label: 'ref-27' }])
    writeFileSync(join(dir, 'c-mark.jpg'), 'jpeg')
    writeFileSync(join(dir, 'c-mark.json'), JSON.stringify({ expect: [{ question: 'target', label: 'ref-27' }], ask: { state: 'state-c <marks>', questions: QUESTIONS, images: { '<marks>': 'c-mark.jpg' } } }))
    const textOnly = (model: string, targets: Record<string, Record<string, number>>) => Object.assign(new FakeJev(targets), { model, readsImages: false })
    const mammoth = textOnly('host/mammoth', { 'state-a': { 'ref-21': 0.9 }, 'state-b': { 'ref-27': 0.6 } })
    const elephant = textOnly('host/elephant', { 'state-a': { 'ref-21': 0.8 }, 'state-b': { none: 0.55, 'ref-27': 0.45 } })
    const gate = await gateCorpus(dir, { env: {}, models: [mammoth, elephant] }, { models: [] })
    expect(gate.code).toBe(1)
    expect(gate.report).toBe(
      [
        'case    mammoth  elephant',
        'a-both  PASS     PASS',
        'b-one   PASS     FAIL      elephant: target=ref-27 chose none 0.55',
        'c-mark  not run  not run   an image case: --with-jev asks Jev',
        '3 cases: mammoth 2/2, elephant 1/2; through on every model 1; 1 not run on any',
        'GATE FAIL — 1 case fails on at least one model',
        'Jev latency over 4 answers: p50 1ms, p90 1ms, max 1ms',
      ].join('\n'),
    )
    expect(mammoth.requests.map((request) => request.state)).toEqual(['state-a', 'state-b'])
  })

  it("asks once more when the host hiccups — a timeout or a 502 — and never when the model answered or refused the ask", async () => {
    saveCase('a-slow', 'state-a', [{ question: 'target', label: 'ref-21' }])
    saveCase('b-refused', 'state-b', [{ question: 'target', label: 'ref-21' }])
    const asked: string[] = []
    const flaky: DecisionModel = {
      model: 'jev-fake',
      async ask(request) {
        asked.push(request.state)
        if (request.state === 'state-b') return { status: 'unavailable', reason: 'failed', message: 'no images', latencyMs: 1, model: 'jev-fake' }
        if (asked.filter((state) => state === 'state-a').length === 1) return { status: 'unavailable', reason: 'timeout', message: 'too slow', latencyMs: 1, model: 'jev-fake' }
        const answers = { target: { type: 'choice', choice: 'ref-21', confidence: 0.9, probabilities: { 'ref-21': 0.9 } } }
        return { status: 'answered', answers: answers as never, latencyMs: 1, model: 'jev-fake' }
      },
    }
    const replay = await replayCorpus(dir, { env: {}, model: flaky })
    expect(asked).toEqual(['state-a', 'state-a', 'state-b'])
    expect(replay.report).toContain('PASS  a-slow')
    expect(replay.report).toContain('FAIL  b-refused  Jev did not answer: failed (no images)')
  })

  it('jev:gate passes when every model passes every case it ran, and refuses to start with no model named', async () => {
    saveCase('a-both', 'state-a', [{ question: 'target', label: 'ref-21' }])
    const one = Object.assign(new FakeJev({ 'state-a': { 'ref-21': 0.9 } }), { model: 'host/one' })
    const gate = await gateCorpus(dir, { env: {}, models: [one] }, { models: [] })
    expect(gate.code).toBe(0)
    expect(gate.report).toContain('GATE PASS')
    const unnamed = await gateCorpus(dir, { env: { BASETEN_API_KEY: 'k' } }, { models: [] })
    expect(unnamed.code).toBe(2)
    expect(unnamed.report).toContain('--models a,b or set BINGBONG_GATE_MODELS')
  })

  it('says so when the folder holds no case', async () => {
    const replay = await replayCorpus(dir, { env: {}, model: new FakeJev({}) })
    expect(replay.code).toBe(0)
    expect(replay.report).toContain(`no cases in ${dir}`)
  })
})

describe('growing the corpus from the logs', () => {
  let logs: string
  let corpus: string

  beforeEach(() => {
    logs = mkdtempSync(join(tmpdir(), 'bingbong-jev-logs-'))
    corpus = join(mkdtempSync(join(tmpdir(), 'bingbong-jev-corpus-')), 'cases')
  })

  afterEach(() => {
    rmSync(logs, { recursive: true, force: true })
    rmSync(corpus, { recursive: true, force: true })
  })

  const ask = (id: string, state: string): AskRecord => ({ type: 'ask', id, turnId: id, at: 1, kind: 'command', model: 'jev-1.14.0', state, questions: QUESTIONS })
  const decision = (turnId: string, extra: Partial<DecisionRecord> = {}): DecisionRecord => ({
    type: 'decision',
    turnId,
    at: 1,
    source: 'spoken',
    transcript: `words of ${turnId}`,
    reading: 'jev',
    verb: 'click',
    target: 21,
    targetLabel: 'Pinned post',
    slot: null,
    jevAsked: true,
    ask: turnId,
    ...extra,
  })
  const jsonl = (records: unknown[]): string => records.map((record) => JSON.stringify(record)).join('\n') + '\n'

  function writeLogs(): void {
    writeFileSync(
      join(logs, 'decision-1-1.jsonl'),
      jsonl([
        decision('t1', { transcript: "open elon musk's latest tweet" }),
        decision('t2'),
        { type: 'misfire', turnId: 't1', at: 2, signal: 'overrun', withinMs: 900, hop: 0 },
        decision('t3', { reading: 'local_match', jevAsked: false, ask: undefined }),
        { type: 'misfire', turnId: 't3', at: 3, signal: 'back', signalTurnId: 't4', withinMs: 1200 },
        decision('t5', { ask: 't5', partialAsks: ['partial-a-1'] }),
        { type: 'misfire', turnId: 't5', at: 4, signal: 'escape', withinMs: 400 },
        // A signal whose decision record rolled off before it.
        { type: 'misfire', turnId: 't0', at: 5, signal: 'clear', withinMs: 700 },
      ]),
    )
    writeFileSync(join(logs, 'asks-1-1.jsonl'), jsonl([ask('t1', 'state-t1'), ask('t2', 'state-t2')]))
  }

  it('jev:candidates lists the asks a misfire or overrun pointed at, and says which have no ask to promote', () => {
    writeLogs()
    const candidates = listCandidates(logs)
    expect(candidates.map((candidate) => [candidate.turnId, candidate.signals, candidate.ask])).toEqual([
      ['t1', ['overrun'], 'recorded'],
      ['t3', ['back'], 'none'],
      ['t5', ['escape'], 'missing'],
      ['t0', ['clear'], 'no_decision'],
    ])
    const text = formatCandidates(candidates, logs)
    expect(text).toContain('t1  overrun  "open elon musk\'s latest tweet" → click "Pinned post"  ask t1')
    expect(text).toContain('t3  back  "words of t3" → click "Pinned post"  no ask (Jev was not asked)')
    expect(text).toContain('t5  escape  "words of t5" → click "Pinned post"  ask t5 is not in the sidecar  partials partial-a-1')
    expect(text).toContain('t0  clear  no decision record (rolled off or purged)')
    expect(text).toContain('pnpm jev:case <turnId> --expect <question>=<label>')
  })

  it('jev:case turns a logged ask into a case file that jev:replay reads back', async () => {
    writeLogs()
    const made = caseFromLog(logs, 't1', ['target=ref-27', 'target!=ref-21'], corpus)
    expect(made).toEqual({ path: join(corpus, 't1.json'), replaced: false })
    expect(caseFromLog(logs, 't1', ['target=ref-27>=0.7'], join(corpus, 'floor'))).toEqual({ path: join(corpus, 'floor', 't1.json'), replaced: false })
    expect(JSON.parse(readFileSync(join(corpus, 'floor', 't1.json'), 'utf8')).expect).toEqual([{ question: 'target', label: 'ref-27', atLeast: 0.7 }])
    expect(caseFromLog(logs, 't1', ['target=ref-27>=0.7', 'verb<0.7'], join(corpus, 'ceiling'))).toEqual({ path: join(corpus, 'ceiling', 't1.json'), replaced: false })
    expect(JSON.parse(readFileSync(join(corpus, 'ceiling', 't1.json'), 'utf8')).expect).toEqual([{ question: 'target', label: 'ref-27', atLeast: 0.7 }, { question: 'verb', below: 0.7 }])
    expect(caseFromLog(logs, 't1', ['target=ref-27', 'target!=ref-21'], corpus)).toEqual({ path: join(corpus, 't1.json'), replaced: true })
    expect(JSON.parse(readFileSync(join(corpus, 't1.json'), 'utf8'))).toMatchObject({
      turnId: 't1',
      transcript: "open elon musk's latest tweet",
      model: 'jev-1.14.0',
      expect: [{ question: 'target', label: 'ref-27' }, { question: 'target', not: 'ref-21' }],
      ask: { state: 'state-t1', questions: QUESTIONS },
    })

    const jev = new FakeJev({ 'state-t1': { none: 0.05, 'ref-21': 0.1, 'ref-27': 0.85 } })
    const replay = await replayCorpus(corpus, { env: {}, model: jev })
    expect(replay.code).toBe(0)
    expect(replay.report).toContain('PASS  t1\n  target=ref-27  chose ref-27 0.85\n  target!=ref-21  chose ref-27 0.85 · ref-21 0.10')
  })

  it("jev:case copies a Mark Ask's image into the corpus beside its case, and jev:replay sends it (#382, ADR 0084)", async () => {
    const image = new Uint8Array([0xff, 0xd8, 9, 8, 7, 0xff, 0xd9])
    mkdirSync(join(logs, 'ask-images'))
    writeFileSync(join(logs, 'ask-images', 't9-mark.jpg'), image)
    writeFileSync(join(logs, 'decision-1-1.jsonl'), jsonl([decision('t9', { ask: 't9-mark', markAsk: true })]))
    writeFileSync(join(logs, 'asks-1-1.jsonl'), jsonl([{ ...ask('t9-mark', 'marked <marks>'), turnId: 't9', kind: 'mark', images: { '<marks>': 'ask-images/t9-mark.jpg' } }]))

    expect(caseFromLog(logs, 't9-mark', ['target=ref-27'], corpus)).toEqual({ path: join(corpus, 't9-mark.json'), replaced: false })
    expect(JSON.parse(readFileSync(join(corpus, 't9-mark.json'), 'utf8')).ask).toEqual({ state: 'marked <marks>', questions: QUESTIONS, images: { '<marks>': 't9-mark.jpg' } })
    expect(new Uint8Array(readFileSync(join(corpus, 't9-mark.jpg')))).toEqual(image)

    const jev = new FakeJev({ 'marked <marks>': { none: 0.05, 'ref-21': 0.1, 'ref-27': 0.85 } })
    const replay = await replayCorpus(corpus, { env: {}, model: jev })
    expect(replay.code).toBe(0)
    expect(jev.requests[0]?.images).toEqual({ '<marks>': image })
  })

  it("jev:case refuses a Mark Ask whose image is gone from the logs, and jev:replay fails a case whose image is gone from the corpus", async () => {
    writeFileSync(join(logs, 'decision-1-1.jsonl'), jsonl([decision('t9', { ask: 't9-mark', markAsk: true })]))
    writeFileSync(join(logs, 'asks-1-1.jsonl'), jsonl([{ ...ask('t9-mark', 'marked <marks>'), turnId: 't9', kind: 'mark', images: { '<marks>': 'ask-images/t9-mark.jpg' } }]))

    expect(caseFromLog(logs, 't9-mark', ['target=ref-27'], corpus)).toEqual({ error: `the ask's image ask-images/t9-mark.jpg is not in ${logs}` })
    expect(existsSync(join(corpus, 't9-mark.json'))).toBe(false)

    mkdirSync(corpus, { recursive: true })
    writeFileSync(join(corpus, 'lost.json'), JSON.stringify({ expect: [{ question: 'target', label: 'ref-27' }], ask: { state: 'marked <marks>', questions: QUESTIONS, images: { '<marks>': 'lost.jpg' } } }))
    const replay = await replayCorpus(corpus, { env: {}, model: new FakeJev({}) })
    expect(replay.code).toBe(1)
    expect(replay.report).toContain('lost.jpg')
  })

  it('jev:case refuses an expectation the ask cannot be judged by, and a turn with no ask, writing nothing', () => {
    writeLogs()
    expect(caseFromLog(logs, 't1', ['target=ref-99'], corpus)).toEqual({ error: '"target" offers no label "ref-99"' })
    expect(caseFromLog(logs, 't1', ['colour=red'], corpus)).toEqual({ error: 'no question "colour" (asked: verb, target)' })
    expect(caseFromLog(logs, 't1', ['target'], corpus)).toEqual({ error: '"target" is not <question>=<label>[>=<probability>], <question>!=<label> or <question><<probability>' })
    expect(caseFromLog(logs, 't1', ['target=ref-27>=1.5'], corpus)).toEqual({ error: '"target=ref-27>=1.5" is not <question>=<label>[>=<probability>], <question>!=<label> or <question><<probability>' })
    expect(caseFromLog(logs, 't1', [], corpus)).toEqual({ error: 'no --expect given' })
    expect(caseFromLog(logs, 't3', ['target=ref-27'], corpus)).toEqual({ error: `no ask recorded for t3 in ${logs}` })
    expect(readCorpus(corpus)).toEqual([])
  })

  it('jev:case on a line read as Steps (#364) takes the ask that split it when the expectations judge the split', () => {
    const STEPS: DecisionQuestions = { ...QUESTIONS, steps: { type: 'choice', instructions: 'One command or two?', options: { none: 'one command', w7: 'a | b' } } }
    const jevDetail = { model: 'jev-1.14.0', latencyMs: 200, confidence: { action: 0.9, slot: 0.9, steps: 0.8 }, probabilities: { action: {}, slot: {}, steps: { w7: 0.8 } } }
    writeFileSync(join(logs, 'decision-1-1.jsonl'), jsonl([decision('s1', { transcript: 'a', ask: 's1-step1', split: { ask: 's1', jev: jevDetail, steps: ['a', 'b'], line: 'a and b' } })]))
    writeFileSync(join(logs, 'asks-1-1.jsonl'), jsonl([{ ...ask('s1', 'state-line'), questions: STEPS }, ask('s1-step1', 'state-step1')]))
    caseFromLog(logs, 's1', ['steps=w7'], corpus)
    // The split's case is the whole line's; the Step's own, by its turn or by its ask's id, carries the Step's words.
    expect(JSON.parse(readFileSync(join(corpus, 's1.json'), 'utf8'))).toMatchObject({ transcript: 'a and b', expect: [{ question: 'steps', label: 'w7' }], ask: { state: 'state-line' } })
    caseFromLog(logs, 's1', ['target=ref-27'], corpus)
    expect(JSON.parse(readFileSync(join(corpus, 's1.json'), 'utf8'))).toMatchObject({ transcript: 'a', ask: { state: 'state-step1' } })
    caseFromLog(logs, 's1-step1', ['target=ref-27'], corpus)
    expect(JSON.parse(readFileSync(join(corpus, 's1-step1.json'), 'utf8'))).toMatchObject({ turnId: 's1', transcript: 'a', ask: { state: 'state-step1' } })
  })
})
