import type { SettledWeighIn } from './people'
import { MIN_WEIGH_IN_KG, type ScaleReading } from './scaleSession'
import { POPUP_LINGER_MS_DEFAULT } from './weightSettings'

/**
 * The Weigh-in pop-up (CONTEXT.md): hidden, the live weight while it
 * moves, or the settled weight with the guessed Person, the change since
 * their previous Weigh-in (null with none before it) and a chip per other
 * Person.
 */
export type WeighInPopupState = { phase: 'hidden' } | { phase: 'live'; kg: number } | ({ phase: 'settled' } & SettledWeighIn)

/** The Weight section's say: whether the pop-up shows at all, and how long it stays after stepping off. */
export interface WeighInPopupOptions {
  on: boolean
  lingerMs: number
}

export interface WeighInPopup {
  reading(reading: ScaleReading): void
  /** The reading settled into a Weigh-in. */
  weighIn(settled: SettledWeighIn): void
  /** A Weigh-in was moved to another Person: shown at once if it is the one up, and its linger starts afresh. */
  moved(settled: SettledWeighIn): void
  /** The scale dropped the link or went quiet. */
  ended(): void
  state(): WeighInPopupState
}

/**
 * Which surface draws the pop-up: the dashboard's own DOM wherever no
 * native view covers it (the Idle Screen, Settings, the Weight page); over
 * the browsing pane, the feed overlay on the open panel's top, else the
 * pop-up's own view in the Peek Card's place — never the feed overlay's
 * slot, which is the edge tab's while the panel is collapsed.
 */
export type WeighInPopupSurface = 'none' | 'dashboard' | 'panel' | 'view'

export function weighInPopupSurface(state: WeighInPopupState, overPane: boolean, panelOpen: boolean): WeighInPopupSurface {
  if (state.phase === 'hidden') return 'none'
  if (!overPane) return 'dashboard'
  return panelOpen ? 'panel' : 'view'
}

const HIDDEN: WeighInPopupState = { phase: 'hidden' }

/**
 * The pop-up's fold, in main: it follows the scale's readings and hands
 * each change of state to `onChange` (the windows). Once settled it holds
 * the settled weight while the owner stays on; stepping off — a reading
 * under 5 kg — or the link dropping starts the linger (8 s by default),
 * and a weight coming back inside it shows live again. Off in the Weight
 * section, it shows nothing. Never spoken.
 */
export function createWeighInPopup(onChange: (state: WeighInPopupState) => void, options: () => WeighInPopupOptions = () => ({ on: true, lingerMs: POPUP_LINGER_MS_DEFAULT })): WeighInPopup {
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
    }, options().lingerMs)
  }

  return {
    reading({ kg }) {
      // Turned off in the Weight section while up: gone at once.
      if (!options().on) {
        stay()
        set(HIDDEN)
        return
      }
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
    weighIn(settled) {
      if (!options().on) return
      stay()
      set({ phase: 'settled', ...settled })
    },
    moved(settled) {
      if (state.phase !== 'settled' || state.at !== settled.at) return
      set({ phase: 'settled', ...settled })
      if (linger === null) return
      stay()
      leaveSoon()
    },
    ended: leaveSoon,
    state: () => state,
  }
}
