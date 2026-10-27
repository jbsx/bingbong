// The overlap gate's report (#486): one table per Decision Model, case ×
// point, each cell green, red (naming the first failed check in words) or
// wall (a wall stopped line 1 before line 2 arrived: neither red nor green),
// and whether the case is through — green at every point, every run. The
// footer holds what reruns it exactly: the seed, the points, the repeat, the
// commit and the calibrated spans. `--check-state` holds the files' `state`
// against the tables.

export type Cell = { readonly verdict: 'green' } | { readonly verdict: 'red' | 'wall'; readonly why: string }

export interface CaseRow {
  readonly id: string
  readonly points: readonly { readonly label: string; readonly runs: readonly Cell[] }[]
}

export interface TableFooter {
  readonly model: string
  readonly planner: string
  readonly seed: number
  readonly points: number
  readonly repeat: number
  readonly commit: string
  /** By case id, the spans its calibration found, in words. */
  readonly spans: Readonly<Record<string, string>>
}

export const through = (row: CaseRow): boolean => row.points.every((point) => point.runs.every((run) => run.verdict === 'green'))

const cellText = (cell: Cell): string => (cell.verdict === 'green' ? 'green' : `${cell.verdict}: ${cell.why.replace(/\|/g, '/')}`)

export function formatTable(rows: readonly CaseRow[], footer: TableFooter): string {
  const lines = [`### Decision Model ${footer.model}, Planner ${footer.planner}`, '', '| case | point | result | through |', '|---|---|---|---|']
  for (const row of rows) {
    row.points.forEach((point, index) => {
      const first = index === 0
      const cells = [first ? row.id : '', point.label, point.runs.map(cellText).join(', '), first ? (through(row) ? 'yes' : 'no') : '']
      lines.push(`|${cells.map((cell) => (cell === '' ? ' ' : ` ${cell} `)).join('|')}|`)
    })
  }
  const spans = Object.entries(footer.spans).map(([id, words]) => `${id} ${words}`)
  lines.push('', `through ${rows.filter(through).length}/${rows.length} · seed ${footer.seed} · points ${footer.points} · repeat ${footer.repeat} · commit ${footer.commit}`)
  if (spans.length > 0) lines.push(`calibrated spans: ${spans.join('; ')}`)
  return lines.join('\n')
}

/** Every case whose `state` disagrees with the tables: green is through on every model run, red is not. */
export function stateDisagreements(cases: readonly { readonly id: string; readonly state: { readonly is: 'red' | 'green' } }[], tables: readonly (readonly CaseRow[])[]): string[] {
  const out: string[] = []
  for (const sequence of cases) {
    const rows = tables.flatMap((table) => table.filter((row) => row.id === sequence.id))
    if (rows.length === 0) continue
    const measured = rows.every(through) ? 'green' : 'red'
    if (measured !== sequence.state.is) out.push(`${sequence.id}: the file says ${sequence.state.is}, the table says ${measured}`)
  }
  return out
}
