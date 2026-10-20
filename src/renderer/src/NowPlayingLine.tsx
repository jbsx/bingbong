import { useState } from 'react'
import { clockTime, thumbnailUrl, type NowPlaying } from '../../core/music/nowPlaying'
import { LoopIcon, MusicIcon, PauseIcon } from './WeatherIcon'

/** The song's thumbnail, the music glyph standing in when it will not load; a pause glyph over it while paused. */
function Thumbnail({ id, paused }: { id: string; paused: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="idle-music-thumb">
      {failed ? <MusicIcon size={22} /> : <img src={thumbnailUrl(id)} alt="" onError={() => setFailed(true)} />}
      {paused ? (
        <span className="idle-music-paused">
          <PauseIcon size={20} />
        </span>
      ) : null}
    </span>
  )
}

/**
 * Now Playing (#344, CONTEXT.md), a Clock Line while the Player holds a
 * song: its thumbnail, title · channel, a loop glyph when it loops, the
 * progress and the time, and the next queued titles at the line's end. A
 * song that ran out with nothing queued stays, shown ended. The tap pauses
 * or plays it through the same Command the words are, on the pointer going
 * down as the other idle controls do — and, unlike them, keeps the Idle
 * Screen up: the music verbs need no pane (the pointer-down is stopped
 * before useIdle hears it). A Timer, running or ringing, takes no line's
 * place: it has its own clock.
 */
export function NowPlayingLine({ nowPlaying }: { nowPlaying: NowPlaying | null }) {
  if (nowPlaying === null) return null
  const { id, title, channel, elapsedS, durationS, paused, loop, ended, queued } = nowPlaying
  const fraction = ended ? 1 : durationS !== null && durationS > 0 ? Math.min(1, elapsedS / durationS) : 0
  const verb = paused || ended ? 'play' : 'pause'
  const toggle = (): void => {
    void window.bingbong.assistant.submit(verb)
  }
  return (
    <button
      type="button"
      className={`idle-line idle-music${paused ? ' idle-music--paused' : ''}${ended ? ' idle-music--ended' : ''}`}
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
      <span className="idle-line-kicker">{ended ? 'Ended' : 'Now playing'}</span>
      <span className="idle-music-title">{title}</span>
      {channel !== '' ? <span className="idle-music-channel">{channel}</span> : null}
      {loop ? <LoopIcon size={20} /> : null}
      <span className="idle-music-bar" aria-hidden="true">
        <span className="idle-music-fill" style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="idle-music-time">
        {clockTime(ended && durationS !== null ? durationS : elapsedS)}
        {durationS !== null ? ` / ${clockTime(durationS)}` : ''}
      </span>
      {ended ? (
        <span className="idle-music-next">say “play” or tap</span>
      ) : queued.length > 0 ? (
        <span className="idle-music-next">
          <span className="idle-music-next-label">Next</span> {queued.join(' · ')}
        </span>
      ) : null}
    </button>
  )
}
