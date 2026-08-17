// Usage IPC surfaced on the settings page (issue #13): today's warn-only
// spend estimate. Read-only — recording happens in the main process.
export const USAGE_IPC = {
  /** renderer → main, invoke: () → UsageSummary. */
  getToday: 'usage:get-today',
} as const
