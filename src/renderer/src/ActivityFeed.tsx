import { useEffect, useRef } from 'react'
import type { FeedEntry } from '../../core/history/feedProjection'

/**
 * The right-edge activity feed panel (#44): timestamped entries for
 * commands, tool lines, spoken/displayed text, errors, and retry detail
 * lines — everything the footer transcript used to show, observation only.
 * Interactions (command box, Stop, confirmation/ask cards) stay in the
 * footer; subagent cards stay above the browser pane.
 */

function formatFeedTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit' })
}

export function FeedLine({ entry }: { entry: FeedEntry }) {
  const time = <time className="feed-time">{formatFeedTime(entry.at)}</time>
  switch (entry.kind) {
    case 'command':
      return (
        <p className="feed-entry feed-entry--command">
          {time}
          <span className="feed-text">
            <span className="feed-speaker">you</span> {entry.text}
          </span>
        </p>
      )
    case 'speak':
      return (
        <p className="feed-entry feed-entry--speak">
          {time}
          <span className="feed-text">
            <span className="feed-speaker">bing bong</span> {entry.text}
          </span>
        </p>
      )
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
      // tool lines, displayed text, voice lines, retries — timestamp + text.
      return (
        <p className={`feed-entry feed-entry--${entry.kind}`}>
          {time}
          <span className="feed-text">{entry.text}</span>
        </p>
      )
  }
}

export function ActivityFeed({ entries }: { entries: FeedEntry[] }) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [entries])

  return (
    <div className="feed" aria-label="activity feed">
      <div className="feed-header">activity</div>
      <div className="feed-list" ref={listRef} aria-live="polite">
        {entries.length === 0 ? <p className="feed-empty">Say or type a command to begin.</p> : null}
        {entries.map((entry) => (
          <FeedLine key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
