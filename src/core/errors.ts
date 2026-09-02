/**
 * The message a thrown value carries, for the one purpose the whole app
 * shares: wording a failure the model or the user reads. Non-Error throws
 * (a string, a rejected value from a native module) stringify rather than
 * disappear.
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
