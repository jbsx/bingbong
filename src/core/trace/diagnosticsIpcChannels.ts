// The renderer diagnostics channel (#187, ADR 0031). One channel, one
// direction: a page reports something it did and main decides whether
// anything is listening. `send` rather than `invoke` because a record is
// not a request — the page must never wait on its own diagnostics, and
// with the Host Trace off there is nothing to wait for anyway.

export const DIAGNOSTICS_IPC = {
  /** Renderer → main: one renderer record for the Host Trace. */
  report: 'diagnostics:report',
} as const
