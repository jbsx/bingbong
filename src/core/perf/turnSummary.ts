import type { PerfTracer, TurnSummary } from './perfTracer'
import { reportFault } from '../trace/fault'

// The per-turn console line (#30): "stt 6.9s | llm 3.2s | tool(n=5) 8.1s |
// total 21.3s" — every stage kind the turn recorded, in first-recorded
// order, a repeat count when a stage ran more than once, and the total
// last. There is no fixed stage list: stages added by sibling tickets (TTS
// split, browser sub-spans) compose into the line untouched. Exact ms live
// in the JSONL summary event; the line rounds each stage independently.
export function formatTurnSummary(summary: TurnSummary): string {
  const parts = Object.entries(summary.stages).map(([stage, tally]) => {
    const label = tally.count > 1 ? `${stage}(n=${tally.count})` : stage
    return `${label} ${(tally.durMs / 1000).toFixed(1)}s`
  })
  parts.push(`total ${(summary.totalMs / 1000).toFixed(1)}s`)
  return parts.join(' | ')
}

/**
 * Run-end close-out (#30): records the turn's synthetic `summary` event and
 * prints the one-line console summary. Turns that recorded nothing degrade
 * to a no-op, and — like every perf call site — a throwing tracer or sink
 * is swallowed: the log is advisory and never breaks a run.
 */
export function emitTurnSummary(tracer: PerfTracer | undefined, turnId: string, print: (line: string) => void): void {
  if (!tracer) return
  try {
    const summary = tracer.summarize(turnId)
    if (summary) print(formatTurnSummary(summary))
  } catch (error) {
    reportFault('perf.turnSummary.emit', error, { turnId })
    // swallowed — see above
  }
}
