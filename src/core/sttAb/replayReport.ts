import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The #35 replay report: what scripts/replay-stt.ts prints after replaying
// utterance dumps through the shipped Moonshine engine — per-file rows plus
// the same nearest-rank percentile summary perf:report gives the live `stt`
// span, so offline replay and real usage speak the same latency units.

export interface ReplayRow {
  file: string
  /** Speech duration of the replayed WAV. */
  speechMs: number
  /** finish() wall time — the endpoint→transcript measure (the stt span). */
  ms: number
  transcript: string
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

export function formatReplayReport(rows: ReplayRow[]): string {
  const fileWidth = Math.max('file'.length, ...rows.map((row) => row.file.length))
  const speechWidth = Math.max('speech'.length, ...rows.map((row) => formatSpeech(row).length))
  const msWidth = Math.max('endpoint→transcript'.length, ...rows.map((row) => formatMs(row.ms).length))

  const lines = [
    `${pad('file', fileWidth)}  ${pad('speech', speechWidth)}  ${pad('endpoint→transcript', msWidth)}  transcript`,
  ]
  for (const row of rows) {
    lines.push(
      `${pad(row.file, fileWidth)}  ${pad(formatSpeech(row), speechWidth)}  ${pad(formatMs(row.ms), msWidth)}  ${row.transcript}`,
    )
  }

  const sorted = rows.map((row) => row.ms).sort((a, b) => a - b)
  lines.push('')
  lines.push(
    `replayed ${rows.length} utterance${rows.length === 1 ? '' : 's'} | ` +
      `endpoint→transcript p50 ${formatMs(nearestRankPercentile(sorted, 50))} ` +
      `p95 ${formatMs(nearestRankPercentile(sorted, 95))} ` +
      `max ${formatMs(sorted.at(-1) ?? 0)}`,
  )
  return lines.join('\n')
}

function formatSpeech(row: ReplayRow): string {
  return `${(row.speechMs / 1000).toFixed(1)}s`
}
