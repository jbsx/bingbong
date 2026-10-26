import type { FeedEntry } from '../../core/feed/feedProjection'
import type { RunProgress } from '../../core/pipeline/runProgress'
import { PEEK_CARD_LINGER_MS, peekCardAnswer, type PeekCardAnswer, type PeekCardState } from '../../core/panel/peekCardState'
import { FeedMarkdown } from './FeedMarkdown'
import { ChevronIcon } from './WeatherIcon'

// The Peek Card (ADR 0021, 0026, 0029; glossary): the system-pushed
// report of the live Run and its Answer, for 15 s past its sentence
// (#470), while the Feed Panel is Collapsed — voice shows it, only a
// human act opens the panel, and clicking it is that act. It renders from the panel's overlay view
// (ADR 0029) — the one surface that floats above the native pane —
// translucent over the page, bottom-center, replacing the collapsed edge
// tab; it is not a state of the panel.

function liveStep(progress: RunProgress | null): string {
  return progress ? progress.stage : 'working'
}

/**
 * The bar along the card's foot draining across the Answer's 15 s (#470):
 * full and still while its sentence sounds, then running out with the
 * time. It is drawn from the deadline, so a card shown late starts part
 * drained; nothing pauses it.
 */
function LingerBar({ retiresAt }: { retiresAt: number | null }) {
  const style = retiresAt === null ? undefined : { animationDuration: `${PEEK_CARD_LINGER_MS}ms`, animationDelay: `${Math.min(0, retiresAt - PEEK_CARD_LINGER_MS - Date.now())}ms` }
  return <span key={retiresAt ?? 'held'} className={retiresAt === null ? 'peek-linger peek-linger--held' : 'peek-linger'} style={style} aria-hidden="true" />
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
      className={`peek-card peek-card--${state.phase}${answer?.failure ? ' peek-card--failed' : ''}${answer?.muted ? ' peek-card--muted' : ''}`}
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
      {state.phase === 'answer' ? <LingerBar retiresAt={state.retiresAt} /> : null}
    </div>
  )
}

/**
 * The Peek Card's Idle Screen form (#470, CONTEXT Peek Card): a failed
 * Command or "No response.", in the Weigh-in pop-up's place, read from the
 * chair — the words heard, the sentence at status size, and under it the
 * rest of the Answer, the reason and the `Try “…”` line (#438). Its dot is
 * the failure colour, grey for "No response.". A tap dismisses it on the
 * pointer going down and keeps the tap from the window, so the Idle Screen
 * stays up: it is never activity.
 */
export function IdlePeekCard({ state, answer, onDismiss }: { state: PeekCardState; answer: PeekCardAnswer; onDismiss(): void }) {
  const [sentence, ...rest] = answer.text.split('\n\n')
  return (
    <div
      className={`peek-card peek-card--answer peek-card--idle${answer.failure ? ' peek-card--failed' : ''}${answer.muted ? ' peek-card--muted' : ''}`}
      role="status"
      aria-label={`${state.commandText ?? ''}: ${answer.text}. Tap to dismiss`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }}
    >
      <span className="peek-orb" aria-hidden="true" />
      <div className="peek-body">
        {state.commandText !== null ? <p className="peek-heard">“{state.commandText}”</p> : null}
        <p className="peek-sentence">{sentence}</p>
        {rest.length > 0 ? <p className="peek-more">{rest.join(' ')}</p> : null}
      </div>
      <LingerBar retiresAt={state.retiresAt} />
    </div>
  )
}
