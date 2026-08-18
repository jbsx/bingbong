export const HISTORY_IPC = {
  /** Renderer → main: hydrate the transcript after a restart. */
  recentEntries: 'history:recentEntries',
  /** Renderer → main: recent run records (inspectable history). */
  recentRuns: 'history:recentRuns',
  /** Renderer → main: persist a mic/capture error raised above main. */
  recordVoiceError: 'history:recordVoiceError',
} as const

/** How much transcript the dashboard hydrates on launch. */
export const HISTORY_HYDRATE_LIMIT = 200
