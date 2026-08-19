import { formatMs, nearestRankPercentile } from '../report/stats.ts'

// The #39 A/B report: per-utterance transcript pairs and latency
// distributions, whisper.cpp vs Moonshine Base, over the utterance dumps the
// voice pipeline can be told to write (#34). Pure functions — the script
// collects rows, this module defines what "compared" means (normalized
// transcript equality) and prints the go/no-go-shaped numbers. Percentiles
// and ms formatting come from src/core/report/stats.ts so this ranks and
// prints latency the same way the perf report (#33) does.

export interface AbRow {
  file: string
  durationSec: number
  whisperText: string
  whisperMs: number
  moonshineText: string
  moonshineMs: number
}

export interface AbLatencyStats {
  count: number
  p50: number
  p95: number
  max: number
}

export interface AbSummary {
  files: number
  /** Normalized-equal transcripts, both-empty pairs included. */
  matches: number
  bothEmpty: number
  differ: number
  whisperEmpty: number
  moonshineEmpty: number
  whisper: AbLatencyStats
  moonshine: AbLatencyStats
}

function latencyStats(ms: number[]): AbLatencyStats {
  const sorted = [...ms].sort((a, b) => a - b)
  return {
    count: sorted.length,
    p50: nearestRankPercentile(sorted, 50),
    p95: nearestRankPercentile(sorted, 95),
    max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
  }
}

/** Case/punctuation/whitespace-insensitive transcript form for matching. */
function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function buildAbSummary(rows: readonly AbRow[]): AbSummary {
  let matches = 0
  let bothEmpty = 0
  let whisperEmpty = 0
  let moonshineEmpty = 0
  for (const row of rows) {
    const whisper = normalizeTranscript(row.whisperText)
    const moonshine = normalizeTranscript(row.moonshineText)
    if (whisper === moonshine) {
      matches += 1
      if (whisper === '') bothEmpty += 1
    } else {
      if (whisper === '') whisperEmpty += 1
      if (moonshine === '') moonshineEmpty += 1
    }
  }
  return {
    files: rows.length,
    matches,
    bothEmpty,
    differ: rows.length - matches,
    whisperEmpty,
    moonshineEmpty,
    whisper: latencyStats(rows.map((r) => r.whisperMs)),
    moonshine: latencyStats(rows.map((r) => r.moonshineMs)),
  }
}

const TEXT_CELL = 40

function cell(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TEXT_CELL ? `${flat.slice(0, TEXT_CELL - 3)}...` : flat || '(empty)'
}

/** Aligned console table: first column pads right, the rest left-align at its width. */
function renderTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  const line = (row: string[]): string =>
    row.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
  return [line(headers), ...rows.map(line)]
}

export function formatAbReport(rows: readonly AbRow[], context: { dumpsDir: string }): string {
  const summary = buildAbSummary(rows)
  const lines: string[] = [`STT A/B — ${context.dumpsDir} (${summary.files} utterance${summary.files === 1 ? '' : 's'})`]

  if (rows.length > 0) {
    // Normalization is computed once per row and drives the match marker,
    // the full-diff section and the summary counts alike.
    const normalized = rows.map((r) => ({
      row: r,
      whisper: normalizeTranscript(r.whisperText),
      moonshine: normalizeTranscript(r.moonshineText),
    }))

    lines.push('')
    lines.push(
      ...renderTable(
        ['file', 'dur', 'whisper', 'moonshine', 'text'],
        normalized.map(({ row: r, whisper, moonshine }) => [
          r.file,
          `${r.durationSec.toFixed(1)}s`,
          formatMs(r.whisperMs),
          formatMs(r.moonshineMs),
          `${whisper === moonshine ? '=' : '!'} ${cell(r.whisperText)} | ${cell(r.moonshineText)}`,
        ]),
      ),
    )

    // Full transcripts for every differing pair — the eyeball/categorize
    // material the go/no-go write-up quotes verbatim.
    const differing = normalized.filter(
      ({ row: r, whisper, moonshine }) => whisper !== moonshine && (r.whisperText.trim() !== '' || r.moonshineText.trim() !== ''),
    )
    if (differing.length > 0) {
      lines.push('')
      lines.push('differing transcripts:')
      for (const { row: r } of differing) {
        lines.push(`${r.file} (${r.durationSec.toFixed(1)}s)`)
        lines.push(`  whisper:   ${r.whisperText.trim() || '(empty)'}`)
        lines.push(`  moonshine: ${r.moonshineText.trim() || '(empty)'}`)
      }
    }
  }

  lines.push('')
  lines.push(`transcripts: ${summary.matches}/${summary.files} match (${summary.bothEmpty} both-empty, ${summary.moonshineEmpty} moonshine-only-empty, ${summary.whisperEmpty} whisper-only-empty)`)
  lines.push(
    ...renderTable(
      ['latency', 'p50', 'p95', 'max'],
      [
        ['whisper base.en', formatMs(summary.whisper.p50), formatMs(summary.whisper.p95), formatMs(summary.whisper.max)],
        ['moonshine base', formatMs(summary.moonshine.p50), formatMs(summary.moonshine.p95), formatMs(summary.moonshine.max)],
      ],
    ),
  )
  return lines.join('\n')
}
