export interface Clock {
  now(): number
  setTimer(ms: number, fn: () => void): () => void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer: (ms, fn) => {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  },
}
