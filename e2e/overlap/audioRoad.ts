// The overlap gate on the audio road (#502): with audio-only music on, a
// song plays in a window never shown (src/main/music/audioSurface.ts), not
// in the pane, so what a person hears is that window's <audio> and what
// they see of the song is the dashboard's Now Playing. `--audio-only-music`
// seeds the setting into each fresh profile; the pane read takes the
// surface's media, each named by the song the surface plays, and the song's
// title the dashboard shows beside the pane's text in view.

import type { MediaState, PaneSample } from './timeline.ts'

/** The setting's file in a profile, as src/main/index.ts names it; a partial file is sanitized onto the defaults. */
export const SETTINGS_FILE = 'settings.json'
export const AUDIO_ONLY_MUSIC_SETTINGS = `${JSON.stringify({ audioOnlyMusic: true })}\n`

/** The audio surface's page: a data: URL holding the `#movie_player` the Player's scripts read. */
export const isAudioSurfaceUrl = (url: string): boolean => url.startsWith('data:text/html') && url.includes('movie_player')

/** What the surface plays: its document's title (the song's, set at each load) and its elements. */
export interface RoadRead {
  readonly title: string
  readonly media: readonly MediaState[]
}

/**
 * The pane read with the road's: the surface's media after the pane's, each
 * carrying the song's title, and the Now Playing title the dashboard shows
 * after the text in view. No road read leaves the pane's read as it was.
 */
export function withRoad<P extends Omit<PaneSample, 't'>>(pane: P, road: RoadRead | undefined, nowPlaying: string | undefined): P {
  const shown = nowPlaying?.trim() ?? ''
  const media = road === undefined ? pane.media : [...pane.media, ...road.media.map((item) => ({ ...item, title: road.title }))]
  return { ...pane, media, text: shown === '' ? pane.text : `${pane.text} ${shown}`.trim() }
}
