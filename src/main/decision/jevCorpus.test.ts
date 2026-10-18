import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DecisionRecord } from '../../core/command/decisionRecord'
import type { AskRecord } from '../../core/decision/askRecord'
import type { DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult } from '../../core/ports/decisionModel'
import { caseFromLog, formatCandidates, listCandidates, readCorpus, replayCorpus } from './jevCorpus'

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

  it('says plainly that it needs TYPESAFE_API_KEY when no key is set, and asks nothing', async () => {
    saveCase('latest', 'state-a', [{ question: 'target', label: 'ref-27' }])
    const replay = await replayCorpus(dir, { env: {} })
    expect(replay.code).toBe(2)
    expect(replay.report).toContain('jev:replay asks the real Jev and needs its key')
    expect(replay.report).toContain('TYPESAFE_API_KEY')
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

  it('jev:case refuses an expectation the ask cannot be judged by, and a turn with no ask, writing nothing', () => {
    writeLogs()
    expect(caseFromLog(logs, 't1', ['target=ref-99'], corpus)).toEqual({ error: '"target" offers no label "ref-99"' })
    expect(caseFromLog(logs, 't1', ['colour=red'], corpus)).toEqual({ error: 'no question "colour" (asked: verb, target)' })
    expect(caseFromLog(logs, 't1', ['target'], corpus)).toEqual({ error: '"target" is not <question>=<label> or <question>!=<label>' })
    expect(caseFromLog(logs, 't1', [], corpus)).toEqual({ error: 'no --expect given' })
    expect(caseFromLog(logs, 't3', ['target=ref-27'], corpus)).toEqual({ error: `no ask recorded for t3 in ${logs}` })
    expect(readCorpus(corpus)).toEqual([])
  })
})
