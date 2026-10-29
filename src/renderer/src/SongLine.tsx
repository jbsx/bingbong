import { songLine } from '../../core/music/nowPlaying'

/**
 * A song named by its title and its channel (#502): one piece wherever a
 * song is shown — the Toolbar's widget, the Now Playing card, the wait
 * before a song sounds (#507). A row sets them on one line, the title
 * first and the channel after a dot, quieter; a stack puts the channel on
 * a line of its own under the title. `name` prefixes each part's class
 * (`<name>-title`, `<name>-channel`) so a surface sizes them its own way.
 * A channel the title already holds is left off (songLine).
 */
export function SongLine({ song, form, name }: { song: { readonly title: string; readonly channel: string }; form: 'row' | 'stack'; name: string }) {
  const { title, channel } = songLine(song)
  return (
    <span className={`song-line song-line--${form} ${name}-line`}>
      <span className={`song-line-title ${name}-title`}>{title}</span>
      {channel === '' ? null : (
        <>
          {form === 'row' ? (
            <span className="song-line-dot" aria-hidden="true">
              {' · '}
            </span>
          ) : null}
          <span className={`song-line-channel ${name}-channel`}>{channel}</span>
        </>
      )}
    </span>
  )
}
