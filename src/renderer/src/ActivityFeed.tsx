import { useEffect, useRef, useState } from 'react'
import type { FeedEntry } from '../../core/history/feedProjection'
import { FeedMarkdown } from './FeedMarkdown'

/**
 * The activity feed list (#44): timestamped entries for commands, tool
 * lines, spoken/displayed text, errors, and retry detail lines —
 * observation only. Conversation structure (#54): user entries render
 * right-aligned in muted bubbles, assistant Answers as left-aligned
 * railed cards; everything else stays a plain system line. Attribution
 * (ADR 0013): one device — the Status Capsule orb beside every assistant
 * entry; no text handles, the name living in screen-reader text only.
 * Run grouping (#55): run noise — tool lines, tool results, intents,
 * reasoning runs, stage markers, retries, steer echoes — folds under one
 * per-run details expander (#55), collapsed by default and auto-open
 * while its run is live, so the conversation reads as just you and Bing
 * Bong. Markdown (#56): the Answer's Card renders as structure
 * (FeedMarkdown) — code blocks, lists, headings, links that navigate the
 * pane — while a display-less Answer renders its Spoken Rendering
 * (italic speech) and the live stream shows a typing indicator under the
 * orb (ADR 0013: internal JSON never flashes into the view). Rendered by
 * the feed panel's overlay webContents (#45).
 */

function formatFeedTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit' })
}

export function FeedLine({ entry }: { entry: FeedEntry }) {
  const time = <time className="feed-time">{formatFeedTime(entry.at)}</time>
  if (entry.role === 'user') {
    // Your words (#54): commands and heard transcriptions, right-aligned
    // in muted bubbles — no glyph, no handle (ADR 0013): the orb marks
    // Bing Bong only; your own words need no attribution.
    return (
      <p className={`feed-entry feed-entry--user feed-entry--${entry.kind}`}>
        <span className="feed-bubble">
          <span className="feed-text">{entry.text}</span>
        </span>
        {time}
      </p>
    )
  }
  if (entry.role === 'assistant') {
    // Bing Bong's answers (#54, ADR 0013): one attribution device — the
    // Status Capsule's orb beside every assistant entry, the name living
    // in screen-reader text. The Card renders its markdown (#56); a
    // display-less turn renders its Spoken Rendering — italic speech in
    // the same card frame; a turn's two renderings never both render.
    if (entry.kind === 'answer_stream') {
      // The live answer stream (ADR 0013): the orb with a typing
      // indicator — internal JSON never flashes into the view; the Card
      // or Spoken Rendering lands when parsing completes.
      return (
        <div className="feed-entry feed-entry--assistant feed-entry--answer_stream">
          {time}
          <span className="feed-orb" aria-hidden="true" />
          <div className="feed-card" role="status" aria-label="Bing Bong is answering">
            <span className="feed-typing" aria-hidden="true">
              <span className="feed-typing-dot" />
              <span className="feed-typing-dot" />
              <span className="feed-typing-dot" />
            </span>
          </div>
        </div>
      )
    }
    return (
      <div className={`feed-entry feed-entry--assistant feed-entry--${entry.kind}`}>
        {time}
        <span className="feed-orb" aria-hidden="true" />
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
 * One round's thinking block: each LLM round's reasoning run renders as
 * its own collapsible section — open while it is the run's trailing entry
 * (the model is still thinking), collapsed the moment the orchestrator
 * starts acting again (any later entry lands after it). The next round's
 * thinking opens its own block. The user's toggle always wins over the
 * trailing default — with one sunset: the run finishing force-collapses
 * every one of its thinking blocks, manual toggles notwithstanding, so a
 * feed of finished runs never fills with open thinking. After that moment
 * the user's toggle wins again — opening an old block is always allowed
 * and stays open until closed.
 */
function ReasoningBlock({ entry, live, trailing }: { entry: FeedEntry; live: boolean; trailing: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  // The finish is the one override of the user's toggle: live → finished
  // clears it once; the block then renders collapsed, and a later manual
  // open records normally and persists.
  useEffect(() => {
    if (!live) setUserOpen(null)
  }, [live])
  const open = userOpen ?? (live && trailing)
  return (
    <details
      className={`feed-entry feed-entry--reasoning feed-reasoning${open ? ' feed-reasoning--live' : ''}`}
      open={open}
      onToggle={(event) => {
        if (event.target !== event.currentTarget) return
        const el = event.currentTarget as HTMLDetailsElement
        // Only a user click flips the DOM against React's rendered state.
        // The toggles React itself applies — the trailing default opening
        // or closing the block, the finish force-collapse — land with the
        // DOM matching `open`, and recording them would freeze the block
        // open past its trailing window (open thinking stacking up the
        // feed mid-run, the very clutter this surface exists to fold).
        if (el.open === open) return
        setUserOpen(el.open)
      }}
    >
      <summary className="feed-reasoning-summary">
        <span className="feed-reasoning-title">{open ? 'thinking' : 'thought'}</span>
      </summary>
      <pre className="feed-text feed-reasoning-text">{entry.text}</pre>
    </details>
  )
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
  const lastId = entries[entries.length - 1]?.id
  // The noise pane is height-capped, so it scrolls itself: while open, new
  // entries keep the newest line in view — same contract as the feed list,
  // one nesting level down. The user's manual scroll position is not
  // defended mid-live-run (neither is the list's); the cap keeps the
  // conversation readable, the scroll keeps the frontier visible.
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
        setUserOpen((event.currentTarget as HTMLDetailsElement).open)
      }}
    >
      <summary className="feed-run-summary">
        <span className="feed-run-title">{live ? 'working' : 'run detail'}</span>
        <span className="feed-run-count">{entries.length}</span>
      </summary>
      <div className="feed-run-entries" ref={entriesRef}>
        {entries.map((entry) =>
          entry.kind === 'reasoning' ? (
            <ReasoningBlock key={entry.id} entry={entry} live={live} trailing={entry.id === lastId} />
          ) : (
            <FeedLine key={entry.id} entry={entry} />
          ),
        )}
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
