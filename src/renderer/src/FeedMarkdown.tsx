import { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'

/**
 * Markdown rendering in the answer cards (#56): assistant display entries
 * render as structure — dark-styled code blocks, lists, headings,
 * emphasis — never literal sigils. Links navigate the main browser pane
 * through the existing browser navigation seam, so "open that" is one
 * click from the feed.
 */

/** Only pane-navigable schemes are intercepted; react-markdown's default urlTransform already sanitized the href. */
function isPaneHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      className="feed-link"
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        // Only pane-navigable links are intercepted; other schemes keep
        // their native behavior rather than swallowing the click.
        if (typeof href !== 'string' || !isPaneHref(href)) return
        event.preventDefault()
        void window.bingbong.browser.navigate(href)
      }}
    >
      {children}
    </a>
  ),
}

/**
 * One markdown answer. The Card's text (ADR 0013): the live stream shows
 * a typing indicator while the Answer forms, so this renders only final
 * display text.
 */
export const FeedMarkdown = memo(function FeedMarkdown({ text }: { text: string }) {
  return (
    <div className="feed-markdown">
      <Markdown components={components}>{text}</Markdown>
    </div>
  )
})
