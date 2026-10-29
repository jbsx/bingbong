/** Now Playing (#344): pulled by the Idle Screen on mount; pushed as it changes. */
export const MUSIC_IPC = {
  get: 'music:get',
  changed: 'music:changed',
  /** The Wait Card's slot over the pane (#507): the rect its own view follows. */
  waitCardRect: 'music:wait-card-rect',
} as const
