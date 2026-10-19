import type { NewsListItem } from '../../core/news/horizons'
import { magnitudeLabel, magnitudeParts } from '../../core/news/news'
import type { NewsDigest } from '../../core/news/newsDesk'

function hostOf(link: string): string {
  return URL.canParse(link) ? new URL(link).hostname.replace(/^www\./, '') : ''
}

/**
 * Opens a story through the same `navigate` Command the words are, on the
 * pointer going down as the Last Page's card does: that pointer-down also
 * wakes the dashboard, so the pane shows it.
 */
function opener(link: string): { onPointerDown: () => void; onKeyDown: (event: React.KeyboardEvent) => void } {
  const open = (): void => {
    void window.bingbong.assistant.submit(`navigate ${link}`)
  }
  return {
    onPointerDown: open,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') open()
    },
  }
}

/** This Week or This Month: one line a story, its title and its number, each a tap that opens it. */
function NewsList({ area, heading, items, empty }: { area: 'week' | 'month'; heading: string; items: readonly NewsListItem[]; empty: string }) {
  return (
    <section className={`idle-news-list idle-news-${area}`} aria-label={heading}>
      <h3 className="idle-news-list-head">{heading}</h3>
      {items.length === 0 ? (
        <p className="idle-news-list-empty">{empty}</p>
      ) : (
        <ol>
          {items.map((item) => (
            <li key={item.key}>
              <button type="button" className="idle-news-item" aria-label={`${item.title}, ${magnitudeLabel(item)} on ${item.source}. Open it`} {...opener(item.link)}>
                <span className="idle-news-item-title">{item.title}</span>
                <span className="idle-news-item-count">{magnitudeParts(item).count}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * The News card (CONTEXT.md), a Card Slot of the Idle Screen. Today's
 * Highlight — the topic it matched, its title, and the number that made it
 * a story, large — with its source and site under them, then This Week and
 * This Month. The box decides what shows, by container query on the slot
 * (styles.css): at 2×2 This Week and This Month side by side under the
 * highlight, at 2×1 This Week beside it, at 1×1 the highlight alone; the
 * highlight draws to its own box the same way. Every story on the card
 * opens in the pane at a tap.
 */
export function NewsCard({ digest }: { digest: NewsDigest }) {
  const { story, topics } = digest.highlight
  const { count, unit } = magnitudeParts(story)
  const host = hostOf(story.link)
  return (
    <div className="idle-card idle-news">
      <button
        type="button"
        className="idle-news-today"
        aria-label={`Today's highlight: ${story.title}, ${magnitudeLabel(story)} on ${story.source}. Open it`}
        {...opener(story.link)}
      >
        <span className="idle-news-kicker">Today’s highlight{topics.length > 0 ? ` · ${topics[0]}` : ''}</span>
        <span className="idle-news-title">{story.title}</span>
        <span className="idle-news-figure">
          <span className="idle-news-count">{count}</span> <span className="idle-news-unit">{unit}</span>
        </span>
        <span className="idle-news-foot">
          <span className="idle-news-source">{story.source}</span>
          {host !== '' ? <span className="idle-news-host">{host}</span> : null}
          {story.comments !== null ? <span className="idle-news-comments">{story.comments.toLocaleString('en-GB')} comments</span> : null}
        </span>
      </button>
      <NewsList area="week" heading="This week" items={digest.week} empty="Nothing this week yet" />
      <NewsList area="month" heading="This month" items={digest.month} empty="Nothing has lasted yet" />
    </div>
  )
}
