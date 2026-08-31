import { useEffect, useRef } from 'react'
import type { SessionObservation } from '../../../core/session/sessionEvidence'
import { formatFeedTime } from '../ActivityFeed'

/**
 * The Evidence Browser's minimal first view (#139): the current Session's
 * checkpointed Observations, newest first, rendered from the authoritative
 * snapshot — never patched from notifications, never anything of a
 * foreign Session. Only Observations render: Candidates arrive with the
 * complete browser (#142), and Assessments are not Evidence (ADR 0028) —
 * the store never holds them as Observations, so none can appear here.
 * Switching to this view is renderer-local: no browser or Run state moves.
 */
export function EvidenceView({
  observations,
  headerActions,
  footer,
}: {
  observations: readonly SessionObservation[]
  headerActions?: React.ReactNode
  /** Below the list — the panel's prompt row, same as Activity. */
  footer?: React.ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Newest evidence stays visible, same contract as the feed list.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = 0
  }, [observations])

  const newestFirst = [...observations].sort((a, b) => b.observedAt - a.observedAt)

  return (
    <div className="feed" aria-label="session evidence">
      <div className="feed-header">
        evidence
        {headerActions ? <span className="feed-header-actions">{headerActions}</span> : null}
      </div>
      <div className="feed-list" ref={listRef}>
        {newestFirst.length === 0 ? (
          <p className="feed-empty">Nothing has been checkpointed as evidence in this session yet.</p>
        ) : null}
        {newestFirst.map((observation) => (
          <article key={observation.id} className="evidence-card" data-evidence-id={observation.id}>
            <header className="evidence-card-head">
              <span className="evidence-kind">{observation.sourceKind}</span>
              <time className="feed-time">{formatFeedTime(observation.observedAt)}</time>
            </header>
            <p className="evidence-text">{observation.text}</p>
          </article>
        ))}
      </div>
      {footer}
    </div>
  )
}
