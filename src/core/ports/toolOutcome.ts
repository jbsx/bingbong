/**
 * The outcome of one browser action as the agent reads it: a result it can
 * read on, or an error line. Every Action Outcome classifier in
 * `core/browser` produces one of these.
 */
export type ToolResultOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string }
