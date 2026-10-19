import { useEffect, useState } from 'react'
import type { ScaleStatus } from '../../core/scale/ipcChannels'
import type { WeighIn } from '../../core/scale/weighIns'
import type { WeighInPopupState } from '../../core/scale/weighInPopup'
import { reportRendererFault } from './diagnostics'

/** Every Weigh-in (CONTEXT.md), oldest first, pulled on mount and followed after; null until main answers. */
export function useWeighIns(): WeighIn[] | null {
  const [weighIns, setWeighIns] = useState<WeighIn[] | null>(null)
  useEffect(() => {
    let cancelled = false
    window.bingbong.weight.list().then(
      (list) => {
        if (!cancelled) setWeighIns(list)
      },
      (error: unknown) => reportRendererFault('weight.list', error),
    )
    const unsubscribe = window.bingbong.weight.onChange((list) => setWeighIns(list))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return weighIns
}

/** The Weigh-in pop-up's state, which main folds from the scale's readings. */
export function useWeighInPopup(): WeighInPopupState {
  const [state, setState] = useState<WeighInPopupState>({ phase: 'hidden' })
  useEffect(() => {
    let cancelled = false
    window.bingbong.weight.popup().then(
      (pulled) => {
        if (!cancelled) setState(pulled)
      },
      (error: unknown) => reportRendererFault('weight.popup', error),
    )
    const unsubscribe = window.bingbong.weight.onPopup(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return state
}

/** The Scale Listener's state for the settings Body section; null until main answers. */
export function useScaleStatus(): ScaleStatus | null {
  const [status, setStatus] = useState<ScaleStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    window.bingbong.weight.status().then(
      (pulled) => {
        if (!cancelled) setStatus(pulled)
      },
      (error: unknown) => reportRendererFault('weight.status', error),
    )
    const unsubscribe = window.bingbong.weight.onStatus(setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return status
}
