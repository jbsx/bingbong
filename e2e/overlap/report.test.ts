import { describe, expect, it } from 'vitest'
import { formatTable, stateDisagreements, through, type CaseRow } from './report'

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
    const table = formatTable(rows, { model: 'mammoth', planner: 'glm-5.3 (default)', seed: 1, points: 3, repeat: 2, commit: 'abc1234', spans: { '5-independent': 'loading 1200–2600 ms' } })
    expect(table).toBe(
      [
        '### Decision Model mammoth, Planner glm-5.3 (default)',
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

describe('--check-state', () => {
  it('names every case whose state disagrees with the table, across every model run', () => {
    const cases = [
      { id: '1-replace', state: { is: 'red' as const } },
      { id: '9-again', state: { is: 'red' as const } },
      { id: '5-independent', state: { is: 'green' as const } },
    ]
    const tables = [rows, [{ id: '9-again', points: [{ label: '700 ms', runs: [{ verdict: 'green' as const }] }] }]]
    expect(stateDisagreements(cases, tables)).toEqual(['9-again: the file says red, the table says green', '5-independent: the file says green, the table says red'])
  })
})
