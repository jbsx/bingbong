import { useEffect, useRef, useState } from 'react'
import { ActivityFeed } from '../ActivityFeed'
import { useSessionEvidence } from '../useSessionEvidence'
import { EvidenceView } from './EvidenceView'
import { PromptBar } from './PromptBar'
import { useOverlayFeed, usePanelState } from './useOverlayFeed'
import { useRunActive } from './useRunActive'

/**
 * The feed panel surface (#45), rendered inside its own transparent
 * WebContentsView above the browser pane. The view's bounds come from the
 * dashboard's slot rect; open/collapsed and overlay/docked styling come
 * from main's folded panel state. The prompt bar rides the panel's
 * footer — one typed-input surface whose verb follows the run-live signal,
 * with the stop button beside it while a run is live.
 *
 * The feed stays mounted when collapsed (CSS hides it): the panel is a
 * visibility toggle, not an unmount — entries keep accumulating behind the
 * edge tab, exactly as the transcript always lived in the dashboard's DOM.
 *
 * The Evidence Browser (#139) is the panel's second view: the header's
 * `Evidence N` control swaps Activity for the Session's live Observations
 * — a renderer-local view switch that never touches browser or Run state.
 *
 * The left-edge handle drag-resizes (#65): main cloaks the view across the
 * window for the drag's duration (widening moves the pointer left, out of
 * a view-sized view), so every move still lands in this page. Moves are
 * tracked at the window, not on the handle — capture retargeting is not
 * something every input path honors — and the width (the surface's fixed
 * right edge minus the cursor) streams to the fold, which clamps it. The
 * surface itself paints right-anchored at the folded width, so the cloak
 * never shifts it a pixel.
 */
export function OverlayPanel() {
  const { feed, liveRunId } = useOverlayFeed()
  const { mode, open, width } = usePanelState()
  const runActive = useRunActive()
  const evidence = useSessionEvidence()
  // The Activity/Evidence view switch (#139): local to this page — one
  // CSS-level swap, no browser or Run state involved.
  const [view, setView] = useState<'activity' | 'evidence'>('activity')
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
    } catch {
      // Synthetic pointers may not be capturable — the drag rides on.
    }
    dragBaseRef.current = surface.getBoundingClientRect().right
    window.bingbong.feedPanel.beginResize()
  }

  // The panel's shared chrome: the prompt footer (one typed-input surface,
  // whichever view is shown) and the layout controls (dock, collapse).
  const panelFooter = (
    <div className="prompt-row">
      <PromptBar runActive={runActive} />
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
    <div className={`overlay-chrome overlay-chrome--${open ? 'open' : 'collapsed'}`}>
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
        {/* The footer is the panel's one typed-input surface — it rides
            below whichever view is shown. */}
        {view === 'evidence' ? (
          <EvidenceView
            observations={evidence.observations}
            footer={panelFooter}
            headerActions={
              <>
                <button
                  type="button"
                  className="feed-tab"
                  aria-label="Back to activity"
                  onClick={() => setView('activity')}
                >
                  activity
                </button>
                {panelControls}
              </>
            }
          />
        ) : (
          <ActivityFeed
            entries={feed}
            liveRunId={liveRunId}
            observations={evidence.observations}
            footer={panelFooter}
            headerActions={
              <>
                <button
                  type="button"
                  className={`feed-tab feed-tab--evidence${evidence.observations.length > 0 ? ' feed-tab--stocked' : ''}`}
                  aria-label={
                    evidence.observations.length > 0
                      ? `Open the evidence browser (${evidence.observations.length} observations)`
                      : 'Open the evidence browser (no evidence yet)'
                  }
                  onClick={() => setView('evidence')}
                >
                  Evidence
                  {evidence.observations.length > 0 ? (
                    <span className="feed-tab-count" aria-hidden="true">
                      {evidence.observations.length}
                    </span>
                  ) : null}
                </button>
                {panelControls}
              </>
            }
          />
        )}
      </div>
      <button
        type="button"
        className="feed-edge-tab"
        aria-label="Open activity feed"
        onClick={() => window.bingbong.feedPanel.toggle()}
      >
        <span className="feed-edge-tab-label">activity</span>
      </button>
    </div>
  )
}
