import { useEffect, useState } from 'react'

/**
 * The Sound Mute for the mute buttons beside the settings cogs: pulled on
 * mount, since the other button may have set it, and followed as it flips.
 */
export function useSoundMute(): { muted: boolean; toggle: () => void } {
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.bingbong.sound.muted().then((current) => {
      if (!cancelled) setMuted(current)
    })
    const unsubscribe = window.bingbong.sound.onChange(setMuted)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { muted, toggle: () => void window.bingbong.sound.toggle() }
}
