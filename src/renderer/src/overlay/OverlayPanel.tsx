import { ActivityFeed } from '../ActivityFeed'
import { SteerBox } from './SteerBox'
import { useOverlayFeed, usePanelState } from './useOverlayFeed'
import { useRunActive } from './useRunActive'

/**
 * The feed panel surface (#45), rendered inside its own transparent
 * WebContentsView above the browser pane. The view's bounds come from the
 * dashboard's slot rect; open/collapsed and overlay/docked styling come
 * from main's folded panel state. The steer box (#46) rides the panel's
 * footer — enabled only while a run is active.
 *
 * The feed stays mounted when collapsed (CSS hides it): the panel is a
 * visibility toggle, not an unmount — entries keep accumulating behind the
 * edge tab, exactly as the transcript always lived in the dashboard's DOM.
 */
export function OverlayPanel() {
  const { feed, liveRunId } = useOverlayFeed()
  const { mode, open } = usePanelState()
  const runActive = useRunActive()

  return (
    <div className={`overlay-chrome overlay-chrome--${open ? 'open' : 'collapsed'}`}>
      <div className={`feed-surface feed-surface--${mode}`} aria-label="activity feed panel" aria-hidden={!open}>
        <ActivityFeed
          entries={feed}
          liveRunId={liveRunId}
          footer={<SteerBox disabled={!runActive} />}
          headerActions={
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
          }
        />
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
