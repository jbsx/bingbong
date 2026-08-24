export const HISTORY_IPC = {
  /** Renderer → main: recorded entries for an explicit history view. */
  recentEntries: 'history:recentEntries',
  /** Renderer → main: recent run records (inspectable history). */
  recentRuns: 'history:recentRuns',
  /** Renderer → main: explicit Session lifecycle records. */
  recentSessions: 'history:recentSessions',
  /** Renderer → main: persist a mic/capture error raised above main. */
  recordVoiceError: 'history:recordVoiceError',
} as const

/** Maximum recorded entries returned by one explicit history query. */
export const HISTORY_QUERY_LIMIT = 200
