export interface WaitForOptions {
  timeoutMs: number
  intervalMs: number
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitFor<T>(
  condition: () => Promise<T | undefined>,
  { timeoutMs, intervalMs }: WaitForOptions,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const value = await condition()
      if (value !== undefined) return value
    } catch {
      // condition not met yet
    }
    if (Date.now() >= deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`)
    await sleep(intervalMs)
  }
}
