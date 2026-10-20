import { useEffect, useRef, useState } from 'react'
import {
  HIDDEN_PANE_RECT,
  idleBrowserPaneState,
  type BrowserPaneState,
  type PaneRect,
} from '../../core/browser/paneState'
import { addressFieldText } from '../../core/browser/urlInput'
import { ChromeIcon } from './ChromeIcon'

function paneRectFrom(rect: DOMRect): PaneRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/**
 * The address split where its tones change (ADR 0078): the scheme and the
 * path quiet, the host in the primary ink. Text with no host — a search,
 * a bare word — is all one quiet run.
 */
function addressParts(text: string): { before: string; host: string; after: string } {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)?([^/\s?#]+\.[^/\s?#]+|localhost(?::\d+)?)(.*)$/i.exec(text)
  if (match === null) return { before: text, host: '', after: '' }
  return { before: match[1] ?? '', host: match[2]!, after: match[3]! }
}

function useBrowserState(): BrowserPaneState {
  const [state, setState] = useState<BrowserPaneState>(idleBrowserPaneState)

  useEffect(() => {
    void window.bingbong.browser.getState().then(setState)
    return window.bingbong.browser.onState(setState)
  }, [])

  return state
}

/**
 * The Toolbar's browsing cluster (ADR 0012): back/forward controls and
 * the pill address field, lifted out of the old per-pane chrome bar. The
 * class hooks (.chrome-button, .url-input, .chrome-loading) predate the
 * restyle and stay — they are e2e observation points.
 */
export function BrowserNav() {
  const inputRef = useRef<HTMLInputElement>(null)
  const state = useBrowserState()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const shown = addressFieldText(state.loading && state.pendingUrl !== '' ? state.pendingUrl : state.url)
  const parts = addressParts(shown)

  return (
    <div className="browser-nav">
      <button
        type="button"
        className="chrome-button"
        aria-label="Go back"
        disabled={!state.canGoBack}
        onClick={() => void window.bingbong.browser.goBack()}
      >
        <ChromeIcon name="back" />
      </button>
      <button
        type="button"
        className="chrome-button"
        aria-label="Go forward"
        disabled={!state.canGoForward}
        onClick={() => void window.bingbong.browser.goForward()}
      >
        <ChromeIcon name="forward" />
      </button>
      <form
        className={`url-form${!editing && shown !== '' ? ' url-form--drawn' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          const input = draft.trim()
          if (input) void window.bingbong.browser.navigate(input)
          setEditing(false)
          inputRef.current?.blur()
        }}
      >
        <input
          ref={inputRef}
          className="url-input"
          type="text"
          placeholder="Enter address or search"
          aria-label="Address and search bar"
          spellCheck={false}
          // A blank pane shows the hint, never "about:blank" (#334); a load shows the page on its way.
          value={editing ? draft : shown}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setEditing(true)
            setDraft(addressFieldText(state.url))
            event.target.select()
          }}
          onBlur={() => setEditing(false)}
        />
        {!editing && shown !== '' ? (
          <span className="url-display" aria-hidden="true">
            {parts.before}
            <span className="url-display-host">{parts.host}</span>
            {parts.after}
          </span>
        ) : null}
        {/* The loading progress (ADR 0078): a peach ring in the field and a
            bar along its foot — inside the field, so the field and the
            controls never shift when loading starts or ends (#334). */}
        {state.loading ? (
          <>
            <span className="chrome-loading" role="status" aria-label="loading" />
            <span className="chrome-loading-bar" aria-hidden="true" />
          </>
        ) : null}
      </form>
    </div>
  )
}

/**
 * The browsing pane (ADR 0078): the page in its frame — inset by the
 * gutter, rounded, on a hairline; the section is the viewport's rect
 * reporter and nothing else.
 */
export function BrowserPane() {
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const report = () => {
      window.bingbong.browser.reportPaneRect(paneRectFrom(viewport.getBoundingClientRect()))
    }

    report()
    const observer = new ResizeObserver(report)
    observer.observe(viewport)
    return () => {
      observer.disconnect()
      window.bingbong.browser.reportPaneRect(HIDDEN_PANE_RECT)
    }
  }, [])

  return (
    <section className="browser-pane" aria-label="browser pane">
      <div ref={viewportRef} className="browser-viewport" />
    </section>
  )
}
