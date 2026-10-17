import { useEffect, useRef } from 'react'
import { ActivityFeed } from '../ActivityFeed'
import { overlaySlotContent } from '../../../core/panel/peekCardState'
import { PeekCard } from '../PeekCard'
import { reportRendererFault } from '../diagnostics'
import { usePeekCard } from '../usePeekCard'
import { PromptBar } from './PromptBar'
import { useOverlayFeed, usePanelState } from './useOverlayFeed'
import { useRunProgress } from './useRunProgress'

/**
 * The feed panel surface (#45), rendered inside its own transparent
 * WebContentsView above the browser pane. The view's bounds come from the
 * dashboard's slot rect; open/collapsed and overlay/docked styling come
 * from main's folded panel state. The prompt bar rides the panel's
 * footer — the one typed-input surface — with the stop button beside it
 * while a run is live.
 *
 * The feed stays mounted when collapsed (CSS hides it): the panel is a
 * visibility toggle, not an unmount — entries keep accumulating behind the
 * edge tab.
 *
 * The left-edge handle drag-resizes (#65): main cloaks the view across the
 * window for the drag's duration (widening moves the pointer left, out of
 * a view-sized view), so every move still lands in this page. Moves are
 * tracked at the window, not on the handle, and the width (the surface's
 * fixed right edge minus the cursor) streams to the fold, which clamps it.
 */
export function OverlayPanel() {
  const { feed, liveRunId } = useOverlayFeed()
  const { mode, open, width } = usePanelState()
  const progress = useRunProgress()
  const runActive = progress !== null
  // The Peek Card (ADR 0029): rendered from this overlay page — the one
  // surface that floats above the native pane. The slot rule decides which
  // single element shows (panel, card, or edge tab); the dashboard sizes
  // the slot rect from the same rule.
  const peek = usePeekCard(open)
  const slotContent = overlaySlotContent(open, peek.state)
  const surfaceRef = useRef<HTMLDivElement>(null)
  // Drag bookkeeping: the surface's fixed right edge (the panel hugs it
  // for the whole drag). Null when no drag is live.
  const dragBaseRef = useRef<number | null>(null)

  // Opening the panel puts the caret in the prompt bar — typing's entry
  // point, since the dashboard carries no typed input of its own.
  useEffect(() => {
    if (!open) return
    surfaceRef.current?.querySelector<HTMLInputElement>('.prompt-input')?.focus()
  }, [open])

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const base = dragBaseRef.current
      if (base === null) return
      // Raw delta to the fold — main owns the clamp against the live window.
      window.bingbong.feedPanel.setWidth(base - event.clientX)
    }
    const onEnd = (): void => {
      if (dragBaseRef.current === null) return
      dragBaseRef.current = null
      window.bingbong.feedPanel.endResize()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEnd()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      window.removeEventListener('keydown', onKey)
    }
    // One subscription for the app's life: the drag state lives in the
    // ref, so the listeners never go stale across re-renders.
  }, [])

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || dragBaseRef.current !== null) return
    const surface = surfaceRef.current
    if (!surface) return
    event.preventDefault()
    try {
      // Best-effort for input paths that honor capture; the window
      // listeners above are the ones doing the work.
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch (error) {
      // Synthetic pointers may not be capturable — the drag rides on.
      reportRendererFault('panel.setPointerCapture', error)
    }
    dragBaseRef.current = surface.getBoundingClientRect().right
    window.bingbong.feedPanel.beginResize()
  }

  const panelFooter = (
    <div className="prompt-row">
      <PromptBar />
      {runActive ? (
        <button
          type="button"
          className="panel-stop"
          onClick={() => void window.bingbong.assistant.abort()}
          aria-label="Stop active command"
        >
          Stop
        </button>
      ) : null}
    </div>
  )
  const panelControls = (
    <>
      <button
        type="button"
        className="feed-header-button"
        aria-label={mode === 'overlay' ? 'Dock the feed panel' : 'Undock the feed panel'}
        title={mode === 'overlay' ? 'Dock the feed panel' : 'Undock the feed panel'}
        onClick={() => window.bingbong.feedPanel.setMode(mode === 'overlay' ? 'docked' : 'overlay')}
      >
        {mode === 'overlay' ? '⇥' : '⇤'}
      </button>
      <button
        type="button"
        className="feed-header-button"
        aria-label="Collapse the feed panel"
        title="Collapse the feed panel"
        onClick={() => window.bingbong.feedPanel.toggle()}
      >
        ›
      </button>
    </>
  )

  return (
    <div
      className={`overlay-chrome overlay-chrome--${open ? 'open' : 'collapsed'}${
        slotContent === 'card' ? ' overlay-chrome--peek' : ''
      }`}
    >
      <div
        ref={surfaceRef}
        className={`feed-surface feed-surface--${mode}`}
        style={{ '--panel-width': `${width}px` } as React.CSSProperties}
        aria-label="activity feed panel"
        aria-hidden={!open}
      >
        <div
          className="feed-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the feed panel"
          onPointerDown={onHandlePointerDown}
        />
        <ActivityFeed entries={feed} liveRunId={liveRunId} footer={panelFooter} headerActions={panelControls} />
      </div>
      {/* Exactly one collapsed affordance renders (ADR 0029): the Peek
          Card replaces the edge tab while it is visible — both are the
          same human act (clicking opens the panel), and the native view's
          bounds shrink-wrap whichever one shows. */}
      {slotContent === 'card' ? (
        <PeekCard
          state={peek.state}
          entries={feed}
          progress={progress}
          onOpen={() => window.bingbong.feedPanel.toggle()}
        />
      ) : slotContent === 'tab' ? (
        <button
          type="button"
          className="feed-edge-tab"
          aria-label="Open activity feed"
          onClick={() => window.bingbong.feedPanel.toggle()}
        >
          <span className="feed-edge-tab-label">activity</span>
        </button>
      ) : null}
    </div>
  )
}
