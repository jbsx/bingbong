import { songLine, type NamedSong } from '../../core/music/nowPlaying'

/**
 * A song named by its title and its channel (#502): one piece wherever a
 * song is shown — the Toolbar's widget, the Now Playing card, the wait
 * before a song sounds (#507). A row sets them on one line, the title
 * first and the channel after a dot, quieter; a stack puts the channel on
 * a line of its own under the title. `classPrefix` prefixes each part's
 * class (`<prefix>-title`, `<prefix>-channel`) so a surface sizes them its
 * own way.
 * A channel the title already holds is left off (songLine).
 */
export function SongLine({ song, form, classPrefix }: { song: NamedSong; form: 'row' | 'stack'; classPrefix: string }) {
  const { title, channel } = songLine(song)
  return (
    <span className={`song-line song-line--${form} ${classPrefix}-line`}>
      <span className={`song-line-title ${classPrefix}-title`}>{title}</span>
      {channel === '' ? null : (
        <>
          {form === 'row' ? (
            <span className="song-line-dot" aria-hidden="true">
              {' · '}
            </span>
          ) : null}
          <span className={`song-line-channel ${classPrefix}-channel`}>{channel}</span>
        </>
      )}
    </span>
  )
}
