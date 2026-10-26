import { cloudKeyterms } from '../voice/cloudKeyterms.ts'
import { wordErrors } from './replayReport.ts'

// The STT gate (#471): every labelled dump (`fixtures/stt-dumps/`, the
// labels in `fixtures/stt-labels/`) heard again by the cloud ear with the
// keyterms the app would build for it, scored against what was said, and
// held against the last kept run. A dump that passed — heard word for
// word — and no longer does is a regression, as on `pnpm jev:gate`; the
// ear's words on a replayed dump are deterministic, so one hearing is
// exact. Pure: the hearing is the runner's (scripts/stt-gate.ts, the
// vitest corpus file), this module says what to ask and what it means.

/** One labelled dump: what was said, and (a ledger `stt` clip) the line and the names it was scored on. */
export interface SttLabel {
  readonly said: string
  readonly evidence?: string
  readonly ledger?: string
  readonly names?: readonly string[]
  /** The keyterms the ear was asked with live, off the `stt` span (#471); absent on a dump older than the span's field. */
  readonly keyterms?: readonly string[]
}

/** The labels file: the dumps whose words are sure, and the Learned Terms the app held when they were spoken. */
export interface SttCorpus {
  readonly labels: Readonly<Record<string, SttLabel>>
  /** The Learned Terms as of the corpus (#471): the keyterms a dump without a logged list is asked with, before the heads. */
  readonly learned?: readonly string[]
}

/** What one kept run heard for a dump, so the next run's words are held against it. */
export interface SttBaselineRow {
  readonly heard: string
  readonly errors: number
}

export type SttBaseline = Readonly<Record<string, SttBaselineRow>>

/** The keyterms a dump is heard with: the logged list where the span has one, else the Learned Terms and the heads. */
export function gateKeyterms(label: SttLabel, corpus: SttCorpus, heads: readonly string[]): string[] {
  if (label.keyterms !== undefined) return [...label.keyterms]
  return cloudKeyterms([...(corpus.learned ?? [])], new Set(), heads)
}

export interface SttGateRow {
  readonly file: string
  readonly said: string
  readonly heard: string
  readonly errors: number
}

export function scoreDump(file: string, label: SttLabel, heard: string): SttGateRow {
  return { file, said: label.said, heard, errors: wordErrors(label.said, heard) }
}

export interface SttGateVerdict {
  readonly rows: readonly SttGateRow[]
  readonly words: number
  readonly errors: number
  readonly exact: number
  /** Dumps whose words differ from the kept run's. */
  readonly changed: readonly { row: SttGateRow; before: SttBaselineRow | undefined }[]
  /** Dumps the kept run heard word for word that this run did not. */
  readonly regressions: readonly SttGateRow[]
  /** Dumps this run heard word for word that the kept run did not. */
  readonly gained: readonly SttGateRow[]
}

const wordsOf = (said: string): number => said.split(/\s+/).filter((word) => word !== '').length

/** The run read against its labels and the kept run. */
export function judgeGate(rows: readonly SttGateRow[], baseline: SttBaseline): SttGateVerdict {
  // Changed in its words, not its marks: the ear sets quotes and stops differently run to run, and a label has none.
  const changed = rows.flatMap((row) => {
    const before = baseline[row.file]
    return before !== undefined && wordErrors(before.heard, row.heard) === 0 ? [] : [{ row, before }]
  })
  return {
    rows,
    words: rows.reduce((sum, row) => sum + wordsOf(row.said), 0),
    errors: rows.reduce((sum, row) => sum + row.errors, 0),
    exact: rows.filter((row) => row.errors === 0).length,
    changed,
    regressions: changed.flatMap(({ row, before }) => (before !== undefined && before.errors === 0 && row.errors > 0 ? [row] : [])),
    gained: changed.flatMap(({ row, before }) => (before !== undefined && before.errors > 0 && row.errors === 0 ? [row] : [])),
  }
}

/** The kept run's rows, as the baseline file holds them. */
export function toBaseline(rows: readonly SttGateRow[]): SttBaseline {
  return Object.fromEntries(rows.map((row) => [row.file, { heard: row.heard, errors: row.errors }]))
}

/** The gate's report: every dump whose words changed, then the totals and the verdict. */
export function formatGate(verdict: SttGateVerdict, total: number): string {
  const lines: string[] = []
  for (const { row, before } of verdict.changed) {
    lines.push(`${row.file}  ${row.errors}  ${row.said}  ← ${JSON.stringify(row.heard)}${before === undefined ? '  (new)' : `  (was ${JSON.stringify(before.heard)}, ${before.errors})`}`)
  }
  if (verdict.changed.length > 0) lines.push('')
  lines.push(`heard ${verdict.rows.length} of ${total} | word errors ${verdict.errors} of ${verdict.words} | exact ${verdict.exact} of ${verdict.rows.length} | changed ${verdict.changed.length}`)
  if (verdict.gained.length > 0) lines.push(`gained: ${verdict.gained.map((row) => row.file).join(', ')}`)
  lines.push(verdict.regressions.length === 0 ? 'no regression' : `REGRESSION: ${verdict.regressions.map((row) => `${row.file} (${JSON.stringify(row.said)} → ${JSON.stringify(row.heard)})`).join(', ')}`)
  return lines.join('\n')
}
