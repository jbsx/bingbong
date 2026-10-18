export const BROWSER_IPC = {
  navigate: 'browser:navigate',
  goBack: 'browser:go-back',
  goForward: 'browser:go-forward',
  getState: 'browser:get-state',
  paneBounds: 'browser:pane-bounds',
  stateChanged: 'browser:state-changed',
  /** The Last Page (CONTEXT.md): pulled by the Idle Screen on mount; pushed as it changes. */
  getLastPage: 'browser:get-last-page',
  lastPageChanged: 'browser:last-page-changed',
} as const
