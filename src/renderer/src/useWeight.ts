import { useEffect, useState } from 'react'
import type { ScaleStatus } from '../../core/scale/ipcChannels'
import type { WeighIn } from '../../core/scale/weighIns'
import type { WeighInPopupState } from '../../core/scale/weighInPopup'
import { reportRendererFault } from './diagnostics'
import { keepAnswer, keptAnswer } from './idleCache'

/**
 * Every Weigh-in (CONTEXT.md), oldest first: the last list known
 * (idleCache) from the first frame, so the Weight card does not wait on a
 * restart, then pulled on mount and followed after; null until either.
 */
export function useWeighIns(): WeighIn[] | null {
  const [weighIns, setWeighIns] = useState<WeighIn[] | null>(() => keptAnswer<WeighIn[]>('weighIns', '', Infinity))
  useEffect(() => {
    let cancelled = false
    const follow = (list: WeighIn[]): void => {
      keepAnswer('weighIns', '', list)
      setWeighIns(list)
    }
    window.bingbong.weight.list().then(
      (list) => {
        if (!cancelled) follow(list)
      },
      (error: unknown) => reportRendererFault('weight.list', error),
    )
    const unsubscribe = window.bingbong.weight.onChange(follow)
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

/** The Scale Listener's state for the settings Weight section; null until main answers. */
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
