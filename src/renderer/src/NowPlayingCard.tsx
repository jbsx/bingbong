import { useState } from 'react'
import { clockTime, thumbnailUrl, type NowPlaying } from '../../core/music/nowPlaying'
import type { TimerState } from '../../core/timer/timer'
import { LoopIcon, MusicIcon, PauseIcon } from './WeatherIcon'

/** The song's thumbnail, the music glyph standing in when it will not load; a pause glyph over it while paused. */
function Thumbnail({ id, paused }: { id: string; paused: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="idle-music-thumb">
      {failed ? <MusicIcon size={44} /> : <img src={thumbnailUrl(id)} alt="" onError={() => setFailed(true)} />}
      {paused ? (
        <span className="idle-music-paused">
          <PauseIcon size={40} />
        </span>
      ) : null}
    </span>
  )
}

/**
 * Now Playing (#344, CONTEXT.md), a 2×1 Card Slot while the Player holds a
 * song (a 1×1 when that is all that is left, the thumbnail over the words): its thumbnail, title and channel, how far in,
 * a loop glyph when it loops and a pause glyph when paused, and the next
 * three queued titles. A song that ran out with nothing queued stays,
 * shown ended. The tap pauses or plays it through the same Command the
 * words are, on the pointer going down as the other idle controls do —
 * and, unlike them, keeps the Idle Screen up: the music verbs need no
 * pane (the pointer-down is stopped before useIdle hears it). A ringing
 * Timer takes its place.
 */
export function NowPlayingCard({ nowPlaying, timer }: { nowPlaying: NowPlaying | null; timer: TimerState }) {
  if (nowPlaying === null || timer.status === 'ringing') return null
  const { id, title, channel, elapsedS, durationS, paused, loop, ended, queued } = nowPlaying
  const fraction = ended ? 1 : durationS !== null && durationS > 0 ? Math.min(1, elapsedS / durationS) : 0
  const verb = paused || ended ? 'play' : 'pause'
  const toggle = (): void => {
    void window.bingbong.assistant.submit(verb)
  }
  return (
    <button
      type="button"
      className={`idle-card idle-music${paused ? ' idle-music--paused' : ''}${ended ? ' idle-music--ended' : ''}`}
      aria-label={`${ended ? 'Ended' : 'Now playing'}: ${title}${channel !== '' ? ` by ${channel}` : ''}. ${verb === 'play' ? 'Play' : 'Pause'}`}
      onPointerDown={(event) => {
        event.stopPropagation()
        toggle()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') toggle()
      }}
    >
      <Thumbnail id={id} paused={paused} />
      <span className="idle-music-words">
        <span className="idle-music-kicker">
          {ended ? 'Ended · say “play” or tap' : 'Now playing'}
          {loop ? <LoopIcon size={22} /> : null}
        </span>
        <span className="idle-music-title">{title}</span>
        {channel !== '' ? <span className="idle-music-channel">{channel}</span> : null}
        <span className="idle-music-progress">
          <span className="idle-music-bar">
            <span className="idle-music-fill" style={{ width: `${fraction * 100}%` }} />
          </span>
          <span className="idle-music-time">
            {clockTime(ended && durationS !== null ? durationS : elapsedS)}
            {durationS !== null ? ` / ${clockTime(durationS)}` : ''}
          </span>
        </span>
        {queued.length > 0 ? (
          <span className="idle-music-next">
            <span className="idle-music-next-label">Next</span>
            {queued.map((next, index) => (
              <span key={index} className="idle-music-next-title">
                {next}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  )
}
