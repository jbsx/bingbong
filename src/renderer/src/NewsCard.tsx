import { useEffect, useRef, useState } from 'react'
import { headline, hostOf, magnitudeLabel, magnitudeParts } from '../../core/news/news'
import type { NewsHorizons } from '../../core/news/newsDesk'
import { sourceTile } from '../../core/news/storyImage'
import { useFitText, useWholeItems } from './useFit'

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

/**
 * A story's Story Image (CONTEXT.md): the picture main cached, loaded from
 * main's scheme, or — when there is none, or it fails to load — the
 * source's tile in its colour, its name on the large one and its initial on
 * a thumbnail. Never an empty box or a broken image.
 */
function StoryPicture({ picture, source, size }: { picture: string | null; source: string; size: 'large' | 'thumb' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [picture])
  const className = size === 'large' ? 'idle-news-picture' : 'idle-news-thumb'
  if (picture === null || failed) {
    const tile = sourceTile(source)
    return (
      <span className={`${className} idle-news-tile`} style={{ '--tile': tile.colour, '--tile-ink': tile.ink } as React.CSSProperties} data-tile="">
        {size === 'large' ? source : tile.initial}
      </span>
    )
  }
  return (
    <span className={className}>
      <img src={picture} alt="" draggable={false} onError={() => setFailed(true)} />
    </span>
  )
}

/** Big News: a story a row, its picture, its whole headline and its number (none for a feed's post), each a tap that opens it; a story the box would cut is left off whole. */
function BigNews({ items }: { items: NewsHorizons['bigNews'] }) {
  const list = useRef<HTMLOListElement>(null)
  useWholeItems(list, items)
  return (
    <section className="idle-news-big" aria-label="Big news">
      <h3 className="idle-news-list-head">Big news</h3>
      <ol ref={list}>
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" className="idle-news-item" aria-label={`${item.title}, ${magnitudeLabel(item)}. Open it`} {...opener(item.link)}>
              <StoryPicture picture={item.picture} source={item.source} size="thumb" />
              <span className="idle-news-item-title">{headline(item.title).title}</span>
              <span className="idle-news-item-count">{magnitudeParts(item)?.count ?? ''}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

const FIT_STAGES = ['snug', 'behind', 'over'] as const

/**
 * The News card (CONTEXT.md), a Card Slot of the Idle Screen. Today's
 * Highlight with its picture large — the topic it matched, its title, and
 * the number that made it a story (a feed's post, counting nothing, has
 * none), with its source and site under them — then Big News, when
 * anything is big enough to be in it. The box decides what shows, by
 * container query on the slot (styles.css): at 2×2 Big News under the
 * highlight, at 2×1 beside it, at 1×1 the highlight alone; with no Big News
 * the highlight takes the whole card. The highlight's words draw to their
 * own box, stepped down until they show whole (useFitText) rather than cut
 * off midway, the picture taking the room they leave. Every story on the
 * card, its picture too, opens in the pane at a tap.
 */
export function NewsCard({ horizons }: { horizons: NewsHorizons }) {
  const { story, topics, picture } = horizons.highlight
  const figure = magnitudeParts(story)
  const host = hostOf(story.link)
  const { title, dek } = headline(story.title)
  const words = useRef<HTMLSpanElement>(null)
  // Past the words' floor the picture shrinks, then goes behind the words, before the description goes and the title is clamped: the words are what the card is read for.
  useFitText(words, `${story.key} ${horizons.bigNews.length}`, FIT_STAGES)
  return (
    <div className="idle-card idle-news" data-big={horizons.bigNews.length > 0 ? 'some' : 'none'}>
      <button type="button" className="idle-news-today" aria-label={`Today's highlight: ${story.title}, ${magnitudeLabel(story)}. Open it`} {...opener(story.link)}>
        <StoryPicture picture={picture} source={story.source} size="large" />
        <span ref={words} className="idle-news-words">
          <span className="idle-news-kicker">Today’s highlight{topics.length > 0 ? ` · ${topics[0]}` : ''}</span>
          <span className="idle-news-title">{title}</span>
          {dek !== null ? <span className="idle-news-dek">{dek}</span> : null}
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
        </span>
      </button>
      {horizons.bigNews.length > 0 ? <BigNews items={horizons.bigNews} /> : null}
    </div>
  )
}
