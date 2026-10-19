import { MIN_WEIGH_IN_KG, type ScaleReading } from './scaleSession'
import type { WeighIn } from './weighIns'

/** How long the pop-up stays after the owner steps off or the scale drops the link. */
export const POPUP_LINGER_MS = 8_000

/**
 * The Weigh-in pop-up (CONTEXT.md): hidden, the live weight while it
 * moves, or the settled weight with the change since the previous
 * Weigh-in (null with none before it).
 */
export type WeighInPopupState = { phase: 'hidden' } | { phase: 'live'; kg: number } | { phase: 'settled'; kg: number; changeKg: number | null }

export interface WeighInPopup {
  reading(reading: ScaleReading): void
  /** The reading settled into a Weigh-in; `previous` is the one before it. */
  weighIn(weighIn: WeighIn, previous: WeighIn | null): void
  /** The scale dropped the link or went quiet. */
  ended(): void
  state(): WeighInPopupState
}

const HIDDEN: WeighInPopupState = { phase: 'hidden' }

/**
 * The pop-up's fold, in main: it follows the scale's readings and hands
 * each change of state to `onChange` (the windows). Once settled it holds
 * the settled weight while the owner stays on; stepping off — a reading
 * under 5 kg — or the link dropping starts an 8 s linger, and a weight
 * coming back inside it shows live again. Never spoken.
 */
export function createWeighInPopup(onChange: (state: WeighInPopupState) => void): WeighInPopup {
  let state: WeighInPopupState = HIDDEN
  let linger: ReturnType<typeof setTimeout> | null = null

  const set = (next: WeighInPopupState): void => {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    onChange(state)
  }
  const stay = (): void => {
    if (linger !== null) clearTimeout(linger)
    linger = null
  }
  const leaveSoon = (): void => {
    if (state.phase === 'hidden' || linger !== null) return
    linger = setTimeout(() => {
      linger = null
      set(HIDDEN)
    }, POPUP_LINGER_MS)
  }

  return {
    reading({ kg }) {
      if (kg < MIN_WEIGH_IN_KG) {
        leaveSoon()
        return
      }
      // Back on inside the linger is a new stepping-on: the weight shows live again.
      const steppedBackOn = linger !== null
      stay()
      if (state.phase === 'settled' && !steppedBackOn) return
      set({ phase: 'live', kg })
    },
    weighIn(weighIn, previous) {
      stay()
      set({ phase: 'settled', kg: weighIn.kg, changeKg: previous === null ? null : Math.round((weighIn.kg - previous.kg) * 100) / 100 })
    },
    ended: leaveSoon,
    state: () => state,
  }
}
