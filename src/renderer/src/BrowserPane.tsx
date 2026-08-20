import { useEffect, useRef, useState } from 'react'
import {
  HIDDEN_PANE_RECT,
  idleBrowserPaneState,
  type BrowserPaneState,
  type PaneRect,
} from '../../core/browser/paneState'

function paneRectFrom(rect: DOMRect): PaneRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** Braille spinner frames (#50): quiet text, no styled motion. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const SPINNER_INTERVAL_MS = 120

function useSpinnerFrame(active: boolean): string {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setFrame((current) => (current + 1) % SPINNER_FRAMES.length), SPINNER_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active])

  return active ? SPINNER_FRAMES[frame] : ''
}

export function BrowserPane() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<BrowserPaneState>(idleBrowserPaneState)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const spinnerFrame = useSpinnerFrame(state.loading)

  useEffect(() => {
    void window.bingbong.browser.getState().then(setState)
    return window.bingbong.browser.onState(setState)
  }, [])

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
      <div className="browser-chrome">
        <button
          type="button"
          className="chrome-button"
          aria-label="Go back"
          disabled={!state.canGoBack}
          onClick={() => void window.bingbong.browser.goBack()}
        >
          ←
        </button>
        <button
          type="button"
          className="chrome-button"
          aria-label="Go forward"
          disabled={!state.canGoForward}
          onClick={() => void window.bingbong.browser.goForward()}
        >
          →
        </button>
        <form
          className="url-form"
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
            value={editing ? draft : state.url}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => {
              setEditing(true)
              setDraft(state.url)
              event.target.select()
            }}
            onBlur={() => setEditing(false)}
          />
        </form>
        {/* The loading indicator (#50): a quiet text spinner — calm frames
            in the chrome, not a sliding bar. */}
        {state.loading ? (
          <span className="chrome-loading" role="status" aria-label="loading">
            {spinnerFrame}
          </span>
        ) : null}
      </div>
      <div ref={viewportRef} className="browser-viewport" />
    </section>
  )
}
