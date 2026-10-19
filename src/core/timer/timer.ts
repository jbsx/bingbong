import type { Clock } from '../ports/clock'

// The Timer (CONTEXT.md): one countdown the appliance runs itself — set by
// a Command, shown on the Idle Screen, ringing when it reaches zero until
// it is dismissed or rings out. No website and no model: the clock is the
// injected seam, so the countdown is provable without real time passing.

/** How long a Timer rings unanswered before it falls silent on its own. */
export const RING_MS = 60_000

export type TimerState =
  | { readonly status: 'off' }
  | { readonly status: 'running'; readonly durationMs: number; readonly endsAt: number }
  | { readonly status: 'ringing'; readonly durationMs: number; readonly rangAt: number }

export interface Timer {
  state(): TimerState
  /** Starts a countdown of `durationMs`, replacing any Timer running or ringing. */
  set(durationMs: number): void
  /** Turns the Timer off, running or ringing; false when there was none. */
  cancel(): boolean
  /** Silences a ringing Timer; a running one is left to run. False when none was ringing. */
  silence(): boolean
  /** Hears every change of state. */
  onChange(listener: (state: TimerState) => void): () => void
  dispose(): void
}

export function createTimer(deps: { clock: Clock; ringMs?: number }): Timer {
  const { clock } = deps
  const ringMs = deps.ringMs ?? RING_MS
  let current: TimerState = { status: 'off' }
  let cancelPending: (() => void) | null = null
  const listeners = new Set<(state: TimerState) => void>()

  function enter(next: TimerState): void {
    cancelPending?.()
    cancelPending = null
    current = next
    if (next.status === 'running') cancelPending = clock.setTimer(next.endsAt - clock.now(), () => enter({ status: 'ringing', durationMs: next.durationMs, rangAt: clock.now() }))
    if (next.status === 'ringing') cancelPending = clock.setTimer(ringMs, () => enter({ status: 'off' }))
    for (const listener of listeners) listener(next)
  }

  return {
    state: () => current,
    set(durationMs) {
      enter({ status: 'running', durationMs, endsAt: clock.now() + durationMs })
    },
    cancel() {
      if (current.status === 'off') return false
      enter({ status: 'off' })
      return true
    },
    silence() {
      if (current.status !== 'ringing') return false
      enter({ status: 'off' })
      return true
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      cancelPending?.()
      cancelPending = null
      listeners.clear()
    },
  }
}
