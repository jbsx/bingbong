// The overlap gate's report (#486): one table per Decision Model, case ×
// point, each cell green, red (naming the first failed check in words) or
// wall (a wall stopped line 1 before line 2 arrived: neither red nor green),
// and whether the case is through — green at every point, every run. The
// footer holds what reruns it exactly: the seed, the points, the repeat, the
// commit and the calibrated spans. `--check-state` holds the files' `state`
// against the tables.

import type { Road } from './audioRoad.ts'

export type Cell = { readonly verdict: 'green' } | { readonly verdict: 'red' | 'wall' | 'start not met'; readonly why: string }

/** What a case measured on a road: `start not met` when no run of it could put its start. */
export type Measured = 'red' | 'green' | 'start not met'

export interface CaseRow {
  readonly id: string
  readonly points: readonly { readonly label: string; readonly runs: readonly Cell[] }[]
}

export interface TableFooter {
  readonly model: string
  readonly planner: string
  readonly road: Road
  readonly seed: number
  readonly points: number
  readonly repeat: number
  readonly commit: string
  /** By case id, the spans its calibration found, in words. */
  readonly spans: Readonly<Record<string, string>>
}

const counted = (row: CaseRow): Cell[] => row.points.flatMap((point) => point.runs.filter((run) => run.verdict !== 'start not met'))

/** Green at every run that measured, with at least one that did. */
export const through = (row: CaseRow): boolean => counted(row).length > 0 && counted(row).every((run) => run.verdict === 'green')

export const measuredOn = (row: CaseRow): Measured => (counted(row).length === 0 ? 'start not met' : through(row) ? 'green' : 'red')

const cellText = (cell: Cell): string => (cell.verdict === 'green' ? 'green' : `${cell.verdict}: ${cell.why.replace(/\|/g, '/')}`)

export function formatTable(rows: readonly CaseRow[], footer: TableFooter): string {
  const lines = [`### Decision Model ${footer.model}, Planner ${footer.planner}, ${footer.road} road`, '', '| case | point | result | through |', '|---|---|---|---|']
  for (const row of rows) {
    row.points.forEach((point, index) => {
      const first = index === 0
      const measured = measuredOn(row)
      const cells = [first ? row.id : '', point.label, point.runs.map(cellText).join(', '), first ? (measured === 'start not met' ? measured : measured === 'green' ? 'yes' : 'no') : '']
      lines.push(`|${cells.map((cell) => (cell === '' ? ' ' : ` ${cell} `)).join('|')}|`)
    })
  }
  const spans = Object.entries(footer.spans).map(([id, words]) => `${id} ${words}`)
  const unmet = rows.filter((row) => measuredOn(row) === 'start not met').length
  lines.push('', `through ${rows.filter(through).length}/${rows.length - unmet}${unmet > 0 ? ` · start not met ${unmet}` : ''} · seed ${footer.seed} · points ${footer.points} · repeat ${footer.repeat} · commit ${footer.commit}`)
  if (spans.length > 0) lines.push(`calibrated spans: ${spans.join('; ')}`)
  return lines.join('\n')
}

/** What a case's file says it measured on each road it was run on. */
export type RoadStates = Partial<Record<Road, { readonly is: Measured }>>

/**
 * Every case whose `state` on a road disagrees with that road's tables: a
 * start not met when no run could put its start, else green when through on
 * every model run, red when not. A road the file has no state for disagrees.
 */
export function stateDisagreements(cases: readonly { readonly id: string; readonly state: RoadStates }[], tables: readonly { readonly road: Road; readonly rows: readonly CaseRow[] }[]): string[] {
  const out: string[] = []
  for (const road of [...new Set(tables.map((table) => table.road))]) {
    for (const sequence of cases) {
      const rows = tables.filter((table) => table.road === road).flatMap((table) => table.rows.filter((row) => row.id === sequence.id))
      if (rows.length === 0) continue
      const kinds = rows.map(measuredOn)
      const measured: Measured = kinds.every((kind) => kind === 'start not met') ? 'start not met' : kinds.every((kind) => kind !== 'red') ? 'green' : 'red'
      const said = sequence.state[road]?.is
      if (said === undefined) out.push(`${sequence.id} on the ${road} road: the file has no state, the table says ${measured}`)
      else if (measured !== said) out.push(`${sequence.id} on the ${road} road: the file says ${said}, the table says ${measured}`)
    }
  }
  return out
}
