import type { FeedEntry } from '../../core/history/feedProjection'
import type { RunProgress } from '../../core/pipeline/runProgress'
import type { PeekCardState } from '../../core/panel/peekCardState'
import { FeedMarkdown } from './FeedMarkdown'

// The Peek Card (ADR 0021, 0026, 0029; glossary): the system-pushed
// report of the live Run and its persisting Answer while the Feed Panel
// is Collapsed — voice shows it, only a human act opens the panel, and
// clicking it is that act. It renders from the panel's overlay view
// (ADR 0029) — the one surface that floats above the native pane —
// translucent over the page, bottom-center, replacing the collapsed edge
// tab; it is not a state of the panel.

/**
 * The run's Answer — its Card when it has one, else its Spoken Rendering.
 * Answer entries are conversation lines (top-level, run-less) so the scan
 * is newest-first over those; a failure surfaces as the run's own scoped
 * error line, never an out-of-turn error from unrelated activity.
 */
function runAnswer(
  entries: FeedEntry[],
  runId: string | null,
): { kind: 'display' | 'spoken' | 'error'; text: string } | null {
  let spoken: FeedEntry | null = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.role === 'assistant' && entry.kind === 'display') return { kind: 'display', text: entry.text }
    if (entry.role === 'assistant' && entry.kind === 'speak') spoken ??= entry
    if (entry.role === 'system' && entry.kind === 'error' && (runId === null || entry.runId === runId)) {
      return { kind: 'error', text: entry.text }
    }
  }
  return spoken ? { kind: 'spoken', text: spoken.text } : null
}

function liveStep(progress: RunProgress | null): string {
  if (!progress) return 'working'
  if (progress.waitingOnAgents) return `waiting on ${progress.waitingOnAgents.running} agents`
  if (progress.retry) return `${progress.stage} — retrying`
  return progress.stage
}

export function PeekCard({
  state,
  entries,
  progress,
  onOpen,
}: {
  state: PeekCardState
  entries: FeedEntry[]
  progress: RunProgress | null
  onOpen(): void
}) {
  const answer = state.phase === 'answer' ? runAnswer(entries, state.runId) : null

  return (
    <div
      className={`peek-card peek-card--${state.phase}`}
      role="button"
      tabIndex={0}
      aria-label="Open the activity feed"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="peek-orb" aria-hidden="true" />
      {state.phase === 'live' ? (
        <div className="peek-body">
          {/* The Run Headline once the orchestrator reports one; the command
              echo until then (ADR 0025). */}
          <p className="peek-command">{state.headline ?? state.commandText}</p>
          <p className="peek-step" role="status">
            {liveStep(progress)}
          </p>
        </div>
      ) : answer ? (
        <div className="peek-body">
          {answer.kind === 'display' ? (
            <div className="peek-text feed-text--markdown">
              <FeedMarkdown text={answer.text} />
            </div>
          ) : answer.kind === 'spoken' ? (
            <p className="peek-text peek-text--spoken">{answer.text}</p>
          ) : (
            <p className="peek-text peek-text--error">{answer.text.split('\n', 1)[0]}</p>
          )}
        </div>
      ) : (
        <div className="peek-body">
          <p className="peek-text">Done.</p>
        </div>
      )}
      <span className="peek-open-hint" aria-hidden="true">
        open ▸
      </span>
    </div>
  )
}
