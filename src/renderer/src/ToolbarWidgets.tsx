import { useEffect, useState } from 'react'
import type { NowPlaying } from '../../core/music/nowPlaying'
import { countdownLabel, describeDuration } from '../../core/timer/duration'
import type { TimerState } from '../../core/timer/timer'
import { ChromeIcon } from './ChromeIcon'

/**
 * The Toolbar's widgets (owner ruling 2026-10-19), beside the Status
 * Capsule: what the Idle Screen's dock shows, kept in sight while the app
 * is in use — the running Timer's countdown, "Time's up" while it rings,
 * and the song Now Playing. Nothing while neither is on.
 */
export function ToolbarWidgets({ timer, nowPlaying }: { timer: TimerState; nowPlaying: NowPlaying | null }) {
  if (timer.status === 'off' && nowPlaying === null) return null
  return (
    <div className="toolbar-widgets">
      {timer.status !== 'off' ? <TimerWidget timer={timer} /> : null}
      {nowPlaying !== null ? <SongWidget song={nowPlaying} /> : null}
    </div>
  )
}

/**
 * The Timer's countdown, ticking four times a second as the Idle Screen's
 * does; ringing, a control — a click turns it off through the same `timer
 * off` Command the words are.
 */
function TimerWidget({ timer }: { timer: Exclude<TimerState, { status: 'off' }> }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (timer.status !== 'running') return
    const tick = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(tick)
  }, [timer.status])

  const length = describeDuration(timer.durationMs)
  if (timer.status === 'running') {
    const left = countdownLabel(timer.endsAt - now)
    return (
      <span className="toolbar-widget toolbar-timer" role="timer" aria-label={`timer: ${left} left of ${length}`} title={`Timer · ${length}`}>
        <ChromeIcon name="timer" size={16} />
        <span className="toolbar-widget-text">{left}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      className="toolbar-widget toolbar-timer toolbar-timer--ringing"
      aria-label={`Time's up: ${length} timer. Turn it off`}
      onClick={() => void window.bingbong.assistant.submit('timer off')}
    >
      <ChromeIcon name="timer" size={16} />
      <span className="toolbar-widget-text">Time’s up</span>
    </button>
  )
}

/** The song Now Playing: its title, quieter while paused or ended. */
function SongWidget({ song }: { song: NowPlaying }) {
  const state = song.ended ? 'ended' : song.paused ? 'paused' : null
  const who = song.channel === '' ? '' : ` · ${song.channel}`
  return (
    <span className={`toolbar-widget toolbar-song${state !== null ? ' toolbar-song--quiet' : ''}`} aria-label={`Now playing: ${song.title}${who}${state !== null ? `, ${state}` : ''}`} title={`${song.title}${who}`}>
      <ChromeIcon name="music" size={16} />
      <span className="toolbar-widget-text toolbar-song-title">{song.title}</span>
      {state !== null ? <span className="toolbar-song-state">{state}</span> : null}
    </span>
  )
}
