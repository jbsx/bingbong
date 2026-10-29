import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { creditRefusal, logLines } from './refusal'
import { finishedCell, readSummary, resumeFrom, withFinished, withRefused, writeSummary, type SummaryHead } from './summary'

describe('a run refused for credit', () => {
  it('is read from the Decision Model’s 402 or 403, with the host’s words', () => {
    expect(creditRefusal({ decision: [{ jev: { model: 'm', httpStatus: 402, message: 'Payment Required: insufficient credits' } }], perf: [] })).toBe('the Decision Model m answered 402: Payment Required: insufficient credits')
    expect(creditRefusal({ decision: [{ jev: { model: 'm', httpStatus: 403, message: 'forbidden' } }], perf: [] })).toContain('answered 403')
  })

  it('is read from the host’s words when the status is another one, and from any fallback host’s attempt', () => {
    expect(creditRefusal({ decision: [{ jev: { model: 'm', httpStatus: 400, message: 'Your account has run out of credits' } }], perf: [] })).toContain('run out of credits')
    expect(creditRefusal({ decision: [{ jev: { model: 'm', attempts: [{ model: 'm', host: 'https://h', httpStatus: 402 }] } }], perf: [] })).toBe('the Decision Model m at https://h answered 402')
  })

  it('is read from the Planner’s step and the judge’s words', () => {
    expect(creditRefusal({ decision: [], perf: [{ stage: 'planner-step', detail: { model: 'glm', httpStatus: 402 } }] })).toBe('the Planner glm answered 402')
    expect(creditRefusal({ decision: [], perf: [], why: 'the run failed: the judge was unavailable: http 402 insufficient balance' })).toContain('judge')
  })

  it('a 429 is rate limiting, never a refusal; nor is an answer, or a run that failed otherwise', () => {
    expect(creditRefusal({ decision: [{ jev: { model: 'm', httpStatus: 429, message: 'quota per minute exceeded' } }], perf: [{ stage: 'planner-step', detail: { httpStatus: 429 } }], why: 'the run failed: the judge was unavailable: 429 quota' })).toBeNull()
    expect(creditRefusal({ decision: [{ jev: { model: 'm', latencyMs: 300 } }, { reading: 'local_match' }], perf: [{ stage: 'reaction' }], why: 'nothing is playing' })).toBeNull()
  })

  it('reads every JSON line of the logs named, skipping a torn one', () => {
    expect(logLines({ 'decision-1.jsonl': '{"a":1}\n{"a":2\n\n', 'perf-1.jsonl': '{"b":1}\n' }, 'decision-')).toEqual([{ a: 1 }])
  })
})

describe('the kept summary and a resume', () => {
  const head: SummaryHead = { commit: 'abc', seed: 1, points: 3, repeat: 1, roads: ['audio'] }
  const point = { road: 'audio' as const, model: 'm', case: '5-independent-volume', point: 2, n: 1, label: 'loading 56%', cell: { verdict: 'green' } as const }

  it('skips a point finished on the same commit, model, seed and arm, and runs the refused one again', () => {
    let summary = resumeFrom(null, head)
    if (typeof summary === 'string') throw new Error(summary)
    summary = withRefused(withFinished(summary, point), { road: 'audio', model: 'm', case: '5-independent-volume', point: 3, n: 1, why: 'answered 402' })
    const resumed = resumeFrom(summary, head)
    if (typeof resumed === 'string') throw new Error(resumed)
    expect(finishedCell(resumed, { road: 'audio', model: 'm', case: '5-independent-volume', point: 2, n: 1 })).toEqual({ verdict: 'green' })
    expect(finishedCell(resumed, { road: 'audio', model: 'm', case: '5-independent-volume', point: 3, n: 1 })).toBeUndefined()
    expect(finishedCell(resumed, { road: 'audio', model: 'other', case: '5-independent-volume', point: 2, n: 1 })).toBeUndefined()
    expect(resumed.refused).toBeNull()
  })

  it('never resumes onto another commit, seed or arm', () => {
    const summary = resumeFrom(null, head) as Exclude<ReturnType<typeof resumeFrom>, string>
    expect(typeof resumeFrom(summary, { ...head, commit: 'def' })).toBe('string')
    expect(typeof resumeFrom(summary, { ...head, roads: ['pane'] })).toBe('string')
    expect(typeof resumeFrom(summary, { ...head, seed: 2 })).toBe('string')
  })

  it('a point finished again replaces its cell; the file reads back whole', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlap-summary-'))
    try {
      const first = resumeFrom(null, head) as Exclude<ReturnType<typeof resumeFrom>, string>
      const again = withFinished(withFinished(first, point), { ...point, cell: { verdict: 'red', why: 'nothing is playing' } })
      expect(again.finished).toHaveLength(1)
      writeSummary(dir, again)
      expect(readSummary(dir)?.finished[0]?.cell).toEqual({ verdict: 'red', why: 'nothing is playing' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
