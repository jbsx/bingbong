import { useEffect, useRef, useState } from 'react'
import type { FeedEntry } from '../../core/history/feedProjection'

/**
 * The activity feed list (#44): timestamped entries for commands, tool
 * lines, spoken/displayed text, errors, and retry detail lines —
 * observation only. Conversation structure (#54): user entries render
 * right-aligned in muted bubbles, assistant answers as left-aligned
 * railed cards; everything else stays a plain system line. Run grouping
 * (#55): run noise — tool lines, tool results, intents, reasoning runs,
 * stage markers, retries, steer echoes — folds under one per-run details
 * expander (#55), collapsed by default and auto-open while its run is
 * live, so the conversation reads as just you and Bing Bong. Rendered by
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

/** One render item after the run fold (#55): a conversation line, or a run's grouped noise. */
type FeedItem = { item: 'line'; entry: FeedEntry } | { item: 'run'; runId: string; entries: FeedEntry[] }

/**
 * Folds run-stamped entries into one bucket per run (#55), placed where
 * the run's first grouped entry landed. Interleaved conversation lines
 * (the streaming answer card) stay top-level and in order — the noise
 * reads as one block beside them, never split into a second expander.
 */
function foldRuns(entries: FeedEntry[]): FeedItem[] {
  const items: FeedItem[] = []
  const runs = new Map<string, Extract<FeedItem, { item: 'run' }>>()
  for (const entry of entries) {
    if (entry.runId === undefined) {
      items.push({ item: 'line', entry })
      continue
    }
    let run = runs.get(entry.runId)
    if (!run) {
      run = { item: 'run', runId: entry.runId, entries: [] }
      runs.set(entry.runId, run)
      items.push(run)
    }
    run.entries.push(entry)
  }
  return items
}

/**
 * One run's collapsible noise (#55): a native details/summary — keyboard
 * accessible by construction — collapsed by default, auto-open while its
 * run is live. The user's own toggles win over the live default: a
 * collapsed live run stays collapsed; a finished run collapses when it
 * ends (the toggle React applies fires onToggle, recording the choice).
 */
function RunDetails({ runId, entries, live }: { runId: string; entries: FeedEntry[]; live: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? live
  return (
    <details
      className={`feed-run${live ? ' feed-run--live' : ''}`}
      data-run-id={runId}
      open={open}
      onToggle={(event) => {
        // Nested error expanders toggle too — only this element's own
        // state is the user's choice about this run.
        if (event.target !== event.currentTarget) return
        setUserOpen((event.currentTarget as HTMLDetailsElement).open)
      }}
    >
      <summary className="feed-run-summary">
        <span className="feed-run-title">{live ? 'working' : 'run detail'}</span>
        <span className="feed-run-count">{entries.length}</span>
      </summary>
      <div className="feed-run-entries">
        {entries.map((entry) => (
          <FeedLine key={entry.id} entry={entry} />
        ))}
      </div>
    </details>
  )
}

export function ActivityFeed({
  entries,
  liveRunId,
  headerActions,
  footer,
}: {
  entries: FeedEntry[]
  /** The run currently in flight (#55) — its expander auto-opens. */
  liveRunId?: string | null
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
        {foldRuns(entries).map((item) =>
          item.item === 'run' ? (
            <RunDetails key={`run-${item.runId}`} runId={item.runId} entries={item.entries} live={item.runId === liveRunId} />
          ) : (
            <FeedLine key={item.entry.id} entry={item.entry} />
          ),
        )}
      </div>
      {footer}
    </div>
  )
}
