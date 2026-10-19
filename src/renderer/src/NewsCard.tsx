import { useEffect, useRef, useState } from 'react'
import type { SlotSize } from '../../core/idle/slots'
import { hostOf, leadAndTail, magnitudeLabel, magnitudeParts } from '../../core/news/news'
import type { NewsHorizons } from '../../core/news/newsDesk'
import type { StoryBrief } from '../../core/news/storyBrief'
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

/** What a screen reader hears of a story: its title, its Story Brief where written, its number, and that a tap opens it. */
function spoken(item: { title: string; brief: StoryBrief | null; magnitude: number | null; unit: string; source: string }, prefix = ''): string {
  const brief = item.brief === null ? '' : ` — ${item.brief.what} ${item.brief.why}`
  return `${prefix}${item.title}${brief}, ${magnitudeLabel(item)}. Open it`
}

/**
 * Big News, a tile of its own: a story a numbered row — its picture as a
 * thumbnail, the lead of its headline in full, then its Story Brief on two
 * lines of their own, what it is and why it matters (where none is written
 * yet, the headline's tail on one quiet line, an ellipsis where it runs
 * on), its number in a pill (none for a feed's post) — each a tap that
 * opens it; a story the box would cut is left off whole.
 */
function BigNews({ items, rows }: { items: NewsHorizons['bigNews']; rows: number }) {
  const list = useRef<HTMLOListElement>(null)
  useWholeItems(list, items)
  return (
    <section className="idle-card idle-news-big" aria-label="Big news" style={{ gridRow: `span ${rows}` }}>
      <h3 className="idle-kicker">Big news</h3>
      <ol ref={list}>
        {items.map((item, index) => {
          const { lead, tail } = leadAndTail(item.title)
          const count = magnitudeParts(item)?.count
          return (
            <li key={item.key}>
              <button type="button" className="idle-news-item" aria-label={spoken(item)} {...opener(item.link)}>
                <span className="idle-news-rank">{index + 1}</span>
                <StoryPicture picture={item.picture} source={item.source} size="thumb" />
                <span className="idle-news-item-title">
                  <span className="idle-news-item-lead" data-briefed={item.brief !== null ? '' : undefined}>
                    {lead}
                  </span>
                  {item.brief !== null ? (
                    <>
                      <span className="idle-news-item-what">{item.brief.what}</span>
                      <span className="idle-news-item-why">{item.brief.why}</span>
                    </>
                  ) : tail !== null ? (
                    <>
                      {' '}
                      <span className="idle-news-item-tail">{tail}</span>
                    </>
                  ) : null}
                </span>
                {count !== undefined ? <span className="idle-news-pill">{count}</span> : null}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

const FIT_STAGES = ['snug', 'behind', 'over'] as const

/**
 * Today's Highlight, a tile: its Story Image, then two chips — "Today's
 * highlight" and the topic it matched — its headline's lead bold, then its
 * Story Brief, what it is and why it matters, each a line of its own (where
 * none is written yet, the headline's tail quiet after the lead, as
 * leadAndTail splits it), never cut; then the number
 * that made it a story, large and light (a feed's post, counting nothing,
 * has none), the comments, and the source and site. In a box wider than it
 * is tall the picture sits beside the words, in any other above them. The
 * words step their sizes down until they show whole (useFitText), the
 * picture taking the room they leave; past that floor the picture shrinks,
 * then goes behind the words under a dark scrim, then the tail is set on
 * one line with an ellipsis, the lead still whole — only the longest
 * headlines in a one-cell tile get that far.
 */
function Highlight({ horizons, span }: { horizons: NewsHorizons; span: SlotSize }) {
  const { story, topics, picture, brief } = horizons.highlight
  const figure = magnitudeParts(story)
  const host = hostOf(story.link)
  const { lead, tail } = leadAndTail(story.title)
  const words = useRef<HTMLSpanElement>(null)
  useFitText(words, `${story.key} ${brief?.what ?? ''} ${span.w}x${span.h}`, FIT_STAGES)
  return (
    <button
      type="button"
      className="idle-card idle-news-today"
      data-flow={span.w > span.h ? 'row' : 'column'}
      style={{ gridColumn: `span ${span.w}`, gridRow: `span ${span.h}` }}
      aria-label={spoken({ ...story, brief }, "Today's highlight: ")}
      {...opener(story.link)}
    >
      <StoryPicture picture={picture} source={story.source} size="large" />
      <span ref={words} className="idle-news-words">
        <span className="idle-news-chips">
          <span className="idle-chip idle-chip--accent">Today’s highlight</span>
          {topics.length > 0 ? <span className="idle-chip">{topics[0]}</span> : null}
        </span>
        <span className="idle-news-title">
          <span className="idle-news-lead">{lead}</span>
          {brief === null && tail !== null ? (
            <>
              {' '}
              <span className="idle-news-tail">{tail}</span>
            </>
          ) : null}
        </span>
        {brief !== null ? (
          <>
            <span className="idle-news-what">{brief.what}</span>
            <span className="idle-news-why">{brief.why}</span>
          </>
        ) : null}
        <span className="idle-news-stats">
          {figure !== null ? (
            <span className="idle-news-figure">
              <span className="idle-news-count">{figure.count}</span> <span className="idle-news-unit">{figure.unit}</span>
            </span>
          ) : null}
          {story.comments !== null ? <span className="idle-news-comments">{story.comments.toLocaleString('en-GB')} comments</span> : null}
          <span className="idle-news-foot">
            <span className="idle-news-source">{story.source}</span>
            {host !== '' ? <span className="idle-news-host"> · {host}</span> : null}
          </span>
        </span>
      </span>
    </button>
  )
}

/**
 * The News card (CONTEXT.md), tiles in its Card Slot: Today's Highlight
 * and, when anything is big enough to be in it, Big News — side by side
 * at 2×2, the highlight over Big News at 1×2, the highlight alone at 1×1.
 * With no Big News the highlight takes the whole box. Every story on the
 * card, its picture too, opens in the pane at a tap.
 */
export function NewsCard({ horizons, size }: { horizons: NewsHorizons; size: SlotSize }) {
  const big = horizons.bigNews.length > 0 && size.w * size.h > 1
  const span = !big ? size : size.w >= 2 ? { w: 1, h: size.h } : { w: 1, h: 1 }
  return (
    <section className="idle-tiles idle-news" aria-label="news" style={{ '--w': String(size.w), '--h': String(size.h) } as React.CSSProperties}>
      <Highlight horizons={horizons} span={span} />
      {big ? <BigNews items={horizons.bigNews} rows={span.h} /> : null}
    </section>
  )
}
