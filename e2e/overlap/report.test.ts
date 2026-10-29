import { describe, expect, it } from 'vitest'
import { formatTable, measuredOn, stateDisagreements, through, type CaseRow } from './report'

const rows: CaseRow[] = [
  { id: '1-replace', points: [{ label: '1200 ms', runs: [{ verdict: 'green' }] }, { label: '2900 ms', runs: [{ verdict: 'red', why: 'media is playing' }] }] },
  { id: '5-independent', points: [{ label: 'loading 40%', runs: [{ verdict: 'wall', why: 'login-wall on accounts.google.com' }] }] },
  { id: '9-again', points: [{ label: '700 ms', runs: [{ verdict: 'green' }, { verdict: 'green' }] }] },
]

describe('the gate’s table, one per Decision Model', () => {
  it('a case is through only when every run at every point is green', () => {
    expect(rows.map(through)).toEqual([false, false, true])
  })

  it('shows case × point, a red cell with its first failed check, and a footer to rerun it exactly', () => {
    const table = formatTable(rows, { model: 'mammoth', planner: 'glm-5.3 (default)', road: 'audio', seed: 1, points: 3, repeat: 2, commit: 'abc1234', spans: { '5-independent': 'loading 1200–2600 ms' } })
    expect(table).toBe(
      [
        '### Decision Model mammoth, Planner glm-5.3 (default), audio road',
        '',
        '| case | point | result | through |',
        '|---|---|---|---|',
        '| 1-replace | 1200 ms | green | no |',
        '| | 2900 ms | red: media is playing | |',
        '| 5-independent | loading 40% | wall: login-wall on accounts.google.com | no |',
        '| 9-again | 700 ms | green, green | yes |',
        '',
        'through 1/3 · seed 1 · points 3 · repeat 2 · commit abc1234',
        'calibrated spans: 5-independent loading 1200–2600 ms',
      ].join('\n'),
    )
  })
})

const unmet: CaseRow = { id: '8-split', points: [{ label: '1100 ms', runs: [{ verdict: 'start not met', why: 'the page shown is https://www.youtube.com/watch?v=1, not https://en.wikipedia.org/wiki/Radiohead' }] }] }

describe('a start not met (#509)', () => {
  it('measures nothing: its point is left out of through, and a case with no point measured is neither through nor not', () => {
    const mixed: CaseRow = { id: '10-own', points: [{ label: 'p1', runs: [{ verdict: 'start not met', why: 'no song is heard, on the pane or the road' }] }, { label: 'p2', runs: [{ verdict: 'green' }] }] }
    expect(through(mixed)).toBe(true)
    expect(through(unmet)).toBe(false)
    expect(measuredOn(unmet)).toBe('start not met')
    expect(measuredOn(mixed)).toBe('green')
    expect(measuredOn(rows[0]!)).toBe('red')
  })

  it('is its own result in the table, and the case is not counted in the through line', () => {
    const table = formatTable([rows[2]!, unmet], { model: 'jev', planner: 'glm-5.3 (default)', road: 'pane', seed: 1, points: 3, repeat: 1, commit: 'abc1234', spans: {} })
    expect(table.split('\n').slice(4)).toEqual([
      '| 9-again | 700 ms | green, green | yes |',
      '| 8-split | 1100 ms | start not met: the page shown is https://www.youtube.com/watch?v=1, not https://en.wikipedia.org/wiki/Radiohead | start not met |',
      '',
      'through 1/1 · start not met 1 · seed 1 · points 3 · repeat 1 · commit abc1234',
    ])
  })
})

describe('--check-state', () => {
  it('names every case whose state on a road disagrees with that road\'s tables, across every model run', () => {
    const state = (is: 'red' | 'green' | 'start not met') => ({ is, on: 'abc', date: '2026-10-29', models: ['m'] })
    const cases = [
      { id: '1-replace', state: { audio: state('red') } },
      { id: '9-again', state: { audio: state('red'), pane: state('green') } },
      { id: '5-independent', state: { audio: state('green') } },
      { id: '8-split', state: { pane: state('start not met') } },
    ]
    const tables = [
      { road: 'audio' as const, rows },
      { road: 'audio' as const, rows: [{ id: '9-again', points: [{ label: '700 ms', runs: [{ verdict: 'green' as const }] }] }] },
      { road: 'pane' as const, rows: [rows[2]!, unmet, rows[0]!] },
    ]
    expect(stateDisagreements(cases, tables)).toEqual([
      '9-again on the audio road: the file says red, the table says green',
      '5-independent on the audio road: the file says green, the table says red',
      '1-replace on the pane road: the file has no state, the table says red',
    ])
  })
})
