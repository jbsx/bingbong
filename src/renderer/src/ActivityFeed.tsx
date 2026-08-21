import { useEffect, useRef } from 'react'
import type { FeedEntry } from '../../core/history/feedProjection'

/**
 * The activity feed list (#44): timestamped entries for commands, tool
 * lines, spoken/displayed text, errors, and retry detail lines —
 * observation only. Conversation structure (#54): user entries render
 * right-aligned in muted bubbles, assistant answers as left-aligned
 * railed cards; everything else stays a plain system line. Rendered by
 * the feed panel's overlay webContents (#45); the idle screen reuses
 * FeedLine for its digest.
 */

function formatFeedTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit' })
}

export function FeedLine({ entry }: { entry: FeedEntry }) {
  const time = <time className="feed-time">{formatFeedTime(entry.at)}</time>
  if (entry.role === 'user') {
    // Your words (#54): commands and heard transcriptions, right-aligned
    // in muted bubbles.
    return (
      <p className={`feed-entry feed-entry--user feed-entry--${entry.kind}`}>
        <span className="feed-bubble">
          <span className="feed-text">
            {entry.kind === 'command' && <span className="feed-speaker">you</span>} {entry.text}
          </span>
        </span>
        {time}
      </p>
    )
  }
  if (entry.role === 'assistant') {
    // Bing Bong's answers (#54): display entries, the live answer stream,
    // and display-less spoken lines — left-aligned railed cards at
    // conversation size.
    return (
      <p className={`feed-entry feed-entry--assistant feed-entry--${entry.kind}`}>
        {time}
        <span className="feed-card">
          <span className="feed-text">
            {entry.kind === 'speak' && <span className="feed-speaker">bing bong</span>} {entry.text}
          </span>
        </span>
      </p>
    )
  }
  switch (entry.kind) {
    case 'error': {
      const summary = entry.text.split('\n', 1)[0]
      const trimmed = summary.length > 140 ? `${summary.slice(0, 140)}…` : summary
      if (trimmed === entry.text) {
        return (
          <p className="feed-entry feed-entry--error">
            {time}
            <span className="feed-text">{entry.text}</span>
          </p>
        )
      }
      return (
        <details className="feed-entry feed-entry--error">
          <summary>
            {time}
            <span className="feed-text">{trimmed}</span>
          </summary>
          <pre className="feed-error-detail">{entry.text}</pre>
        </details>
      )
    }
    default:
      // tool lines, displayed text, voice lines, retries, streamed
      // answer/reasoning runs, tool intent — timestamp + text.
      return (
        <p className={`feed-entry feed-entry--${entry.kind}`}>
          {time}
          <span className="feed-text">{entry.text}</span>
        </p>
      )
  }
}

export function ActivityFeed({
  entries,
  headerActions,
  footer,
}: {
  entries: FeedEntry[]
  headerActions?: React.ReactNode
  /** Below the list — the panel's steer box (#46). */
  footer?: React.ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [entries])

  return (
    <div className="feed" aria-label="activity feed">
      <div className="feed-header">
        activity
        {headerActions ? <span className="feed-header-actions">{headerActions}</span> : null}
      </div>
      <div className="feed-list" ref={listRef} aria-live="polite">
        {entries.length === 0 ? <p className="feed-empty">Say or type a command to begin.</p> : null}
        {entries.map((entry) => (
          <FeedLine key={entry.id} entry={entry} />
        ))}
      </div>
      {footer}
    </div>
  )
}
