import { useEffect, useState } from 'react'
import { thumbnailUrl } from '../../core/music/nowPlaying'
import { songWaitAfter, songWaitWords, waitedFor, type SongWait } from '../../core/music/songWait'
import { SongLine } from './SongLine'
import { useSecondClock } from './useSecondClock'
import { MusicIcon } from './WeatherIcon'

/** The song's wait as the Player last told it (#507): folded from the pipeline stream the Capsule reads. */
export function useSongWait(): SongWait | null {
  const [wait, setWait] = useState<SongWait | null>(null)
  useEffect(() => window.bingbong.assistant.onEvent((event) => setWait((last) => songWaitAfter(last, event))), [])
  return wait
}

/**
 * The Wait Card (#507): while a song waits to sound — its stream looked
 * up on the audio road, then served — what is coming and when: the video's
 * thumbnail, its title and channel as Now Playing names them (SongLine),
 * and the wait in the Capsule's own words on its clock, at the glance
 * size: "Finding the audio, 2s", then "Playing in 4s". It closes on the
 * song's first sound, or names the watch page opened instead. It is read,
 * never acted on: no control, no focus taken.
 */
export function WaitCard({ wait }: { wait: SongWait }) {
  const now = useSecondClock(wait)
  const id = waitedFor(wait.song)
  return (
    <section className={`wait-card wait-card--${wait.kind}`} aria-label="the song coming" data-song={id ?? ''}>
      <WaitThumbnail key={id ?? ''} id={id} />
      <span className="wait-card-info">
        <span className="wait-card-count" role="status">
          {songWaitWords(wait, now)}
        </span>
        <SongLine song={{ title: wait.song.title, channel: 'channel' in wait.song ? (wait.song.channel ?? '') : '' }} form="stack" classPrefix="wait-card" />
      </span>
    </section>
  )
}

/** The video's picture over the music glyph, which shows until it loads, when it fails, or while the search has not picked it. */
function WaitThumbnail({ id }: { id: string | null }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="wait-card-thumb" aria-hidden="true">
      <MusicIcon size={56} />
      {failed || id === null ? null : <img src={thumbnailUrl(id)} alt="" onError={() => setFailed(true)} />}
    </span>
  )
}
