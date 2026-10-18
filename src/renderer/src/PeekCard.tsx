import type { FeedEntry } from '../../core/feed/feedProjection'
import type { RunProgress } from '../../core/pipeline/runProgress'
import { peekCardAnswer, type PeekCardState } from '../../core/panel/peekCardState'
import { FeedMarkdown } from './FeedMarkdown'
import { ChevronIcon } from './WeatherIcon'

// The Peek Card (ADR 0021, 0026, 0029; glossary): the system-pushed
// report of the live Run and its persisting Answer while the Feed Panel
// is Collapsed — voice shows it, only a human act opens the panel, and
// clicking it is that act. It renders from the panel's overlay view
// (ADR 0029) — the one surface that floats above the native pane —
// translucent over the page, bottom-center, replacing the collapsed edge
// tab; it is not a state of the panel.

function liveStep(progress: RunProgress | null): string {
  return progress ? progress.stage : 'working'
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
  // Only the reported Command's own Answer (#329); a failure's mark takes the failure colour.
  const answer = state.phase === 'answer' ? peekCardAnswer(entries, state.runId) : null

  return (
    <div
      className={`peek-card peek-card--${state.phase}${answer?.failure ? ' peek-card--failed' : ''}`}
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
          <p className="peek-command">{state.commandText}</p>
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
            <p className="peek-text peek-text--error">{answer.text}</p>
          )}
        </div>
      ) : (
        <div className="peek-body">
          <p className="peek-text">Done.</p>
        </div>
      )}
      <span className="peek-open-hint" aria-hidden="true">
        open <ChevronIcon size={14} />
      </span>
    </div>
  )
}
