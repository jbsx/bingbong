import { Fragment, useEffect, useRef, useState } from 'react'
import { headlineAnswerId, type FeedEntry } from '../../core/feed/feedProjection'
import { ChromeIcon } from './ChromeIcon'
import { FeedMarkdown } from './FeedMarkdown'

/**
 * The activity feed list (#44): timestamped entries for commands, tool
 * lines, spoken/displayed text, errors, and stage detail lines —
 * observation only. Conversation structure (#54): user entries render
 * right-aligned in muted bubbles, assistant Answers as left-aligned
 * railed cards; everything else stays a plain system line. Attribution
 * (ADR 0013): one device — the Status Capsule orb beside every assistant
 * entry; no text handles, the name living in screen-reader text only.
 * Run grouping (#55): run noise — tool lines and stage markers
 * — folds under one per-run details expander, collapsed (#333), its title
 * reading as activity while its run is live, so the conversation reads as just you
 * and Bing Bong. Markdown (#56): the Answer's Card renders as structure
 * (FeedMarkdown) — code blocks, lists, headings, links that navigate the
 * pane — while a display-less Answer renders its spoken line (italic
 * speech). Rendered by the feed panel's overlay webContents (#45).
 */

export function formatFeedTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit' })
}

/**
 * Text that may carry a long address (#333): a line break may fall after
 * any slash, so the address wraps inside its bubble at its slashes rather
 * than mid-word or past the bubble's edge.
 */
function BreaksAtSlashes({ text }: { text: string }) {
  const parts = text.split(/(?<=\/)/)
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </>
  )
}

/**
 * How the Feed draws one line (#359, ADR 0078): the headline is the newest
 * Answer, drawn at reading size; live is the Command being worked on.
 */
export interface FeedLineEmphasis {
  headline?: boolean
  live?: boolean
}

export function FeedLine({ entry, emphasis = {} }: { entry: FeedEntry; emphasis?: FeedLineEmphasis }) {
  // One time per entry, always first (#333): every entry's time sits in the same left column.
  const time = <time className="feed-time">{formatFeedTime(entry.at)}</time>
  if (entry.role === 'user') {
    // Your words (#54): commands and heard transcriptions, right-aligned
    // in muted bubbles — no glyph, no handle (ADR 0013): the orb marks
    // Bing Bong only; your own words need no attribution. One entry per
    // Command (#324, ADR 0076): the words heard, and under them the action
    // taken; an Utterance read as no Command is the words alone, greyed. A
    // Task (#336) adds one line per later hop that fired.
    return (
      <p className={`feed-entry feed-entry--user feed-entry--${entry.kind}${entry.muted ? ' feed-entry--muted' : ''}${emphasis.live === true ? ' feed-entry--live' : ''}`}>
        {time}
        <span className="feed-bubble">
          <span className="feed-text">
            <BreaksAtSlashes text={entry.text} />
          </span>
          {entry.action !== undefined ? (
            <span className="feed-action">
              <BreaksAtSlashes text={entry.action} />
            </span>
          ) : null}
          {(entry.hopLines ?? []).map((hop, index) => (
            <span key={index} className={`feed-action feed-action--hop${hop.muted ? ' feed-action--muted' : ''}${hop.failure ? ' feed-action--failed' : ''}`}>
              <BreaksAtSlashes text={hop.text} />
            </span>
          ))}
        </span>
      </p>
    )
  }
  if (entry.role === 'assistant') {
    // Bing Bong's answers (#54, ADR 0013): one attribution device — the
    // Status Capsule's orb beside every assistant entry, the name living
    // in screen-reader text. The Card renders its markdown (#56); a
    // display-less turn renders its spoken line — italic speech in the
    // same card frame; a turn's two renderings never both render.
    // The entry's own event stamp rides the card as nonvisual metadata:
    // an observer correlating a rendered Answer with the published
    // `display` event reads the same `at` here. A line telling what went
    // wrong takes the failure colour on its mark and rail (#329); a Stop's is grey.
    return (
      <div
        className={`feed-entry feed-entry--assistant feed-entry--${entry.kind}${entry.failure ? ' feed-entry--failed' : ''}${entry.muted ? ' feed-entry--muted' : ''}${emphasis.headline === true ? ' feed-entry--headline' : ''}`}
        data-event-at={entry.at}
      >
        {time}
        <span className="feed-orb" aria-hidden="true">
          <ChromeIcon name={entry.failure ? 'cross' : entry.muted ? 'dash' : 'tick'} size={14} />
        </span>
        <div className="feed-card">
          <span className="feed-sr">Bing Bong</span>
          {entry.kind === 'display' ? (
            <div className="feed-text feed-text--markdown">
              <FeedMarkdown text={entry.text} />
            </div>
          ) : (
            <span className="feed-text feed-text--spoken">{entry.text}</span>
          )}
        </div>
      </div>
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
      // tool lines, voice lines, stage markers — timestamp + text.
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
 * stay top-level and in order — the noise reads as one block beside them,
 * never split into a second expander.
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
 * accessible by construction — collapsed, live or not (#333): the Answer
 * tells what happened, and the steps open on a click. The user's toggle
 * holds from then on.
 */
function RunDetails({ runId, entries, live }: { runId: string; entries: FeedEntry[]; live: boolean }) {
  const [open, setOpen] = useState(false)
  // The noise pane is height-capped, so it scrolls itself: while open, new
  // entries keep the newest line in view — same contract as the feed list,
  // one nesting level down.
  const entriesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = entriesRef.current
    if (el && open) el.scrollTop = el.scrollHeight
  }, [entries, open])
  return (
    <details
      className={`feed-run${live ? ' feed-run--live' : ''}`}
      data-run-id={runId}
      open={open}
      onToggle={(event) => {
        // Nested error expanders toggle too — only this element's own
        // state is the user's choice about this run.
        if (event.target !== event.currentTarget) return
        setOpen((event.currentTarget as HTMLDetailsElement).open)
      }}
    >
      <summary className="feed-run-summary">
        <span className="feed-run-title">{live ? 'working' : 'run detail'}</span>
        <span className="feed-run-count">{entries.length}</span>
      </summary>
      <div className="feed-run-entries" ref={entriesRef}>
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
  /** The run currently in flight (#55) — its expander is titled as activity. */
  liveRunId?: string | null
  headerActions?: React.ReactNode
  /** Below the list — the panel's prompt bar. */
  footer?: React.ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const headline = headlineAnswerId(entries)
  // The Command being worked on: the newest one, while a run is live.
  const live = liveRunId == null ? null : (entries.findLast((entry) => entry.role === 'user')?.id ?? null)

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
            <FeedLine key={item.entry.id} entry={item.entry} emphasis={{ headline: item.entry.id === headline, live: item.entry.id === live }} />
          ),
        )}
      </div>
      {footer}
    </div>
  )
}
