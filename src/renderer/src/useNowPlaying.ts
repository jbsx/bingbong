import { useEffect, useState } from 'react'
import type { NowPlaying } from '../../core/music/nowPlaying'

/**
 * Now Playing (#344, CONTEXT.md) for the Idle Screen: pulled on mount,
 * since the song may have started while the dashboard showed, and followed
 * as it plays. Only read while `active` — the Idle Screen is the one
 * consumer.
 */
export function useNowPlaying(active: boolean): NowPlaying | null {
  const [state, setState] = useState<NowPlaying | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void window.bingbong.music.get().then((current) => {
      if (!cancelled) setState(current)
    })
    const unsubscribe = window.bingbong.music.onChange(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [active])

  return state
}
