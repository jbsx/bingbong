import { magnitudeLabel, magnitudeParts } from '../../core/news/news'
import type { TodaysHighlight } from '../../core/news/newsDesk'

function hostOf(link: string): string {
  return URL.canParse(link) ? new URL(link).hostname.replace(/^www\./, '') : ''
}

/**
 * The News card (CONTEXT.md), a Card Slot of the Idle Screen: Today's
 * Highlight — the topic it matched, its title, and the number that made it
 * a story, large — with its source and site under them. It draws to its box
 * (styles.css container queries): at this stage every size holds the
 * highlight alone, the larger boxes leaving room for This Week and This
 * Month (#347). The tap opens the story through the same `navigate`
 * Command the words are, on the pointer going down as the Last Page's card
 * does: that pointer-down also wakes the dashboard, so the pane shows it.
 */
export function NewsCard({ highlight }: { highlight: TodaysHighlight }) {
  const { story, topics } = highlight
  const points = magnitudeLabel(story)
  const { count, unit } = magnitudeParts(story)
  const host = hostOf(story.link)
  const open = (): void => {
    void window.bingbong.assistant.submit(`navigate ${story.link}`)
  }
  return (
    <button
      type="button"
      className="idle-card idle-news"
      aria-label={`Today's highlight: ${story.title}, ${points} on ${story.source}. Open it`}
      onPointerDown={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') open()
      }}
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
  )
}
