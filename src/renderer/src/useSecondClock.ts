import { useEffect, useState } from 'react'
import { songWaitTick, type SongWait } from '../../core/music/songWait'

/**
 * A clock that redraws each second (ui.md 2: the seconds counted on the
 * renderer's own clock). Over a song's wait (#507) it turns on the wait's
 * own second, so the Wait Card, the Capsule and the Turn Card — each in a
 * view of its own — change their count at the same instant and never show
 * two (ruling 3).
 */
export function useSecondClock(wait?: SongWait): number {
  const [now, setNow] = useState(() => Date.now())
  const key = wait === undefined ? '' : `${wait.kind} ${wait.since} ${wait.kind === 'served' ? wait.until : ''}`
  useEffect(() => {
    if (wait === undefined) {
      const timer = setInterval(() => setNow(Date.now()), 1_000)
      return () => clearInterval(timer)
    }
    let timer: ReturnType<typeof setTimeout>
    const tick = (): void => {
      const at = Date.now()
      setNow(at)
      // A few ms past the turn, so the read lands on the new second.
      timer = setTimeout(tick, songWaitTick(wait, at) + 5)
    }
    tick()
    return () => clearTimeout(timer)
    // The wait's identity is its key: a new object of the same wait keeps the clock.
  }, [key])
  return now
}
