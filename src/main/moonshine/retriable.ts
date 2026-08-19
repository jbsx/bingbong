// The memoize-with-retry shape every model-loading seam shares (#41):
// lazily started, shared while in flight, sticky on success — and dropped
// on rejection so a transient failure (network fetch, partial file) is
// retried by the next call instead of cached until restart.

/**
 * Wraps a promise factory in a retriable memo: the first call starts it,
 * concurrent callers share it, success memoizes it forever, and a rejection
 * clears the memo so the next call runs the factory again.
 */
export function createRetriable<T>(start: () => Promise<T>): () => Promise<T> {
  let memo: Promise<T> | null = null
  return () => {
    memo ??= start().catch((err: unknown) => {
      memo = null
      throw err
    })
    return memo
  }
}
