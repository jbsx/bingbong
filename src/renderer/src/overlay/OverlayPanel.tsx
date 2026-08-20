import { ActivityFeed } from '../ActivityFeed'
import { useOverlayFeed, usePanelState } from './useOverlayFeed'

/**
 * The feed panel surface (#45), rendered inside its own transparent
 * WebContentsView above the browser pane. The view's bounds come from the
 * dashboard's slot rect; open/collapsed and overlay/docked styling come
 * from main's folded panel state. Observation only — the steer box (#46)
 * will join the footer of this panel.
 *
 * The feed stays mounted when collapsed (CSS hides it): the panel is a
 * visibility toggle, not an unmount — entries keep accumulating behind the
 * edge tab, exactly as the transcript always lived in the dashboard's DOM.
 */
export function OverlayPanel() {
  const feed = useOverlayFeed()
  const { mode, open } = usePanelState()

  return (
    <div className={`overlay-chrome overlay-chrome--${open ? 'open' : 'collapsed'}`}>
      <div className={`feed-surface feed-surface--${mode}`} aria-label="activity feed panel" aria-hidden={!open}>
        <ActivityFeed
          entries={feed}
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
