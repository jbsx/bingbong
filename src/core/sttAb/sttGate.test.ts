import { describe, expect, it } from 'vitest'
import { formatGate, gateKeyterms, judgeGate, scoreDump, toBaseline, type SttCorpus } from './sttGate'

// The STT gate (#471): the keyterms a dump is heard with, the score against
// its label, and the verdict against the kept run.

const corpus: SttCorpus = {
  learned: ['niyam', 'tum se tum tak'],
  labels: {
    'a.wav': { said: 'idle page', ledger: 'turn-1', names: ['idle'] },
    'b.wav': { said: 'play feeling good', keyterms: ['feeling good', 'play'] },
    'c.wav': { said: 'loop this song' },
  },
}

describe('gateKeyterms', () => {
  it('asks with the logged list where the span has one, else the Learned Terms and the heads', () => {
    expect(gateKeyterms(corpus.labels['b.wav']!, corpus, ['idle', 'loop'])).toEqual(['feeling good', 'play'])
    expect(gateKeyterms(corpus.labels['a.wav']!, corpus, ['idle', 'loop'])).toEqual(['niyam', 'tum se tum tak', 'idle', 'loop'])
  })
})

describe('judgeGate', () => {
  const rows = [scoreDump('a.wav', corpus.labels['a.wav']!, 'Idle page.'), scoreDump('b.wav', corpus.labels['b.wav']!, "They're feeling good."), scoreDump('c.wav', corpus.labels['c.wav']!, 'Loop this song.')]

  it('scores each dump by word errors, case and punctuation aside', () => {
    expect(rows.map((row) => row.errors)).toEqual([0, 1, 0])
  })

  it('names a dump the kept run heard right and this run did not as a regression, and the reverse as gained', () => {
    const verdict = judgeGate(rows, { 'a.wav': { heard: 'Title page.', errors: 1 }, 'b.wav': { heard: 'Play feeling good.', errors: 0 }, 'c.wav': { heard: 'Loop this song.', errors: 0 } })
    expect(verdict.regressions.map((row) => row.file)).toEqual(['b.wav'])
    expect(verdict.gained.map((row) => row.file)).toEqual(['a.wav'])
    expect(verdict.changed.map(({ row }) => row.file)).toEqual(['a.wav', 'b.wav'])
    expect({ words: verdict.words, errors: verdict.errors, exact: verdict.exact }).toEqual({ words: 8, errors: 1, exact: 2 })
  })

  it('a dump the kept run never heard is changed, never a regression', () => {
    const verdict = judgeGate(rows, {})
    expect(verdict.changed).toHaveLength(3)
    expect(verdict.regressions).toEqual([])
  })

  it('keeps a run as the baseline the next is held against, its marks and quotes aside', () => {
    expect(judgeGate(rows, toBaseline(rows)).changed).toEqual([])
    expect(judgeGate(rows, { ...toBaseline(rows), 'c.wav': { heard: 'Loop "this" song', errors: 0 } }).changed).toEqual([])
  })

  it('prints the changed dumps, the totals and the verdict', () => {
    const report = formatGate(judgeGate(rows, { 'b.wav': { heard: 'Play feeling good.', errors: 0 }, 'c.wav': { heard: 'Loop this song.', errors: 0 } }), 4)
    expect(report).toContain('a.wav  0  idle page  ← "Idle page."  (new)')
    expect(report).toContain('b.wav  1  play feeling good  ← "They\'re feeling good."  (was "Play feeling good.", 0)')
    expect(report).toContain('heard 3 of 4 | word errors 1 of 8 | exact 2 of 3 | changed 2')
    expect(report).toContain('REGRESSION: b.wav')
  })
})
