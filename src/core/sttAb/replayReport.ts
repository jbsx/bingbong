import { formatMs, nearestRankPercentile } from '../report/stats.ts'
import { numberAt } from '../timer/duration.ts'

// The #35 replay report: what scripts/replay-stt.ts prints after replaying
// utterance dumps through a shipped STT engine — per-file rows plus the
// same nearest-rank percentile summary perf:report gives the live `stt`
// span, so offline replay and real usage speak the same latency units.

export interface ReplayRow {
  file: string
  /** Speech duration of the replayed WAV. */
  speechMs: number
  /** finish() wall time — the endpoint→transcript measure (the stt span). */
  ms: number
  transcript: string
  /** The process's peak resident memory once this file was done (#358), in MB. */
  peakRssMb?: number
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

export function formatReplayReport(rows: ReplayRow[]): string {
  const fileWidth = Math.max('file'.length, ...rows.map((row) => row.file.length))
  const speechWidth = Math.max('speech'.length, ...rows.map((row) => formatSpeech(row).length))
  const msWidth = Math.max('endpoint→transcript'.length, ...rows.map((row) => formatMs(row.ms).length))
  const rss = rows.some((row) => row.peakRssMb !== undefined)
  const rssWidth = Math.max('peak RSS'.length, ...rows.map((row) => formatRss(row).length))
  const rssCell = (text: string): string => (rss ? `${pad(text, rssWidth)}  ` : '')

  const lines = [
    `${pad('file', fileWidth)}  ${pad('speech', speechWidth)}  ${pad('endpoint→transcript', msWidth)}  ${rssCell('peak RSS')}transcript`,
  ]
  for (const row of rows) {
    lines.push(
      `${pad(row.file, fileWidth)}  ${pad(formatSpeech(row), speechWidth)}  ${pad(formatMs(row.ms), msWidth)}  ${rssCell(formatRss(row))}${row.transcript}`,
    )
  }

  const sorted = rows.map((row) => row.ms).sort((a, b) => a - b)
  const peak = Math.max(0, ...rows.map((row) => row.peakRssMb ?? 0))
  lines.push('')
  lines.push(
    `replayed ${rows.length} utterance${rows.length === 1 ? '' : 's'} | ` +
      `endpoint→transcript p50 ${formatMs(nearestRankPercentile(sorted, 50))} ` +
      `p95 ${formatMs(nearestRankPercentile(sorted, 95))} ` +
      `max ${formatMs(sorted.at(-1) ?? 0)}` +
      (rss ? ` | peak RSS ${peak} MB` : ''),
  )
  return lines.join('\n')
}

/**
 * A transcript's words as a label's are written: lower case, apostrophes
 * dropped, letters and digits only, and a number as digits whether said
 * in words or written so by the ear (#471): "fifty percent" and "50%" are
 * the same words to the app, which reads both (#457).
 */
function wordsOf(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/%/g, ' percent ')
    .replace(/[^\p{L}\p{N}.\s]/gu, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    .filter((word) => word !== '')
  const out: string[] = []
  for (let at = 0; at < words.length; ) {
    const number = numberAt(words, at)
    if (number !== null && !number.alone && number.next > at) {
      out.push(String(number.value))
      at = number.next
    } else out.push(words[at++]!)
  }
  return out
}

/** The words heard wrong against what was said (#456): substituted, dropped or added — a word-level edit distance. */
export function wordErrors(said: string, heard: string): number {
  const a = wordsOf(said)
  const b = wordsOf(heard)
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)))
    previous = current
  }
  return previous[b.length]!
}

/**
 * The replay scored against labels (#456): what was said, by dump file,
 * for each dump whose meaning is sure. One line per labelled dump — its
 * word errors, what was said and, when wrong, what was heard — and the
 * totals two seed lexicons are compared by.
 */
export function formatLabelScore(rows: ReplayRow[], labels: Readonly<Record<string, string>>): string {
  const scored = rows.filter((row) => Object.hasOwn(labels, row.file)).map((row) => ({ row, said: labels[row.file]!, errors: wordErrors(labels[row.file]!, row.transcript) }))
  const fileWidth = Math.max(0, ...scored.map(({ row }) => row.file.length))
  const lines = scored.map(({ row, said, errors }) => `${pad(row.file, fileWidth)}  ${errors}  ${said}${errors > 0 ? `  ← ${row.transcript}` : ''}`)
  const errors = scored.reduce((sum, { errors: each }) => sum + each, 0)
  const words = scored.reduce((sum, { said }) => sum + wordsOf(said).length, 0)
  const exact = scored.filter(({ errors: each }) => each === 0).length
  lines.push('', `labelled ${scored.length} of ${rows.length} | word errors ${errors} of ${words} | exact ${exact} of ${scored.length}`)
  return lines.join('\n')
}

/** A ledger `stt` line's clip (#463): the names that were misheard, written as meant. */
export interface LedgerNames {
  names: readonly string[]
  /** The ledger line's turn id. */
  ledger: string
}

/** Letters and digits only, no spaces: "Tumse" and "Tum Se" are one name heard. */
function squashed(text: string): string {
  return wordsOf(text).join('')
}

/**
 * The ear's pass bar (#463, grill ruling 5): of the ledger's `stt` clips
 * that have a dump, the ones whose meant names were all heard.
 */
export function formatNameScore(rows: ReplayRow[], ledger: Readonly<Record<string, LedgerNames>>): string {
  const scored = rows
    .filter((row) => Object.hasOwn(ledger, row.file))
    .map((row) => {
      const { names, ledger: turn } = ledger[row.file]!
      const heard = squashed(row.transcript)
      return { row, names, turn, right: names.every((name) => heard.includes(squashed(name))) }
    })
  const fileWidth = Math.max(0, ...scored.map(({ row }) => row.file.length))
  const lines = scored.map(({ row, names, turn, right }) => `${pad(row.file, fileWidth)}  ${right ? 'right' : 'wrong'}  ${names.join(', ')}  ${turn}${right ? '' : `  ← ${row.transcript}`}`)
  lines.push('', `ledger names right ${scored.filter(({ right }) => right).length} of ${scored.length}`)
  return lines.join('\n')
}

/** Two engines over the clips no label covers (#463, grill ruling 4): scored on agreement only. */
export function formatAgreement(rows: ReplayRow[], other: readonly ReplayRow[], labels: Readonly<Record<string, string>>): string {
  const theirs = new Map(other.map((row) => [row.file, row.transcript]))
  const compared = rows
    .filter((row) => !Object.hasOwn(labels, row.file) && theirs.has(row.file))
    .map((row) => ({ row, other: theirs.get(row.file)!, apart: wordErrors(theirs.get(row.file)!, row.transcript) }))
  const fileWidth = Math.max(0, ...compared.map(({ row }) => row.file.length))
  const lines = compared.filter(({ apart }) => apart > 0).map(({ row, other: heard, apart }) => `${pad(row.file, fileWidth)}  ${apart}  ${row.transcript}  ≠ ${heard}`)
  const apart = compared.reduce((sum, each) => sum + each.apart, 0)
  lines.push('', `unlabelled ${compared.length} | engines agree on ${compared.filter((each) => each.apart === 0).length} of ${compared.length} | words apart ${apart}`)
  return lines.join('\n')
}

function formatSpeech(row: ReplayRow): string {
  return `${(row.speechMs / 1000).toFixed(1)}s`
}

function formatRss(row: ReplayRow): string {
  return row.peakRssMb === undefined ? '' : `${row.peakRssMb} MB`
}
