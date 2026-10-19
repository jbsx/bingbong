import type { NewsListItem } from '../../core/news/horizons'
import { hostOf, magnitudeLabel, magnitudeParts } from '../../core/news/news'
import type { NewsHorizons } from '../../core/news/newsDesk'

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

/** This Week or This Month: one line a story, its title and its number (none for a feed's post), each a tap that opens it. */
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
              <button type="button" className="idle-news-item" aria-label={`${item.title}, ${magnitudeLabel(item)}. Open it`} {...opener(item.link)}>
                <span className="idle-news-item-title">{item.title}</span>
                <span className="idle-news-item-count">{magnitudeParts(item)?.count ?? ''}</span>
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
 * a story, large (a feed's post, counting nothing, has none) — with its
 * source and site under them, then This Week and This Month. The box
 * decides what shows, by container query on the slot (styles.css): at 2×2
 * This Week and This Month side by side under the highlight, at 2×1 This
 * Week beside it, at 1×1 the highlight alone; the highlight draws to its
 * own box the same way. Every story on the card opens in the pane at a tap.
 */
export function NewsCard({ horizons }: { horizons: NewsHorizons }) {
  const { story, topics } = horizons.highlight
  const figure = magnitudeParts(story)
  const host = hostOf(story.link)
  return (
    <div className="idle-card idle-news">
      <button type="button" className="idle-news-today" aria-label={`Today's highlight: ${story.title}, ${magnitudeLabel(story)}. Open it`} {...opener(story.link)}>
        <span className="idle-news-kicker">Today’s highlight{topics.length > 0 ? ` · ${topics[0]}` : ''}</span>
        <span className="idle-news-title">{story.title}</span>
        {figure !== null ? (
          <span className="idle-news-figure">
            <span className="idle-news-count">{figure.count}</span> <span className="idle-news-unit">{figure.unit}</span>
          </span>
        ) : null}
        <span className="idle-news-foot">
          <span className="idle-news-source">{story.source}</span>
          {host !== '' ? <span className="idle-news-host">{host}</span> : null}
          {story.comments !== null ? <span className="idle-news-comments">{story.comments.toLocaleString('en-GB')} comments</span> : null}
        </span>
      </button>
      <NewsList area="week" heading="This week" items={horizons.week} empty="Nothing this week yet" />
      <NewsList area="month" heading="This month" items={horizons.month} empty="Nothing has lasted yet" />
    </div>
  )
}
