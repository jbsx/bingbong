import { useEffect, useState } from 'react'
import type { NowPlaying } from '../../core/music/nowPlaying'

/**
 * Now Playing (#344, CONTEXT.md) for the Idle Screen and the Toolbar's
 * widgets: pulled on mount, since the song may have started before, and
 * followed as it plays.
 */
export function useNowPlaying(): NowPlaying | null {
  const [state, setState] = useState<NowPlaying | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.bingbong.music.get().then((current) => {
      if (!cancelled) setState(current)
    })
    const unsubscribe = window.bingbong.music.onChange(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}
